import { Logger } from '@nestjs/common';
import { decodeTrap, RECOVERY_CAPABLE_TRAP_OIDS, SYS_UPTIME_OID, trapAlertTitle } from '@simoes/snmp-core';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';
import { SNMP_NETWORK_TYPES } from '../snmp/snmp-fleet.service';

export type TrapAlertSource = {
  id: string;
  dedupKey?: string | null;
  deviceId?: string | null;
  sourceAddress: string;
  trapOid?: string | null;
  varbinds: unknown;
  category?: string | null;
  severity?: string | null;
  receivedAt: Date;
  /** SnmpTrapEvent.uptimeTicks: sysUpTime.0 stored by the trap receiver (String of the TimeTicks number). */
  uptimeTicks?: string | null;
  device?: { siteId: string | null; name: string } | null;
  enrollment?: { siteId: string } | null;
};

export type TrapRecoverySource = Pick<TrapAlertSource, 'id' | 'deviceId' | 'sourceAddress' | 'trapOid' | 'varbinds' | 'receivedAt' | 'uptimeTicks'>;

/** Max |uptime delta − receive delta| for two traps to count as the same boot (otherwise fall back to receivedAt). */
export const SAME_BOOT_TOLERANCE_MS = 5 * 60 * 1000;
const PROBLEM_CAP = 100;
const PAGE = 500;
const MAX_PAGES = 40;
const RESOLVE_LOOKBACK_MS = 30 * 24 * 60 * 60 * 1000;
/** coldStart / warmStart: a reboot boundary for sysUpTime ordering. */
export const BOOT_TRAP_OIDS: readonly string[] = ['1.3.6.1.6.3.1.1.5.1', '1.3.6.1.6.3.1.1.5.2'];
const logger = new Logger('TrapAlerts');

function scope(trap: { deviceId?: string | null; sourceAddress: string }) { return trap.deviceId ? `device:${trap.deviceId}` : `source:${trap.sourceAddress}`; }

export function trapAlertDedupKey(trap: Pick<TrapAlertSource, 'id' | 'dedupKey'>) { return `snmp:trap:${trap.dedupKey ?? trap.id}`; }

function ticks(value: unknown): number | undefined {
  const parsed = typeof value === 'number' ? value : typeof value === 'string' && /^\d+$/.test(value.trim()) ? Number(value.trim()) : NaN;
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : undefined;
}

/** sysUpTime.0 in hundredths of a second from the varbinds, when the trap carries it. */
export function trapUptimeTicks(varbinds: unknown): number | undefined {
  if (!Array.isArray(varbinds)) return undefined;
  const hit = varbinds.find((item) => item && typeof item === 'object' && String((item as { oid?: unknown }).oid).replace(/^\./, '') === SYS_UPTIME_OID) as { value?: unknown } | undefined;
  return ticks(hit?.value);
}

/** Uptime for a stored trap: the uptimeTicks column first, then the sysUpTime.0 varbind. */
export function storedTrapUptime(trap: { uptimeTicks?: string | null; varbinds: unknown }): number | undefined {
  return ticks(trap.uptimeTicks) ?? trapUptimeTicks(trap.varbinds);
}

type Timed = { receivedAt: Date; uptime?: number };

/**
 * True only when `recovery` provably happened at or after `problem` (same device).
 * Conservative agreement rule; any ambiguity returns false so the problem stays open:
 * (a) the recovery must be received at or after the problem;
 * (b) when both carry sysUpTime, the recovery's uptime must also be later and the same-boot
 *     check must pass: the smaller uptime exceeds SAME_BOOT_TOLERANCE_MS and the uptime
 *     delta matches the receive delta within it. Uptime on only one side → ambiguous;
 *     only when both lack it does receivedAt alone decide;
 * (c) no coldStart/warmStart from the device sits in the window between the two traps
 *     (widened by SAME_BOOT_TOLERANCE_MS on each side).
 */
