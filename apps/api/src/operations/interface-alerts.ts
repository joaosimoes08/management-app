import { Prisma, PrismaClient } from '@simoes/database';
import { interfaceTrafficRates } from '../snmp/metrics';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';

/**
 * Round 2 #7: SNMP interface alerts on the existing Alertas page (source SNMP_INTERFACE), computed from the two latest
 * snapshots of each enabled SNMP device:
 * - a documented link (an interface used by a DeviceConnection) that is operationally down while not administratively
 *   shut down → HIGH;
 * - interface utilisation, max(in, out) / speed, at or above 80 % → WARNING, at or above 90 % → CRITICAL.
 * Devices whose latest snapshot is stale (older than twice the poll interval) keep their open alerts unchanged: their
 * data cannot confirm a recovery, and "polling stopped" is raised separately.
 */
export const INTERFACE_ALERT_SOURCE = 'SNMP_INTERFACE';
export const INTERFACE_UTILISATION_WARNING = 0.8;
export const INTERFACE_UTILISATION_CRITICAL = 0.9;
export const INTERFACE_ALERT_LIMIT = 100;

export type InterfaceObservationRow = { snapshotId: string; ifIndex: number; deviceInterfaceId: string | null; name: string | null; description: string | null; adminUp: boolean | null; operUp: boolean | null; speedMbps: number | null; counters: unknown };
export type DeviceSnapshots = {
  deviceId: string; deviceName: string; siteId: string | null; intervalMinutes: number;
  latest: { id: string; observedAt: Date; interfaces: InterfaceObservationRow[] };
  previous?: { id: string; observedAt: Date; interfaces: InterfaceObservationRow[] } | null;
};

const SEVERITY_ORDER: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };
export const interfaceDownKey = (deviceId: string, ifIndex: number) => `snmp:interface:down:${deviceId}:${ifIndex}`;
export const interfaceUtilisationKey = (deviceId: string, ifIndex: number) => `snmp:interface:util:${deviceId}:${ifIndex}`;
export const interfaceAlertDeviceId = (dedupKey: string) => dedupKey.split(':')[3] ?? null;

const percent = (value: number) => `${Math.round(value * 1000) / 10}%`;
const label = (item: InterfaceObservationRow) => item.name || item.description || `ifIndex ${item.ifIndex}`;

export function isSnapshotFresh(device: Pick<DeviceSnapshots, 'intervalMinutes' | 'latest'>, now: Date) {
  return now.getTime() - device.latest.observedAt.getTime() <= device.intervalMinutes * 2 * 60_000;
}

/** Alert candidates for one device's latest snapshot. `documented` holds DeviceInterface ids used by a DeviceConnection. */
export function interfaceAlertCandidates(device: DeviceSnapshots, documented: Set<string>): UpsertOperationalAlert[] {
  const candidates: UpsertOperationalAlert[] = [];
  const previous = new Map((device.previous?.interfaces ?? []).map((item) => [item.ifIndex, item]));
  const href = `/snmp?deviceId=${device.deviceId}`;
  for (const item of device.latest.interfaces) {
    if (item.deviceInterfaceId && documented.has(item.deviceInterfaceId) && item.operUp === false && item.adminUp !== false) {
      candidates.push({ dedupKey: interfaceDownKey(device.deviceId, item.ifIndex), source: INTERFACE_ALERT_SOURCE, severity: AlertSeverityDto.HIGH, siteId: device.siteId ?? undefined, entityType: 'Device', entityId: device.deviceId,
        title: `Ligação documentada em baixo: ${device.deviceName} ${label(item)}`,
        detail: `A interface ${label(item)} está operacionalmente em baixo (administrativamente ativa) e tem uma ligação documentada.`, actionHref: href });
    }
    const before = previous.get(item.ifIndex);
    if (!before || !device.previous || item.operUp === false || !item.speedMbps || item.speedMbps <= 0) continue;
    const [, rate] = interfaceTrafficRates([{ ...before, observedAt: device.previous.observedAt }, { ...item, observedAt: device.latest.observedAt }]);
    const peak = Math.max(rate.inMbps ?? -1, rate.outMbps ?? -1);
    if (peak < 0) continue;
    const utilisation = peak / item.speedMbps;
    if (utilisation < INTERFACE_UTILISATION_WARNING) continue;
    const critical = utilisation >= INTERFACE_UTILISATION_CRITICAL;
    candidates.push({ dedupKey: interfaceUtilisationKey(device.deviceId, item.ifIndex), source: INTERFACE_ALERT_SOURCE, severity: critical ? AlertSeverityDto.CRITICAL : AlertSeverityDto.WARNING, siteId: device.siteId ?? undefined, entityType: 'Device', entityId: device.deviceId,
      title: `Utilização ${critical ? 'crítica' : 'elevada'} em ${device.deviceName} ${label(item)}`,
      detail: `Utilização de ${percent(utilisation)} da velocidade da interface (${item.speedMbps} Mbps): entrada ${(rate.inMbps ?? 0).toFixed(1)} Mbps, saída ${(rate.outMbps ?? 0).toFixed(1)} Mbps. Limiares: ${percent(INTERFACE_UTILISATION_WARNING)} aviso, ${percent(INTERFACE_UTILISATION_CRITICAL)} crítico.`, actionHref: href });
  }
  return candidates;
}

