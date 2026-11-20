import { Logger } from '@nestjs/common';
import { decodeTrap, RECOVERY_CAPABLE_TRAP_OIDS, SYS_UPTIME_OID, trapAlertTitle } from '@simoes/snmp-core';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';

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

/**
 * Turns WARNING+ traps into operational alert candidates. A problem trap is
 * left out when a later recovery trap from the same device carries the same
 * clear key (scope + index, e.g. linkUp for the same ifIndex; FRU module, power,
 * fan tray and presence are separate scopes), so the existing resolve path in
 * OperationsService.reconcileSource resolves its alert. No new alert engine.
 */
export function trapAlertCandidates(problems: TrapAlertSource[], recoveries: TrapRecoverySource[], boots: TrapBootSource[] = []): UpsertOperationalAlert[] {
  const index = recoveryIndex(recoveries, boots);
  const candidates: UpsertOperationalAlert[] = [];
  for (const trap of problems) {
    const decoded = decodeTrap(trap.trapOid, trap.varbinds);
    if (decoded.known && !decoded.alertable) continue;
    if (isCleared(trap, decoded.clearKey, index)) continue;
    const where = trap.device?.name ?? trap.sourceAddress;
    candidates.push({
      dedupKey: trapAlertDedupKey(trap),
      source: 'SNMP_TRAP',
      severity: trap.severity === 'CRITICAL' ? AlertSeverityDto.CRITICAL : trap.severity === 'HIGH' ? AlertSeverityDto.HIGH : AlertSeverityDto.WARNING,
      siteId: trap.device?.siteId ?? trap.enrollment?.siteId,
      entityType: 'SnmpTrapEvent',
      entityId: trap.id,
      title: decoded.known ? trapAlertTitle(decoded) : `Trap SNMP ${trap.category ?? trap.trapOid ?? 'relevante'}`,
      detail: decoded.known ? `${where} · ${decoded.summary}` : where,
      actionHref: '/snmp',
    });
  }
  return candidates;
}

/** Alert dedup keys of problem traps that a later recovery has cleared. */
export function clearedTrapAlertKeys(problems: TrapAlertSource[], recoveries: TrapRecoverySource[], boots: TrapBootSource[] = []): string[] {
  const index = recoveryIndex(recoveries, boots);
  return problems.filter((trap) => isCleared(trap, decodeTrap(trap.trapOid, trap.varbinds).clearKey, index)).map(trapAlertDedupKey);
}

type FindMany = (args: any) => Promise<any[]>;
export type TrapAlertDb = { snmpTrapEvent: { findMany: FindMany }; operationalAlert: { findMany: FindMany } };

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
 * Collects SNMP_TRAP alert candidates plus the open alerts whose problem trap has a
 * later recovery. `resolveKeys` is passed to reconcileSource so clears resolve even
 * when more than PROBLEM_CAP problem traps keep `resolveMissing` off.
 */
export async function collectTrapAlerts(prisma: TrapAlertDb, cutoff: Date) {
  const traps: TrapAlertSource[] = await prisma.snmpTrapEvent.findMany({ where: { receivedAt: { gte: cutoff }, severity: { in: ['CRITICAL', 'HIGH', 'WARNING'] } }, include: TRAP_INCLUDE, orderBy: { receivedAt: 'desc' }, take: PROBLEM_CAP + 1 });
  const problems = traps.slice(0, PROBLEM_CAP);
  const open: Array<{ id: string; dedupKey: string; entityId: string | null }> = await pageAll('open SNMP_TRAP alerts', (page) => prisma.operationalAlert.findMany({ where: { source: 'SNMP_TRAP', status: { not: 'RESOLVED' }, entityType: 'SnmpTrapEvent' }, select: { id: true, dedupKey: true, entityId: true }, ...page }));
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
  return {
    candidates: trapAlertCandidates(problems, recoveries, boots),
    resolveKeys: clearedTrapAlertKeys(all, recoveries, boots).filter((key) => openKeys.has(key)),
    resolveMissing: traps.length <= PROBLEM_CAP,
  };
}