export function recoveredAfter(problem: Timed, recovery: Timed, boots: readonly Date[] = []) {
  const p = problem.receivedAt.getTime();
  const r = recovery.receivedAt.getTime();
  if (r < p) return false;
  if (boots.some((boot) => boot.getTime() >= p - SAME_BOOT_TOLERANCE_MS && boot.getTime() <= r + SAME_BOOT_TOLERANCE_MS)) return false;
  if (problem.uptime === undefined && recovery.uptime === undefined) return true;
  if (problem.uptime === undefined || recovery.uptime === undefined) return false;
  const uptimeDelta = (recovery.uptime - problem.uptime) * 10;
  const sameBoot = Math.min(problem.uptime, recovery.uptime) * 10 > SAME_BOOT_TOLERANCE_MS && Math.abs(uptimeDelta - (r - p)) <= SAME_BOOT_TOLERANCE_MS;
  return sameBoot && uptimeDelta >= 0;
}

type RecoveryIndex = { clears: Map<string, Timed[]>; boots: Map<string, Date[]> };
export type TrapBootSource = Pick<TrapAlertSource, 'deviceId' | 'sourceAddress' | 'trapOid' | 'receivedAt'>;

function isBootTrap(trap: { trapOid?: string | null }) { return !!trap.trapOid && BOOT_TRAP_OIDS.includes(trap.trapOid.replace(/^\./, '')); }

function addBoot(boots: Map<string, Date[]>, key: string, at: Date) { boots.set(key, [...(boots.get(key) ?? []), at]); }

/**
 * Boot traps are indexed by device and by source address, so a coldStart that was not
 * matched to a device (UNMATCHED/DISCOVERED, deviceId null) still blocks a clear for a
 * problem trap from the same IP.
 */
function recoveryIndex(recoveries: TrapRecoverySource[], bootTraps: TrapBootSource[] = []): RecoveryIndex {
  const clears = new Map<string, Timed[]>();
  const boots = new Map<string, Date[]>();
  for (const boot of [...bootTraps, ...recoveries.filter(isBootTrap)]) {
    if (!isBootTrap(boot)) continue;
    if (boot.deviceId) addBoot(boots, `device:${boot.deviceId}`, boot.receivedAt);
    addBoot(boots, `source:${boot.sourceAddress}`, boot.receivedAt);
  }
  for (const recovery of recoveries) {
    if (isBootTrap(recovery)) continue;
    const decoded = decodeTrap(recovery.trapOid, recovery.varbinds);
    if (!decoded.isClear || !decoded.clearKey) continue;
    const key = `${scope(recovery)}|${decoded.clearKey}`;
    clears.set(key, [...(clears.get(key) ?? []), { receivedAt: recovery.receivedAt, uptime: storedTrapUptime(recovery) }]);
  }
  return { clears, boots };
}

function isCleared(trap: TrapAlertSource, clearKey: string | undefined, index: RecoveryIndex) {
  if (!clearKey) return false;
  const problem = { receivedAt: trap.receivedAt, uptime: storedTrapUptime(trap) };
  const boots = [...(trap.deviceId ? index.boots.get(`device:${trap.deviceId}`) ?? [] : []), ...(index.boots.get(`source:${trap.sourceAddress}`) ?? [])];
  return (index.clears.get(`${scope(trap)}|${clearKey}`) ?? []).some((recovery) => recoveredAfter(problem, recovery, boots));
}

/** Port traps (linkDown, err-disable: clear scope "interface") are grouped per device and port (SNMP Phase 1 step 2.1). */
function isPortTrap(decoded: ReturnType<typeof decodeTrap>) { return !!decoded.clearKey && decoded.clearKey.startsWith('interface:'); }

/** One alert per device + port for repeated linkDowns; `snmp:trap:<scope>:interface:<ifIndex>`. */
export function trapGroupDedupKey(trap: Pick<TrapAlertSource, 'deviceId' | 'sourceAddress'>, clearKey: string) { return `snmp:trap:${scope(trap)}:${clearKey}`; }

/** Decides whether a port trap may raise an alert: only uplinks (documented link to another network device). */
export type UplinkCheck = (trap: TrapAlertSource, decoded: ReturnType<typeof decodeTrap>) => boolean;

export type TrapAlertPlanOptions = {
  /** Default: every port is treated as an uplink (pure-function tests). collectTrapAlerts always passes the real check. */
  isUplink?: UplinkCheck;
  /** occurrenceCount of the currently open alerts, so a grouped count never goes down when old traps leave the window. */
  openCounts?: Map<string, number>;
};

