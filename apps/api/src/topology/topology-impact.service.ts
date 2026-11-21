import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { ImpactAnchorMode, ImpactEdge, clampDepth, computeImpact, hostMatches, shortestPath, urlHost } from './impact-graph';
import { TopologyImpactQueryDto, TopologyPathQueryDto } from './dto';

/** Device types treated as the way out of a site when the caller names no upstream devices. */
export const GATEWAY_DEVICE_TYPES = ['ROUTER', 'FIREWALL'];
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const deviceSelect = { id: true, name: true, type: true, status: true, hostname: true, managementIp: true, isCritical: true, criticalityTier: true, siteId: true, rackId: true, rack: { select: { roomId: true } } } as const;

type DeviceRow = { id: string; name: string; type: string; status: string; hostname: string | null; managementIp: string | null; isCritical: boolean; criticalityTier: string | null; siteId: string | null; rackId: string | null; rack: { roomId: string } | null };
type DownReason = 'ORIGIN' | 'RACK' | 'POWER';

function summary(device: DeviceRow) {
  return { id: device.id, name: device.name, type: device.type, status: device.status, hostname: device.hostname, managementIp: device.managementIp, isCritical: device.isCritical, criticalityTier: device.criticalityTier, rackId: device.rackId };
}
const truthy = (value?: string) => value === 'true' || value === '1';

/**
 * Step 34: "what is affected if this goes down" and the shortest documented path between two devices.
 * Reachability is computed on the whole site graph so hidden devices still count as links; the response only names
 * devices the caller may read and reports the rest as `hiddenCount`.
 */
