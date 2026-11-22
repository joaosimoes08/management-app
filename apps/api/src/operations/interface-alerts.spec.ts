import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DeviceSnapshots, interfaceAlertCandidates, interfaceDownKey, interfaceUtilisationKey, planInterfaceAlerts } from './interface-alerts';

// Round 2 #7: documented link down and utilisation ≥80 % / ≥90 % of interface speed.
const now = new Date('2026-11-22T12:00:00Z');
const ago = (minutes: number) => new Date(now.getTime() - minutes * 60_000);
// 300 s between snapshots: an octet delta of N bytes is N * 8 / 300 / 1e6 Mbps.
const octetsFor = (mbps: number) => String(Math.round(mbps * 1_000_000 * 300 / 8));
const port = (ifIndex: number, overrides: Partial<DeviceSnapshots['latest']['interfaces'][number]> = {}) => ({ snapshotId: 's', ifIndex, deviceInterfaceId: `if-${ifIndex}`, name: `Gi0/${ifIndex}`, description: null, adminUp: true, operUp: true, speedMbps: 1000, counters: { hcInOctets: '0', hcOutOctets: '0' }, ...overrides });
const device = (latest: ReturnType<typeof port>[], previous: ReturnType<typeof port>[] | null, overrides: Partial<DeviceSnapshots> = {}): DeviceSnapshots => ({
  deviceId: 'dev-1', deviceName: 'core-1', siteId: 'site-1', intervalMinutes: 5,
  latest: { id: 'snap-2', observedAt: ago(1), interfaces: latest },
  previous: previous ? { id: 'snap-1', observedAt: ago(6), interfaces: previous } : null,
  ...overrides,
});

test('a documented link that is down raises HIGH; admin-down or undocumented interfaces do not', () => {
  const candidates = interfaceAlertCandidates(device([
    port(1, { operUp: false }),
    port(2, { operUp: false, adminUp: false }),
    port(3, { operUp: false, deviceInterfaceId: 'if-undocumented' }),
    port(4, { operUp: true }),
  ], null), new Set(['if-1', 'if-2', 'if-4']));
  assert.deepEqual(candidates.map((item) => [item.dedupKey, item.severity]), [[interfaceDownKey('dev-1', 1), 'HIGH']]);
  assert.equal(candidates[0].source, 'SNMP_INTERFACE');
  assert.equal(candidates[0].actionHref, '/snmp?deviceId=dev-1');
});

test('utilisation thresholds: <80 % nothing, ≥80 % WARNING, ≥90 % CRITICAL; the busier direction counts', () => {
  const before = [port(1), port(2), port(3), port(4)];
  const after = [
    port(1, { counters: { hcInOctets: octetsFor(790), hcOutOctets: '0' } }),
    port(2, { counters: { hcInOctets: '0', hcOutOctets: octetsFor(800) } }),
    port(3, { counters: { hcInOctets: octetsFor(905), hcOutOctets: octetsFor(10) } }),
    port(4, { speedMbps: 100, counters: { hcInOctets: octetsFor(85), hcOutOctets: '0' } }),
  ];
  const candidates = interfaceAlertCandidates(device(after, before), new Set());
  assert.deepEqual(candidates.map((item) => [item.dedupKey, item.severity]), [
    [interfaceUtilisationKey('dev-1', 2), 'WARNING'],
    [interfaceUtilisationKey('dev-1', 3), 'CRITICAL'],
    [interfaceUtilisationKey('dev-1', 4), 'WARNING'],
  ]);
  assert.match(candidates[1].detail ?? '', /90\.5%/);
});

test('no utilisation without a previous sample, a known speed, or with a down interface or counter reset', () => {
  const before = [port(1, { counters: { hcInOctets: octetsFor(900) } }), port(2), port(3)];
  const after = [port(1, { counters: { hcInOctets: '0' } }), port(2, { speedMbps: null, counters: { hcInOctets: octetsFor(900) } }), port(3, { operUp: false, deviceInterfaceId: null, counters: { hcInOctets: octetsFor(950) } }), port(4, { counters: { hcInOctets: octetsFor(950) } })];
  assert.deepEqual(interfaceAlertCandidates(device(after, before), new Set()), []);
});

test('plan: stale devices keep their open alerts, recovered or unpolled devices are resolved, worst first and capped', () => {
  const busy = device([port(1, { counters: { hcInOctets: octetsFor(950) } })], [port(1)]);
  const stale = device([port(1, { operUp: false })], null, { deviceId: 'dev-stale', latest: { id: 'x', observedAt: ago(30), interfaces: [port(1, { operUp: false })] } });
  const plan = planInterfaceAlerts([busy, stale], new Set(['if-1']), [
    interfaceDownKey('dev-stale', 1), // stale data: kept
    interfaceDownKey('dev-1', 7), // fresh device, link back up: resolved
    interfaceUtilisationKey('dev-gone', 1), // device no longer polled: resolved
    interfaceUtilisationKey('dev-1', 1), // still active: kept
  ], now);
  assert.deepEqual(plan.candidates.map((item) => item.dedupKey), [interfaceUtilisationKey('dev-1', 1)]);
  assert.deepEqual(plan.resolveKeys, [interfaceDownKey('dev-1', 7), interfaceUtilisationKey('dev-gone', 1)]);

  const many = Array.from({ length: 120 }, (_, index) => device([port(1, { operUp: false })], null, { deviceId: `dev-${String(index).padStart(3, '0')}` }));
  const capped = planInterfaceAlerts(many, new Set(['if-1']), [interfaceDownKey('dev-119', 1)], now);
  assert.equal(capped.candidates.length, 100);
  assert.equal(capped.total, 120);
  assert.deepEqual(capped.resolveKeys, [], 'an active alert past the cap is not resolved');
});