const severityOf = (value?: string | null) => value === 'CRITICAL' ? AlertSeverityDto.CRITICAL : value === 'HIGH' ? AlertSeverityDto.HIGH : AlertSeverityDto.WARNING;

/**
 * Plans SNMP_TRAP alerts from WARNING+ problem traps (SNMP Phase 1 steps 1.1 and 2.1):
 * - a problem stays open until a later recovery trap with the same clear key (linkUp for the same ifIndex; FRU,
 *   power, fan tray and presence are separate scopes) provably follows it. There is no age-based resolve: an
 *   alert whose trap is older than the 24 h window stays open until its real clear;
 * - port traps are grouped per device + ifIndex into one alert whose occurrenceCount is the number of linkDowns
 *   seen, and they alert only for uplinks (HIGH, like the documented-link poll alert). Other ports are stored, not alerted;
 * - resolveKeys: cleared alerts, alerts for ports that are not uplinks, and pre-Phase-1 per-trap port alerts that a
 *   group key now replaces.
 */
export function planTrapAlerts(problems: TrapAlertSource[], recoveries: TrapRecoverySource[], boots: TrapBootSource[] = [], options: TrapAlertPlanOptions = {}) {
  const index = recoveryIndex(recoveries, boots);
  const isUplink = options.isUplink ?? (() => true);
  const candidates: UpsertOperationalAlert[] = [];
  const resolve = new Set<string>();
  const groups = new Map<string, { latest: TrapAlertSource; decoded: ReturnType<typeof decodeTrap>; count: number }>();
  for (const trap of problems) {
    const decoded = decodeTrap(trap.trapOid, trap.varbinds);
    if (decoded.known && !decoded.alertable) { resolve.add(trapAlertDedupKey(trap)); continue; }
    if (isPortTrap(decoded)) {
      const key = trapGroupDedupKey(trap, decoded.clearKey!);
      // a pre-Phase-1 per-trap alert for this port is replaced by the group alert
      resolve.add(trapAlertDedupKey(trap));
      if (!isUplink(trap, decoded)) { resolve.add(key); continue; }
      const group = groups.get(key);
      if (!group) groups.set(key, { latest: trap, decoded, count: 1 });
      else {
        group.count += 1;
        if (trap.receivedAt.getTime() > group.latest.receivedAt.getTime()) Object.assign(group, { latest: trap, decoded });
      }
      continue;
    }
    if (isCleared(trap, decoded.clearKey, index)) { resolve.add(trapAlertDedupKey(trap)); continue; }
    const where = trap.device?.name ?? trap.sourceAddress;
    candidates.push({
      dedupKey: trapAlertDedupKey(trap), source: 'SNMP_TRAP', severity: severityOf(trap.severity),
      siteId: trap.device?.siteId ?? trap.enrollment?.siteId, entityType: 'SnmpTrapEvent', entityId: trap.id,
      title: decoded.known ? trapAlertTitle(decoded) : `Trap SNMP ${trap.category ?? trap.trapOid ?? 'relevante'}`,
      detail: decoded.known ? `${where} · ${decoded.summary}` : where,
      actionHref: '/snmp',
    });
  }
  for (const [key, { latest, decoded, count }] of groups) {
    // the latest linkDown of the port decides: a later linkUp clears the whole group
    if (isCleared(latest, decoded.clearKey, index)) { resolve.add(key); continue; }
    const where = latest.device?.name ?? latest.sourceAddress;
    const occurrences = Math.max(count, options.openCounts?.get(key) ?? 0);
    candidates.push({
      dedupKey: key, source: 'SNMP_TRAP', severity: severityOf(latest.severity === 'CRITICAL' ? 'CRITICAL' : 'HIGH'),
      siteId: latest.device?.siteId ?? latest.enrollment?.siteId, entityType: 'SnmpTrapEvent', entityId: latest.id,
      title: `Uplink em baixo: ${where} ${decoded.subject ?? decoded.clearKey}`,
      detail: `${where} · ${decoded.summary}${occurrences > 1 ? ` · ${occurrences} ocorrências` : ''}. Resolve-se com o linkUp seguinte da mesma porta.`,
      actionHref: '/snmp', occurrenceCount: occurrences,
    });
  }
  const active = new Set(candidates.map((candidate) => candidate.dedupKey));
  return { candidates, resolveKeys: [...resolve].filter((key) => !active.has(key)) };
}

