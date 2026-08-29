import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { CreateInfrastructurePermissionDto, UpdateInfrastructurePermissionDto } from './dto';

export type InfrastructureAction = 'READ' | 'CREATE' | 'UPDATE' | 'DELETE';
type Rule = { groupId: string; scopeType: string; scopeId: string; permission: string };

@Injectable()
export class InfrastructureAccessService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  private candidates(rules: Rule[], action: InfrastructureAction) { return rules.filter((rule) => action === 'READ' || rule.permission === action); }
  private async groupIds(user: AuthenticatedUser, siteId: string) {
    if (user.roles.includes('ADMIN')) return null;
    if (!user.roles.length) return [];
    return (await this.prisma.accessGroupMember.findMany({ where: { userId: user.id, group: { siteAssignments: { some: { siteId } } } }, select: { groupId: true } })).map((item) => item.groupId);
  }
  private allowed(rules: Rule[], action: InfrastructureAction, groups: string[] | null) {
    if (groups === null) return true;
    return this.candidates(rules, action).some((rule) => groups.includes(rule.groupId));
  }
  private denied(action: InfrastructureAction): never {
    if (action === 'READ') throw new NotFoundException({ code: 'INFRASTRUCTURE_RESOURCE_NOT_FOUND', message: 'Recurso de infraestrutura não encontrado.' });
    throw new ForbiddenException({ code: 'INFRASTRUCTURE_SCOPE_FORBIDDEN', message: 'Não tens permissão para esta operação neste scope de infraestrutura.' });
  }
  private async rules(siteId: string, buildingId?: string, roomId?: string) {
    const all = await this.prisma.infrastructurePermission.findMany({ where: { OR: [
      { scopeType: 'SITE', scopeId: siteId },
      ...(buildingId ? [{ scopeType: 'BUILDING', scopeId: buildingId }] : []),
      ...(roomId ? [{ scopeType: 'ROOM', scopeId: roomId }] : []),
    ] } });
    const site = all.filter((rule) => rule.scopeType === 'SITE');
    const building = buildingId ? all.filter((rule) => rule.scopeType === 'BUILDING') : [];
    const room = roomId ? all.filter((rule) => rule.scopeType === 'ROOM') : [];
    return { site, building, room, effective: room.length ? room : building.length ? building : site };
  }

  async assertSite(user: AuthenticatedUser, action: InfrastructureAction, siteId: string) {
    if (!await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException('Site não encontrado');
    const groups = await this.groupIds(user, siteId); const { site: rules } = await this.rules(siteId);
    if (this.allowed(rules, action, groups)) return { id: siteId };
    const visible = this.allowed(rules, 'READ', groups) || Boolean((await this.visibleBuildingIds(user, siteId)).length);
    if (visible && action === 'READ') return { id: siteId };
    if (!visible) return this.denied('READ');
    return this.denied(action);
  }
  async assertBuilding(user: AuthenticatedUser, action: InfrastructureAction, buildingId: string) {
    const building = await this.prisma.building.findUnique({ where: { id: buildingId }, select: { id: true, siteId: true } });
    if (!building) throw new NotFoundException('Edifício não encontrado');
    const groups = await this.groupIds(user, building.siteId); const { effective } = await this.rules(building.siteId, building.id);
    if (this.allowed(effective, action, groups)) return building;
    let visible = this.allowed(effective, 'READ', groups);
    if (!visible) {
      const visibleRoomIds = await this.visibleRoomIds(user, building.siteId);
      const child = await this.prisma.room.findFirst({ where: { id: { in: visibleRoomIds }, buildingId }, select: { id: true } }); visible = Boolean(child);
    }
    if (visible && action === 'READ') return building;
    if (!visible) return this.denied('READ');
    return this.denied(action);
  }
  async assertRoom(user: AuthenticatedUser, action: InfrastructureAction, roomId: string) {
    const room = await this.prisma.room.findUnique({ where: { id: roomId }, select: { id: true, buildingId: true, building: { select: { siteId: true } } } });
    if (!room) throw new NotFoundException('Sala não encontrada');
    const groups = await this.groupIds(user, room.building.siteId); const { effective } = await this.rules(room.building.siteId, room.buildingId, room.id);
    if (this.allowed(effective, action, groups)) return room;
    if (!this.allowed(effective, 'READ', groups)) return this.denied('READ');
    return this.denied(action);
  }
  async assertRack(user: AuthenticatedUser, action: InfrastructureAction, rackId: string) {
    const rack = await this.prisma.rack.findUnique({ where: { id: rackId }, select: { id: true, roomId: true } });
    if (!rack) throw new NotFoundException('Bastidor não encontrado'); await this.assertRoom(user, action, rack.roomId); return rack;
  }
  async assertDevice(user: AuthenticatedUser, action: InfrastructureAction, deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, siteId: true, rack: { select: { roomId: true } } } });
    if (!device) throw new NotFoundException('Equipamento não encontrado');
    if (device.rack) await this.assertRoom(user, action, device.rack.roomId); else if (device.siteId) await this.assertSite(user, action, device.siteId); else this.denied(action);
    return device;
  }
  async assertInterface(user: AuthenticatedUser, action: InfrastructureAction, interfaceId: string) {
    const item = await this.prisma.deviceInterface.findUnique({ where: { id: interfaceId }, select: { id: true, deviceId: true } });
    if (!item) throw new NotFoundException('Interface não encontrada'); await this.assertDevice(user, action, item.deviceId); return item;
  }

  async visibleRoomIds(user: AuthenticatedUser, siteId?: string) {
    const rooms = await this.prisma.room.findMany({ where: siteId ? { building: { siteId } } : {}, select: { id: true, buildingId: true, building: { select: { siteId: true } } } });
    if (user.roles.includes('ADMIN')) return rooms.map((room) => room.id);
    if (!user.roles.length) return [];
    const siteIds = [...new Set(rooms.map((room) => room.building.siteId))];
    const memberships = await this.prisma.accessGroupMember.findMany({ where: { userId: user.id, group: { siteAssignments: { some: { siteId: { in: siteIds } } } } }, select: { groupId: true, group: { select: { siteAssignments: { where: { siteId: { in: siteIds } }, select: { siteId: true } } } } } });
    const groupsBySite = new Map(siteIds.map((id) => [id, memberships.filter((item) => item.group.siteAssignments.some((assignment) => assignment.siteId === id)).map((item) => item.groupId)]));
    const ids = rooms.map((room) => room.id); const buildingIds = [...new Set(rooms.map((room) => room.buildingId))];
    const rules = await this.prisma.infrastructurePermission.findMany({ where: { OR: [{ scopeType: 'SITE', scopeId: { in: siteIds } }, { scopeType: 'BUILDING', scopeId: { in: buildingIds } }, { scopeType: 'ROOM', scopeId: { in: ids } }] } });
    return rooms.filter((room) => {
      const roomRules = rules.filter((rule) => rule.scopeType === 'ROOM' && rule.scopeId === room.id);
      const buildingRules = rules.filter((rule) => rule.scopeType === 'BUILDING' && rule.scopeId === room.buildingId);
      const siteRules = rules.filter((rule) => rule.scopeType === 'SITE' && rule.scopeId === room.building.siteId);
      return this.allowed(roomRules.length ? roomRules : buildingRules.length ? buildingRules : siteRules, 'READ', groupsBySite.get(room.building.siteId) ?? []);
    }).map((room) => room.id);
  }
  async visibleBuildingIds(user: AuthenticatedUser, siteId: string) {
    const buildings = await this.prisma.building.findMany({ where: { siteId }, select: { id: true, rooms: { select: { id: true } } } });
    if (user.roles.includes('ADMIN')) return buildings.map((building) => building.id);
    const roomIds = new Set(await this.visibleRoomIds(user, siteId)); const groups = await this.groupIds(user, siteId) as string[];
    const rules = await this.prisma.infrastructurePermission.findMany({ where: { OR: [{ scopeType: 'SITE', scopeId: siteId }, { scopeType: 'BUILDING', scopeId: { in: buildings.map((building) => building.id) } }] } });
    const siteRules = rules.filter((rule) => rule.scopeType === 'SITE');
    return buildings.filter((building) => { const own = rules.filter((rule) => rule.scopeType === 'BUILDING' && rule.scopeId === building.id); return this.allowed(own.length ? own : siteRules, 'READ', groups) || building.rooms.some((room) => roomIds.has(room.id)); }).map((building) => building.id);
  }
  async visibleUnplacedSiteIds(user: AuthenticatedUser, siteId?: string) {
    if (user.roles.includes('ADMIN')) return siteId ? [siteId] : (await this.prisma.site.findMany({ select: { id: true } })).map((item) => item.id);
    if (!user.roles.length) return [];
    const assignments = await this.prisma.accessGroupSite.findMany({ where: { ...(siteId ? { siteId } : {}), group: { members: { some: { userId: user.id } } } }, select: { siteId: true, groupId: true } });
    const siteIds = [...new Set(assignments.map((item) => item.siteId))];
    const rules = await this.prisma.infrastructurePermission.findMany({ where: { scopeType: 'SITE', scopeId: { in: siteIds } } });
    return siteIds.filter((id) => this.allowed(rules.filter((rule) => rule.scopeId === id), 'READ', assignments.filter((item) => item.siteId === id).map((item) => item.groupId)));
  }

  async listPermissions(siteId?: string) {
    if (!siteId) return this.prisma.infrastructurePermission.findMany({ include: { group: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
    const buildings = await this.prisma.building.findMany({ where: { siteId }, select: { id: true, rooms: { select: { id: true } } } });
    const scopeIds = [siteId, ...buildings.flatMap((building) => [building.id, ...building.rooms.map((room) => room.id)])];
    return this.prisma.infrastructurePermission.findMany({ where: { scopeId: { in: scopeIds } }, include: { group: { select: { id: true, name: true } } }, orderBy: { createdAt: 'asc' } });
  }
  async effectiveAccess(user: AuthenticatedUser, siteId: string) {
    if (!await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException('Site não encontrado');
    const actions: InfrastructureAction[] = ['READ', 'CREATE', 'UPDATE', 'DELETE'];
    const admin = user.roles.includes('ADMIN');
    if (!admin && (!user.roles.length || !await this.prisma.accessGroupSite.count({ where: { siteId, group: { members: { some: { userId: user.id } } } } }))) return this.denied('READ');
    const groups = await this.groupIds(user, siteId);
    const [visibleBuildingIds, visibleRoomIds] = await Promise.all([this.visibleBuildingIds(user, siteId), this.visibleRoomIds(user, siteId)]);
    const buildings = await this.prisma.building.findMany({ where: { siteId, id: { in: visibleBuildingIds } }, select: { id: true, rooms: { where: { id: { in: visibleRoomIds } }, select: { id: true } } } });
    const siteRules = (await this.rules(siteId)).site;
    const infrastructure = { site: actions.filter((action) => this.allowed(siteRules, action, groups)), buildings: [] as { id: string; actions: InfrastructureAction[] }[], rooms: [] as { id: string; actions: InfrastructureAction[] }[] };
    for (const building of buildings) {
      const buildingRules = await this.rules(siteId, building.id);
      infrastructure.buildings.push({ id: building.id, actions: actions.filter((action) => this.allowed(buildingRules.effective, action, groups)) });
      for (const room of building.rooms) { const roomRules = await this.rules(siteId, building.id, room.id); infrastructure.rooms.push({ id: room.id, actions: actions.filter((action) => this.allowed(roomRules.effective, action, groups)) }); }
    }
    const canReadIpam = user.roles.some((role) => role === 'NETWORK_OPERATOR' || role === 'AUDITOR' || role === 'READ_ONLY');
    const canWriteIpam = user.roles.includes('NETWORK_OPERATOR');
    const assignedIpamGrants = admin || !canReadIpam ? [] : (await this.prisma.accessGroupSitePermission.findMany({ where: { siteId, assignment: { group: { members: { some: { userId: user.id } } } } }, select: { permission: true } })).map((item) => item.permission);
    const ipamGrants = admin ? ['READ', 'CREATE', 'UPDATE', 'DELETE', 'DISCOVER', 'IMPORT'] : canWriteIpam ? assignedIpamGrants : assignedIpamGrants.length ? ['READ'] : [];
    const capabilities = {
      administer: admin,
      network: admin || user.roles.includes('NETWORK_OPERATOR'),
      systems: admin || user.roles.includes('SYSTEMS_OPERATOR'),
      audit: admin || user.roles.includes('AUDITOR'),
      readOnly: user.roles.includes('READ_ONLY'),
    };
    return { siteId, capabilities, ipamActions: [...new Set(ipamGrants)], infrastructure, tabs: { permissions: admin, assets: capabilities.network || capabilities.systems, models: capabilities.network || capabilities.systems, interfaces: capabilities.network, discovery: capabilities.network } };
  }
  private async scopeSite(dto: CreateInfrastructurePermissionDto) {
    if (dto.scopeType === 'SITE') return (await this.prisma.site.findUnique({ where: { id: dto.scopeId }, select: { id: true } }))?.id;
    if (dto.scopeType === 'BUILDING') return (await this.prisma.building.findUnique({ where: { id: dto.scopeId }, select: { siteId: true } }))?.siteId;
    return (await this.prisma.room.findUnique({ where: { id: dto.scopeId }, select: { building: { select: { siteId: true } } } }))?.building.siteId;
  }
  private async validatePermission(dto: CreateInfrastructurePermissionDto) {
    const siteId = await this.scopeSite(dto); if (!siteId) throw new NotFoundException('Scope de infraestrutura não encontrado');
    if (!await this.prisma.accessGroupSite.findUnique({ where: { groupId_siteId: { groupId: dto.groupId, siteId } } })) throw new BadRequestException({ code: 'INFRASTRUCTURE_SCOPE_SITE_MISMATCH', message: 'O grupo não está associado ao Site deste scope.' });
  }
  async createPermission(dto: CreateInfrastructurePermissionDto, actor: AuthenticatedUser) { await this.validatePermission(dto); const item = await this.prisma.infrastructurePermission.create({ data: dto }).catch(() => { throw new ConflictException('Esta permissão já está atribuída.'); }); await this.audit.record({ userId: actor.id, action: 'INFRASTRUCTURE_PERMISSION_CREATED', entityType: 'InfrastructurePermission', entityId: item.id, metadata: dto }); return item; }
  async updatePermission(id: string, dto: UpdateInfrastructurePermissionDto, actor: AuthenticatedUser) { await this.validatePermission(dto); const item = await this.prisma.infrastructurePermission.update({ where: { id }, data: dto }).catch(() => { throw new NotFoundException('Permissão de infraestrutura não encontrada'); }); await this.audit.record({ userId: actor.id, action: 'INFRASTRUCTURE_PERMISSION_UPDATED', entityType: 'InfrastructurePermission', entityId: id, metadata: dto }); return item; }
  async deletePermission(id: string, actor: AuthenticatedUser) { await this.prisma.infrastructurePermission.delete({ where: { id } }).catch(() => { throw new NotFoundException('Permissão de infraestrutura não encontrada'); }); await this.audit.record({ userId: actor.id, action: 'INFRASTRUCTURE_PERMISSION_DELETED', entityType: 'InfrastructurePermission', entityId: id }); return { success: true }; }
}
