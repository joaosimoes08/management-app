import { BadRequestException, ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from './infrastructure-access.service';
import { CreateLifecycleDateDto, UpdateLifecycleDateDto } from './dto';

const DEFAULT_REMINDERS = [30, 7, 0];
const includeLifecycle = {
  device: {
    select: {
      id: true, name: true, type: true, siteId: true,
      site: { select: { id: true, name: true } },
      rack: {
        select: {
          room: {
            select: {
              building: {
                select: { siteId: true, site: { select: { id: true, name: true } } },
              },
            },
          },
        },
      },
    },
  },
  responsibleUser: { select: { id: true, displayName: true, username: true } },
  responsibleGroup: { select: { id: true, name: true } },
} as const;

@Injectable()
export class LifecycleDatesService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService, private readonly audit: AuditService) {}

  private day(value: string) {
    const date = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(date.getTime()) || date.toISOString().slice(0, 10) !== value) throw new BadRequestException('A data tem de ser um dia válido no formato YYYY-MM-DD.');
    return date;
  }

  private reminderDays(values?: number[]) {
    const days = values ?? DEFAULT_REMINDERS;
    if (days.length > 4 || new Set(days).size !== days.length || days.some((day) => !Number.isInteger(day) || day < 0 || day > 365)) throw new BadRequestException('Os lembretes devem ser dias únicos entre 0 e 365.');
    return [...days].sort((a, b) => b - a);
  }

  private async deviceContext(deviceId: string) {
    const device = await this.prisma.device.findUnique({ where: { id: deviceId }, select: { id: true, type: true, siteId: true, rack: { select: { room: { select: { building: { select: { siteId: true } } } } } } } });
    if (!device) throw new NotFoundException('Equipamento não encontrado.');
    const siteId = device.rack?.room.building.siteId ?? device.siteId;
    if (!siteId) throw new BadRequestException('O equipamento tem de pertencer a um Site para registar datas.');
    return { ...device, siteId };
  }

  private async assignment(siteId: string, input: { responsibleUserId?: string | null; responsibleGroupId?: string | null }, current?: { responsibleUserId: string | null; responsibleGroupId: string | null }, body?: UpdateLifecycleDateDto) {
    const hasUser = body ? Object.hasOwn(body, 'responsibleUserId') : input.responsibleUserId !== undefined;
    const hasGroup = body ? Object.hasOwn(body, 'responsibleGroupId') : input.responsibleGroupId !== undefined;
    let userId = hasUser ? input.responsibleUserId ?? null : current?.responsibleUserId ?? null;
    let groupId = hasGroup ? input.responsibleGroupId ?? null : current?.responsibleGroupId ?? null;
    if (hasUser && !hasGroup && userId) groupId = null;
    if (hasGroup && !hasUser && groupId) userId = null;
    if (userId && groupId) throw new BadRequestException('Escolha uma pessoa ou um grupo responsável, não ambos.');
    if (groupId) {
      const group = await this.prisma.accessGroup.findFirst({ where: { id: groupId, siteAssignments: { some: { siteId } } }, select: { id: true } });
      if (!group) throw new BadRequestException('O grupo responsável não está atribuído a este Site.');
    } else if (userId) {
      const member = await this.prisma.accessGroupMember.findFirst({ where: { userId, group: { siteAssignments: { some: { siteId } } } }, select: { userId: true } });
      if (!member) throw new BadRequestException('A pessoa responsável não pertence a um grupo deste Site.');
    } else {
      const fallback = await this.prisma.accessGroup.findFirst({ where: { name: { equals: 'Site coordinator', mode: 'insensitive' }, siteAssignments: { some: { siteId } } }, select: { id: true } });
      if (!fallback) throw new BadRequestException('Atribua uma pessoa ou grupo responsável, ou configure o grupo Site coordinator neste Site.');
      groupId = fallback.id;
    }
    return { responsibleUserId: userId, responsibleGroupId: groupId };
  }

  private async withVisibleDevice<T extends { deviceId: string }>(item: T, user: AuthenticatedUser) {
    try { await this.access.assertDevice(user, 'READ', item.deviceId); return true; } catch { return false; }
  }

  async list(user: AuthenticatedUser, siteId: string, from: string, to: string) {
    if (!siteId || !from || !to) throw new BadRequestException('siteId, from e to são obrigatórios.');
    const start = this.day(from); const end = this.day(to);
    if (end < start || (end.getTime() - start.getTime()) / 86_400_000 > 370) throw new BadRequestException('O intervalo de datas é inválido ou demasiado amplo.');
    const items = await this.prisma.lifecycleDate.findMany({ where: { dueDate: { gte: start, lte: end }, device: { OR: [
      { siteId }, { rack: { room: { building: { siteId } } } },
    ] } }, include: includeLifecycle, orderBy: [{ dueDate: 'asc' }, { kind: 'asc' }] });
    const visible = await Promise.all(items.map((item) => this.withVisibleDevice(item, user)));
    return { items: items.filter((_, index) => visible[index]).map((item) => ({
      ...item,
      dueDate: item.dueDate.toISOString().slice(0, 10),
      reminderDays: Array.isArray(item.reminderDays) ? item.reminderDays : DEFAULT_REMINDERS,
      site: item.device.rack?.room.building.site ?? item.device.site ?? { id: siteId, name: '' },
      device: { id: item.device.id, name: item.device.name, type: item.device.type, siteId: item.device.rack?.room.building.siteId ?? item.device.siteId ?? siteId },
    })) };
  }

  async create(deviceId: string, dto: CreateLifecycleDateDto, user: AuthenticatedUser) {
    const device = await this.deviceContext(deviceId);
    await this.access.assertDevice(user, 'UPDATE', deviceId);
    const assignment = await this.assignment(device.siteId, dto);
    try {
      const item = await this.prisma.lifecycleDate.create({ data: { deviceId, kind: dto.kind, dueDate: this.day(dto.dueDate), reminderDays: this.reminderDays(dto.reminderDays), ...assignment }, include: includeLifecycle });
      await this.audit.record({ userId: user.id, action: 'LIFECYCLE_DATE_CREATED', entityType: 'LifecycleDate', entityId: item.id, metadata: { deviceId, kind: item.kind, dueDate: item.dueDate.toISOString().slice(0, 10) } });
      return { ...item, dueDate: item.dueDate.toISOString().slice(0, 10), reminderDays: item.reminderDays };
    } catch (error) {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ConflictException('Já existe uma data deste tipo para este equipamento.');
      throw error;
    }
  }

  async update(id: string, dto: UpdateLifecycleDateDto, user: AuthenticatedUser) {
    const current = await this.prisma.lifecycleDate.findUnique({ where: { id }, select: { id: true, deviceId: true, responsibleUserId: true, responsibleGroupId: true } });
    if (!current) throw new NotFoundException('Data de ciclo de vida não encontrada.');
    const device = await this.deviceContext(current.deviceId);
    await this.access.assertDevice(user, 'UPDATE', current.deviceId);
    const assignment = await this.assignment(device.siteId, dto, current, dto);
    const item = await this.prisma.lifecycleDate.update({ where: { id }, data: {
      ...(dto.kind !== undefined ? { kind: dto.kind } : {}), ...(dto.dueDate !== undefined ? { dueDate: this.day(dto.dueDate) } : {}),
      ...(dto.reminderDays !== undefined ? { reminderDays: this.reminderDays(dto.reminderDays) } : {}), ...assignment,
    }, include: includeLifecycle }).catch((error: unknown) => {
      if (typeof error === 'object' && error !== null && 'code' in error && error.code === 'P2002') throw new ConflictException('Já existe uma data deste tipo para este equipamento.');
      throw error;
    });
    await this.audit.record({ userId: user.id, action: 'LIFECYCLE_DATE_UPDATED', entityType: 'LifecycleDate', entityId: id, metadata: { deviceId: current.deviceId, kind: item.kind, dueDate: item.dueDate.toISOString().slice(0, 10) } });
    return { ...item, dueDate: item.dueDate.toISOString().slice(0, 10), reminderDays: item.reminderDays };
  }

  async remove(id: string, user: AuthenticatedUser) {
    const current = await this.prisma.lifecycleDate.findUnique({ where: { id }, select: { id: true, deviceId: true, kind: true } });
    if (!current) throw new NotFoundException('Data de ciclo de vida não encontrada.');
    await this.access.assertDevice(user, 'UPDATE', current.deviceId);
    await this.prisma.lifecycleDate.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'LIFECYCLE_DATE_DELETED', entityType: 'LifecycleDate', entityId: id, metadata: { deviceId: current.deviceId, kind: current.kind } });
    return { success: true };
  }
}
