import { Prisma, PrismaClient } from '@simoes/database';
import { readCapacityRacks, rackMeasurements } from '../infrastructure/capacity/rack-capacity';
import { SUMMARY_DEFAULT_CRITICAL_PERCENT, SUMMARY_DEFAULT_WARNING_PERCENT, thresholdLevel, type SummaryThresholds } from '../infrastructure/power/power-summary';
import { calculateSubnetCapacity } from '../ipam/subnet-capacity';
import type { OntapSnapshot } from '../netapp/ontap-client';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';

/**
 * Round 2 #15: capacity threshold alerts on the existing alerts page and channels (in-app, Teams and e-mail follow the
 * existing delivery rules for the severity).
 *
 * - Resources: IPv4 subnets (allocated vs usable addresses), rack units, rack power, PDU power, NetApp volumes and
 *   aggregates: the same measurements as the Site capacity outlook.
 * - Levels: the outlook's thresholds (80 % warning → WARNING, 90 % critical → CRITICAL).
 * - Hysteresis: an open alert stays open (at WARNING) until usage drops 5 points below the warning threshold, so a
 *   resource hovering around 80 % does not open and resolve an alert on every pass.
 * - Subnets with fewer than 8 usable addresses (/29 and smaller: point-to-point and transfer networks) are skipped:
 *   they are full by design.
 */
export const CAPACITY_ALERT_SOURCE = 'CAPACITY';
export const CAPACITY_ALERT_LIMIT = 200;
export const CAPACITY_ALERT_HYSTERESIS_POINTS = 5;
export const CAPACITY_ALERT_MIN_SUBNET_ADDRESSES = 8;
export const CAPACITY_ALERT_THRESHOLDS: SummaryThresholds = { warningPercent: SUMMARY_DEFAULT_WARNING_PERCENT, criticalPercent: SUMMARY_DEFAULT_CRITICAL_PERCENT };

export type CapacityKind = 'SUBNET' | 'RACK_SPACE' | 'RACK_POWER' | 'PDU_POWER' | 'NETAPP_VOLUME' | 'NETAPP_AGGREGATE';
export type CapacityReading = { kind: CapacityKind; id: string; name: string; siteId: string | null; entityType: string; entityId: string; used: number; total: number; actionHref: string; context?: string };

const KIND_LABEL: Record<CapacityKind, string> = {
  SUBNET: 'Subnet', RACK_SPACE: 'Espaço do bastidor', RACK_POWER: 'Energia do bastidor', PDU_POWER: 'Energia da PDU',
  NETAPP_VOLUME: 'Volume NetApp', NETAPP_AGGREGATE: 'Agregado NetApp',
};
const UNIT: Record<CapacityKind, (used: number, total: number) => string> = {
  SUBNET: (used, total) => `${used} de ${total} endereços atribuídos`,
  RACK_SPACE: (used, total) => `${used} de ${total} U ocupadas`,
  RACK_POWER: (used, total) => `${Math.round(used)} W de ${Math.round(total)} W estimados`,
  PDU_POWER: (used, total) => `${Math.round(used)} W de ${Math.round(total)} W estimados`,
  NETAPP_VOLUME: (used, total) => `${gib(used)} de ${gib(total)} usados`,
  NETAPP_AGGREGATE: (used, total) => `${gib(used)} de ${gib(total)} usados`,
};
function gib(bytes: number) { return `${(bytes / 1024 ** 3).toFixed(bytes >= 100 * 1024 ** 3 ? 0 : 1)} GiB`; }
const percentOf = (reading: Pick<CapacityReading, 'used' | 'total'>) => reading.total > 0 ? (reading.used / reading.total) * 100 : (reading.used > 0 ? Infinity : 0);
export const capacityAlertKey = (reading: Pick<CapacityReading, 'kind' | 'id'>) => `capacity:${reading.kind.toLowerCase()}:${reading.id}`;

