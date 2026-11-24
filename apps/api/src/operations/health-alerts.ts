import { Prisma, PrismaClient } from '@simoes/database';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';

/**
 * SNMP Phase 2 step 9: polling-based health alerts (source SNMP_HEALTH) on the existing Alertas pipeline, computed from
 * the latest SnmpDeviceHealth reading and the recent SnmpDeviceHealthSample history of each enabled SNMP device.
 *
 * Joao's limits (Phase 2 answer 12), overridable per Site and per Device:
 * - CPU above 90 % sustained for 5 minutes → HIGH
 * - memory above 90 % → HIGH
 * - temperature at the device's warning level → HIGH, at its critical level → CRITICAL (or at a °C limit, when set)
 * - power-supply or fan failure → CRITICAL
 * - reboot → HIGH (kept open 24 h unless someone resolves it)
 * - interface errors above 10 per minute (input + output, one interface) → WARNING (documented default, not Joao's)
 *
 * One alert per device and condition (dedupKey snmp:health:<deviceId>:<CONDITION>). It resolves on its own when the
 * condition clears. Vendor-specific decoding stays in snmp-core's HealthVendor: this file only reads the normalised
 * snapshot (percentages, °C, component states).
 */
export const HEALTH_ALERT_SOURCE = 'SNMP_HEALTH';
export const HEALTH_ALERT_LIMIT = 200;
/** An open CPU or memory alert stays open until the value drops this many points below the limit (no flapping). */
export const HEALTH_CLEAR_MARGIN_PERCENT = 5;
/** An open temperature alert set by a °C limit stays open until the sensor is this much below it. */
export const HEALTH_CLEAR_MARGIN_CELSIUS = 2;
/** A detected reboot stays an open alert for this long, unless someone resolves it. */
export const REBOOT_ALERT_WINDOW_MS = 24 * 60 * 60 * 1000;
/** Samples read per device: enough to cover the longest CPU sustain window (60 min) at the shortest interval (5 min). */
export const HEALTH_SAMPLES_PER_DEVICE = 14;

export const HEALTH_CONDITIONS = ['CPU', 'MEMORY', 'TEMPERATURE', 'POWER_SUPPLY', 'FAN', 'REBOOT', 'INTERFACE_ERRORS'] as const;
export type HealthCondition = typeof HEALTH_CONDITIONS[number];

export type HealthThresholds = {
  cpuPercent: number;
  cpuSustainMinutes: number;
  memoryPercent: number;
  temperatureHighCelsius: number | null;
  temperatureCriticalCelsius: number | null;
  interfaceErrorsPerMinute: number;
};
export type HealthThresholdOverride = { [K in keyof HealthThresholds]?: HealthThresholds[K] | null };
export const HEALTH_THRESHOLD_FIELDS = ['cpuPercent', 'cpuSustainMinutes', 'memoryPercent', 'temperatureHighCelsius', 'temperatureCriticalCelsius', 'interfaceErrorsPerMinute'] as const satisfies ReadonlyArray<keyof HealthThresholds>;

export const DEFAULT_HEALTH_THRESHOLDS: Readonly<HealthThresholds> = Object.freeze({
  cpuPercent: 90,
  cpuSustainMinutes: 5,
  memoryPercent: 90,
  temperatureHighCelsius: null,
  temperatureCriticalCelsius: null,
  interfaceErrorsPerMinute: 10,
});

export type ThresholdSource = 'DEFAULT' | 'SITE' | 'DEVICE';

/** Field by field: device override, else site override, else default. Also says where each value came from. */
export function effectiveHealthThresholds(site?: HealthThresholdOverride | null, device?: HealthThresholdOverride | null) {
  const values = { ...DEFAULT_HEALTH_THRESHOLDS } as HealthThresholds;
  const sources = {} as Record<keyof HealthThresholds, ThresholdSource>;
  for (const field of HEALTH_THRESHOLD_FIELDS) {
    const fromDevice = device?.[field]; const fromSite = site?.[field];
    if (fromDevice !== null && fromDevice !== undefined) { (values as any)[field] = fromDevice; sources[field] = 'DEVICE'; }
    else if (fromSite !== null && fromSite !== undefined) { (values as any)[field] = fromSite; sources[field] = 'SITE'; }
    else sources[field] = 'DEFAULT';
  }
  return { values, sources };
}

