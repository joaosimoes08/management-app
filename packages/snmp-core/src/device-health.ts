/**
 * SNMP Phase 2 step 8: device health from polling (inventory, CPU, memory, interface errors, environment, stack,
 * reboot detection). Everything here is pure: the SNMP app walks the subtrees a vendor asks for, turns each varbind
 * into a plain value and hands the map to the vendor's parser. Vendor-specific OIDs and decoders stay behind
 * HealthVendor (Joao's Phase 2 answer 15: Cisco first, prepared for every brand); GENERIC_VENDOR reads only
 * standard MIBs. No thresholds here: limits and alerts are step 9.
 */

/** A varbind value after normalisation: integers, gauges, counters and timeticks as numbers, Counter64 as a decimal
 * string, OCTET STRING as text (or hex when not printable), OIDs as dotted strings without a leading dot. */
export type SnmpScalar = string | number;
/** Full OID (no leading dot) -> value. */
export type SnmpWalk = Map<string, SnmpScalar>;

export type HealthSection = 'entity' | 'interfaces' | 'cpu' | 'memory' | 'environment' | 'stack';
export type EnvironmentState = 'normal' | 'warning' | 'critical' | 'shutdown' | 'notPresent' | 'notFunctioning' | 'unknown';
export type HealthStatus = 'OK' | 'DEGRADED' | 'UNKNOWN';

export type HealthIssue = {
  code: 'POWER_SUPPLY_FAULT' | 'FAN_FAULT' | 'TEMPERATURE_STATE' | 'STACK_MEMBER_NOT_READY' | 'STACK_RING_NOT_REDUNDANT' | 'REBOOT_DETECTED';
  component: string;
  state: string;
};

export type DeviceHealthSnapshot = {
  vendor: string;
  status: HealthStatus;
  uptimeTicks: number | null;
  inventory: Array<{ index: number; class: string; containedIn: number | null; name: string | null; description: string | null; model: string | null; serial: string | null; softwareRev: string | null }>;
  cpus: Array<{ index: number; physicalIndex: number | null; name: string | null; fiveSecondPercent: number | null; oneMinutePercent: number | null; fiveMinutePercent: number | null }>;
  /** Highest load across CPUs (a stack reports one CPU per member). */
  cpu: { fiveSecondPercent: number | null; oneMinutePercent: number | null; fiveMinutePercent: number | null } | null;
  memoryPools: Array<{ index: number; name: string; usedBytes: string; freeBytes: string; usedPercent: number | null }>;
  /** The main memory figure: Cisco "Processor" pool, otherwise the first pool / RAM entry. */
  memory: { name: string; usedBytes: string; totalBytes: string; usedPercent: number | null } | null;
  temperatures: Array<{ index: number; description: string | null; celsius: number | null; thresholdCelsius: number | null; state: EnvironmentState }>;
  fans: Array<{ index: number; description: string | null; state: EnvironmentState }>;
  powerSupplies: Array<{ index: number; description: string | null; state: EnvironmentState; source: string | null }>;
  stack: { ringRedundant: boolean | null; members: Array<{ index: number; switchNumber: number | null; name: string | null; role: string; priority: number | null; state: string; ready: boolean; macAddress: string | null }> } | null;
  /** IF-MIB error/discard counters (raw, cumulative) and octets (64-bit ifHC* when the device has them). */
  interfaces: Array<{ ifIndex: number; name: string | null; operUp: boolean | null; inErrors: string | null; outErrors: string | null; inDiscards: string | null; outDiscards: string | null; inOctets: string | null; outOctets: string | null; highCapacity: boolean }>;
  /** Faults the device itself reports (component state, stack readiness, reboot). Threshold checks are step 9. */
  issues: HealthIssue[];
  /** Sections the device did not answer (absent MIB or failed walk). */
  unavailable: HealthSection[];
};

export interface HealthVendor {
  id: string;
  matches(sysObjectId: string | null | undefined): boolean;
  /** Subtrees to walk, per section. A section whose walks fail or come back empty is reported as unavailable. */
  walks: Partial<Record<HealthSection, string[]>>;
  parse(walk: SnmpWalk, context: { uptimeTicks: number | null; failedSections?: HealthSection[] }): DeviceHealthSnapshot;
}

