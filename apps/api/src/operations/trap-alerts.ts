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
  device?: { siteId: string | null; name: string } | null;
  enrollment?: { siteId: string } | null;
};

export type TrapRecoverySource = Pick<TrapAlertSource, 'id' | 'deviceId' | 'sourceAddress' | 'trapOid' | 'varbinds' | 'receivedAt'>;

/** Max |uptime delta − receive delta| for two traps to count as the same boot (otherwise fall back to receivedAt). */
export const SAME_BOOT_TOLERANCE_MS = 5 * 60 * 1000;
const PROBLEM_CAP = 100;
const PAGE = 500;
const MAX_PAGES = 40;

function scope(trap: { deviceId?: string | null; sourceAddress: string }) { return trap.deviceId ? `device:${trap.deviceId}` : `source:${trap.sourceAddress}`; }

export function trapAlertDedupKey(trap: Pick<TrapAlertSource, 'id' | 'dedupKey'>) { return `snmp:trap:${trap.dedupKey ?? trap.id}`; }

/** sysUpTime.0 in hundredths of a second, when the trap carries it. */
export function trapUptimeTicks(varbinds: unknown): number | undefined {
  if (!Array.isArray(varbinds)) return undefined;
  const hit = varbinds.find((item) => item && typeof item === 'object' && String((item as { oid?: unknown }).oid).replace(/^\./, '') === SYS_UPTIME_OID) as { value?: unknown } | undefined;
  const value = typeof hit?.value === 'number' ? hit.value : typeof hit?.value === 'string' && hit.value.trim() !== '' ? Number(hit.value) : NaN;
  return Number.isFinite(value) && value >= 0 ? value : undefined;
}

type Timed = { receivedAt: Date; uptime?: number };

/**
 * True when `recovery` happened at or after `problem` (both from the same device scope).
 * Uses sysUpTime when both traps carry it and the uptime delta matches the receive delta
 * within SAME_BOOT_TOLERANCE_MS (same boot, so only delivery order differs); otherwise a
 * reboot or counter wrap happened in between and receivedAt decides.
 */
export function recoveredAfter(problem: Timed, recovery: Timed) {
  const receivedDelta = recovery.receivedAt.getTime() - problem.receivedAt.getTime();
  if (problem.uptime !== undefined && recovery.uptime !== undefined) {
    const uptimeDelta = (recovery.uptime - problem.uptime) * 10;
    if (Math.abs(uptimeDelta - receivedDelta) <= SAME_BOOT_TOLERANCE_MS) return uptimeDelta >= 0;
  }
  return receivedDelta >= 0;
}

function recoveryIndex(recoveries: TrapRecoverySource[]) {
  const index = new Map<string, Timed[]>();
  for (const recovery of recoveries) {
    const decoded = decodeTrap(recovery.trapOid, recovery.varbinds);
    if (!decoded.isClear || !decoded.clearKey) continue;
    const key = `${scope(recovery)}|${decoded.clearKey}`;
    const list = index.get(key) ?? [];
    list.push({ receivedAt: recovery.receivedAt, uptime: trapUptimeTicks(recovery.varbinds) });
    index.set(key, list);
  }
  return index;
}

function isCleared(trap: TrapAlertSource, clearKey: string | undefined, index: Map<string, Timed[]>) {
  if (!clearKey) return false;
  const problem = { receivedAt: trap.receivedAt, uptime: trapUptimeTicks(trap.varbinds) };
  return (index.get(`${scope(trap)}|${clearKey}`) ?? []).some((recovery) => recoveredAfter(problem, recovery));
}

/**
 * Turns WARNING+ traps into operational alert candidates. A problem trap is
 * left out when a later recovery trap from the same device carries the same
 * clear key (scope + index, e.g. linkUp for the same ifIndex; FRU module, power,
 * fan tray and presence are separate scopes), so the existing resolve path in
 * OperationsService.reconcileSource resolves its alert. No new alert engine.
 */
export function trapAlertCandidates(problems: TrapAlertSource[], recoveries: TrapRecoverySource[]): UpsertOperationalAlert[] {
  const index = recoveryIndex(recoveries);
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
export function clearedTrapAlertKeys(problems: TrapAlertSource[], recoveries: TrapRecoverySource[]): string[] {
  const index = recoveryIndex(recoveries);
  return problems.filter((trap) => isCleared(trap, decodeTrap(trap.trapOid, trap.varbinds).clearKey, index)).map(trapAlertDedupKey);
}

type FindMany = (args: any) => Promise<any[]>;
export type TrapAlertDb = { snmpTrapEvent: { findMany: FindMany }; operationalAlert: { findMany: FindMany } };

async function pageAll<T extends { id: string }>(fetch: (args: { take: number; orderBy: { id: 'asc' }; cursor?: { id: string }; skip?: number }) => Promise<T[]>) {
  const all: T[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const rows = await fetch({ take: PAGE, orderBy: { id: 'asc' }, ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}) });
    all.push(...rows);
    if (rows.length < PAGE) break;
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
  const open: Array<{ id: string; dedupKey: string; entityId: string | null }> = await pageAll((page) => prisma.operationalAlert.findMany({ where: { source: 'SNMP_TRAP', status: { not: 'RESOLVED' }, entityType: 'SnmpTrapEvent' }, select: { id: true, dedupKey: true, entityId: true }, ...page }));
  const loaded = new Set(problems.map((trap) => trap.id));
  const missing = [...new Set(open.flatMap((alert) => alert.entityId && !loaded.has(alert.entityId) ? [alert.entityId] : []))];
  const older: TrapAlertSource[] = [];
  for (let i = 0; i < missing.length; i += PAGE) older.push(...await prisma.snmpTrapEvent.findMany({ where: { id: { in: missing.slice(i, i + PAGE) } }, include: TRAP_INCLUDE }));
  const all = [...problems, ...older];
  let recoveries: TrapRecoverySource[] = [];
  if (all.length) {
    const since = new Date(Math.min(cutoff.getTime(), ...all.map((trap) => trap.receivedAt.getTime())));
    const deviceIds = [...new Set(all.flatMap((trap) => trap.deviceId ? [trap.deviceId] : []))];
    const sources = [...new Set(all.filter((trap) => !trap.deviceId).map((trap) => trap.sourceAddress))];
    recoveries = await pageAll((page) => prisma.snmpTrapEvent.findMany({ where: { receivedAt: { gte: since }, status: 'PROCESSED', trapOid: { in: [...RECOVERY_CAPABLE_TRAP_OIDS] }, OR: [{ deviceId: { in: deviceIds } }, { deviceId: null, sourceAddress: { in: sources } }] }, select: { id: true, deviceId: true, sourceAddress: true, trapOid: true, varbinds: true, receivedAt: true }, ...page }));
  }
  const openKeys = new Set(open.map((alert) => alert.dedupKey));
  return {
    candidates: trapAlertCandidates(problems, recoveries),
    resolveKeys: clearedTrapAlertKeys(all, recoveries).filter((key) => openKeys.has(key)),
    resolveMissing: traps.length <= PROBLEM_CAP,
  };
}