export const healthAlertKey = (deviceId: string, condition: HealthCondition) => `snmp:health:${deviceId}:${condition}`;
export function parseHealthAlertKey(dedupKey: string): { deviceId: string; condition: HealthCondition } | null {
  const parts = dedupKey.split(':');
  if (parts.length !== 4 || parts[0] !== 'snmp' || parts[1] !== 'health' || !(HEALTH_CONDITIONS as readonly string[]).includes(parts[3])) return null;
  return { deviceId: parts[2], condition: parts[3] as HealthCondition };
}

type EnvironmentItem = { index: number; description: string | null; state: string };
export type HealthReading = {
  observedAt: Date;
  rebootDetectedAt: Date | null;
  bootedAt?: Date | null;
  cpu: { fiveSecondPercent: number | null; oneMinutePercent: number | null; fiveMinutePercent: number | null } | null;
  memory: { usedPercent: number | null } | null;
  temperatures: Array<EnvironmentItem & { celsius: number | null; thresholdCelsius?: number | null }>;
  fans: EnvironmentItem[];
  powerSupplies: EnvironmentItem[];
  unavailable: string[];
};
export type InterfaceErrorCounters = Array<{ ifIndex: number; name: string | null; inErrors: string | null; outErrors: string | null }>;
export type HealthSampleRow = { observedAt: Date; cpu5sPercent: number | null; cpu1mPercent: number | null; cpu5mPercent: number | null; rebooted: boolean; interfaceErrors: InterfaceErrorCounters | null };
export type HealthDevice = {
  deviceId: string; deviceName: string; siteId: string | null; intervalMinutes: number;
  latest: HealthReading;
  /** Newest first; the first one is the latest reading. */
  samples: HealthSampleRow[];
  thresholds: HealthThresholds;
};
/** Open alerts of this source, plus reboot alerts someone resolved by hand (and when). */
export type HealthAlertState = { openKeys: Set<string>; manuallyResolvedAt: Map<string, Date> };

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };
const round = (value: number) => Math.round(value * 10) / 10;
const label = (item: { description: string | null; index: number }, kind: string) => item.description || `${kind} ${item.index}`;
const failed = (state: string) => state !== 'normal' && state !== 'notPresent';

/** A device whose reading is older than twice its poll interval (plus a minute) cannot confirm a recovery. */
export function isHealthFresh(device: Pick<HealthDevice, 'intervalMinutes' | 'latest'>, now: Date) {
  return now.getTime() - device.latest.observedAt.getTime() <= (device.intervalMinutes * 2 + 1) * 60_000;
}

/**
 * The CPU figure a sample stands for, and the minutes it already averages: the device's 5-minute average when it has
 * one (Cisco), else the 1-minute load (HOST-RESOURCES), else the 5-second figure.
 */
function cpuFigure(sample: Pick<HealthSampleRow, 'cpu5sPercent' | 'cpu1mPercent' | 'cpu5mPercent'>): { value: number; minutes: number } | null {
  if (sample.cpu5mPercent !== null && sample.cpu5mPercent !== undefined) return { value: sample.cpu5mPercent, minutes: 5 };
  if (sample.cpu1mPercent !== null && sample.cpu1mPercent !== undefined) return { value: sample.cpu1mPercent, minutes: 1 };
  if (sample.cpu5sPercent !== null && sample.cpu5sPercent !== undefined) return { value: sample.cpu5sPercent, minutes: 0 };
  return null;
}

/**
 * CPU is "sustained" when the newest samples, back to back, are all above the limit and together cover at least the
 * sustain window (time between the oldest and newest of them, plus the averaging window of the oldest figure). A
 * Cisco 5-minute average above 90 % is enough on its own; a 1-minute figure needs two readings 5 minutes apart.
 */
