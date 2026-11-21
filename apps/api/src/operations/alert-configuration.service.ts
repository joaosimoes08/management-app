import { BadRequestException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { alertPolicyDecision, effectiveAlertRule } from './alert-policy';

const severities = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'];

@Injectable()
export class AlertConfigurationService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}

  async list() {
    const now = new Date();
    const [rules, windows, openAlerts, activeWindows] = await Promise.all([
      this.prisma.alertRule.findMany({ orderBy: [{ siteId: 'asc' }, { name: 'asc' }], include: { site: { select: { id: true, name: true } } } }),
      this.prisma.maintenanceWindow.findMany({ where: { endsAt: { gte: now } }, orderBy: { startsAt: 'asc' }, take: 100, include: { site: { select: { id: true, name: true } }, createdBy: { select: { username: true, displayName: true } } } }),
      this.prisma.operationalAlert.findMany({ where: { status: { not: 'RESOLVED' } }, select: { source: true, siteId: true, severity: true } }),
      this.prisma.maintenanceWindow.findMany({ where: { startsAt: { lte: now }, endsAt: { gt: now } }, select: { siteId: true } }),
    ]);
    return { rules: rules.map((rule) => ({ ...rule, activeAlerts: ruleAlertCounts(rule, rules, activeWindows, openAlerts) })), windows };
  }

  /** Partial update: only the fields sent change (e.g. { enabled: false } to switch a rule off). */
  async patchRule(id: string, body: { name?: string; source?: string; siteId?: string | null; minSeverity?: string; enabled?: boolean }, user: AuthenticatedUser) {
    const current = await this.prisma.alertRule.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Regra não encontrada.');
    if (body.name === undefined && body.source === undefined && body.siteId === undefined && body.minSeverity === undefined && body.enabled === undefined) throw new BadRequestException('Indica pelo menos um campo a alterar.');
    return this.saveRule({
      id,
      name: body.name ?? current.name,
      source: body.source ?? current.source,
      siteId: body.siteId === undefined ? current.siteId : body.siteId,
      minSeverity: body.minSeverity ?? current.minSeverity,
      enabled: body.enabled ?? current.enabled,
    }, user);
  }

  async patchWindow(id: string, body: { name?: string; reason?: string | null; siteId?: string | null; startsAt?: string; endsAt?: string }, user: AuthenticatedUser) {
    const current = await this.prisma.maintenanceWindow.findUnique({ where: { id } });
    if (!current) throw new NotFoundException('Janela não encontrada.');
    const name = body.name === undefined ? current.name : body.name?.trim();
    const startsAt = body.startsAt === undefined ? current.startsAt : new Date(body.startsAt);
    const endsAt = body.endsAt === undefined ? current.endsAt : new Date(body.endsAt);
    if (!name || name.length > 120 || !Number.isFinite(startsAt.getTime()) || !Number.isFinite(endsAt.getTime()) || startsAt >= endsAt) throw new BadRequestException('Indica um nome e um intervalo de manutenção válido.');
    const siteId = body.siteId === undefined ? current.siteId : body.siteId || null;
    if (siteId && siteId !== current.siteId) { const site = await this.prisma.site.findUnique({ where: { id: siteId }, select: { id: true } }); if (!site) throw new NotFoundException('Site não encontrado.'); }
    const reason = body.reason === undefined ? current.reason : body.reason?.trim().slice(0, 500) || null;
    const item = await this.prisma.maintenanceWindow.update({ where: { id }, data: { name, reason, siteId, startsAt, endsAt } });
    await this.audit.record({ userId: user.id, action: 'MAINTENANCE_WINDOW_UPDATED', entityType: 'MaintenanceWindow', entityId: id, metadata: { before: { name: current.name, reason: current.reason, siteId: current.siteId, startsAt: current.startsAt, endsAt: current.endsAt }, after: { name, reason, siteId, startsAt, endsAt }, criticalAlertsUnaffected: true } });
    return item;
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

/**
 * Open (not resolved) alerts per rule. `matching` counts alerts the rule could apply to (same source,
 * global rule or same Site). `governed` counts those where this rule is the effective one (enabled,
 * most specific, then strictest); they split into `shown`, `belowThreshold` and `inMaintenance`.
 */
export function ruleAlertCounts(
  rule: { id: string; source: string; siteId: string | null; minSeverity: string; enabled: boolean },
  rules: Array<{ id: string; source: string; siteId: string | null; minSeverity: string; enabled: boolean }>,
  activeWindows: Array<{ siteId: string | null }>,
  alerts: Array<{ source: string; siteId: string | null; severity: string }>,
) {
  const counts = { matching: 0, governed: 0, shown: 0, belowThreshold: 0, inMaintenance: 0 };
  for (const alert of alerts) {
    if (alert.source !== rule.source || (rule.siteId !== null && rule.siteId !== alert.siteId)) continue;
    counts.matching += 1;
    if (!rule.enabled || effectiveAlertRule(rules, alert)?.id !== rule.id) continue;
    counts.governed += 1;
    const decision = alertPolicyDecision(rules, activeWindows, alert);
    if (decision === 'SHOWN') counts.shown += 1; else if (decision === 'MAINTENANCE') counts.inMaintenance += 1; else counts.belowThreshold += 1;
  }
  return counts;
}
