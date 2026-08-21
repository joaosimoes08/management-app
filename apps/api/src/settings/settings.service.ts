import { Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';

@Injectable()
export class SettingsService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService) {}
  private async getSettings() { return (await this.prisma.systemSettings.findFirst()) ?? this.prisma.systemSettings.create({ data: {} }); }
  async organization() { const settings = await this.getSettings(); const sites = await this.prisma.site.findMany({ orderBy: { name: 'asc' }, include: { _count: { select: { vlans: true, subnets: true, buildings: true } } } }); return { settings, sites }; }
  async updateOrganization(body: { name?: string; code?: string; timezone?: string }, user: AuthenticatedUser) { const current = await this.getSettings(); const updated = await this.prisma.systemSettings.update({ where: { id: current.id }, data: { organizationName: body.name?.trim() || current.organizationName, organizationCode: body.code?.trim().toUpperCase() || current.organizationCode, timezone: body.timezone || current.timezone } }); await this.audit.record({ userId: user.id, action: 'ORGANIZATION_SETTINGS_UPDATED', entityType: 'SystemSettings', entityId: updated.id, metadata: body }); return updated; }
  async integrations() { return { items: [{ key: 'keycloak', label: 'Keycloak', status: 'CONNECTED' }, { key: 'postgresql', label: 'PostgreSQL', status: 'CONNECTED' }, { key: 'redis', label: 'Redis/BullMQ', status: 'CONFIGURED' }, { key: 'ldap', label: 'LDAP/LDAPS', status: 'PLANNED' }, { key: 'snmp', label: 'SNMP', status: 'PLANNED' }, { key: 'agents', label: 'Agentes', status: 'PLANNED' }, { key: 'netapp', label: 'NetApp', status: 'PLANNED' }] }; }
  async system() { const settings = await this.getSettings(); return { setupCompleted: settings.setupCompleted, timezone: settings.timezone, nodeEnv: process.env.NODE_ENV ?? 'development', apiVersion: 'v1' }; }
}