export function sustainedCpu(samples: HealthSampleRow[], limit: number, sustainMinutes: number, open: boolean): { active: boolean; value: number | null } {
  const latest = samples[0] ? cpuFigure(samples[0]) : null;
  if (!latest) return { active: false, value: null };
  if (open) return { active: latest.value > limit - HEALTH_CLEAR_MARGIN_PERCENT, value: latest.value };
  let covered = 0;
  for (const sample of samples) {
    const figure = cpuFigure(sample);
    if (!figure || figure.value <= limit) break;
    covered = (samples[0].observedAt.getTime() - sample.observedAt.getTime()) / 60_000 + figure.minutes;
    if (covered >= sustainMinutes) return { active: true, value: latest.value };
  }
  return { active: false, value: latest.value };
}

const counter = (value: string | null) => (value !== null && /^\d+$/.test(value) ? BigInt(value) : null);

/** Errors per minute per interface between two samples. Counter drops (reboot, clear counters) are skipped. */
export function interfaceErrorRates(latest: HealthSampleRow, previous: HealthSampleRow) {
  const minutes = (latest.observedAt.getTime() - previous.observedAt.getTime()) / 60_000;
  if (!(minutes > 0) || latest.rebooted || !latest.interfaceErrors || !previous.interfaceErrors) return null;
  const before = new Map(previous.interfaceErrors.map((item) => [item.ifIndex, item]));
  const rates: Array<{ ifIndex: number; name: string | null; perMinute: number; errors: bigint }> = [];
  for (const item of latest.interfaceErrors) {
    const old = before.get(item.ifIndex);
    if (!old) continue;
    const now = (counter(item.inErrors) ?? 0n) + (counter(item.outErrors) ?? 0n);
    const then = (counter(old.inErrors) ?? 0n) + (counter(old.outErrors) ?? 0n);
    if (now < then) continue;
    const errors = now - then;
    rates.push({ ifIndex: item.ifIndex, name: item.name, perMinute: Number(errors) / minutes, errors });
  }
  return rates;
}

/**
 * Candidates and held keys for one device. A held key belongs to a condition whose data is missing this time (MIB not
 * answered, no previous sample): its open alert is neither raised again nor resolved.
 */