export const HEALTH_OIDS = {
  entPhysicalEntry: '1.3.6.1.2.1.47.1.1.1.1',
  ifEntry: '1.3.6.1.2.1.2.2.1',
  ifXEntry: '1.3.6.1.2.1.31.1.1.1',
  hrProcessorLoad: '1.3.6.1.2.1.25.3.3.1.2',
  hrStorageEntry: '1.3.6.1.2.1.25.2.3.1',
  hrStorageRam: '1.3.6.1.2.1.25.2.1.2',
  cpmCPUTotalEntry: '1.3.6.1.4.1.9.9.109.1.1.1.1',
  ciscoMemoryPoolEntry: '1.3.6.1.4.1.9.9.48.1.1.1',
  ciscoEnvMonTemperatureStatusEntry: '1.3.6.1.4.1.9.9.13.1.3.1',
  ciscoEnvMonFanStatusEntry: '1.3.6.1.4.1.9.9.13.1.4.1',
  ciscoEnvMonSupplyStatusEntry: '1.3.6.1.4.1.9.9.13.1.5.1',
  cswRingRedundant: '1.3.6.1.4.1.9.9.500.1.1.3',
  cswSwitchInfoEntry: '1.3.6.1.4.1.9.9.500.1.2.1.1',
} as const;

const column = (entry: string, ...columns: number[]) => columns.map((item) => `${entry}.${item}`);

/** Standard-MIB walks every vendor reuses. */
const STANDARD_WALKS: Partial<Record<HealthSection, string[]>> = {
  // entPhysicalDescr, ContainedIn, Class, Name, SoftwareRev, SerialNum, ModelName
  entity: column(HEALTH_OIDS.entPhysicalEntry, 2, 4, 5, 7, 10, 11, 13),
  // ifInOctets, ifInDiscards, ifInErrors, ifOutOctets, ifOutDiscards, ifOutErrors, ifOperStatus; ifName, ifHCInOctets, ifHCOutOctets
  interfaces: [...column(HEALTH_OIDS.ifEntry, 8, 10, 13, 14, 16, 19, 20), ...column(HEALTH_OIDS.ifXEntry, 1, 6, 10)],
};

/** Rows of a table: index suffix (as a string, usually one integer) -> column -> value. */
export function tableRows(walk: SnmpWalk, entry: string): Map<string, Map<number, SnmpScalar>> {
  const prefix = `${entry}.`;
  const rows = new Map<string, Map<number, SnmpScalar>>();
  for (const [oid, value] of walk) {
    if (!oid.startsWith(prefix)) continue;
    const rest = oid.slice(prefix.length);
    const dot = rest.indexOf('.');
    if (dot < 1) continue;
    const col = Number(rest.slice(0, dot));
    const index = rest.slice(dot + 1);
    if (!Number.isInteger(col) || !index) continue;
    if (!rows.has(index)) rows.set(index, new Map());
    rows.get(index)!.set(col, value);
  }
  return rows;
}

const num = (value: SnmpScalar | undefined): number | null => {
  if (value === undefined || value === '') return null;
  const parsed = typeof value === 'number' ? value : Number(value);
  return Number.isFinite(parsed) ? parsed : null;
};
const text = (value: SnmpScalar | undefined): string | null => (value === undefined || value === '' ? null : String(value));
const counter = (value: SnmpScalar | undefined): string | null => {
  if (value === undefined || value === '') return null;
  const asText = typeof value === 'number' ? String(Math.trunc(value)) : value;
  return /^\d+$/.test(asText) ? asText : null;
};
const percentOf = (used: bigint, total: bigint) => (total > 0n ? Math.round(Number((used * 10000n) / total)) / 100 : null);
const toBigInt = (value: SnmpScalar | undefined): bigint | null => { const digits = counter(value); return digits === null ? null : BigInt(digits); };
const intIndex = (index: string) => Number(index);
const maxOf = (values: Array<number | null>) => { const present = values.filter((item): item is number => item !== null); return present.length ? Math.max(...present) : null; };

const ENTITY_CLASSES: Record<number, string> = { 1: 'other', 2: 'unknown', 3: 'chassis', 4: 'backplane', 5: 'container', 6: 'powerSupply', 7: 'fan', 8: 'sensor', 9: 'module', 10: 'port', 11: 'stack', 12: 'cpu' };

