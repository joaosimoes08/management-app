import { Injectable, NotFoundException } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import type { AuthenticatedUser } from '../../auth/auth.service';
import { IpamAccessService } from '../../ipam/ipam-access.service';
import { calculateSubnetCapacity } from '../../ipam/subnet-capacity';
import type { OntapSnapshot } from '../../netapp/ontap-client';
import { InfrastructureAccessService } from '../infrastructure-access.service';
import { thresholdLevel, type SummaryThresholds } from '../power/power-summary';
import { DAY_MS, estimateCapacity, HISTORY_DAYS, type CapacityMeasurement, usableMeasurement } from './estimate-capacity';
import { rackMeasurements, readCapacityRacks } from './rack-capacity';

type ResourceKind = 'SUBNET' | 'NETAPP_VOLUME' | 'NETAPP_AGGREGATE' | 'RACK_SPACE' | 'RACK_POWER' | 'PDU_POWER';
type Resource = {
  kind: ResourceKind;
  id: string;
  name: string;
  rackId?: string;
  rackName?: string;
  source?: 'UPS' | 'SUPPLIER' | null;
  roomId?: string;
  buildingId?: string;
  /** RACK_SPACE: units held by active reservations that no device occupies yet (already included in used). */
  reservedUnits?: number;
  latest: CapacityMeasurement | null;
  history: CapacityMeasurement[];
};

type NetAppReading = { objectKey: string; kind: 'VOLUME' | 'AGGREGATE'; usedBytes: bigint | null; sizeBytes: bigint | null; observedAt: Date };

const metric = (sampledAt: Date, used: number | null, total: number | null): CapacityMeasurement | null =>
  total !== null && usableMeasurement(used, total) ? { sampledAt, used, total } : null;
const numeric = (value: bigint | null) => value === null ? null : Number(value);
const resourceKey = (...parts: string[]) => parts.join('/');
const addPoint = (store: Map<string, CapacityMeasurement[]>, key: string, point: CapacityMeasurement | null) => {
  if (!point) return;
  const points = store.get(key) ?? [];
  points.push(point);
  store.set(key, points);
};

@Injectable()
export class SiteCapacityService {
  constructor(
    private readonly prisma: PrismaClient,
    private readonly access: InfrastructureAccessService,
    private readonly ipamAccess: IpamAccessService,
  ) {}

  async outlook(siteId: string, user: AuthenticatedUser, thresholds: SummaryThresholds, now = new Date()) {
    await this.access.assertSite(user, 'READ', siteId);
    const since = new Date(now.getTime() - HISTORY_DAYS * DAY_MS);
    const sources = await Promise.all([
      this.subnets(siteId, user, now, since),
      this.netapp(siteId, since),
      this.racks(siteId, user, now, since),
    ]);
    const items = sources.flat().map(({ latest, history, ...identity }) => ({
      ...identity,
      ...estimateCapacity(history, latest, thresholds.criticalPercent),
      level: latest ? thresholdLevel(latest.used, latest.total, thresholds) : null,
      observedAt: latest?.sampledAt.toISOString() ?? null,
    }));
    return { siteId, thresholds, historyDays: HISTORY_DAYS, items };
  }

  private async subnets(siteId: string, user: AuthenticatedUser, now: Date, since: Date): Promise<Resource[]> {
    try { await this.ipamAccess.assertContext(user, 'READ', { siteId }); }
    catch (error) {
      if (error instanceof NotFoundException) return [];
      throw error;
    }
    const subnets = await this.prisma.subnet.findMany({
      where: { siteId },
      select: {
        id: true, cidr: true, version: true, gateway: true,
        ips: { where: { state: { not: 'FREE' } }, select: { address: true, state: true } },
        capacitySnapshots: {
          where: { sampledAt: { gte: since }, version: 4 },
          select: { sampledAt: true, allocatedAddresses: true, usableCapacity: true },
        },
      },
    });
    return subnets.map(({ id, cidr, version, gateway, ips, capacitySnapshots }) => {
      const current = version === 4 ? calculateSubnetCapacity(cidr, gateway, ips) : null;
      return {
        kind: 'SUBNET', id, name: cidr,
        latest: current ? metric(now, current.allocatedAddresses, current.usableCapacity) : null,
        history: capacitySnapshots.flatMap((sample) => metric(sample.sampledAt, sample.allocatedAddresses, sample.usableCapacity) ?? []),
      };
    });
  }