export function healthAlertCandidates(device: HealthDevice, state: HealthAlertState, now: Date): { candidates: UpsertOperationalAlert[]; held: string[] } {
  const candidates: UpsertOperationalAlert[] = [];
  const held: string[] = [];
  const t = device.thresholds;
  const href = `/snmp?deviceId=${device.deviceId}`;
  const isOpen = (condition: HealthCondition) => state.openKeys.has(healthAlertKey(device.deviceId, condition));
  const push = (condition: HealthCondition, severity: AlertSeverityDto, title: string, detail: string) => candidates.push({
    dedupKey: healthAlertKey(device.deviceId, condition), source: HEALTH_ALERT_SOURCE, severity, siteId: device.siteId ?? undefined,
    entityType: 'Device', entityId: device.deviceId, title, detail, actionHref: href,
  });
  const hold = (condition: HealthCondition) => held.push(healthAlertKey(device.deviceId, condition));
  const unavailable = new Set(device.latest.unavailable);

  // CPU
  const cpu = sustainedCpu(device.samples, t.cpuPercent, t.cpuSustainMinutes, isOpen('CPU'));
  if (cpu.value === null) hold('CPU');
  else if (cpu.active) push('CPU', AlertSeverityDto.HIGH, `CPU elevada em ${device.deviceName}`,
    `CPU a ${round(cpu.value)}%, acima de ${t.cpuPercent}% durante pelo menos ${t.cpuSustainMinutes} min. Resolve-se sozinho abaixo de ${t.cpuPercent - HEALTH_CLEAR_MARGIN_PERCENT}%.`);

  // Memory
  const memory = device.latest.memory?.usedPercent ?? null;
  if (memory === null) hold('MEMORY');
  else if (memory > (isOpen('MEMORY') ? t.memoryPercent - HEALTH_CLEAR_MARGIN_PERCENT : t.memoryPercent)) push('MEMORY', AlertSeverityDto.HIGH, `Memória elevada em ${device.deviceName}`,
    `Memória usada a ${round(memory)}%, acima de ${t.memoryPercent}%. Resolve-se sozinho abaixo de ${t.memoryPercent - HEALTH_CLEAR_MARGIN_PERCENT}%.`);

  // Environment: temperature, power supplies, fans
  if (unavailable.has('environment')) { hold('TEMPERATURE'); hold('POWER_SUPPLY'); hold('FAN'); }
  else {
    const tempOpen = isOpen('TEMPERATURE');
    const margin = tempOpen ? HEALTH_CLEAR_MARGIN_CELSIUS : 0;
    const hot: Array<{ text: string; critical: boolean }> = [];
    for (const item of device.latest.temperatures) {
      const name = label(item, 'Sensor');
      const reading = item.celsius === null ? '' : ` (${item.celsius} °C)`;
      const byState = item.state === 'critical' || item.state === 'shutdown' ? 'critical' : item.state === 'warning' || item.state === 'notFunctioning' ? 'warning' : null;
      const byCritical = t.temperatureCriticalCelsius !== null && item.celsius !== null && item.celsius >= t.temperatureCriticalCelsius - margin;
      const byHigh = t.temperatureHighCelsius !== null && item.celsius !== null && item.celsius >= t.temperatureHighCelsius - margin;
      if (byState === 'critical' || byCritical) hot.push({ critical: true, text: `${name}${reading}: ${byState === 'critical' ? `estado ${item.state} no equipamento` : `≥ ${t.temperatureCriticalCelsius} °C`}` });
      else if (byState === 'warning' || byHigh) hot.push({ critical: false, text: `${name}${reading}: ${byState === 'warning' ? `estado ${item.state} no equipamento` : `≥ ${t.temperatureHighCelsius} °C`}` });
    }
    if (hot.length) {
      const critical = hot.some((item) => item.critical);
      push('TEMPERATURE', critical ? AlertSeverityDto.CRITICAL : AlertSeverityDto.HIGH, `Temperatura ${critical ? 'crítica' : 'elevada'} em ${device.deviceName}`, hot.map((item) => item.text).join('; '));
    }
    const psu = device.latest.powerSupplies.filter((item) => failed(item.state));
    if (psu.length) push('POWER_SUPPLY', AlertSeverityDto.CRITICAL, `Falha de fonte de alimentação em ${device.deviceName}`, psu.map((item) => `${label(item, 'Fonte')}: ${item.state}`).join('; '));
    const fans = device.latest.fans.filter((item) => failed(item.state));
    if (fans.length) push('FAN', AlertSeverityDto.CRITICAL, `Falha de ventoinha em ${device.deviceName}`, fans.map((item) => `${label(item, 'Ventoinha')}: ${item.state}`).join('; '));
  }

  // Reboot: open for 24 h after detection, unless someone resolved it after the reboot was seen.
  const rebootAt = device.latest.rebootDetectedAt;
  const rebootKey = healthAlertKey(device.deviceId, 'REBOOT');
  const resolvedByHand = state.manuallyResolvedAt.get(rebootKey);
  if (rebootAt && now.getTime() - rebootAt.getTime() < REBOOT_ALERT_WINDOW_MS && !(resolvedByHand && resolvedByHand.getTime() >= rebootAt.getTime())) {
    push('REBOOT', AlertSeverityDto.HIGH, `Reinício detetado em ${device.deviceName}`,
      `O equipamento reiniciou (sysUpTime voltou atrás). Detetado em ${rebootAt.toISOString()}${device.latest.bootedAt ? `; arranque estimado em ${device.latest.bootedAt.toISOString()}` : ''}. Fecha-se sozinho 24 h depois.`);
  }

  // Interface errors between the two latest samples.
  const [latest, previous] = device.samples;
  const rates = latest && previous ? interfaceErrorRates(latest, previous) : null;
  if (!rates || unavailable.has('interfaces')) hold('INTERFACE_ERRORS');
  else {
    const limit = isOpen('INTERFACE_ERRORS') ? t.interfaceErrorsPerMinute / 2 : t.interfaceErrorsPerMinute;
    const bad = rates.filter((item) => item.perMinute > limit).sort((a, b) => b.perMinute - a.perMinute);
    if (bad.length) push('INTERFACE_ERRORS', AlertSeverityDto.WARNING, `Erros de interface em ${device.deviceName}`,
      `${bad.slice(0, 5).map((item) => `${item.name ?? `ifIndex ${item.ifIndex}`}: ${round(item.perMinute)} erros/min`).join('; ')}${bad.length > 5 ? ` (+${bad.length - 5})` : ''}. Limite: ${t.interfaceErrorsPerMinute} erros/min (entrada + saída).`);
  }
  return { candidates, held };
}