function parseInventory(walk: SnmpWalk): DeviceHealthSnapshot['inventory'] {
  return [...tableRows(walk, HEALTH_OIDS.entPhysicalEntry)]
    .map(([index, row]) => ({
      index: intIndex(index),
      class: ENTITY_CLASSES[num(row.get(5)) ?? 2] ?? 'unknown',
      containedIn: num(row.get(4)),
      name: text(row.get(7)), description: text(row.get(2)), model: text(row.get(13)), serial: text(row.get(11)), softwareRev: text(row.get(10)),
    }))
    .filter((item) => Number.isInteger(item.index))
    .sort((a, b) => a.index - b.index);
}

function parseInterfaces(walk: SnmpWalk): DeviceHealthSnapshot['interfaces'] {
  const base = tableRows(walk, HEALTH_OIDS.ifEntry);
  const extended = tableRows(walk, HEALTH_OIDS.ifXEntry);
  const indexes = new Set([...base.keys(), ...extended.keys()]);
  return [...indexes].map((index) => {
    const row = base.get(index) ?? new Map<number, SnmpScalar>();
    const x = extended.get(index) ?? new Map<number, SnmpScalar>();
    const hcIn = counter(x.get(6)); const hcOut = counter(x.get(10));
    const oper = num(row.get(8));
    return {
      ifIndex: intIndex(index), name: text(x.get(1)), operUp: oper === null ? null : oper === 1,
      inErrors: counter(row.get(14)), outErrors: counter(row.get(20)), inDiscards: counter(row.get(13)), outDiscards: counter(row.get(19)),
      inOctets: hcIn ?? counter(row.get(10)), outOctets: hcOut ?? counter(row.get(16)), highCapacity: hcIn !== null || hcOut !== null,
    };
  }).filter((item) => Number.isInteger(item.ifIndex)).sort((a, b) => a.ifIndex - b.ifIndex);
}

function summarise(snapshot: Omit<DeviceHealthSnapshot, 'status' | 'issues'>, issues: HealthIssue[]): DeviceHealthSnapshot {
  const anyData = snapshot.uptimeTicks !== null || snapshot.inventory.length > 0 || snapshot.cpus.length > 0 || snapshot.memoryPools.length > 0 || snapshot.interfaces.length > 0;
  return { ...snapshot, issues, status: issues.length ? 'DEGRADED' : anyData ? 'OK' : 'UNKNOWN' };
}

function unavailableSections(walk: SnmpWalk, walks: HealthVendor['walks'], failed: HealthSection[] = []) {
  const missing = new Set<HealthSection>(failed);
  const keys = [...walk.keys()];
  for (const [section, oids] of Object.entries(walks) as Array<[HealthSection, string[]]>) {
    if (!oids.some((oid) => keys.some((key) => key.startsWith(`${oid}.`)))) missing.add(section);
  }
  return [...missing].sort();
}

// ---------------------------------------------------------------------------------------------------------------
// Generic vendor: standard MIBs only (ENTITY-MIB, IF-MIB, HOST-RESOURCES-MIB).

