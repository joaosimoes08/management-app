import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';

const severities = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'];

@Injectable()
export class AlertConfigurationService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async list() {
    const [rules, windows] = await Promise.all([
      this.prisma.alertRule.findMany({ orderBy: [{ siteId: 'asc' }, { name: 'asc' }], include: { site: { select: { id: true, name: true } } } }),
      this.prisma.maintenanceWindow.findMany({ where: { endsAt: { gte: new Date() } }, orderBy: { startsAt: 'asc' }, take: 100, include: { site: { select: { id: true, name: true } }, createdBy: { select: { username: true, displayName: true } } } }),
    ]);
    return { rules, windows };
  }

  async saveRule(body: { id?: string; name: string; source: string; siteId?: string | null; minSeverity: string; enabled: boolean }, user: AuthenticatedUser) {
    const name = body.name?.trim(); const source = body.source?.trim();
    if (!name || name.length > 120 || !source || source.length > 100) throw new BadRequestException('Nome e tipo de evento são obrigatórios.');
    if (!severities.includes(body.minSeverity)) throw new BadRequestException('Severidade mínima inválida.');
    if (body.siteId) { const site = await this.prisma.site.findUnique({ where: { id: body.siteId }, select: { id: true } }); if (!site) throw new NotFoundException('Site não encontrado.'); }
    const data = { name, source, siteId: body.siteId || null, minSeverity: body.minSeverity, enabled: Boolean(body.enabled) };
    const item = body.id
      ? await this.prisma.alertRule.update({ where: { id: body.id }, data }).catch(() => { throw new NotFoundException('Regra não encontrada.'); })
      : await this.prisma.alertRule.create({ data });
    await this.audit.record({ userId: user.id, action: body.id ? 'ALERT_RULE_UPDATED' : 'ALERT_RULE_CREATED', entityType: 'AlertRule', entityId: item.id, metadata: data });
    return item;
  }

  async removeRule(id: string, user: AuthenticatedUser) {
    await this.prisma.alertRule.delete({ where: { id } }).catch(() => { throw new NotFoundException('Regra não encontrada.'); });
    await this.audit.record({ userId: user.id, action: 'ALERT_RULE_DELETED', entityType: 'AlertRule', entityId: id }); return { success: true };
  }

  async createWindow(body: { name: string; reason?: string; siteId?: string | null; startsAt: string; endsAt: string }, user: AuthenticatedUser) {
    const name = body.name?.trim(); const startsAt = new Date(body.startsAt); const endsAt = new Date(body.endsAt);
    if (!name || name.length > 120 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new BadRequestException('Indica um nome e um intervalo de manutenção válido.');
    if (body.siteId) { const site = await this.prisma.site.findUnique({ where: { id: body.siteId }, select: { id: true } }); if (!site) throw new NotFoundException('Site não encontrado.'); }
    const data = { name, reason: body.reason?.trim().slice(0, 500) || null, siteId: body.siteId || null, startsAt, endsAt, createdById: user.id };
    const item = await this.prisma.maintenanceWindow.create({ data });
    await this.audit.record({ userId: user.id, action: 'MAINTENANCE_WINDOW_CREATED', entityType: 'MaintenanceWindow', entityId: item.id, metadata: { name, reason: data.reason, siteId: data.siteId, startsAt, endsAt, criticalAlertsUnaffected: true } });
    return item;
  }

  async removeWindow(id: string, user: AuthenticatedUser) {
    await this.prisma.maintenanceWindow.delete({ where: { id } }).catch(() => { throw new NotFoundException('Janela não encontrada.'); });
    await this.audit.record({ userId: user.id, action: 'MAINTENANCE_WINDOW_DELETED', entityType: 'MaintenanceWindow', entityId: id }); return { success: true };
  }
}
