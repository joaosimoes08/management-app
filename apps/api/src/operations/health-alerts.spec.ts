import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  DEFAULT_HEALTH_THRESHOLDS, effectiveHealthThresholds, HealthAlertState, HealthDevice, healthAlertCandidates, healthAlertKey, HealthSampleRow,
  interfaceErrorRates, parseHealthAlertKey, planHealthAlerts, sustainedCpu,
} from './health-alerts';
import { KNOWN_ALERT_SOURCES } from './alert-sources';

// SNMP Phase 2 step 9: Joao's limits (answer 12), per-site/per-device overrides, dedup per device + condition, auto-resolve.
const now = new Date('2026-11-24T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
const none = (): HealthAlertState => ({ openKeys: new Set(), manuallyResolvedAt: new Map() });
const open = (...keys: string[]): HealthAlertState => ({ openKeys: new Set(keys), manuallyResolvedAt: new Map() });
const sample = (minutesAgo: number, cpu: Partial<HealthSampleRow> = {}, errors: Array<[number, number, number]> | null = null): HealthSampleRow => ({
  observedAt: ago(minutesAgo), cpu5sPercent: null, cpu1mPercent: null, cpu5mPercent: null, rebooted: false,
  interfaceErrors: errors ? errors.map(([ifIndex, inErrors, outErrors]) => ({ ifIndex, name: `Gi1/0/${ifIndex}`, inErrors: String(inErrors), outErrors: String(outErrors) })) : null, ...cpu,
});
const device = (overrides: Partial<HealthDevice> = {}, latest: Partial<HealthDevice['latest']> = {}): HealthDevice => ({
  deviceId: 'dev-1', deviceName: 'core-1', siteId: 'site-1', intervalMinutes: 5,
  latest: { observedAt: ago(1), rebootDetectedAt: null, cpu: null, memory: { usedPercent: 40 }, temperatures: [], fans: [], powerSupplies: [], unavailable: [], ...latest },
  samples: [sample(1, { cpu5mPercent: 10 }, [[1, 0, 0]]), sample(6, { cpu5mPercent: 10 }, [[1, 0, 0]])],
  thresholds: { ...DEFAULT_HEALTH_THRESHOLDS },
  ...overrides,
});
const summary = (items: Array<{ dedupKey: string; severity: string }>) => items.map((item) => [parseHealthAlertKey(item.dedupKey)!.condition, item.severity]);

test('a healthy device raises nothing', () => {
  assert.deepEqual(healthAlertCandidates(device(), none(), now).candidates, []);
});

test('defaults are Joao\'s answer 12, and SNMP_HEALTH is a known alert source', () => {
  assert.deepEqual(DEFAULT_HEALTH_THRESHOLDS, { cpuPercent: 90, cpuSustainMinutes: 5, memoryPercent: 90, temperatureHighCelsius: null, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: 10 });
  assert.ok(KNOWN_ALERT_SOURCES.includes('SNMP_HEALTH'));
});

test('CPU: a Cisco 5-minute average above 90 % is HIGH at once; exactly 90 % is not', () => {
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 91 })], 90, 5, false).active, true);
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 90 })], 90, 5, false).active, false);
  const result = healthAlertCandidates(device({ samples: [sample(1, { cpu5mPercent: 95 })] }), none(), now);
  assert.deepEqual(summary(result.candidates), [['CPU', 'HIGH']]);
  assert.equal(result.candidates[0].dedupKey, 'snmp:health:dev-1:CPU');
  assert.equal(result.candidates[0].source, 'SNMP_HEALTH');
  assert.equal(result.candidates[0].entityType, 'Device');
  assert.equal(result.candidates[0].actionHref, '/snmp?deviceId=dev-1');
});

test('CPU: a 1-minute figure (generic vendor) needs two readings 5 minutes apart above the limit', () => {
  assert.equal(sustainedCpu([sample(1, { cpu1mPercent: 99 })], 90, 5, false).active, false);
  assert.equal(sustainedCpu([sample(1, { cpu1mPercent: 99 }), sample(6, { cpu1mPercent: 95 })], 90, 5, false).active, true);
  assert.equal(sustainedCpu([sample(1, { cpu1mPercent: 99 }), sample(6, { cpu1mPercent: 50 }), sample(11, { cpu1mPercent: 99 })], 90, 5, false).active, false);
  // A longer sustain override needs more history: 15 min from 5-minute averages = three readings.
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 95 }), sample(6, { cpu5mPercent: 95 })], 90, 15, false).active, false);
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 95 }), sample(6, { cpu5mPercent: 95 }), sample(11, { cpu5mPercent: 95 })], 90, 15, false).active, true);
});