export const GENERIC_VENDOR: HealthVendor = {
  id: 'generic',
  matches: () => true,
  walks: {
    ...STANDARD_WALKS,
    cpu: [HEALTH_OIDS.hrProcessorLoad],
    // hrStorageType, Descr, AllocationUnits, Size, Used
    memory: column(HEALTH_OIDS.hrStorageEntry, 2, 3, 4, 5, 6),
  },
  parse(walk, context) {
    const loads = [...tableRows(walk, '1.3.6.1.2.1.25.3.3.1')].filter(([, row]) => row.has(2)).map(([index, row]) => ({ index: intIndex(index), load: num(row.get(2)) }));
    // hrProcessorLoad is the average over the last minute.
    const cpus = loads.map((item) => ({ index: item.index, physicalIndex: null, name: null, fiveSecondPercent: null, oneMinutePercent: item.load, fiveMinutePercent: null }));
    const memoryPools = [...tableRows(walk, HEALTH_OIDS.hrStorageEntry)]
      .filter(([, row]) => String(row.get(2) ?? '').replace(/^\./, '') === HEALTH_OIDS.hrStorageRam)
      .flatMap(([index, row]) => {
        const unit = toBigInt(row.get(4)); const size = toBigInt(row.get(5)); const used = toBigInt(row.get(6));
        if (unit === null || size === null || used === null) return [];
        const usedBytes = used * unit; const totalBytes = size * unit;
        return [{ index: intIndex(index), name: text(row.get(3)) ?? 'RAM', usedBytes: String(usedBytes), freeBytes: String(totalBytes - usedBytes), usedPercent: percentOf(usedBytes, totalBytes) }];
      });
    const first = memoryPools[0];
    return summarise({
      vendor: 'generic', uptimeTicks: context.uptimeTicks,
      inventory: parseInventory(walk), interfaces: parseInterfaces(walk),
      cpus, cpu: cpus.length ? { fiveSecondPercent: null, oneMinutePercent: maxOf(cpus.map((item) => item.oneMinutePercent)), fiveMinutePercent: null } : null,
      memoryPools, memory: first ? { name: first.name, usedBytes: first.usedBytes, totalBytes: String(BigInt(first.usedBytes) + BigInt(first.freeBytes)), usedPercent: first.usedPercent } : null,
      temperatures: [], fans: [], powerSupplies: [], stack: null,
      unavailable: unavailableSections(walk, this.walks, context.failedSections),
    }, []);
  },
};

// ---------------------------------------------------------------------------------------------------------------
// Cisco: CISCO-PROCESS-MIB, CISCO-MEMORY-POOL-MIB, CISCO-ENVMON-MIB, CISCO-STACKWISE-MIB on top of the standard MIBs.

const ENVMON_STATES: Record<number, EnvironmentState> = { 1: 'normal', 2: 'warning', 3: 'critical', 4: 'shutdown', 5: 'notPresent', 6: 'notFunctioning' };
const SUPPLY_SOURCES: Record<number, string> = { 1: 'unknown', 2: 'ac', 3: 'dc', 4: 'externalPowerSupply', 5: 'internalRedundant' };
const STACK_ROLES: Record<number, string> = { 1: 'master', 2: 'member', 3: 'notMember', 4: 'standby' };
const STACK_STATES: Record<number, string> = { 1: 'waiting', 2: 'progressing', 3: 'added', 4: 'ready', 5: 'sdmMismatch', 6: 'verMismatch', 7: 'featureMismatch', 8: 'newMasterInit', 9: 'provisioned', 10: 'invalid', 11: 'removed' };

export const CISCO_ENTERPRISE_OID = '1.3.6.1.4.1.9';

function macAddress(value: SnmpScalar | undefined) {
  const raw = text(value);
  if (!raw) return null;
  const hex = raw.replace(/[^0-9a-f]/gi, '');
  return hex.length === 12 ? hex.toLowerCase().match(/.{2}/g)!.join(':') : raw;
}

