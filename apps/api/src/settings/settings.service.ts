import { BadRequestException, Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { KeycloakAdminService } from './keycloak-admin.service';
import { UpdateAuditPolicyDto, UpdateDiscoveryDefaultsDto, UpdateOrganizationSettingsDto, UpdateSnmpListenerDto } from './dto';
import Redis from 'ioredis';
import { DiscoveryPolicyError, normalizeAllowedCidrs } from '../discovery/discovery-policy';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly keycloak: KeycloakAdminService) {}

  async users(search?: string, page?: string, pageSize?: string) {
    if (!this.keycloak) throw new Error('Keycloak service unavailable');
    const result = await this.keycloak.listUsers(search, page, pageSize);
    const users = await this.prisma.user.findMany({ where: { externalId: { in: result.items.map((item) => item.externalId) } }, select: { id: true, externalId: true } });
    const pending = await this.prisma.roleRequest.findMany({ where: { userId: { in: users.map((item) => item.id) }, status: { in: ['PENDING', 'PROCESSING'] } }, orderBy: { createdAt: 'asc' } });
    const byExternal = new Map(users.map((item) => [item.id, item.externalId]));
    return { ...result, items: result.items.map((item) => { const request = pending.find((entry) => byExternal.get(entry.userId) === item.externalId); return { ...item, pendingRoleRequest: request ? { id: request.id, requestedRoles: Array.isArray(request.roles) ? request.roles : [], status: request.status, createdAt: request.createdAt } : null }; }) };
  }
  async legacyRoleAssignments() {
    return this.prisma.userRole.findMany({ where: { role: 'STORAGE_OPERATOR' }, select: { userId: true, role: true, user: { select: { externalId: true, username: true, displayName: true, email: true } } }, orderBy: { user: { username: 'asc' } } });
  }
  private async getSettings() { return (await this.prisma.systemSettings.findFirst()) ?? this.prisma.systemSettings.create({ data: {} }); }
  private stringArray(value: unknown, fallback: string[]) { return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : fallback; }
  private numberArray(value: unknown, fallback: number[]) { return Array.isArray(value) ? value.filter((item): item is number => typeof item === 'number') : fallback; }
  async organization(user: AuthenticatedUser) { const settings = await this.getSettings(); const sites = user.roles.includes('ADMIN') ? await this.prisma.site.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { vlans: true, subnets: true, buildings: true, devices: true } } } }) : []; return { settings, sites }; }
  async updateOrganization(body: UpdateOrganizationSettingsDto, user: AuthenticatedUser) { const current = await this.getSettings(); const updated = await this.prisma.systemSettings.update({ where: { id: current.id }, data: { organizationName: body.name?.trim() || current.organizationName, organizationCode: body.code?.trim().toUpperCase() || current.organizationCode, timezone: body.timezone || current.timezone, locale: body.locale || current.locale } }); await this.audit.record({ userId: user.id, action: 'ORGANIZATION_SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: updated.id, metadata: body }); return updated; }
  async discovery() { const settings = await this.getSettings(); return { methods: this.stringArray(settings.discoveryDefaultMethods, ['ICMP', 'TCP']), tcpPorts: this.numberArray(settings.discoveryDefaultTcpPorts, [22, 80, 443, 3389]), reverseDns: settings.discoveryDefaultReverseDns, intervalHours: settings.discoveryDefaultIntervalHours, allowedCidrs: normalizeAllowedCidrs(settings.discoveryAllowedCidrs) }; }
  async updateDiscovery(body: UpdateDiscoveryDefaultsDto, user: AuthenticatedUser) { const methods = [...new Set(body.methods)]; const tcpPorts = [...new Set(body.tcpPorts)].sort((a, b) => a - b); if (methods.includes('TCP') && !tcpPorts.length) throw new BadRequestException({ code: 'TCP_PORT_REQUIRED', message: 'Define pelo menos uma porta para Discovery TCP.' }); let allowedCidrs: string[]; try { allowedCidrs = normalizeAllowedCidrs(body.allowedCidrs); } catch (error) { if (error instanceof DiscoveryPolicyError) throw new BadRequestException({ code: error.code, message: error.message }); throw error; } const current = await this.getSettings(); await this.prisma.systemSettings.update({ where: { id: current.id }, data: { discoveryDefaultMethods: methods, discoveryDefaultTcpPorts: tcpPorts, discoveryDefaultReverseDns: body.reverseDns, discoveryDefaultIntervalHours: body.intervalHours, discoveryAllowedCidrs: allowedCidrs } }); await this.audit.record({ userId: user.id, action: 'DISCOVERY_DEFAULTS_UPDATED', entityType: 'SystemSettings', entityId: current.id, metadata: { ...body, methods, tcpPorts, allowedCidrs } }); return this.discovery(); }
  private selectedSnmpInterfaces(value: unknown) {
    if (!Array.isArray(value)) return [];
    return value.flatMap((item) => {
      if (!item || typeof item !== 'object') return [];
      const candidate = item as Record<string, unknown>;
      return typeof candidate.instanceId === 'string' && typeof candidate.name === 'string' && typeof candidate.address === 'string'
        ? [{ instanceId: candidate.instanceId, name: candidate.name, address: candidate.address }]
        : [];
    });
  }
  async snmpListeners() {
    const freshSince = new Date(Date.now() - 2 * 60 * 1000);
    const [config, interfaces] = await Promise.all([
      this.prisma.snmpListenerConfig.findUnique({ where: { id: 'default' } }),
      this.prisma.snmpListenerInterface.findMany({ where: { instanceId: { startsWith: 'host:' }, lastSeenAt: { gte: freshSince } }, orderBy: [{ instanceId: 'asc' }, { name: 'asc' }, { address: 'asc' }] }),
    ]);
    const selected = this.selectedSnmpInterfaces(config?.selectedInterfaces);
    return {
      listenAll: config?.listenAll ?? true,
      selectedInterfaceIds: interfaces.filter((item) => selected.some((entry) => entry.instanceId === item.instanceId && entry.name === item.name && entry.address === item.address)).map((item) => item.id),
      interfaces: interfaces.map(({ id, instanceId, name, address, internal, lastSeenAt }) => ({ id, instanceId, name, address, internal, lastSeenAt })),
      updatedAt: config?.updatedAt ?? null,
      refreshSeconds: 30,
    };
  }
  async updateSnmpListeners(body: UpdateSnmpListenerDto, user: AuthenticatedUser) {
    const ids = [...new Set(body.interfaceIds)];
    if (!body.listenAll && !ids.length) throw new BadRequestException({ code: 'SNMP_LISTENER_REQUIRED', message: 'Seleciona pelo menos uma interface para receber traps SNMP.' });
    const freshSince = new Date(Date.now() - 2 * 60 * 1000);
    const interfaces = ids.length ? await this.prisma.snmpListenerInterface.findMany({ where: { id: { in: ids }, instanceId: { startsWith: 'host:' }, lastSeenAt: { gte: freshSince } } }) : [];
    if (!body.listenAll && interfaces.length !== ids.length) throw new BadRequestException({ code: 'SNMP_LISTENER_STALE', message: 'Uma ou mais interfaces já não estão disponíveis no host SNMP.' });
    if (new Set(interfaces.map((item) => item.instanceId)).size > 1) throw new BadRequestException({ code: 'SNMP_LISTENER_HOST_CONFLICT', message: 'As interfaces selecionadas têm de pertencer ao mesmo host SNMP.' });
    const selectedInterfaces = body.listenAll ? [] : interfaces.map(({ instanceId, name, address }) => ({ instanceId, name, address }));
    const updated = await this.prisma.snmpListenerConfig.upsert({
      where: { id: 'default' },
      create: { id: 'default', listenAll: body.listenAll, selectedInterfaces, updatedBy: user.id },
      update: { listenAll: body.listenAll, selectedInterfaces, updatedBy: user.id },
    });
    await this.audit.record({ userId: user.id, action: 'SNMP_LISTENERS_UPDATED', entityType: 'SnmpListenerConfig', entityId: updated.id, metadata: { listenAll: body.listenAll, interfaces: selectedInterfaces } });
    return this.snmpListeners();
  }
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