/**
 * Turns readings into alert candidates. `openKeys` are the dedup keys of open CAPACITY alerts: readings between the
 * hysteresis floor and the warning threshold keep their alert open; everything else not raised is resolved.
 */
export function planCapacityAlerts(readings: CapacityReading[], openKeys: Set<string>, thresholds = CAPACITY_ALERT_THRESHOLDS) {
  const floor = thresholds.warningPercent - CAPACITY_ALERT_HYSTERESIS_POINTS;
  const raised: Array<UpsertOperationalAlert & { percent: number }> = [];
  const held = new Set<string>();
  for (const reading of readings) {
    const key = capacityAlertKey(reading);
    const percent = percentOf(reading);
    const level = thresholdLevel(reading.used, reading.total, thresholds);
    const holding = level === 'ok' && openKeys.has(key) && percent >= floor;
    if (level === 'ok' && !holding) continue;
    const shown = Number.isFinite(percent) ? Math.round(percent) : 100;
    raised.push({
      dedupKey: key, source: CAPACITY_ALERT_SOURCE,
      severity: level === 'critical' ? AlertSeverityDto.CRITICAL : AlertSeverityDto.WARNING,
      siteId: reading.siteId ?? undefined, entityType: reading.entityType, entityId: reading.entityId,
      title: `${KIND_LABEL[reading.kind]} ${reading.name} a ${shown}% da capacidade`,
      detail: `${reading.context ? `${reading.context} · ` : ''}${UNIT[reading.kind](reading.used, reading.total)}. Limiares: aviso ${thresholds.warningPercent}%, crítico ${thresholds.criticalPercent}%.`,
      actionHref: reading.actionHref, percent: Number.isFinite(percent) ? percent : Number.MAX_SAFE_INTEGER,
    });
    held.add(key);
  }
  raised.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === AlertSeverityDto.CRITICAL ? -1 : 1) || b.percent - a.percent || a.dedupKey.localeCompare(b.dedupKey));
  const candidates = raised.slice(0, CAPACITY_ALERT_LIMIT).map(({ percent: _percent, ...candidate }) => candidate);
  // Raised but over the cap: keep any open alert as it is rather than resolve it.
  const resolveKeys = [...openKeys].filter((key) => !held.has(key));
  return { candidates, resolveKeys, truncated: raised.length > candidates.length };
}

type SubnetUsage = { id: string; cidr: string; gateway: string | null; siteId: string | null; allocated: number };