export const CISCO_VENDOR: HealthVendor = {
  id: 'cisco',
  matches: (sysObjectId) => {
    const oid = String(sysObjectId ?? '').replace(/^\./, '');
    return oid === CISCO_ENTERPRISE_OID || oid.startsWith(`${CISCO_ENTERPRISE_OID}.`);
  },
  walks: {
    ...STANDARD_WALKS,
    // cpmCPUTotalPhysicalIndex, 5sec/1min/5minRev and (IOS XE) cpmCPUMemoryHCUsed/HCFree in KB.
    cpu: column(HEALTH_OIDS.cpmCPUTotalEntry, 2, 6, 7, 8),
    // ciscoMemoryPoolName, Used, Free; cpmCPUMemoryHCUsed/HCFree as a fallback on platforms without memory pools.
    memory: [...column(HEALTH_OIDS.ciscoMemoryPoolEntry, 2, 5, 6), ...column(HEALTH_OIDS.cpmCPUTotalEntry, 17, 19)],
    environment: [
      ...column(HEALTH_OIDS.ciscoEnvMonTemperatureStatusEntry, 2, 3, 4, 6),
      ...column(HEALTH_OIDS.ciscoEnvMonFanStatusEntry, 2, 3),
      ...column(HEALTH_OIDS.ciscoEnvMonSupplyStatusEntry, 2, 3, 4),
    ],
    stack: [HEALTH_OIDS.cswRingRedundant, ...column(HEALTH_OIDS.cswSwitchInfoEntry, 1, 3, 4, 6, 7)],
  },
  parse(walk, context) {
    const inventory = parseInventory(walk);
    const entityName = new Map(inventory.map((item) => [item.index, item.name ?? item.description]));

    const cpus = [...tableRows(walk, HEALTH_OIDS.cpmCPUTotalEntry)]
      .filter(([, row]) => row.has(6) || row.has(7) || row.has(8))
      .map(([index, row]) => {
        const physicalIndex = num(row.get(2));
        return { index: intIndex(index), physicalIndex: physicalIndex || null, name: physicalIndex ? entityName.get(physicalIndex) ?? null : null, fiveSecondPercent: num(row.get(6)), oneMinutePercent: num(row.get(7)), fiveMinutePercent: num(row.get(8)) };
      })
      .sort((a, b) => a.index - b.index);

    let memoryPools: DeviceHealthSnapshot['memoryPools'] = [...tableRows(walk, HEALTH_OIDS.ciscoMemoryPoolEntry)].flatMap(([index, row]) => {
      const used = toBigInt(row.get(5)); const free = toBigInt(row.get(6));
      if (used === null || free === null) return [];
      return [{ index: intIndex(index), name: text(row.get(2)) ?? `pool ${index}`, usedBytes: String(used), freeBytes: String(free), usedPercent: percentOf(used, used + free) }];
    }).sort((a, b) => a.index - b.index);
    if (!memoryPools.length) {
      memoryPools = [...tableRows(walk, HEALTH_OIDS.cpmCPUTotalEntry)].flatMap(([index, row]) => {
        const usedKb = toBigInt(row.get(17)); const freeKb = toBigInt(row.get(19));
        if (usedKb === null || freeKb === null) return [];
        const physicalIndex = num(row.get(2));
        return [{ index: intIndex(index), name: (physicalIndex && entityName.get(physicalIndex)) || `CPU ${index}`, usedBytes: String(usedKb * 1024n), freeBytes: String(freeKb * 1024n), usedPercent: percentOf(usedKb, usedKb + freeKb) }];
      });
    }
    const mainPool = memoryPools.find((item) => item.name.toLowerCase() === 'processor') ?? memoryPools[0];

    const envState = (value: SnmpScalar | undefined): EnvironmentState => ENVMON_STATES[num(value) ?? 0] ?? 'unknown';
    const temperatures = [...tableRows(walk, HEALTH_OIDS.ciscoEnvMonTemperatureStatusEntry)].map(([index, row]) => ({ index: intIndex(index), description: text(row.get(2)), celsius: num(row.get(3)), thresholdCelsius: num(row.get(4)), state: envState(row.get(6)) })).sort((a, b) => a.index - b.index);
    const fans = [...tableRows(walk, HEALTH_OIDS.ciscoEnvMonFanStatusEntry)].map(([index, row]) => ({ index: intIndex(index), description: text(row.get(2)), state: envState(row.get(3)) })).sort((a, b) => a.index - b.index);
    const powerSupplies = [...tableRows(walk, HEALTH_OIDS.ciscoEnvMonSupplyStatusEntry)].map(([index, row]) => ({ index: intIndex(index), description: text(row.get(2)), state: envState(row.get(3)), source: SUPPLY_SOURCES[num(row.get(4)) ?? 0] ?? null })).sort((a, b) => a.index - b.index);

    const members = [...tableRows(walk, HEALTH_OIDS.cswSwitchInfoEntry)].map(([index, row]) => {
      const state = STACK_STATES[num(row.get(6)) ?? 0] ?? 'unknown';
      return { index: intIndex(index), switchNumber: num(row.get(1)), name: entityName.get(intIndex(index)) ?? null, role: STACK_ROLES[num(row.get(3)) ?? 0] ?? 'unknown', priority: num(row.get(4)), state, ready: state === 'ready', macAddress: macAddress(row.get(7)) };
    }).sort((a, b) => a.index - b.index);
    const ring = num(walk.get(`${HEALTH_OIDS.cswRingRedundant}.0`));
    const stack = members.length || ring !== null ? { ringRedundant: ring === null ? null : ring === 1, members } : null;

    const issues: HealthIssue[] = [];
    const label = (item: { description: string | null; index: number }, kind: string) => item.description ?? `${kind} ${item.index}`;
    const bad = (state: EnvironmentState) => state !== 'normal' && state !== 'notPresent';
    for (const item of powerSupplies) if (bad(item.state)) issues.push({ code: 'POWER_SUPPLY_FAULT', component: label(item, 'Power supply'), state: item.state });
    for (const item of fans) if (bad(item.state)) issues.push({ code: 'FAN_FAULT', component: label(item, 'Fan'), state: item.state });
    for (const item of temperatures) if (bad(item.state)) issues.push({ code: 'TEMPERATURE_STATE', component: label(item, 'Sensor'), state: item.state });
    for (const item of members) if (!item.ready) issues.push({ code: 'STACK_MEMBER_NOT_READY', component: item.name ?? `Switch ${item.switchNumber ?? item.index}`, state: item.state });
    if (stack && stack.ringRedundant === false && members.length > 1) issues.push({ code: 'STACK_RING_NOT_REDUNDANT', component: 'Stack ring', state: 'notRedundant' });

    return summarise({
      vendor: 'cisco', uptimeTicks: context.uptimeTicks, inventory, interfaces: parseInterfaces(walk),
      cpus, cpu: cpus.length ? { fiveSecondPercent: maxOf(cpus.map((item) => item.fiveSecondPercent)), oneMinutePercent: maxOf(cpus.map((item) => item.oneMinutePercent)), fiveMinutePercent: maxOf(cpus.map((item) => item.fiveMinutePercent)) } : null,
      memoryPools, memory: mainPool ? { name: mainPool.name, usedBytes: mainPool.usedBytes, totalBytes: String(BigInt(mainPool.usedBytes) + BigInt(mainPool.freeBytes)), usedPercent: mainPool.usedPercent } : null,
      temperatures, fans, powerSupplies, stack,
      unavailable: unavailableSections(walk, this.walks, context.failedSections),
    }, issues);
  },
};