  private async netapp(siteId: string, since: Date): Promise<Resource[]> {
    // Uses the same Site READ check as the NetApp snapshot. Only the capacity payload is selected.
    const integration = await this.prisma.netAppIntegration.findUnique({
      where: { siteId }, select: { id: true, snapshot: true },
    });
    const snapshot = integration?.snapshot as OntapSnapshot | null | undefined;
    if (!integration || !snapshot || !Array.isArray(snapshot.aggregates) || !Array.isArray(snapshot.volumes)) return [];

    const history = await this.prisma.$queryRaw<NetAppReading[]>(Prisma.sql`
      SELECT DISTINCT ON ("kind", "objectKey", DATE_TRUNC('day', "observedAt"))
        "kind", "objectKey", "usedBytes", "sizeBytes", "observedAt"
      FROM "NetAppCapacitySample"
      WHERE "integrationId" = ${integration.id}::uuid AND "kind" IN ('VOLUME', 'AGGREGATE') AND "observedAt" >= ${since}
      ORDER BY "kind", "objectKey", DATE_TRUNC('day', "observedAt"), "observedAt" DESC, "id" DESC
    `);
    const points = new Map<string, CapacityMeasurement[]>();
    for (const row of history) addPoint(points, resourceKey(row.kind, row.objectKey), metric(row.observedAt, numeric(row.usedBytes), numeric(row.sizeBytes)));

    const observedAt = new Date(snapshot.observedAt);
    const items = [
      ...snapshot.aggregates.map((item) => ({ ...item, kind: 'AGGREGATE' as const })),
      ...snapshot.volumes.map((item) => ({ ...item, kind: 'VOLUME' as const })),
    ];
    return items.map((item) => {
      const id = item.uuid || item.name;
      return {
        kind: item.kind === 'AGGREGATE' ? 'NETAPP_AGGREGATE' : 'NETAPP_VOLUME',
        id, name: item.name,
        latest: Number.isFinite(observedAt.getTime()) ? metric(observedAt, item.usedBytes ?? null, item.sizeBytes ?? null) : null,
        history: points.get(resourceKey(item.kind, id)) ?? [],
      };
    });
  }

  private async racks(siteId: string, user: AuthenticatedUser, now: Date, since: Date): Promise<Resource[]> {
    const visibleRoomIds = await this.access.visibleRoomIds(user, siteId);
    if (!visibleRoomIds.length) return [];
    const racks = await readCapacityRacks(this.prisma, { roomId: { in: visibleRoomIds }, room: { building: { siteId } } }, undefined, now);
    const history = await this.prisma.rackCapacitySample.findMany({
      where: { rackId: { in: racks.map((rack) => rack.id) }, sampledAt: { gte: since } },
      select: { rackId: true, resourceKey: true, sampledAt: true, used: true, total: true },
    });
    const points = new Map<string, CapacityMeasurement[]>();
    for (const row of history) addPoint(points, resourceKey(row.rackId, row.resourceKey), row);

    return racks.flatMap((rack) => rackMeasurements(rack).map((row) => ({
      kind: row.kind,
      id: row.kind === 'PDU_POWER' ? row.resourceKey.slice('pdu:'.length) : rack.id,
      name: row.name, source: row.source, ...(row.kind === 'RACK_SPACE' ? { reservedUnits: row.reservedUnits } : {}), rackId: rack.id, rackName: rack.name, roomId: rack.roomId, buildingId: rack.room.buildingId,
      latest: metric(now, row.used, row.total),
      history: points.get(resourceKey(rack.id, row.resourceKey)) ?? [],
    })));
  }
}