/**
 * Plans one reconciliation: the candidates to upsert (worst first, at most INTERFACE_ALERT_LIMIT) and the open alert
 * keys to resolve. A key is resolved only if its device has fresh data (or is no longer polled) and the full candidate
 * list no longer contains it, so truncation never resolves a still-active alert.
 */
export function planInterfaceAlerts(devices: DeviceSnapshots[], documented: Set<string>, openKeys: string[], now: Date) {
  const fresh = devices.filter((device) => isSnapshotFresh(device, now));
  const held = new Set(devices.filter((device) => !isSnapshotFresh(device, now)).map((device) => device.deviceId));
  const all = fresh.flatMap((device) => interfaceAlertCandidates(device, documented)).sort((left, right) => (SEVERITY_ORDER[left.severity] ?? 9) - (SEVERITY_ORDER[right.severity] ?? 9) || left.dedupKey.localeCompare(right.dedupKey));
  const active = new Set(all.map((candidate) => candidate.dedupKey));
  const resolveKeys = openKeys.filter((key) => !active.has(key) && !held.has(interfaceAlertDeviceId(key) ?? ''));
  return { candidates: all.slice(0, INTERFACE_ALERT_LIMIT), total: all.length, resolveKeys };
}

/** Loads the two latest snapshots per enabled, non-retired SNMP device (one indexed LATERAL query) and plans the alerts. */
export async function collectInterfaceAlerts(prisma: PrismaClient, now = new Date()) {
  const snapshots = await prisma.$queryRaw<Array<{ id: string; deviceId: string; observedAt: Date; deviceName: string; siteId: string | null; intervalMinutes: number }>>(Prisma.sql`
    SELECT s."id", c."deviceId", s."observedAt", d."name" AS "deviceName", d."siteId", c."intervalMinutes"
    FROM "SnmpDeviceConfig" c
    JOIN "Device" d ON d."id" = c."deviceId"
    CROSS JOIN LATERAL (
      SELECT "id", "observedAt" FROM "SnmpSnapshot" WHERE "deviceId" = c."deviceId" ORDER BY "observedAt" DESC LIMIT 2
    ) s
    WHERE c."enabled" = true AND d."status" <> 'RETIRED'
    ORDER BY c."deviceId", s."observedAt" DESC`);
  const openKeys = (await prisma.operationalAlert.findMany({ where: { source: INTERFACE_ALERT_SOURCE, status: { not: 'RESOLVED' } }, select: { dedupKey: true } })).map((item) => item.dedupKey);
  if (!snapshots.length) return { ...planInterfaceAlerts([], new Set(), openKeys, now), devices: 0 };
  const observations = await prisma.snmpInterfaceObservation.findMany({
    where: { snapshotId: { in: snapshots.map((item) => item.id) } },
    select: { snapshotId: true, ifIndex: true, deviceInterfaceId: true, name: true, description: true, adminUp: true, operUp: true, speedMbps: true, counters: true },
  });
  const bySnapshot = new Map<string, InterfaceObservationRow[]>();
  for (const item of observations) bySnapshot.set(item.snapshotId, [...(bySnapshot.get(item.snapshotId) ?? []), item]);
  const devices = new Map<string, DeviceSnapshots>();
  for (const row of snapshots) {
    const snapshot = { id: row.id, observedAt: row.observedAt, interfaces: bySnapshot.get(row.id) ?? [] };
    const existing = devices.get(row.deviceId);
    if (!existing) devices.set(row.deviceId, { deviceId: row.deviceId, deviceName: row.deviceName, siteId: row.siteId, intervalMinutes: row.intervalMinutes, latest: snapshot, previous: null });
    else if (!existing.previous) existing.previous = snapshot;
  }
  const interfaceIds = [...new Set([...devices.values()].flatMap((device) => device.latest.interfaces.map((item) => item.deviceInterfaceId).filter((id): id is string => Boolean(id))))];
  const documented = new Set<string>();
  for (let i = 0; i < interfaceIds.length; i += 1000) {
    const batch = interfaceIds.slice(i, i + 1000);
    const links = await prisma.deviceConnection.findMany({ where: { OR: [{ sourceInterfaceId: { in: batch } }, { targetInterfaceId: { in: batch } }] }, select: { sourceInterfaceId: true, targetInterfaceId: true } });
    for (const link of links) for (const id of [link.sourceInterfaceId, link.targetInterfaceId]) if (id && batch.includes(id)) documented.add(id);
  }
  return { ...planInterfaceAlerts([...devices.values()], documented, openKeys, now), devices: devices.size };
}