/**
 * Plans one reconciliation: candidates (worst first, at most HEALTH_ALERT_LIMIT) and open keys to resolve. A key is
 * resolved only when its device has fresh data (or is no longer polled), its data was there this time, and the full
 * candidate list no longer contains it, so truncation or a missing MIB never resolves an active alert.
 */
export function planHealthAlerts(devices: HealthDevice[], state: HealthAlertState, now: Date) {
  const stale = new Set(devices.filter((device) => !isHealthFresh(device, now)).map((device) => device.deviceId));
  const held = new Set<string>();
  const all: UpsertOperationalAlert[] = [];
  for (const device of devices) {
    if (stale.has(device.deviceId)) continue;
    const result = healthAlertCandidates(device, state, now);
    all.push(...result.candidates);
    for (const key of result.held) held.add(key);
  }
  all.sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9) || left.dedupKey.localeCompare(right.dedupKey));
  const active = new Set(all.map((candidate) => candidate.dedupKey));
  const resolveKeys = [...state.openKeys].filter((key) => !active.has(key) && !held.has(key) && !stale.has(parseHealthAlertKey(key)?.deviceId ?? ''));
  return { candidates: all.slice(0, HEALTH_ALERT_LIMIT), total: all.length, resolveKeys };
}

type SnapshotData = Partial<Pick<HealthReading, 'temperatures' | 'fans' | 'powerSupplies' | 'unavailable'>>;

