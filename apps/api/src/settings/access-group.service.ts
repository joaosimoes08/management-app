import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { CreateAccessGroupDto, UpdateAccessGroupDto } from './dto';

@Injectable()
export class AccessGroupService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  private async log(user: AuthenticatedUser, action: string, groupId: string, metadata?: unknown) {
    await this.audit.record({ userId: user.id, action, entityType: 'AccessGroup', entityId: groupId, metadata });
  }

  async list(siteId?: string) {
    return this.prisma.accessGroup.findMany({
      where: siteId ? { siteAssignments: { some: { siteId } } } : {},
      include: {
        siteAssignments: { include: { site: { select: { id: true, name: true, code: true } }, permissions: true }, orderBy: { site: { name: 'asc' } } },
        members: { include: { user: { select: { id: true, username: true, displayName: true, email: true } } } },
        infrastructurePermissions: true,
      },
      orderBy: { name: 'asc' },
    });
  }

  private async validateSite(siteId: string) {
    if (!await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } })) throw new NotFoundException('Site não encontrado');
  }

  private async assertUnique(name: string, excludeId?: string) {
    const duplicate = await this.prisma.accessGroup.findFirst({ where: { name: { equals: name.trim(), mode: 'insensitive' }, ...(excludeId ? { id: { not: excludeId } } : {}) }, select: { id: true } });
    if (duplicate) throw new ConflictException('Já existe um grupo com esse nome na Organização.');
  }

  async create(dto: CreateAccessGroupDto, actor: AuthenticatedUser) {
    await this.assertUnique(dto.name);
    try {
      const item = await this.prisma.accessGroup.create({ data: { ...dto, name: dto.name.trim(), description: dto.description?.trim() || null } });
      await this.log(actor, 'ACCESS_GROUP_CREATED', item.id);
      return item;
    } catch { throw new ConflictException('Já existe um grupo com esse nome na Organização.'); }
  }

  async update(id: string, dto: UpdateAccessGroupDto, actor: AuthenticatedUser) {
    const current = await this.prisma.accessGroup.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Grupo de acesso não encontrado');
    await this.assertUnique(dto.name, id);
    try {
      const item = await this.prisma.accessGroup.update({ where: { id }, data: { ...dto, name: dto.name.trim(), description: dto.description?.trim() || null } });
      await this.log(actor, 'ACCESS_GROUP_UPDATED', id);
      return item;
    } catch (error) { if (error instanceof ConflictException) throw error; throw new ConflictException('Não foi possível atualizar o grupo de acesso.'); }
  }

  async remove(id: string, actor: AuthenticatedUser) {
    const group = await this.prisma.accessGroup.findUnique({ where: { id }, include: { _count: { select: { infrastructurePermissions: true } } } });
    if (!group) throw new NotFoundException('Grupo de acesso não encontrado');
    if (group._count.infrastructurePermissions) throw new ConflictException({ code: 'ACCESS_GROUP_IN_USE', message: 'Remove primeiro todas as permissões de Infraestrutura atribuídas a este grupo.' });
    await this.prisma.accessGroup.delete({ where: { id } });
    await this.log(actor, 'ACCESS_GROUP_DELETED', id);
    return { success: true };
  }

  async users(search?: string) {
    return this.prisma.user.findMany({
      where: search ? { OR: [{ username: { contains: search, mode: 'insensitive' } }, { displayName: { contains: search, mode: 'insensitive' } }, { email: { contains: search, mode: 'insensitive' } }] } : {},
      select: { id: true, username: true, displayName: true, email: true }, orderBy: { username: 'asc' }, take: 100,
    });
  }

  async addMember(groupId: string, userId: string, actor: AuthenticatedUser) {
    const [group, member] = await Promise.all([this.prisma.accessGroup.findUnique({ where: { id: groupId } }), this.prisma.user.findUnique({ where: { id: userId } })]);
    if (!group || !member) throw new NotFoundException('Grupo ou utilizador não encontrado');
    const item = await this.prisma.accessGroupMember.upsert({ where: { groupId_userId: { groupId, userId } }, create: { groupId, userId }, update: {} });
    await this.log(actor, 'ACCESS_GROUP_MEMBER_ADDED', groupId, { userId });
    return item;
  }

  async removeMember(groupId: string, userId: string, actor: AuthenticatedUser) {
    await this.prisma.accessGroupMember.delete({ where: { groupId_userId: { groupId, userId } } }).catch(() => { throw new NotFoundException('Membro do grupo não encontrado'); });
    await this.log(actor, 'ACCESS_GROUP_MEMBER_REMOVED', groupId, { userId });
    return { success: true };
  }

  async assignSite(groupId: string, siteId: string, permissions: string[], actor: AuthenticatedUser) {
    await this.validateSite(siteId);
    if (!await this.prisma.accessGroup.findUnique({ where: { id: groupId }, select: { id: true } })) throw new NotFoundException('Grupo de acesso não encontrado');
    const normalized = [...new Set(permissions)];
    const item = await this.prisma.$transaction(async (tx) => {
      await tx.accessGroupSite.upsert({ where: { groupId_siteId: { groupId, siteId } }, create: { groupId, siteId }, update: {} });
      await tx.accessGroupSitePermission.deleteMany({ where: { groupId, siteId, permission: { notIn: normalized } } });
      if (normalized.length) await tx.accessGroupSitePermission.createMany({ data: normalized.map((permission) => ({ groupId, siteId, permission })), skipDuplicates: true });
      return tx.accessGroupSite.findUnique({ where: { groupId_siteId: { groupId, siteId } }, include: { site: true, permissions: true } });
    });
    await this.log(actor, 'ACCESS_GROUP_SITE_UPDATED', groupId, { siteId, permissions: normalized });
    return item;
  }

  async removeSite(groupId: string, siteId: string, actor: AuthenticatedUser) {
    const buildings = await this.prisma.building.findMany({ where: { siteId }, select: { id: true, rooms: { select: { id: true } } } });
    const scopeIds = [siteId, ...buildings.flatMap((building) => [building.id, ...building.rooms.map((room) => room.id)])];
    if (await this.prisma.infrastructurePermission.count({ where: { groupId, scopeId: { in: scopeIds } } })) throw new ConflictException({ code: 'ACCESS_GROUP_SITE_IN_USE', message: 'Remove primeiro as permissões de Infraestrutura deste Site.' });
    await this.prisma.accessGroupSite.delete({ where: { groupId_siteId: { groupId, siteId } } }).catch(() => { throw new NotFoundException('Associação do grupo ao Site não encontrada'); });
    await this.log(actor, 'ACCESS_GROUP_SITE_REMOVED', groupId, { siteId });
    return { success: true };
  }
}