/** Every capacity reading at or above the hysteresis floor (resources well below the thresholds are not returned). */
export async function collectCapacityReadings(prisma: PrismaClient, thresholds = CAPACITY_ALERT_THRESHOLDS): Promise<CapacityReading[]> {
  const floor = thresholds.warningPercent - CAPACITY_ALERT_HYSTERESIS_POINTS;
  const readings: CapacityReading[] = [];
  const keep = (reading: CapacityReading) => { if (percentOf(reading) >= floor) readings.push(reading); };

  // Subnets: one grouped count, then the exact outlook calculation only for subnets that can be near the threshold.
  const usage = await prisma.$queryRaw<SubnetUsage[]>(Prisma.sql`
    SELECT s."id", s."cidr", s."gateway", s."siteId", COUNT(ip."id")::int AS "allocated"
    FROM "Subnet" s JOIN "IpAddress" ip ON ip."subnetId" = s."id" AND ip."state" <> 'FREE'
    WHERE s."version" = 4
    GROUP BY s."id"`);
  const near = usage.filter((row) => {
    const capacity = calculateSubnetCapacity(row.cidr, row.gateway, []).usableCapacity ?? 0;
    return capacity >= CAPACITY_ALERT_MIN_SUBNET_ADDRESSES && (row.allocated / capacity) * 100 >= floor;
  });
  for (let i = 0; i < near.length; i += 200) {
    const batch = near.slice(i, i + 200);
    const ips = await prisma.ipAddress.findMany({ where: { subnetId: { in: batch.map((row) => row.id) }, state: { not: 'FREE' } }, select: { subnetId: true, address: true, state: true } });
    const bySubnet = new Map<string, typeof ips>();
    for (const ip of ips) bySubnet.set(ip.subnetId, [...(bySubnet.get(ip.subnetId) ?? []), ip]);
    for (const row of batch) {
      const point = calculateSubnetCapacity(row.cidr, row.gateway, bySubnet.get(row.id) ?? []);
      if (point.usableCapacity === null) continue;
      keep({ kind: 'SUBNET', id: row.id, name: row.cidr, siteId: row.siteId, entityType: 'Subnet', entityId: row.id, used: point.allocatedAddresses, total: point.usableCapacity, actionHref: `/ipam?${new URLSearchParams({ ...(row.siteId ? { siteId: row.siteId } : {}), subnetId: row.id })}` });
    }
  }

  // Racks and PDUs, read in pages with the outlook's own measurement.
  const buildings = new Map((await prisma.building.findMany({ select: { id: true, siteId: true } })).map((row) => [row.id, row.siteId]));
  for (let after: string | undefined; ;) {
    const racks = await readCapacityRacks(prisma, {}, { after, take: 500 });
    for (const rack of racks) {
      const siteId = buildings.get(rack.room.buildingId) ?? null;
      const href = `/infraestrutura?${new URLSearchParams({ ...(siteId ? { siteId } : {}), rackId: rack.id })}`;
      for (const row of rackMeasurements(rack)) {
        if (row.total === null || row.total === undefined) continue;
        const pdu = row.kind === 'PDU_POWER';
        keep({ kind: row.kind, id: pdu ? row.resourceKey.slice('pdu:'.length) : rack.id, name: pdu ? (row.name || 'sem nome') : rack.name, context: pdu ? `Bastidor ${rack.name}` : undefined, siteId, entityType: 'Rack', entityId: rack.id, used: row.used, total: row.total, actionHref: href });
      }
    }
    if (racks.length < 500) break;
    after = racks.at(-1)!.id;
  }

  // NetApp: the latest snapshot of each integration.
  const integrations = await prisma.netAppIntegration.findMany({ where: { snapshot: { not: Prisma.DbNull } }, select: { siteId: true, snapshot: true } });
  for (const integration of integrations) {
    const snapshot = integration.snapshot as OntapSnapshot | null;
    if (!snapshot || !Array.isArray(snapshot.aggregates) || !Array.isArray(snapshot.volumes)) continue;
    const href = `/netapp?${new URLSearchParams({ siteId: integration.siteId })}`;
    for (const [kind, items] of [['NETAPP_AGGREGATE', snapshot.aggregates], ['NETAPP_VOLUME', snapshot.volumes]] as const) {
      for (const item of items) {
        const used = item.usedBytes ?? null; const total = item.sizeBytes ?? null;
        if (used === null || total === null || !Number.isFinite(used) || !Number.isFinite(total) || total <= 0) continue;
        const objectId = item.uuid || item.name;
        keep({ kind, id: `${integration.siteId}:${objectId}`, name: item.name, siteId: integration.siteId, entityType: 'NetAppIntegration', entityId: integration.siteId, used, total, actionHref: href });
      }
    }
  }
  return readings;
}

export async function collectCapacityAlerts(prisma: PrismaClient, thresholds = CAPACITY_ALERT_THRESHOLDS) {
  const [readings, open] = await Promise.all([
    collectCapacityReadings(prisma, thresholds),
    prisma.operationalAlert.findMany({ where: { source: CAPACITY_ALERT_SOURCE, status: { not: 'RESOLVED' } }, select: { dedupKey: true } }),
  ]);
  return planCapacityAlerts(readings, new Set(open.map((row) => row.dedupKey)), thresholds);
}