@Injectable()
export class TopologyImpactService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService) {}
  private db() { return this.prisma as any; }

  private async visibility(user: AuthenticatedUser, siteId: string | null) {
    if (!siteId) return (device: DeviceRow) => user.roles.includes('ADMIN') && !device.siteId;
    const [roomIds, unplacedSiteIds] = await Promise.all([this.access.visibleRoomIds(user, siteId), this.access.visibleUnplacedSiteIds(user, siteId)]);
    const rooms = new Set(roomIds); const unplaced = new Set(unplacedSiteIds);
    return (device: DeviceRow) => device.rack ? rooms.has(device.rack.roomId) : Boolean(device.siteId && unplaced.has(device.siteId));
  }

  private async edges(siteId: string | null, includeLogical: boolean): Promise<ImpactEdge[]> {
    if (!siteId) return [];
    const rows = await this.db().deviceConnection.findMany({ where: { siteId, ...(includeLogical ? {} : { type: 'PHYSICAL' }) }, select: { id: true, sourceDeviceId: true, targetDeviceId: true } });
    return rows.map((row: any) => ({ id: row.id, a: row.sourceDeviceId, b: row.targetDeviceId }));
  }

  /** What goes down first: the device itself, every device in a rack, or devices whose every PDU plug is on a failed PDU. */
  private async origin(user: AuthenticatedUser, query: TopologyImpactQueryDto) {
    const named = [query.deviceId, query.pduId, query.rackId].filter(Boolean);
    if (named.length !== 1) throw new BadRequestException('Indica exatamente um de deviceId, pduId ou rackId');
    const down = new Map<string, DownReason>(); let pduIds: string[] = [];
    if (query.deviceId) {
      const device = await this.access.assertDevice(user, 'READ', query.deviceId);
      const row = await this.db().device.findUnique({ where: { id: device.id }, select: { name: true } });
      down.set(device.id, 'ORIGIN');
      return { origin: { kind: 'DEVICE' as const, id: device.id, name: row?.name ?? '' }, siteId: device.siteId as string | null, down, pduIds };
    }
    if (query.rackId) {
      await this.access.assertRack(user, 'READ', query.rackId, 'DEVICE');
      const rack = await this.db().rack.findUnique({ where: { id: query.rackId }, select: { id: true, name: true, room: { select: { building: { select: { siteId: true } } } }, devices: { select: { id: true } }, pdus: { select: { id: true } } } });
      if (!rack) throw new NotFoundException('Bastidor não encontrado');
      for (const device of rack.devices) down.set(device.id, 'RACK');
      pduIds = rack.pdus.map((pdu: any) => pdu.id);
      return { origin: { kind: 'RACK' as const, id: rack.id, name: rack.name }, siteId: rack.room.building.siteId as string, down, pduIds };
    }
    const pduRef = await this.db().rackPdu.findUnique({ where: { id: query.pduId }, select: { rackId: true } });
    if (!pduRef) throw new NotFoundException('PDU não encontrada');
    await this.access.assertRack(user, 'READ', pduRef.rackId, 'DEVICE');
    const pdu = await this.db().rackPdu.findUnique({ where: { id: query.pduId }, select: { id: true, name: true, source: true, rackId: true, rack: { select: { name: true, room: { select: { building: { select: { siteId: true } } } } } } } });
    if (!pdu) throw new NotFoundException('PDU não encontrada');
    pduIds = [pdu.id];
    return { origin: { kind: 'PDU' as const, id: pdu.id, name: pdu.name || `${pdu.rack.name} · ${pdu.source}` }, siteId: pdu.rack.room.building.siteId as string, down, pduIds };
  }

  async impact(user: AuthenticatedUser, query: TopologyImpactQueryDto) {
    const started = Date.now();
    const maxDepth = clampDepth(query.maxDepth); const includeLogical = truthy(query.includeLogical);
    const { origin, siteId, down, pduIds } = await this.origin(user, query);
    const powerDegraded = new Set<string>();
    if (pduIds.length) {
      const failedPdus = new Set(pduIds);
      const plugged = await this.db().pduOutletAssignment.findMany({ where: { pduId: { in: pduIds } }, select: { deviceId: true } });
      const pluggedIds = [...new Set<string>(plugged.map((item: any) => item.deviceId))];
      const plugs = pluggedIds.length ? await this.db().pduOutletAssignment.findMany({ where: { deviceId: { in: pluggedIds } }, select: { deviceId: true, pduId: true } }) : [];
      for (const deviceId of pluggedIds) {
        if (down.has(deviceId)) continue;
        const feeds = plugs.filter((item: any) => item.deviceId === deviceId);
        if (feeds.every((item: any) => failedPdus.has(item.pduId))) down.set(deviceId, 'POWER'); else powerDegraded.add(deviceId);
      }
    }
    const [edges, devices, visible] = await Promise.all([
      this.edges(siteId, includeLogical),
      this.db().device.findMany({ where: { OR: [...(siteId ? [{ siteId }] : []), { id: { in: [...down.keys(), ...powerDegraded] } }] }, select: deviceSelect }) as Promise<DeviceRow[]>,
      this.visibility(user, siteId),
    ]);
    const byId = new Map(devices.map((device) => [device.id, device]));
    const explicit = (query.upstreamDeviceIds ?? '').split(',').map((id) => id.trim()).filter((id) => UUID.test(id) && byId.has(id));
    let anchorMode: ImpactAnchorMode = 'explicit'; let anchors = explicit;
    if (!explicit.length) { anchorMode = 'gateway-devices'; anchors = devices.filter((device) => device.siteId === siteId && GATEWAY_DEVICE_TYPES.includes(device.type)).map((device) => device.id); }
    const graph = computeImpact({ edges, failed: down.keys(), anchors, anchorMode, maxDepth });

    let hiddenCount = 0;
    const shown = <T,>(id: string, build: (device: DeviceRow) => T): T[] => { const device = byId.get(id); if (!device) return []; if (!visible(device)) { hiddenCount += 1; return []; } return [build(device)]; };
    const downList = [...down.entries()].flatMap(([id, reason]) => shown(id, (device) => ({ ...summary(device), reason })));
    const affectedList = graph.affected.flatMap((item) => shown(item.deviceId, (device) => ({ ...summary(device), hops: item.hops, viaDeviceId: byId.get(item.viaDeviceId) && visible(byId.get(item.viaDeviceId)!) ? item.viaDeviceId : null, viaConnectionId: item.viaConnectionId })));
    const affectedIds = new Set(graph.affected.map((item) => item.deviceId));
    const degradedList = [...powerDegraded].filter((id) => !affectedIds.has(id)).flatMap((id) => shown(id, summary));
    const impacted = [...downList, ...affectedList];
    const impactedIds = impacted.map((device) => device.id);

    const hosts = impactedIds.length ? await this.db().host.findMany({
      where: { OR: [{ deviceId: { in: impactedIds } }, { ipAddresses: { some: { deviceId: { in: impactedIds } } } }] },
      select: { id: true, name: true, hostname: true, observedHostname: true, status: true, deviceId: true, ipAddresses: { select: { address: true, deviceId: true } }, services: { select: { id: true, name: true, protocol: true, port: true, status: true }, orderBy: [{ name: 'asc' }] } },
      orderBy: [{ name: 'asc' }],
    }) : [];
    const names = new Set<string>();
    const addName = (value?: string | null) => { const clean = value?.trim().toLowerCase(); if (clean) names.add(clean); };
    for (const device of impacted) { addName(device.hostname); addName(device.managementIp); }
    for (const host of hosts) { addName(host.name); addName(host.hostname); addName(host.observedHostname); host.ipAddresses.forEach((ip: any) => addName(ip.address)); }
    const links = names.size ? await this.db().applicationLink.findMany({ where: { isActive: true, OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles } } } }] }, select: { id: true, name: true, url: true, category: true }, orderBy: [{ name: 'asc' }] }) : [];
    const applications = links.flatMap((link: any) => { const host = urlHost(link.url); return host && hostMatches(host, names) ? [{ ...link, matchedHost: host }] : []; });

    const critical = { T1: [] as string[], T2: [] as string[], T3: [] as string[], untiered: [] as string[] };
    for (const device of impacted) {
      if (device.criticalityTier === 'T1' || device.criticalityTier === 'T2' || device.criticalityTier === 'T3') critical[device.criticalityTier].push(device.id);
      else if (device.isCritical) critical.untiered.push(device.id);
    }
    return {
      origin, siteId, maxDepth, includeLogical, truncated: graph.truncated,
      anchorMode: graph.anchorMode, anchorDeviceIds: graph.anchors.filter((id) => byId.has(id) && visible(byId.get(id)!)),
      down: downList, affected: affectedList, powerDegraded: degradedList,
      hosts: hosts.map((host: any) => ({ id: host.id, name: host.name, hostname: host.hostname, status: host.status, deviceId: host.deviceId, services: host.services })),
      applications, critical,
      counts: { down: downList.length, affected: affectedList.length, powerDegraded: degradedList.length, hosts: hosts.length, services: hosts.reduce((total: number, host: any) => total + host.services.length, 0), applications: applications.length, tier1: critical.T1.length },
      hiddenCount, elapsedMs: Date.now() - started,
    };
  }

  async path(user: AuthenticatedUser, query: TopologyPathQueryDto) {
    const [from, to] = await Promise.all([this.access.assertDevice(user, 'READ', query.fromDeviceId), this.access.assertDevice(user, 'READ', query.toDeviceId)]);
    const maxDepth = clampDepth(query.maxDepth); const includeLogical = truthy(query.includeLogical);
    if (!from.siteId || from.siteId !== to.siteId) return { found: false, reason: 'DIFFERENT_SITES', maxDepth, includeLogical, steps: [], connections: [] };
    const edges = await this.edges(from.siteId, includeLogical);
    const result = shortestPath(edges, from.id, to.id, maxDepth);
    if (!result) return { found: false, reason: 'NO_PATH', maxDepth, includeLogical, steps: [], connections: [] };
    const [devices, connections, visible] = await Promise.all([
      this.db().device.findMany({ where: { id: { in: result.deviceIds } }, select: deviceSelect }) as Promise<DeviceRow[]>,
      result.connectionIds.length ? this.db().deviceConnection.findMany({ where: { id: { in: result.connectionIds } }, select: { id: true, type: true, label: true, sourceDeviceId: true, targetDeviceId: true, sourceInterface: { select: { id: true, name: true } }, targetInterface: { select: { id: true, name: true } } } }) : [],
      this.visibility(user, from.siteId),
    ]);
    const byId = new Map(devices.map((device) => [device.id, device])); const linkById = new Map(connections.map((item: any) => [item.id, item]));
    const steps = result.deviceIds.map((id) => { const device = byId.get(id); return device && visible(device) ? { hidden: false, ...summary(device) } : { hidden: true, id: null }; });
    const links = result.connectionIds.map((id, index) => {
      const link: any = linkById.get(id); const hidden = steps[index].hidden || steps[index + 1].hidden;
      if (!link || hidden) return { hidden: true, id: null };
      return { hidden: false, id: link.id, type: link.type, label: link.label, sourceDeviceId: link.sourceDeviceId, targetDeviceId: link.targetDeviceId, sourceInterface: link.sourceInterface, targetInterface: link.targetInterface };
    });
    return { found: true, hops: result.connectionIds.length, maxDepth, includeLogical, steps, connections: links };
  }
}
