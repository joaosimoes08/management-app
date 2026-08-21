import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { CreateApplicationLinkDto } from './dto/create-application-link.dto';
import { UpdateApplicationLinkDto } from './dto/update-application-link.dto';

@Injectable()
export class ApplicationLinksService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async list(user: AuthenticatedUser, includeInactive = false) {
    const canManage = user.roles.includes('ADMIN');
    return this.prisma.applicationLink.findMany({
      where: {
        ...(includeInactive && canManage ? {} : { isActive: true, OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles } } } }] }),
      },
      include: { roles: true },
      orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }, { name: 'asc' }],
    });
  }

  async create(dto: CreateApplicationLinkDto, user: AuthenticatedUser) {
    const { roles, ...data } = dto;
    const link = await this.prisma.applicationLink.create({
      data: { ...data, roles: { create: (roles ?? []).map((role) => ({ role: role as never })) } },
      include: { roles: true },
    });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_CREATED', entityType: 'ApplicationLink', entityId: link.id, metadata: { name: link.name } });
    return link;
  }

  async update(id: string, dto: UpdateApplicationLinkDto, user: AuthenticatedUser) {
    const existing = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!existing) throw new NotFoundException('Ligação não encontrada');
    const { roles, ...data } = dto;
    const link = await this.prisma.$transaction(async (tx) => {
      if (roles) await tx.applicationLinkRole.deleteMany({ where: { linkId: id } });
      return tx.applicationLink.update({
        where: { id },
        data: { ...data, ...(roles ? { roles: { create: roles.map((role) => ({ role: role as never })) } } : {}) },
        include: { roles: true },
      });
    });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_UPDATED', entityType: 'ApplicationLink', entityId: link.id, metadata: { name: link.name } });
    return link;
  }

  async remove(id: string, user: AuthenticatedUser) {
    const link = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Ligação não encontrada');
    await this.prisma.applicationLink.delete({ where: { id } });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_DELETED', entityType: 'ApplicationLink', entityId: id, metadata: { name: link.name } });
  }

  async check(id: string, user: AuthenticatedUser) {
    const link = await this.prisma.applicationLink.findUnique({ where: { id } });
    if (!link) throw new NotFoundException('Ligação não encontrada');
    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 5000);
    let available = false;
    try {
      const response = await fetch(link.url, { method: 'HEAD', redirect: 'manual', signal: controller.signal });
      available = response.status >= 200 && response.status < 400;
    } catch { available = false; }
    finally { clearTimeout(timeout); }
    const updated = await this.prisma.applicationLink.update({ where: { id }, data: { lastCheckedAt: new Date(), isAvailable: available }, include: { roles: true } });
    await this.audit.record({ userId: user.id, action: 'APPLICATION_LINK_CHECKED', entityType: 'ApplicationLink', entityId: id, metadata: { available } });
    return updated;
  }
}