/** Vendors in match order; the generic fallback last. */
export const HEALTH_VENDORS: readonly HealthVendor[] = [CISCO_VENDOR, GENERIC_VENDOR];

export function healthVendorFor(sysObjectId: string | null | undefined, vendors: readonly HealthVendor[] = HEALTH_VENDORS): HealthVendor {
  return vendors.find((vendor) => vendor.matches(sysObjectId)) ?? GENERIC_VENDOR;
}

// ---------------------------------------------------------------------------------------------------------------
// Reboot detection from sysUpTime (hundredths of a second, wraps at 2^32 after ~497 days).

export const SYS_UPTIME_WRAP = 2 ** 32;
/** Slack for poll duration and clock differences between the app and the device. */
export const REBOOT_TOLERANCE_MS = 120_000;

export type RebootCheck = { rebooted: boolean; bootedAt: Date | null; wrapped: boolean };

/**
 * A reboot is detected when sysUpTime went down (and it is not the 32-bit wrap), or when the device says it booted
 * after the previous poll (catches a reboot whose new uptime has already passed the old one, e.g. after a long gap).
 */
export function detectReboot(previous: { uptimeTicks: number | null; observedAt: Date } | null, currentTicks: number | null, now: Date = new Date()): RebootCheck {
  if (currentTicks === null || !Number.isFinite(currentTicks) || currentTicks < 0) return { rebooted: false, bootedAt: null, wrapped: false };
  const bootedAt = new Date(now.getTime() - currentTicks * 10);
  if (!previous || previous.uptimeTicks === null || !Number.isFinite(previous.uptimeTicks)) return { rebooted: false, bootedAt, wrapped: false };
  const elapsedTicks = Math.max(0, (now.getTime() - previous.observedAt.getTime()) / 10);
  const expected = previous.uptimeTicks + elapsedTicks;
  const toleranceTicks = REBOOT_TOLERANCE_MS / 10;
  if (expected >= SYS_UPTIME_WRAP - toleranceTicks && Math.abs((expected - SYS_UPTIME_WRAP) - currentTicks) <= toleranceTicks) {
    return { rebooted: false, bootedAt: null, wrapped: true };
  }
  const dropped = currentTicks < previous.uptimeTicks;
  const bootedSincePrevious = bootedAt.getTime() > previous.observedAt.getTime() + REBOOT_TOLERANCE_MS;
  return { rebooted: dropped || bootedSincePrevious, bootedAt, wrapped: false };
}