test('CPU and memory: an open alert stays until 5 points below the limit, then resolves', () => {
  const key = healthAlertKey('dev-1', 'CPU');
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 87 })], 90, 5, true).active, true);
  assert.equal(sustainedCpu([sample(1, { cpu5mPercent: 85 })], 90, 5, true).active, false);
  const memory = healthAlertCandidates(device({}, { memory: { usedPercent: 88 } }), open(healthAlertKey('dev-1', 'MEMORY')), now);
  assert.deepEqual(summary(memory.candidates), [['MEMORY', 'HIGH']]);
  const plan = planHealthAlerts([device({ samples: [sample(1, { cpu5mPercent: 20 })] })], open(key), now);
  assert.deepEqual(plan.resolveKeys, [key]);
});

test('memory above 90 % is HIGH', () => {
  assert.deepEqual(summary(healthAlertCandidates(device({}, { memory: { usedPercent: 92.4 } }), none(), now).candidates), [['MEMORY', 'HIGH']]);
  assert.deepEqual(healthAlertCandidates(device({}, { memory: { usedPercent: 90 } }), none(), now).candidates, []);
});

test('temperature: the device warning state is HIGH, critical or shutdown is CRITICAL; one alert per device', () => {
  const warn = healthAlertCandidates(device({}, { temperatures: [{ index: 1, description: 'Inlet', celsius: 52, state: 'warning' }, { index: 2, description: 'Outlet', celsius: 40, state: 'normal' }] }), none(), now);
  assert.deepEqual(summary(warn.candidates), [['TEMPERATURE', 'HIGH']]);
  assert.match(warn.candidates[0].detail, /Inlet \(52 °C\)/);
  const crit = healthAlertCandidates(device({}, { temperatures: [{ index: 1, description: 'Inlet', celsius: 52, state: 'warning' }, { index: 2, description: 'Hotspot', celsius: 110, state: 'critical' }] }), none(), now);
  assert.deepEqual(summary(crit.candidates), [['TEMPERATURE', 'CRITICAL']]);
  assert.deepEqual(summary(healthAlertCandidates(device({}, { temperatures: [{ index: 1, description: null, celsius: null, state: 'shutdown' }] }), none(), now).candidates), [['TEMPERATURE', 'CRITICAL']]);
});

test('temperature: °C limits from an override apply on top of the device state', () => {
  const thresholds = { ...DEFAULT_HEALTH_THRESHOLDS, temperatureHighCelsius: 45, temperatureCriticalCelsius: 60 };
  const at = (celsius: number, state: HealthAlertState = none()) => summary(healthAlertCandidates(device({ thresholds }, { temperatures: [{ index: 1, description: 'Inlet', celsius, state: 'normal' }] }), state, now).candidates);
  assert.deepEqual(at(44), []);
  assert.deepEqual(at(45), [['TEMPERATURE', 'HIGH']]);
  assert.deepEqual(at(61), [['TEMPERATURE', 'CRITICAL']]);
  // Open: stays until 2 °C under the limit.
  assert.deepEqual(at(43.5, open(healthAlertKey('dev-1', 'TEMPERATURE'))), [['TEMPERATURE', 'HIGH']]);
  assert.deepEqual(at(42.9, open(healthAlertKey('dev-1', 'TEMPERATURE'))), []);
});

test('power-supply and fan failures are CRITICAL; not-present units are ignored', () => {
  const result = healthAlertCandidates(device({}, {
    powerSupplies: [{ index: 1, description: 'PS1', state: 'normal' }, { index: 2, description: 'PS2', state: 'critical' }, { index: 3, description: 'PS3', state: 'notPresent' }],
    fans: [{ index: 1, description: 'Fan 1', state: 'notFunctioning' }],
  }), none(), now);
  assert.deepEqual(summary(result.candidates), [['POWER_SUPPLY', 'CRITICAL'], ['FAN', 'CRITICAL']]);
  assert.equal(result.candidates[0].detail, 'PS2: critical');
});

test('reboot is HIGH for 24 h, and stays closed once someone resolves it after the reboot', () => {
  assert.deepEqual(summary(healthAlertCandidates(device({}, { rebootDetectedAt: ago(10) }), none(), now).candidates), [['REBOOT', 'HIGH']]);
  assert.deepEqual(healthAlertCandidates(device({}, { rebootDetectedAt: ago(25 * 60) }), none(), now).candidates, []);
  const key = healthAlertKey('dev-1', 'REBOOT');
  assert.deepEqual(healthAlertCandidates(device({}, { rebootDetectedAt: ago(10) }), { openKeys: new Set(), manuallyResolvedAt: new Map([[key, ago(5)]]) }, now).candidates, []);
  // A newer reboot after the manual resolution raises it again.
  assert.deepEqual(summary(healthAlertCandidates(device({}, { rebootDetectedAt: ago(2) }), { openKeys: new Set(), manuallyResolvedAt: new Map([[key, ago(5)]]) }, now).candidates), [['REBOOT', 'HIGH']]);
});