/** Loads the latest reading, recent samples and limits of each enabled, non-retired SNMP device and plans the alerts. */
export async function collectHealthAlerts(prisma: PrismaClient, now = new Date()) {
  const [rows, alerts] = await Promise.all([
    prisma.snmpDeviceHealth.findMany({
      where: { device: { status: { not: 'RETIRED' }, snmpConfig: { enabled: true } } },
      select: { deviceId: true, observedAt: true, bootedAt: true, rebootDetectedAt: true, cpu5sPercent: true, cpu1mPercent: true, cpu5mPercent: true, memoryUsedPercent: true, data: true, device: { select: { name: true, siteId: true, snmpConfig: { select: { intervalMinutes: true } } } } },
    }),
    prisma.operationalAlert.findMany({
      where: { source: HEALTH_ALERT_SOURCE, OR: [{ status: { not: 'RESOLVED' } }, { status: 'RESOLVED', resolvedById: { not: null }, resolvedAt: { gte: new Date(now.getTime() - REBOOT_ALERT_WINDOW_MS) } }] },
      select: { dedupKey: true, status: true, resolvedAt: true },
    }),
  ]);
  const state: HealthAlertState = { openKeys: new Set(), manuallyResolvedAt: new Map() };
  for (const alert of alerts) {
    if (alert.status !== 'RESOLVED') state.openKeys.add(alert.dedupKey);
    else if (alert.resolvedAt) state.manuallyResolvedAt.set(alert.dedupKey, alert.resolvedAt);
  }
  if (!rows.length) return { ...planHealthAlerts([], state, now), devices: 0 };
  const deviceIds = rows.map((row) => row.deviceId);
  const siteIds = [...new Set(rows.map((row) => row.device.siteId).filter((id): id is string => Boolean(id)))];
  const [samples, overrides] = await Promise.all([
    prisma.$queryRaw<Array<HealthSampleRow & { deviceId: string }>>(Prisma.sql`
      SELECT d."deviceId", s."observedAt", s."cpu5sPercent", s."cpu1mPercent", s."cpu5mPercent", s."rebooted", s."interfaceErrors"
      FROM unnest(${deviceIds}::uuid[]) AS d("deviceId")
      CROSS JOIN LATERAL (
        SELECT "observedAt", "cpu5sPercent", "cpu1mPercent", "cpu5mPercent", "rebooted", "interfaceErrors"
        FROM "SnmpDeviceHealthSample" WHERE "deviceId" = d."deviceId" ORDER BY "observedAt" DESC LIMIT ${HEALTH_SAMPLES_PER_DEVICE}
      ) s
      ORDER BY d."deviceId", s."observedAt" DESC`),
    prisma.snmpHealthThreshold.findMany({ where: { OR: [{ deviceId: { in: deviceIds } }, ...(siteIds.length ? [{ siteId: { in: siteIds } }] : [])] } }),
  ]);
  const bySample = new Map<string, HealthSampleRow[]>();
  for (const sample of samples) bySample.set(sample.deviceId, [...(bySample.get(sample.deviceId) ?? []), { ...sample, interfaceErrors: Array.isArray(sample.interfaceErrors) ? sample.interfaceErrors : null }]);
  const siteOverride = new Map(overrides.filter((item) => item.siteId).map((item) => [item.siteId!, item]));
  const deviceOverride = new Map(overrides.filter((item) => item.deviceId).map((item) => [item.deviceId!, item]));
  const devices: HealthDevice[] = rows.map((row) => {
    const data = (row.data && typeof row.data === 'object' ? row.data : {}) as SnapshotData;
    return {
      deviceId: row.deviceId, deviceName: row.device.name, siteId: row.device.siteId, intervalMinutes: row.device.snmpConfig?.intervalMinutes ?? 5,
      latest: {
        observedAt: row.observedAt, rebootDetectedAt: row.rebootDetectedAt, bootedAt: row.bootedAt,
        cpu: { fiveSecondPercent: row.cpu5sPercent, oneMinutePercent: row.cpu1mPercent, fiveMinutePercent: row.cpu5mPercent },
        memory: { usedPercent: row.memoryUsedPercent },
        temperatures: Array.isArray(data.temperatures) ? data.temperatures : [],
        fans: Array.isArray(data.fans) ? data.fans : [],
        powerSupplies: Array.isArray(data.powerSupplies) ? data.powerSupplies : [],
        unavailable: Array.isArray(data.unavailable) ? data.unavailable : [],
      },
      // The latest reading always counts as the newest sample, even if its history row is missing.
      samples: withLatest(bySample.get(row.deviceId) ?? [], row),
      thresholds: effectiveHealthThresholds(row.device.siteId ? siteOverride.get(row.device.siteId) : null, deviceOverride.get(row.deviceId)).values,
    };
  });
  return { ...planHealthAlerts(devices, state, now), devices: devices.length };
}

function withLatest(samples: HealthSampleRow[], row: { observedAt: Date; cpu5sPercent: number | null; cpu1mPercent: number | null; cpu5mPercent: number | null }) {
  if (samples[0] && samples[0].observedAt.getTime() === row.observedAt.getTime()) return samples;
  return [{ observedAt: row.observedAt, cpu5sPercent: row.cpu5sPercent, cpu1mPercent: row.cpu1mPercent, cpu5mPercent: row.cpu5mPercent, rebooted: false, interfaceErrors: null }, ...samples];
}
