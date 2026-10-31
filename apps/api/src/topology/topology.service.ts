import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { BulkTopologyNodesDto, CreateDeviceConnectionDto, CreateTopologyConnectionDto, CreateTopologyMapDto, ListDeviceConnectionsQueryDto, ListTopologyMapsQueryDto, TopologyMapNodeDto, UpdateDeviceConnectionDto, UpdateTopologyMapDto } from './dto';

/** Topology persistence is kept behind this service so map revisions remain a single API concern. */
@Injectable()
export class TopologyService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService, private readonly ipamAccess: IpamAccessService, private readonly audit: AuditService) {}
  private db() { return this.prisma as any; }
  private readonly mapInclude = { nodes: { include: { device: { include: { rack: { include: { room: { include: { building: true } } } } } } } }, connections: { include: { connection: { include: { sourceInterface: { select: { id: true, name: true } }, targetInterface: { select: { id: true, name: true } } } } } } };
  private async map(id: string) {
    const item = await this.db().topologyMap.findUnique({ where: { id }, include: this.mapInclude });
    if (!item) throw new NotFoundException('Mapa de topologia não encontrado');
    return { ...item, connections: item.connections.map((link: any) => ({ ...link.connection, sourceNodeId: `${item.id}:${link.connection.sourceDeviceId}`, targetNodeId: `${item.id}:${link.connection.targetDeviceId}` })), nodes: item.nodes.map((node: any) => ({ ...node, id: `${item.id}:${node.deviceId}` })) };
  }
  private async authorizeMap(user: AuthenticatedUser, action: 'READ' | 'CREATE' | 'UPDATE' | 'DELETE', siteId: string, type: string = 'PHYSICAL') {
    try { return type === 'PHYSICAL' ? await this.access.assertSite(user, action, siteId, 'PHYSICAL') : await this.access.assertSite(user, action, siteId, 'DEVICE', 'SWITCH'); }
    catch (error) {
      if (action === 'READ') throw error;
      const effective = await this.access.effectiveAccess(user, siteId).catch(() => null);
      const permitted = effective && [effective.infrastructure.site, ...effective.infrastructure.buildings.map((item) => item.actions), ...effective.infrastructure.rooms.map((item) => item.actions)].some((actions) => actions.includes(action) || (action === 'UPDATE' && actions.includes('CREATE')));
      if (permitted) return { id: siteId };
      throw error;
    }
  }
  private revisionConflict(): never {
    throw new ConflictException({ code: 'TOPOLOGY_MAP_REVISION_CONFLICT', message: 'O mapa foi alterado. Recarrega antes de guardar.' });
  }
  private async advanceRevision(tx: any, mapId: string, revision: number) {
    const result = await tx.topologyMap.updateMany({ where: { id: mapId, revision }, data: { revision: { increment: 1 } } });
    if (result.count !== 1) this.revisionConflict();
  }
  private async validateConnectionEndpoints(siteId: string, dto: { sourceDeviceId: string; targetDeviceId: string; sourceInterfaceId?: string; targetInterfaceId?: string; type?: 'PHYSICAL' | 'LOGICAL' }) {
    if (dto.sourceDeviceId === dto.targetDeviceId) throw new BadRequestException('Uma ligação requer dois equipamentos diferentes');
    const devices = await this.db().device.findMany({ where: { id: { in: [dto.sourceDeviceId, dto.targetDeviceId] } }, select: { id: true, siteId: true } });
    if (devices.length !== 2 || devices.some((device: any) => device.siteId !== siteId)) throw new NotFoundException('Os dispositivos não pertencem ao Site indicado');
    const interfaceIds = [dto.sourceInterfaceId, dto.targetInterfaceId].filter(Boolean);
    if (dto.type !== 'LOGICAL' && (!dto.sourceInterfaceId || !dto.targetInterfaceId)) throw new BadRequestException('Uma ligação física requer uma porta nos dois equipamentos');
    if (interfaceIds.length) {
      const interfaces = await this.db().deviceInterface.findMany({ where: { id: { in: interfaceIds } }, select: { id: true, deviceId: true } });
      if ((dto.sourceInterfaceId && !interfaces.some((item: any) => item.id === dto.sourceInterfaceId && item.deviceId === dto.sourceDeviceId)) || (dto.targetInterfaceId && !interfaces.some((item: any) => item.id === dto.targetInterfaceId && item.deviceId === dto.targetDeviceId))) throw new NotFoundException('A interface não pertence ao dispositivo indicado');
    }
    if (dto.type !== 'LOGICAL' && interfaceIds.length) {
      const occupied = await this.db().deviceConnection.findFirst({ where: { OR: [{ sourceInterfaceId: { in: interfaceIds } }, { targetInterfaceId: { in: interfaceIds } }] }, select: { id: true } });
      if (occupied) throw new ConflictException('Uma das portas selecionadas já está ligada');
    }
  }
  private async assertConnectionVisible(user: AuthenticatedUser, connection: { sourceDeviceId: string; targetDeviceId: string }) {
    await Promise.all([this.access.assertDevice(user, 'READ', connection.sourceDeviceId), this.access.assertDevice(user, 'READ', connection.targetDeviceId)]);
  }
  private async assertAllMapNodesVisible(user: AuthenticatedUser, map: { nodes: { deviceId: string }[] }) {
    await Promise.all(map.nodes.map((node) => this.access.assertDevice(user, 'READ', node.deviceId)));
  }
  async list(user: AuthenticatedUser, query: ListTopologyMapsQueryDto = {}) {
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 100);
    const maps = await this.db().topologyMap.findMany({ where: { ...(query.siteId ? { siteId: query.siteId } : {}), ...(query.type ? { type: query.type } : {}), ...(query.search ? { OR: [{ name: { contains: query.search, mode: 'insensitive' } }, { description: { contains: query.search, mode: 'insensitive' } }] } : {}) }, orderBy: { updatedAt: 'desc' } });
    const visible = await Promise.all(maps.map(async (item: any) => {
      try { await this.authorizeMap(user, 'READ', item.siteId, item.type); return item; } catch { return null; }
    }));
    const items = visible.filter(Boolean); return { items: items.slice((page - 1) * pageSize, page * pageSize), total: items.length, page, pageSize };
  }
  async get(user: AuthenticatedUser, id: string) {
    const item = await this.map(id); await this.authorizeMap(user, 'READ', item.siteId, item.type);
    const visibleIds = new Set((await Promise.all(item.nodes.map(async (node: any) => { try { await this.access.assertDevice(user, 'READ', node.deviceId); return node.deviceId; } catch { return null; } }))).filter(Boolean));
    let nodes = item.nodes.filter((node: any) => visibleIds.has(node.deviceId));
    if (item.type === 'VLAN_SUBNET') {
      try {
        await this.ipamAccess.assertSite(user, 'READ', item.siteId);
        const interfaces = await this.db().deviceInterface.findMany({ where: { deviceId: { in: nodes.map((node: any) => node.deviceId) } }, include: { nativeVlan: { include: { subnets: true } }, accessVlan: { include: { subnets: true } }, allowedVlans: { include: { vlan: { include: { subnets: true } } } }, ipAddresses: { include: { subnet: { include: { vlan: true } } } } } });
        const context = new Map<string, { vlans: Map<string, any>; subnets: Map<string, any> }>();
        for (const iface of interfaces) {
          const entry = context.get(iface.deviceId) ?? { vlans: new Map(), subnets: new Map() };
          const vlans = [iface.nativeVlan, iface.accessVlan, ...iface.allowedVlans.map((allowed: any) => allowed.vlan), ...iface.ipAddresses.map((ip: any) => ip.subnet.vlan)].filter(Boolean);
          for (const vlan of vlans) { entry.vlans.set(vlan.id, { id: vlan.id, vlanId: vlan.vlanId, name: vlan.name }); for (const subnet of vlan.subnets ?? []) entry.subnets.set(subnet.id, { id: subnet.id, cidr: subnet.cidr }); }
          for (const ip of iface.ipAddresses) entry.subnets.set(ip.subnet.id, { id: ip.subnet.id, cidr: ip.subnet.cidr });
          context.set(iface.deviceId, entry);
        }
        const selected = new Set(Array.isArray((item.filters as any)?.vlanIds) ? (item.filters as any).vlanIds.filter((value: unknown) => typeof value === 'string') : []);
        nodes = nodes.map((node: any) => { const entry = context.get(node.deviceId); return { ...node, networkContext: { vlans: [...(entry?.vlans.values() ?? [])], subnets: [...(entry?.subnets.values() ?? [])] } }; }).filter((node: any) => !selected.size || node.networkContext.vlans.some((vlan: any) => selected.has(vlan.id)));
      } catch { nodes = nodes.map((node: any) => ({ ...node, networkContext: { vlans: [], subnets: [] } })); }
    }
    const finalIds = new Set(nodes.map((node: any) => node.deviceId));
    return { ...item, nodes, connections: item.connections.filter((connection: any) => finalIds.has(connection.sourceDeviceId) && finalIds.has(connection.targetDeviceId)) };
  }
  async create(user: AuthenticatedUser, dto: CreateTopologyMapDto) {
    await this.authorizeMap(user, 'CREATE', dto.siteId, dto.type);
    const item = await this.db().topologyMap.create({ data: { name: dto.name, type: dto.type, siteId: dto.siteId, description: dto.description, viewport: dto.viewport, filters: dto.filters, createdById: user.id }, include: this.mapInclude });
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_MAP_CREATED', entityType: 'TopologyMap', entityId: item.id, metadata: { siteId: dto.siteId } });
    return item;
  }
  async update(user: AuthenticatedUser, id: string, dto: UpdateTopologyMapDto) {
    const existing = await this.map(id); await this.authorizeMap(user, 'UPDATE', existing.siteId, existing.type);
    const revision = dto.expectedRevision ?? existing.revision;
    const { expectedRevision: _revision, ...data } = dto;
    const result = await this.db().topologyMap.updateMany({ where: { id, revision }, data: { ...data, revision: { increment: 1 } } });
    if (result.count !== 1) this.revisionConflict();
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_MAP_UPDATED', entityType: 'TopologyMap', entityId: id, metadata: data });
    return this.map(id);
  }
  async remove(user: AuthenticatedUser, id: string, expectedRevision?: number) {
    const existing = await this.map(id); await this.authorizeMap(user, 'DELETE', existing.siteId, existing.type);
    await this.assertAllMapNodesVisible(user, existing);
    const result = await this.db().topologyMap.deleteMany({ where: { id, revision: expectedRevision ?? existing.revision } });
    if (result.count !== 1) this.revisionConflict();
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_MAP_DELETED', entityType: 'TopologyMap', entityId: id });
    return { success: true };
  }
  async replaceNodes(user: AuthenticatedUser, mapId: string, dto: BulkTopologyNodesDto) {
    const existing = await this.map(mapId); await this.authorizeMap(user, 'UPDATE', existing.siteId, existing.type);
    await this.assertAllMapNodesVisible(user, existing);
    const devices = await this.db().device.findMany({ where: { id: { in: dto.nodes.map((node) => node.deviceId) } }, select: { id: true, siteId: true } });
    if (devices.length !== new Set(dto.nodes.map((node) => node.deviceId)).size || devices.some((device: any) => device.siteId !== existing.siteId)) throw new NotFoundException('Um ou mais equipamentos não pertencem ao Site do mapa');
    for (const device of devices) await this.access.assertDevice(user, 'READ', device.id);
    const result = await this.db().$transaction(async (tx: any) => {
      await this.advanceRevision(tx, mapId, dto.revision);
      await tx.topologyMapNode.deleteMany({ where: { mapId } });
      await tx.topologyMapNode.createMany({ data: dto.nodes.map((node: TopologyMapNodeDto) => ({ mapId, deviceId: node.deviceId, x: node.x ?? 0, y: node.y ?? 0 })) });
      return tx.topologyMap.findUnique({ where: { id: mapId }, include: this.mapInclude });
    });
    return result;
  }
  async createConnection(user: AuthenticatedUser, mapId: string, dto: CreateTopologyConnectionDto) {
    const existing = await this.map(mapId); await this.authorizeMap(user, 'UPDATE', existing.siteId, existing.type);
    const nodes = await this.db().topologyMapNode.findMany({ where: { mapId, deviceId: { in: [dto.sourceDeviceId, dto.targetDeviceId] } }, select: { deviceId: true } });
    if (nodes.length !== 2) throw new NotFoundException('Os dispositivos não pertencem a este mapa');
    await this.validateConnectionEndpoints(existing.siteId, dto);
    await this.assertConnectionVisible(user, dto);
    const connection = await this.db().$transaction(async (tx: any) => {
      await this.advanceRevision(tx, mapId, dto.revision ?? existing.revision);
      const created = await tx.deviceConnection.create({ data: { siteId: existing.siteId, sourceDeviceId: dto.sourceDeviceId, targetDeviceId: dto.targetDeviceId, sourceInterfaceId: dto.sourceInterfaceId, targetInterfaceId: dto.targetInterfaceId, type: dto.type ?? 'PHYSICAL', label: dto.label, createdById: user.id } });
      await tx.topologyMapConnection.create({ data: { mapId, connectionId: created.id } });
      return created;
    });
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_CONNECTION_CREATED', entityType: 'DeviceConnection', entityId: connection.id, metadata: { mapId } });
    return connection;
  }
  async removeConnection(user: AuthenticatedUser, mapId: string, connectionId: string, expectedRevision?: number) {
    const existing = await this.map(mapId); await this.authorizeMap(user, 'UPDATE', existing.siteId, existing.type);
    const link = await this.db().topologyMapConnection.findUnique({ where: { mapId_connectionId: { mapId, connectionId } } }); if (!link) throw new NotFoundException('Ligação não encontrada');
    const connection = await this.db().deviceConnection.findUnique({ where: { id: connectionId } });
    if (!connection) throw new NotFoundException('Ligação não encontrada');
    await this.assertConnectionVisible(user, connection);
    await this.db().$transaction(async (tx: any) => {
      await this.advanceRevision(tx, mapId, expectedRevision ?? existing.revision);
      await tx.topologyMapConnection.delete({ where: { mapId_connectionId: { mapId, connectionId } } });
      const remaining = await tx.topologyMapConnection.count({ where: { connectionId } });
      if (!remaining) await tx.deviceConnection.delete({ where: { id: connectionId } });
    });
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_CONNECTION_DELETED', entityType: 'DeviceConnection', entityId: connectionId, metadata: { mapId } });
    return { success: true };
  }
  async associateConnection(user: AuthenticatedUser, mapId: string, connectionId: string, expectedRevision?: number) {
    const existing = await this.map(mapId); await this.authorizeMap(user, 'UPDATE', existing.siteId, existing.type);
    const connection = await this.db().deviceConnection.findUnique({ where: { id: connectionId } });
    if (!connection || connection.siteId !== existing.siteId) throw new NotFoundException('Ligação não encontrada neste Site');
    await this.assertConnectionVisible(user, connection);
    const nodes = await this.db().topologyMapNode.count({ where: { mapId, deviceId: { in: [connection.sourceDeviceId, connection.targetDeviceId] } } });
    if (nodes !== 2) throw new BadRequestException('Os dois equipamentos da ligação têm de pertencer ao mapa');
    await this.db().$transaction(async (tx: any) => {
      await this.advanceRevision(tx, mapId, expectedRevision ?? existing.revision);
      await tx.topologyMapConnection.create({ data: { mapId, connectionId } }).catch(() => { throw new ConflictException('A ligação já pertence ao mapa'); });
    });
    await this.audit.record({ userId: user.id, action: 'TOPOLOGY_CONNECTION_ASSOCIATED', entityType: 'DeviceConnection', entityId: connectionId, metadata: { mapId } });
    return this.map(mapId);
  }
  async listConnections(user: AuthenticatedUser, query: ListDeviceConnectionsQueryDto = {}) {
    const page = Math.max(Number(query.page) || 1, 1); const pageSize = Math.min(Math.max(Number(query.pageSize) || 50, 1), 100);
    const items = await this.db().deviceConnection.findMany({ where: { ...(query.siteId ? { siteId: query.siteId } : {}), ...(query.type ? { type: query.type } : {}), ...(query.search ? { OR: [{ label: { contains: query.search, mode: 'insensitive' } }, { notes: { contains: query.search, mode: 'insensitive' } }, { sourceDevice: { name: { contains: query.search, mode: 'insensitive' } } }, { targetDevice: { name: { contains: query.search, mode: 'insensitive' } } }] } : {}) }, include: { sourceDevice: true, targetDevice: true, sourceInterface: true, targetInterface: true, maps: { select: { mapId: true } } }, orderBy: { updatedAt: 'desc' } });
    const visible = await Promise.all(items.map(async (item: any) => {
      try {
        await this.authorizeMap(user, 'READ', item.siteId, 'NETWORK');
        await Promise.all([this.access.assertDevice(user, 'READ', item.sourceDeviceId), this.access.assertDevice(user, 'READ', item.targetDeviceId)]);
        return item;
      } catch { return null; }
    }));
    const filtered = visible.filter(Boolean); return { items: filtered.slice((page - 1) * pageSize, page * pageSize), total: filtered.length, page, pageSize };
  }
  async createStandaloneConnection(user: AuthenticatedUser, dto: CreateDeviceConnectionDto) {
    await this.authorizeMap(user, 'CREATE', dto.siteId, 'NETWORK');
    await this.validateConnectionEndpoints(dto.siteId, dto);
    await this.assertConnectionVisible(user, dto);
    const item = await this.db().deviceConnection.create({ data: { ...dto, type: dto.type ?? 'PHYSICAL', createdById: user.id } });
    await this.audit.record({ userId: user.id, action: 'DEVICE_CONNECTION_CREATED', entityType: 'DeviceConnection', entityId: item.id, metadata: { siteId: dto.siteId } });
    return item;
  }
  async updateStandaloneConnection(user: AuthenticatedUser, id: string, dto: UpdateDeviceConnectionDto) {
    const existing = await this.db().deviceConnection.findUnique({ where: { id }, include: { maps: { include: { map: { select: { revision: true } } } } } });
    if (!existing) throw new NotFoundException('Ligação não encontrada');
    await this.authorizeMap(user, 'UPDATE', existing.siteId, 'NETWORK');
    await this.assertConnectionVisible(user, existing);
    const { expectedRevisions, ...data } = dto;
    const item = await this.db().$transaction(async (tx: any) => {
      for (const association of existing.maps) {
        const expected = expectedRevisions?.[association.mapId] ?? association.map.revision;
        const result = await tx.topologyMap.updateMany({ where: { id: association.mapId, revision: expected }, data: { revision: { increment: 1 } } });
        if (result.count !== 1) this.revisionConflict();
      }
      return tx.deviceConnection.update({ where: { id }, data });
    });
    await this.audit.record({ userId: user.id, action: 'DEVICE_CONNECTION_UPDATED', entityType: 'DeviceConnection', entityId: id, metadata: data });
    return item;
  }
  async deleteStandaloneConnection(user: AuthenticatedUser, id: string) {
    const existing = await this.db().deviceConnection.findUnique({ where: { id }, include: { maps: { select: { mapId: true } } } });
    if (!existing) throw new NotFoundException('Ligação não encontrada');
    await this.authorizeMap(user, 'DELETE', existing.siteId, 'NETWORK');
    await this.assertConnectionVisible(user, existing);
    await this.db().$transaction(async (tx: any) => {
      for (const association of existing.maps) await tx.topologyMap.update({ where: { id: association.mapId }, data: { revision: { increment: 1 } } });
      await tx.deviceConnection.delete({ where: { id } });
    });
    await this.audit.record({ userId: user.id, action: 'DEVICE_CONNECTION_DELETED', entityType: 'DeviceConnection', entityId: id, metadata: { mapIds: existing.maps.map((item: any) => item.mapId) } });
    return { success: true };
  }
}