test('interface errors: more than 10 per minute (in + out) on one interface is WARNING; counter resets are skipped', () => {
  assert.deepEqual(interfaceErrorRates(sample(1, {}, [[1, 100, 0]]), sample(6, {}, [[1, 0, 0]]))!.map((item) => item.perMinute), [20]);
  const bad = device({ samples: [sample(1, {}, [[1, 30, 30], [2, 5, 0], [3, 0, 0]]), sample(6, {}, [[1, 0, 0], [2, 0, 0], [3, 500, 0]])] });
  const result = healthAlertCandidates(bad, none(), now);
  assert.deepEqual(summary(result.candidates), [['INTERFACE_ERRORS', 'WARNING']]);
  assert.match(result.candidates[0].detail, /Gi1\/0\/1: 12 erros\/min/);
  assert.doesNotMatch(result.candidates[0].detail, /Gi1\/0\/3/);
  assert.deepEqual(healthAlertCandidates(device({ samples: [sample(1, {}, [[1, 50, 0]]), sample(6, {}, [[1, 0, 0]])] }), none(), now).candidates, []);
});

test('missing data holds the condition: neither raised nor resolved', () => {
  const keys = ['CPU', 'MEMORY', 'TEMPERATURE', 'FAN', 'POWER_SUPPLY', 'INTERFACE_ERRORS'].map((condition) => healthAlertKey('dev-1', condition as any));
  const blind = device({ samples: [sample(1)] }, { memory: null, unavailable: ['environment', 'interfaces', 'cpu', 'memory'] });
  const plan = planHealthAlerts([blind], open(...keys), now);
  assert.deepEqual(plan.candidates, []);
  assert.deepEqual(plan.resolveKeys, []);
});

test('a stale device keeps its open alerts; a device no longer polled resolves them; cleared ones resolve', () => {
  const stale = device({ deviceId: 'dev-stale' }, { observedAt: ago(20) });
  const staleKey = healthAlertKey('dev-stale', 'MEMORY');
  const goneKey = healthAlertKey('dev-gone', 'FAN');
  const clearedKey = healthAlertKey('dev-1', 'POWER_SUPPLY');
  const plan = planHealthAlerts([stale, device()], open(staleKey, goneKey, clearedKey), now);
  assert.deepEqual(plan.resolveKeys.sort(), [clearedKey, goneKey].sort());
});

test('candidates are sorted worst first', () => {
  const plan = planHealthAlerts([device({ samples: [sample(1, { cpu5mPercent: 99 })] }, { memory: { usedPercent: 95 }, powerSupplies: [{ index: 1, description: 'PS1', state: 'critical' }] })], none(), now);
  assert.deepEqual(summary(plan.candidates), [['POWER_SUPPLY', 'CRITICAL'], ['CPU', 'HIGH'], ['MEMORY', 'HIGH']]);
});

test('overrides: device beats site beats default, field by field', () => {
  const result = effectiveHealthThresholds({ cpuPercent: 80, memoryPercent: 85, interfaceErrorsPerMinute: null }, { cpuPercent: 95, temperatureHighCelsius: 50 });
  assert.deepEqual(result.values, { cpuPercent: 95, cpuSustainMinutes: 5, memoryPercent: 85, temperatureHighCelsius: 50, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: 10 });
  assert.deepEqual(result.sources, { cpuPercent: 'DEVICE', cpuSustainMinutes: 'DEFAULT', memoryPercent: 'SITE', temperatureHighCelsius: 'DEVICE', temperatureCriticalCelsius: 'DEFAULT', interfaceErrorsPerMinute: 'DEFAULT' });
  const lowered = healthAlertCandidates(device({ thresholds: { ...DEFAULT_HEALTH_THRESHOLDS, memoryPercent: 30 } }), none(), now);
  assert.deepEqual(summary(lowered.candidates), [['MEMORY', 'HIGH']]);
});

test('dedup keys parse back and reject other sources', () => {
  assert.deepEqual(parseHealthAlertKey('snmp:health:abc:FAN'), { deviceId: 'abc', condition: 'FAN' });
  assert.equal(parseHealthAlertKey('snmp:interface:down:abc:1'), null);
  assert.equal(parseHealthAlertKey('snmp:health:abc:NOPE'), null);
});