/** Alert candidates only (see planTrapAlerts). */
export function trapAlertCandidates(problems: TrapAlertSource[], recoveries: TrapRecoverySource[], boots: TrapBootSource[] = [], options: TrapAlertPlanOptions = {}): UpsertOperationalAlert[] {
  return planTrapAlerts(problems, recoveries, boots, options).candidates;
}

/** Alert dedup keys of problem traps that a later recovery has cleared (per-trap keys, and group keys for ports). */
export function clearedTrapAlertKeys(problems: TrapAlertSource[], recoveries: TrapRecoverySource[], boots: TrapBootSource[] = []): string[] {
  const index = recoveryIndex(recoveries, boots);
  return problems.flatMap((trap) => {
    const decoded = decodeTrap(trap.trapOid, trap.varbinds);
    if (!isCleared(trap, decoded.clearKey, index)) return [];
    return isPortTrap(decoded) ? [trapAlertDedupKey(trap), trapGroupDedupKey(trap, decoded.clearKey!)] : [trapAlertDedupKey(trap)];
  });
}

type FindMany = (args: any) => Promise<any[]>;
export type TrapAlertDb = {
  snmpTrapEvent: { findMany: FindMany };
  operationalAlert: { findMany: FindMany };
  /** Optional in unit-test fakes; when absent no port is an uplink. */
  deviceConnection?: { findMany: FindMany };
  deviceInterface?: { findMany: FindMany };
  snmpInterfaceObservation?: { findMany: FindMany };
};

