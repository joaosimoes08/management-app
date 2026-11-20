import { decodeTrap, trapAlertTitle } from '@simoes/snmp-core';
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

function scope(trap: { deviceId?: string | null; sourceAddress: string }) { return trap.deviceId ? `device:${trap.deviceId}` : `source:${trap.sourceAddress}`; }

/**
 * Turns WARNING+ traps into operational alert candidates. A problem trap is
 * left out when a later recovery trap from the same device carries the same
 * clear key (e.g. linkUp for the same ifIndex), so the existing stale path in
 * OperationsService.reconcileSource resolves its alert. No new alert engine.
 */
export function trapAlertCandidates(problems: TrapAlertSource[], recoveries: TrapRecoverySource[]): UpsertOperationalAlert[] {
  const latestRecovery = new Map<string, number>();
  for (const recovery of recoveries) {
    const decoded = decodeTrap(recovery.trapOid, recovery.varbinds);
    if (!decoded.isClear || !decoded.clearKey) continue;
    const key = `${scope(recovery)}|${decoded.clearKey}`;
    const at = recovery.receivedAt.getTime();
    if ((latestRecovery.get(key) ?? -Infinity) < at) latestRecovery.set(key, at);
  }
  const candidates: UpsertOperationalAlert[] = [];
  for (const trap of problems) {
    const decoded = decodeTrap(trap.trapOid, trap.varbinds);
    if (decoded.known && !decoded.alertable) continue;
    if (decoded.clearKey) {
      const recoveredAt = latestRecovery.get(`${scope(trap)}|${decoded.clearKey}`);
      if (recoveredAt !== undefined && recoveredAt >= trap.receivedAt.getTime()) continue;
    }
    const where = trap.device?.name ?? trap.sourceAddress;
    candidates.push({
      dedupKey: `snmp:trap:${trap.dedupKey ?? trap.id}`,
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
