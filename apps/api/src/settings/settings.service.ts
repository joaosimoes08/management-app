import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { UpdateAuditPolicyDto, UpdateDiscoveryDefaultsDto, UpdateOrganizationSettingsDto } from './dto';
import Redis from 'ioredis';
import { DiscoveryPolicyError, normalizeAllowedCidrs } from '../discovery/discovery-policy';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}
  private async getSettings() { return (await this.prisma.systemSettings.findFirst()) ?? this.prisma.systemSettings.create({ data: {} }); }
  private stringArray(value: unknown, fallback: string[]) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback; }
  private numberArray(value: unknown, fallback: number[]) { return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : fallback; }
  async organization() { const settings = await this.getSettings(); const sites = await this.prisma.site.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { vlans: true, subnets: true, buildings: true, devices: true } } } }); return { settings, sites }; }
  async updateOrganization(body: UpdateOrganizationSettingsDto, user: AuthenticatedUser) { const current = await this.getSettings(); const updated = await this.prisma.systemSettings.update({ where: { id: current.id }, data: { organizationName: body.name?.trim() || current.organizationName, organizationCode: body.code?.trim().toUpperCase() || current.organizationCode, timezone: body.timezone || current.timezone, locale: body.locale || current.locale } }); await this.audit.record({ userId: user.id, action: 'ORGANIZATION_SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: updated.id, metadata: body }); return updated; }
  async discovery() { const settings = await this.getSettings(); return { methods: this.stringArray(settings.discoveryDefaultMethods, ['ICMP', 'TCP']), tcpPorts: this.numberArray(settings.discoveryDefaultTcpPorts, [22, 80, 443, 3389]), reverseDns: settings.discoveryDefaultReverseDns, intervalHours: settings.discoveryDefaultIntervalHours, allowedCidrs: normalizeAllowedCidrs(settings.discoveryAllowedCidrs) }; }
  async updateDiscovery(body: UpdateDiscoveryDefaultsDto, user: AuthenticatedUser) { const methods = [...new Set(body.methods)]; const tcpPorts = [...new Set(body.tcpPorts)].sort((a, b) => a - b); if (methods.includes('TCP') && !tcpPorts.length) throw new BadRequestException({ code: 'TCP_PORT_REQUIRED', message: 'Define pelo menos uma porta para Discovery TCP.' }); let allowedCidrs: string[]; try { allowedCidrs = normalizeAllowedCidrs(body.allowedCidrs); } catch (error) { if (error instanceof DiscoveryPolicyError) throw new BadRequestException({ code: error.code, message: error.message }); throw error; } const current = await this.getSettings(); await this.prisma.systemSettings.update({ where: { id: current.id }, data: { discoveryDefaultMethods: methods, discoveryDefaultTcpPorts: tcpPorts, discoveryDefaultReverseDns: body.reverseDns, discoveryDefaultIntervalHours: body.intervalHours, discoveryAllowedCidrs: allowedCidrs } }); await this.audit.record({ userId: user.id, action: 'DISCOVERY_DEFAULTS_UPDATED', entityType: 'SystemSettings', entityId: current.id, metadata: { ...body, methods, tcpPorts, allowedCidrs } }); return this.discovery(); }
  async auditPolicy() { const settings = await this.getSettings(); const [total, oldest] = await Promise.all([this.prisma.auditLog.count(), this.prisma.auditLog.findFirst({ orderBy: { createdAt: 'asc' }, select: { createdAt: true } })]); return { retentionDays: settings.auditRetentionDays, totalEvents: total, oldestEventAt: oldest?.createdAt ?? null, lastCleanupAt: settings.lastAuditCleanupAt, lastCleanupDeletedCount: settings.lastAuditCleanupDeletedCount, nextCleanupAt: settings.lastAuditCleanupAt ? new Date(settings.lastAuditCleanupAt.getTime() + 24 * 60 * 60 * 1000) : null }; }
  async updateAuditPolicy(body: UpdateAuditPolicyDto, user: AuthenticatedUser) { const current = await this.getSettings(); const updated = await this.prisma.systemSettings.update({ where: { id: current.id }, data: { auditRetentionDays: body.retentionDays } }); await this.audit.record({ userId: user.id, action: 'AUDIT_RETENTION_UPDATED', entityType: 'SystemSettings', entityId: current.id, metadata: { previousDays: current.auditRetentionDays, nextDays: body.retentionDays } }); return { ...(await this.auditPolicy()), retentionDays: updated.auditRetentionDays }; }
  async integrations() {
    const probe = async (operation: () => Promise<unknown>) => { try { await Promise.race([operation(), new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), 1500))]); return 'CONNECTED'; } catch { return 'DEGRADED'; } };
    const redis = new Redis(process.env.REDIS_URL ?? 'redis://localhost:6379', { lazyConnect: true, maxRetriesPerRequest: 0, enableOfflineQueue: false });
    const issuer = process.env.OIDC_ISSUER_URL ?? 'http://localhost:8080/realms/COCiber';
    const [postgresql, redisStatus, keycloak] = await Promise.all([
      probe(() => this.prisma.$queryRaw`SELECT 1`),
      probe(async () => { await redis.connect(); await redis.ping(); }),
      probe(async () => { const response = await fetch(`${issuer}/.well-known/openid-configuration`, { signal: AbortSignal.timeout(1500) }); if (!response.ok) throw new Error('unavailable'); }),
    ]);
    await redis.quit().catch(() => undefined);
    return { items: [{ key: 'keycloak', label: 'Keycloak', status: keycloak }, { key: 'postgresql', label: 'PostgreSQL', status: postgresql }, { key: 'redis', label: 'Redis/BullMQ', status: redisStatus }] };
  }
  async system() { const settings = await this.getSettings(); return { setupCompleted: settings.setupCompleted, timezone: settings.timezone, locale: settings.locale, nodeEnv: process.env.NODE_ENV ?? 'development', apiVersion: 'v1' }; }
}