async function pageAll<T extends { id: string }>(label: string, fetch: (args: { take: number; orderBy: { id: 'asc' }; cursor?: { id: string }; skip?: number }) => Promise<T[]>) {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const last = page === MAX_PAGES - 1;
    // On the last page fetch one extra row: warn only when rows really remain beyond the cap.
    const rows = await fetch({ take: last ? PAGE + 1 : PAGE, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    all.push(...rows.slice(0, PAGE));
    if (rows.length > PAGE && last) logger.warn(`${label}: stopped after ${MAX_PAGES} pages (${all.length} rows); remaining rows are handled on a later pass`);
    if (rows.length < PAGE || last) break;
    cursor = rows[rows.length - 1].id;
  }
  return all;
}

const TRAP_INCLUDE = { device: { select: { siteId: true, name: true } }, enrollment: { select: { siteId: true } } };

/**
 * SNMP Phase 1 step 2.1: uplinks are device interfaces with a documented DeviceConnection to another network device
 * (switch, router, firewall), the same documented-link rule as the poll-based interface alert. A trap's ifIndex is
 * mapped to the interface through SNMP poll observations, or by ifName against the interface name / port key.
 * A port that cannot be mapped is not an uplink: the trap is stored, but raises no alert.
 */
export async function loadUplinkCheck(prisma: TrapAlertDb, traps: TrapAlertSource[]): Promise<UplinkCheck> {
  const deviceIds = [...new Set(traps.flatMap((trap) => trap.deviceId && isPortTrap(decodeTrap(trap.trapOid, trap.varbinds)) ? [trap.deviceId] : []))];
  if (!deviceIds.length || !prisma.deviceConnection || !prisma.deviceInterface) return () => false;
  const network = new Set(SNMP_NETWORK_TYPES);
  const links = await prisma.deviceConnection.findMany({
    where: { OR: [{ sourceDeviceId: { in: deviceIds } }, { targetDeviceId: { in: deviceIds } }] },
    select: { sourceDeviceId: true, sourceInterfaceId: true, targetDeviceId: true, targetInterfaceId: true, sourceDevice: { select: { type: true } }, targetDevice: { select: { type: true } } },
  });
  const uplinkIds = new Set<string>();
  for (const link of links) {
    if (link.sourceInterfaceId && deviceIds.includes(link.sourceDeviceId) && network.has(link.targetDevice?.type)) uplinkIds.add(link.sourceInterfaceId);
    if (link.targetInterfaceId && deviceIds.includes(link.targetDeviceId) && network.has(link.sourceDevice?.type)) uplinkIds.add(link.targetInterfaceId);
  }
  if (!uplinkIds.size) return () => false;
  const interfaces: Array<{ id: string; deviceId: string; name: string; portKey: string | null }> = await prisma.deviceInterface.findMany({ where: { id: { in: [...uplinkIds] } }, select: { id: true, deviceId: true, name: true, portKey: true } });
  const observed: Array<{ deviceInterfaceId: string; ifIndex: number }> = prisma.snmpInterfaceObservation
    ? await prisma.snmpInterfaceObservation.findMany({ where: { deviceInterfaceId: { in: [...uplinkIds] } }, select: { deviceInterfaceId: true, ifIndex: true }, distinct: ['deviceInterfaceId', 'ifIndex'] })
    : [];
  const deviceOf = new Map(interfaces.map((item) => [item.id, item.deviceId]));
  const byIndex = new Set(observed.flatMap((item) => deviceOf.has(item.deviceInterfaceId) ? [`${deviceOf.get(item.deviceInterfaceId)}|${item.ifIndex}`] : []));
  const byName = new Set(interfaces.flatMap((item) => [item.name, item.portKey].filter(Boolean).map((name) => `${item.deviceId}|${String(name).toLowerCase()}`)));
  return (trap, decoded) => {
    if (!trap.deviceId) return false;
    const ifIndex = decoded.fields.ifIndex;
    const ifName = decoded.fields.ifName;
    return (ifIndex !== undefined && byIndex.has(`${trap.deviceId}|${ifIndex}`)) || (ifName !== undefined && byName.has(`${trap.deviceId}|${String(ifName).toLowerCase()}`));
  };
}

/**
 * Collects SNMP_TRAP alert candidates and the keys to resolve (SNMP Phase 1 step 1.1: never resolve by age).
 * Candidates come from the WARNING+ traps of the last 24 h plus the traps behind every still-open alert, however
 * old, so an unrecovered problem stays open. reconcileSource is called with resolveMissing = false: only a real
 * clear (resolveKeys) resolves. An alert whose trap row expired stays open until someone resolves it.
 */
export async function collectTrapAlerts(prisma: TrapAlertDb, cutoff: Date) {
  const traps: TrapAlertSource[] = await prisma.snmpTrapEvent.findMany({ where: { receivedAt: { gte: cutoff }, severity: { in: ['CRITICAL', 'HIGH', 'WARNING'] } }, include: TRAP_INCLUDE, orderBy: { receivedAt: 'desc' }, take: PROBLEM_CAP + 1 });
  const problems = traps.slice(0, PROBLEM_CAP);
  const open: Array<{ id: string; dedupKey: string; entityId: string | null; occurrenceCount?: number }> = await pageAll('open SNMP_TRAP alerts', (page) => prisma.operationalAlert.findMany({ where: { source: 'SNMP_TRAP', status: { not: 'RESOLVED' }, entityType: 'SnmpTrapEvent' }, select: { id: true, dedupKey: true, entityId: true, occurrenceCount: true }, ...page }));
  const loaded = new Set(problems.map((trap) => trap.id));
  const missing = [...new Set(open.flatMap((alert) => alert.entityId && !loaded.has(alert.entityId) ? [alert.entityId] : []))];
  const older: TrapAlertSource[] = [];
  for (let i = 0; i < missing.length; i += PAGE) older.push(...await prisma.snmpTrapEvent.findMany({ where: { id: { in: missing.slice(i, i + PAGE) } }, include: TRAP_INCLUDE }));
  const all = [...problems, ...older];
  let recoveries: TrapRecoverySource[] = [];
  let boots: TrapBootSource[] = [];
  if (all.length) {
    const oldest = all.reduce((min, trap) => Math.min(min, trap.receivedAt.getTime()), cutoff.getTime());
    const since = new Date(Math.max(oldest, Date.now() - RESOLVE_LOOKBACK_MS));
    const deviceIds = [...new Set(all.flatMap((trap) => trap.deviceId ? [trap.deviceId] : []))];
    const sources = [...new Set(all.filter((trap) => !trap.deviceId).map((trap) => trap.sourceAddress))];
    const addresses = [...new Set(all.map((trap) => trap.sourceAddress))];
    recoveries = await pageAll('SNMP recovery traps', (page) => prisma.snmpTrapEvent.findMany({ where: { receivedAt: { gte: since }, status: 'PROCESSED', trapOid: { in: [...RECOVERY_CAPABLE_TRAP_OIDS] }, OR: [{ deviceId: { in: deviceIds } }, { deviceId: null, sourceAddress: { in: sources } }] }, select: { id: true, deviceId: true, sourceAddress: true, trapOid: true, varbinds: true, receivedAt: true, uptimeTicks: true }, ...page }));
    // Boot traps in any status (an unmatched or still-pending coldStart is still a reboot),
    // by device or by the same source IP; only self-test traps are ignored.
    boots = await pageAll('SNMP boot traps', (page) => prisma.snmpTrapEvent.findMany({ where: { receivedAt: { gte: since }, trapOid: { in: [...BOOT_TRAP_OIDS] }, AND: [{ OR: [{ deviceId: { in: deviceIds } }, { sourceAddress: { in: addresses } }] }, { OR: [{ category: null }, { category: { not: 'SELF_TEST' } }] }] }, select: { id: true, deviceId: true, sourceAddress: true, trapOid: true, receivedAt: true }, ...page }));
  }
  const openKeys = new Set(open.map((alert) => alert.dedupKey));
  const openCounts = new Map(open.map((alert) => [alert.dedupKey, alert.occurrenceCount ?? 0]));
  const plan = planTrapAlerts(all, recoveries, boots, { isUplink: await loadUplinkCheck(prisma, all), openCounts });
  return {
    candidates: plan.candidates,
    resolveKeys: plan.resolveKeys.filter((key) => openKeys.has(key)),
    resolveMissing: false,
  };
}

/** SNMP Phase 1 step 2: one alert per source IP that sends traps nobody accepts (unknown device, bad credentials). */
export const TRAP_SOURCE_ALERT_SOURCE = 'SNMP_TRAP_SOURCE';
const TRAP_SOURCE_CAP = 100;
export const trapSourceDedupKey = (sourceAddress: string) => `snmp:trap-source:${sourceAddress}`;

export type TrapSourceRow = { sourceAddress: string; status: string; errorCode: string | null; count: number; lastAt: Date };
export type TrapSourceDb = {
  snmpTrapEvent: { groupBy: (args: any) => Promise<any[]> };
  device: { findMany: FindMany };
  operationalAlert: { findMany: FindMany };
};

/**
 * Plans the per-source alerts. A source is alerted (WARNING, one alert per IP whatever the number of traps; the
 * receiver also stores at most one REJECTED row per IP per minute) while its latest UNMATCHED/REJECTED trap is newer
 * than its latest accepted trap. It resolves when the source sends an accepted trap, or after 24 h without bad
 * traps. A manual resolve holds until a new bad trap arrives after it.
 */
export function planTrapSourceAlerts(bad: TrapSourceRow[], acceptedAt: Map<string, Date>, sites: Map<string, { siteId: string | null; name: string }>, resolvedAt: Map<string, Date> = new Map()) {
  const bySource = new Map<string, { count: number; lastAt: Date; unmatched: number; rejected: number; codes: Set<string> }>();
  for (const row of bad) {
    const item = bySource.get(row.sourceAddress) ?? { count: 0, lastAt: row.lastAt, unmatched: 0, rejected: 0, codes: new Set<string>() };
    item.count += row.count;
    if (row.status === 'REJECTED') item.rejected += row.count; else item.unmatched += row.count;
    if (row.errorCode) item.codes.add(row.errorCode);
    if (row.lastAt > item.lastAt) item.lastAt = row.lastAt;
    bySource.set(row.sourceAddress, item);
  }
  const candidates: UpsertOperationalAlert[] = [];
  const resolveKeys: string[] = [];
  for (const [sourceAddress, item] of [...bySource].sort((left, right) => right[1].lastAt.getTime() - left[1].lastAt.getTime())) {
    const key = trapSourceDedupKey(sourceAddress);
    const accepted = acceptedAt.get(sourceAddress);
    if (accepted && accepted >= item.lastAt) { resolveKeys.push(key); continue; }
    const resolved = resolvedAt.get(key);
    if (resolved && resolved >= item.lastAt) continue;
    const device = sites.get(sourceAddress);
    const parts = [item.unmatched ? `${item.unmatched} sem equipamento/credencial correspondente` : '', item.rejected ? `${item.rejected} rejeitado(s)${item.codes.size ? ` (${[...item.codes].sort().join(', ')})` : ''}` : ''].filter(Boolean);
    candidates.push({
      dedupKey: key, source: TRAP_SOURCE_ALERT_SOURCE, severity: AlertSeverityDto.WARNING, siteId: device?.siteId ?? null,
      entityType: null, entityId: null, occurrenceCount: item.count,
      title: `Traps SNMP não aceites de ${sourceAddress}${device ? ` (${device.name})` : ''}`,
      detail: `Últimas 24 h: ${parts.join('; ')}. Último: ${item.lastAt.toISOString()}. Verifica o IP de gestão, a credencial TRAP (SNMPv3) e o Engine ID configurado no equipamento.`,
      actionHref: '/snmp',
    });
  }
  return { candidates: candidates.slice(0, TRAP_SOURCE_CAP), resolveMissing: candidates.length <= TRAP_SOURCE_CAP, resolveKeys };
}

export async function collectTrapSourceAlerts(prisma: TrapSourceDb, cutoff: Date) {
  const grouped = await prisma.snmpTrapEvent.groupBy({ by: ['sourceAddress', 'status', 'errorCode'], where: { receivedAt: { gte: cutoff }, status: { in: ['UNMATCHED', 'REJECTED'] }, OR: [{ category: null }, { category: { not: 'SELF_TEST' } }] }, _count: { _all: true }, _max: { receivedAt: true }, orderBy: { _max: { receivedAt: 'desc' } }, take: 1000 });
  const bad: TrapSourceRow[] = grouped.map((row) => ({ sourceAddress: row.sourceAddress, status: row.status, errorCode: row.errorCode ?? null, count: row._count?._all ?? 0, lastAt: row._max?.receivedAt ?? cutoff }));
  const sources = [...new Set(bad.map((row) => row.sourceAddress))].slice(0, 500);
  if (!sources.length) return { ...planTrapSourceAlerts([], new Map(), new Map()), resolveMissing: true };
  const [accepted, devices, resolved] = await Promise.all([
    prisma.snmpTrapEvent.groupBy({ by: ['sourceAddress'], where: { receivedAt: { gte: cutoff }, sourceAddress: { in: sources }, status: { in: ['PENDING', 'PROCESSED', 'DISCOVERED'] } }, _max: { receivedAt: true } }),
    prisma.device.findMany({ where: { managementIp: { in: sources }, status: { not: 'RETIRED' } }, select: { managementIp: true, siteId: true, name: true } }),
    prisma.operationalAlert.findMany({ where: { source: TRAP_SOURCE_ALERT_SOURCE, status: 'RESOLVED', dedupKey: { in: sources.map(trapSourceDedupKey) } }, select: { dedupKey: true, resolvedAt: true } }),
  ]);
  const plan = planTrapSourceAlerts(
    bad.filter((row) => sources.includes(row.sourceAddress)),
    new Map(accepted.flatMap((row) => row._max?.receivedAt ? [[row.sourceAddress, row._max.receivedAt] as const] : [])),
    new Map(devices.flatMap((device: any) => device.managementIp ? [[device.managementIp, { siteId: device.siteId, name: device.name }] as const] : [])),
    new Map(resolved.flatMap((alert: any) => alert.resolvedAt ? [[alert.dedupKey, alert.resolvedAt] as const] : [])),
  );
  // a truncated read must not resolve sources it did not look at
  return { ...plan, resolveMissing: plan.resolveMissing && grouped.length < 1000 && sources.length < 500 };
}
