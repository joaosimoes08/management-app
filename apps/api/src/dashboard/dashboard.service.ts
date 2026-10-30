import { BadRequestException, ConflictException, ForbiddenException, Injectable, NotFoundException, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';
import { DashboardRoleDto, SaveDashboardLayoutDto, SaveDashboardPreferenceDto } from './dto';
import { OperationsService } from '../operations/operations.service';
import { InventoryQualityService } from '../inventory-quality/inventory-quality.service';

export type TopbarAlert = {
  id: string;
  severity: 'CRITICAL' | 'WARNING' | 'INFO';
  title: string;
  detail: string;
  href: string;
  occurredAt: string;
};

export type GlobalSearchResult = {
  id: string;
  type: 'SITE' | 'DEVICE' | 'INTERFACE' | 'HOST' | 'SERVICE' | 'VLAN' | 'SUBNET' | 'IP' | 'APPLICATION';
  title: string;
  detail: string;
  href: string;
};

@Injectable()
export class DashboardService implements OnModuleDestroy {
  private readonly discoveryQueue = new Queue('discovery', { connection: this.redisConnection() });
  constructor(
    private readonly prisma: PrismaClient,
    private readonly ipamAccess: IpamAccessService,
    private readonly infrastructureAccess: InfrastructureAccessService,
    private readonly operations: OperationsService,
    private readonly quality: InventoryQualityService,
  ) {}
  async onModuleDestroy() { await this.discoveryQueue.disconnect(); }

  private redisConnection() {
    const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
    return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1500, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) };
  }

  async summary(user?: AuthenticatedUser) {
    if (!user) return { counts: { sites: 0, devices: 0, vlans: 0, subnets: 0, ips: 0, occupiedIps: 0, freeIps: 0, applications: 0 }, recentAudit: [] };
    const [siteWhere, vlanWhere, subnetWhere, ipWhere, roomIds, unplacedSiteIds] = await Promise.all([
      this.ipamAccess.whereFor(user, 'READ', 'site'),
      this.ipamAccess.whereFor(user, 'READ', 'vlan'),
      this.ipamAccess.whereFor(user, 'READ', 'subnet'),
      this.ipamAccess.whereFor(user, 'READ', 'ip'),
      this.infrastructureAccess.visibleRoomIds(user),
      this.infrastructureAccess.visibleUnplacedSiteIds(user),
    ]);
    const deviceWhere = { OR: [{ rack: { roomId: { in: roomIds } } }, { rackId: null, siteId: { in: unplacedSiteIds } }] };
    const applicationWhere = { isActive: true, OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles } } } }] };
    const [sites, devices, vlans, subnets, ips, occupiedIps, freeIps, applications, recentAudit] = await Promise.all([
      this.prisma.site.count({ where: siteWhere }),
      this.prisma.device.count({ where: deviceWhere }),
      this.prisma.vlan.count({ where: vlanWhere }),
      this.prisma.subnet.count({ where: subnetWhere }),
      this.prisma.ipAddress.count({ where: ipWhere }),
      this.prisma.ipAddress.count({ where: { AND: [ipWhere, { state: 'OCCUPIED' }] } }),
      this.prisma.ipAddress.count({ where: { AND: [ipWhere, { state: 'FREE' }] } }),
      this.prisma.applicationLink.count({ where: applicationWhere }),
      user && !user.roles.some((role) => role === 'ADMIN' || role === 'AUDITOR') ? Promise.resolve([]) : this.prisma.auditLog.findMany({
        take: 6,
        orderBy: { createdAt: 'desc' },
        include: { user: { select: { username: true, displayName: true } } },
      }),
    ]);

    return {
      counts: { sites, devices, vlans, subnets, ips, occupiedIps, freeIps, applications },
      recentAudit: recentAudit.map((entry) => ({
        id: entry.id,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        username: entry.user?.displayName ?? entry.user?.username ?? 'sistema',
        createdAt: entry.createdAt,
      })),
    };
  }

  async search(queryText: string | undefined, limitText: string | undefined, user: AuthenticatedUser) {
    const query = queryText?.trim() ?? '';
    if (query.length < 2) return { items: [] as GlobalSearchResult[] };
    const limit = Math.min(Math.max(Number(limitText) || 8, 1), 20);
    const contains = { contains: query, mode: 'insensitive' as const };
    const [siteWhere, vlanWhere, subnetWhere, ipWhere, hostWhere, roomIds, unplacedSiteIds] = await Promise.all([
      this.ipamAccess.whereFor(user, 'READ', 'site'),
      this.ipamAccess.whereFor(user, 'READ', 'vlan'),
      this.ipamAccess.whereFor(user, 'READ', 'subnet'),
      this.ipamAccess.whereFor(user, 'READ', 'ip'),
      this.ipamAccess.whereFor(user, 'READ', 'host'),
      this.infrastructureAccess.visibleRoomIds(user),
      this.infrastructureAccess.visibleUnplacedSiteIds(user),
    ]);
    const visibleDeviceWhere = { OR: [{ rack: { roomId: { in: roomIds } } }, { rackId: null, siteId: { in: unplacedSiteIds } }] };
    const [sites, devices, interfaces, hosts, services, vlans, subnets, ips, applications] = await Promise.all([
      this.prisma.site.findMany({ where: { AND: [siteWhere, { OR: [{ name: contains }, { code: contains }, { city: contains }] }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' }, take: limit }),
      this.prisma.device.findMany({ where: { AND: [visibleDeviceWhere, { OR: [{ name: contains }, { hostname: contains }, { managementIp: contains }, { serialNumber: contains }, { assetTag: contains }] }] }, select: { id: true, name: true, hostname: true, managementIp: true, siteId: true, site: { select: { name: true } } }, orderBy: { name: 'asc' }, take: limit }),
      this.prisma.deviceInterface.findMany({ where: { device: visibleDeviceWhere, OR: [{ name: contains }, { portKey: contains }, { description: contains }, { macAddress: contains }] }, select: { id: true, name: true, portKey: true, macAddress: true, device: { select: { id: true, name: true, siteId: true, site: { select: { name: true } } } } }, orderBy: [{ device: { name: 'asc' } }, { name: 'asc' }], take: limit }),
      this.prisma.host.findMany({ where: { AND: [hostWhere, { OR: [{ name: contains }, { hostname: contains }, { observedHostname: contains }, { macAddress: contains }, { operatingSystem: contains }] }] }, select: { id: true, name: true, hostname: true, observedHostname: true, macAddress: true, ipAddresses: { select: { subnet: { select: { siteId: true, site: { select: { name: true } } } } }, take: 1 }, device: { select: { siteId: true } } }, orderBy: { name: 'asc' }, take: limit }),
      this.prisma.service.findMany({ where: { AND: [{ host: hostWhere }, { OR: [{ name: contains }, { protocol: contains }, { version: contains }, ...(/^\d+$/.test(query) ? [{ port: Number(query) }] : [])] }] }, select: { id: true, name: true, protocol: true, port: true, host: { select: { id: true, name: true, ipAddresses: { select: { subnet: { select: { siteId: true } } }, take: 1 }, device: { select: { siteId: true } } } } }, orderBy: [{ name: 'asc' }, { port: 'asc' }], take: limit }),
      this.prisma.vlan.findMany({ where: { AND: [vlanWhere, { OR: [{ name: contains }, ...(/^\d+$/.test(query) ? [{ vlanId: Number(query) }] : [])] }] }, select: { id: true, vlanId: true, name: true, siteId: true, site: { select: { name: true } } }, orderBy: { vlanId: 'asc' }, take: limit }),
      this.prisma.subnet.findMany({ where: { AND: [subnetWhere, { OR: [{ cidr: contains }, { purpose: contains }, { gateway: contains }] }] }, select: { id: true, cidr: true, purpose: true, siteId: true, site: { select: { name: true } } }, orderBy: { cidr: 'asc' }, take: limit }),
      this.prisma.ipAddress.findMany({ where: { AND: [ipWhere, { OR: [{ address: contains }, { hostname: contains }, { macAddress: contains }] }] }, select: { id: true, address: true, hostname: true, subnetId: true, subnet: { select: { cidr: true, siteId: true } } }, orderBy: { address: 'asc' }, take: limit }),
      this.prisma.applicationLink.findMany({ where: { isActive: true, AND: [{ OR: [{ name: contains }, { description: contains }, { category: contains }] }, { OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles } } } }] }] }, select: { id: true, name: true, category: true, url: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }], take: limit }),
    ]);

    const items: GlobalSearchResult[] = [
      ...sites.map((site) => ({ id: site.id, type: 'SITE' as const, title: site.name, detail: `Site · ${site.code}`, href: `/ipam?siteId=${site.id}` })),
      ...devices.map((device) => ({ id: device.id, type: 'DEVICE' as const, title: device.name, detail: `Equipamento · ${device.site?.name ?? device.hostname ?? device.managementIp ?? 'sem Site'}`, href: `/infraestrutura${device.siteId ? `?siteId=${device.siteId}&tab=devices` : ''}` })),
      ...interfaces.map((item) => ({ id: item.id, type: 'INTERFACE' as const, title: item.name, detail: `Interface · ${item.device.name}${item.macAddress ? ` · ${item.macAddress}` : item.portKey ? ` · ${item.portKey}` : ''}`, href: `/infraestrutura${item.device.siteId ? `?siteId=${item.device.siteId}&tab=interfaces&deviceId=${item.device.id}` : ''}` })),
      ...hosts.map((host) => { const siteId = host.ipAddresses[0]?.subnet.siteId ?? host.device?.siteId; return { id: host.id, type: 'HOST' as const, title: host.name, detail: `Host · ${host.hostname ?? host.observedHostname ?? host.macAddress ?? 'sem hostname'}`, href: `/ipam?${new URLSearchParams({ ...(siteId ? { siteId } : {}), hostId: host.id }).toString()}` }; }),
      ...services.map((service) => { const siteId = service.host.ipAddresses[0]?.subnet.siteId ?? service.host.device?.siteId; return { id: service.id, type: 'SERVICE' as const, title: service.name, detail: `Service · ${service.host.name}${service.protocol || service.port ? ` · ${[service.protocol, service.port].filter(Boolean).join('/')}` : ''}`, href: `/ipam?${new URLSearchParams({ ...(siteId ? { siteId } : {}), hostId: service.host.id }).toString()}` }; }),
      ...vlans.map((vlan) => ({ id: vlan.id, type: 'VLAN' as const, title: `VLAN ${vlan.vlanId} · ${vlan.name}`, detail: vlan.site?.name ?? 'VLAN sem Site', href: `/ipam?${new URLSearchParams({ ...(vlan.siteId ? { siteId: vlan.siteId } : {}), vlanId: vlan.id }).toString()}` })),
      ...subnets.map((subnet) => ({ id: subnet.id, type: 'SUBNET' as const, title: subnet.cidr, detail: `Subnet · ${subnet.site?.name ?? subnet.purpose ?? 'sem Site'}`, href: `/ipam?${new URLSearchParams({ ...(subnet.siteId ? { siteId: subnet.siteId } : {}), subnetId: subnet.id, tab: 'subnets' }).toString()}` })),
      ...ips.map((ip) => ({ id: ip.id, type: 'IP' as const, title: ip.address, detail: `IP · ${ip.hostname ?? ip.subnet.cidr}`, href: `/ipam?${new URLSearchParams({ ...(ip.subnet.siteId ? { siteId: ip.subnet.siteId } : {}), subnetId: ip.subnetId, tab: 'subnets' }).toString()}` })),
      ...applications.map((application) => ({ id: application.id, type: 'APPLICATION' as const, title: application.name, detail: `Aplicação · ${application.category}`, href: application.url })),
    ];
    return { items: items.slice(0, limit) };
  }

  async topbarState(user?: AuthenticatedUser) {
    const canDiscover = Boolean(user?.roles.some((role) => role === 'ADMIN' || role === 'NETWORK_OPERATOR'));
    const subnetWhere = user && canDiscover ? await this.ipamAccess.whereFor(user, 'READ', 'subnet') : { id: { in: [] } };
    const [processes, redis, settings, pendingRoleRequests, notifications, operationalAlerts] = await Promise.all([
      this.prisma.discoveryJob.findMany({
        where: { status: { in: ['PENDING', 'RUNNING'] }, subnet: subnetWhere },
        include: { subnet: { select: { cidr: true } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.discoveryQueue.getJobCounts('waiting', 'active', 'failed').then((counts) => ({ available: true, counts })).catch(() => ({ available: false, counts: {} })),
      this.prisma.systemSettings.findFirst({ select: { setupCompleted: true, setupCompletedAt: true } }),
      user?.roles.includes('ADMIN') ? this.prisma.roleRequest.count({ where: { status: { in: ['PENDING', 'PROCESSING'] } } }) : Promise.resolve(0),
      user ? this.prisma.notification.findMany({ where: { userId: user.id, readAt: null }, orderBy: { createdAt: 'desc' }, take: 20 }) : Promise.resolve([]),
      user ? this.operations.list(user, { pageSize: '8' }) : Promise.resolve({ items: [] }),
    ]);

    const alerts: TopbarAlert[] = operationalAlerts.items.map((alert) => ({ id: alert.id, severity: alert.severity === 'HIGH' ? 'CRITICAL' : alert.severity, title: alert.title, detail: alert.detail, href: alert.actionHref ?? '/', occurredAt: alert.lastOccurredAt.toISOString() }));
    if (pendingRoleRequests > 0) alerts.push({ id: 'role-requests-pending', severity: 'INFO', title: `${pendingRoleRequests} pedido${pendingRoleRequests === 1 ? '' : 's'} de role${pendingRoleRequests === 1 ? '' : 's'} por rever`, detail: 'Existem pedidos de acesso à espera de decisão.', href: '/definicoes?tab=users', occurredAt: new Date().toISOString() });
    alerts.push(...notifications.map((notification) => ({ id: `notification-${notification.id}`, severity: 'INFO' as const, title: notification.title, detail: notification.message, href: '/perfil?tab=roles', occurredAt: notification.createdAt.toISOString() })));

    const severityOrder = { CRITICAL: 0, WARNING: 1, INFO: 2 };
    alerts.sort((left, right) => severityOrder[left.severity] - severityOrder[right.severity] || right.occurredAt.localeCompare(left.occurredAt));
    return {
      environment: {
        state: redis.available ? 'OPERATIONAL' : 'DEGRADED',
        setup: { completed: settings?.setupCompleted ?? false, completedAt: settings?.setupCompletedAt ?? null },
        services: [
          { key: 'api', label: 'API', state: 'OPERATIONAL' },
          { key: 'postgres', label: 'PostgreSQL', state: 'OPERATIONAL' },
          { key: 'redis', label: 'Redis / BullMQ', state: redis.available ? 'OPERATIONAL' : 'UNAVAILABLE' },
        ],
      },
      alerts: alerts.slice(0, 8),
      processes: processes.map((job) => ({ id: job.id, label: job.name, detail: job.subnet.cidr, state: job.status, href: `/descoberta?jobId=${job.id}` })),
      updatedAt: new Date().toISOString(),
    };
  }

  async readNotifications(user: AuthenticatedUser) {
    const result = await this.prisma.notification.updateMany({ where: { userId: user.id, readAt: null }, data: { readAt: new Date() } });
    return { updated: result.count };
  }

  private readonly widgetIds = new Set(['active-alerts', 'running-processes', 'discovery-review', 'snmp-drifts', 'quality-queue', 'service-health', 'inventory-summary', 'recent-changes', 'quick-actions']);
  private defaultWidgets(role: DashboardRoleDto) {
    const base = ['active-alerts', 'service-health', 'inventory-summary', 'recent-changes'];
    const operational = ['running-processes', 'discovery-review', 'snmp-drifts', 'quality-queue', 'quick-actions'];
    return [...base, ...(['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'].includes(role) ? operational : [])].map((id, index) => ({ id, x: (index % 2) * 6, y: Math.floor(index / 2) * 4, w: 6, h: 4, visible: true }));
  }
  private roles(user: AuthenticatedUser) { return user.roles.filter((role) => Object.values(DashboardRoleDto).includes(role as DashboardRoleDto)) as DashboardRoleDto[]; }
  private async assertWorkspace(user: AuthenticatedUser, siteId: string, role: DashboardRoleDto) {
    if (!siteId || !role) throw new BadRequestException('siteId e role são obrigatórios');
    if (!this.roles(user).includes(role) && !user.roles.includes('ADMIN')) throw new ForbiddenException('Workspace não atribuído');
    await this.infrastructureAccess.assertSite(user, 'READ', siteId);
  }
  private async assertOperationalWorkspace(user: AuthenticatedUser, siteId: string) {
    if (user.roles.includes('ADMIN')) return;
    const effective = await this.infrastructureAccess.effectiveAccess(user, siteId);
    const infrastructureActions = [effective.infrastructure.site, ...effective.infrastructure.buildings.map((item) => item.actions), ...effective.infrastructure.rooms.map((item) => item.actions)].flat();
    if (!effective.ipamActions.some((action) => ['CREATE', 'UPDATE', 'DELETE'].includes(action)) && !infrastructureActions.some((action) => ['CREATE', 'UPDATE', 'DELETE'].includes(action))) throw new ForbiddenException('O Site não tem permissão operacional para editar este layout');
  }
  async workspaces(user: AuthenticatedUser, requestedSiteId?: string) {
    const sites = await this.prisma.site.findMany({ where: requestedSiteId ? { id: requestedSiteId } : {}, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' } });
    const visible = (await Promise.all(sites.map(async (site) => { try { await this.infrastructureAccess.assertSite(user, 'READ', site.id); return site; } catch { return null; } }))).filter((site): site is NonNullable<typeof site> => Boolean(site));
    const roles = user.roles.includes('ADMIN') ? Object.values(DashboardRoleDto) : this.roles(user);
    const preferences = await this.prisma.userDashboardPreference.findMany({ where: { userId: user.id, siteId: { in: visible.map((site) => site.id) } } });
    return { items: visible.flatMap((site) => roles.map((role) => ({ id: `${site.id}:${role}`, siteId: site.id, siteName: site.name, siteCode: site.code, role, selected: preferences.some((item) => item.siteId === site.id && item.selectedRole === role) }))) };
  }
  async layout(user: AuthenticatedUser, siteId: string, role: DashboardRoleDto) {
    await this.assertWorkspace(user, siteId, role);
    const existing = await this.prisma.dashboardLayout.findUnique({ where: { siteId_role: { siteId, role } } });
    if (existing) return { siteId, role, revision: existing.revision, ...(existing.config as { widgets: unknown[] }) };
    const widgets = this.defaultWidgets(role);
    const created = await this.prisma.dashboardLayout.create({ data: { siteId, role, config: { widgets }, updatedById: user.id } }).catch(async () => this.prisma.dashboardLayout.findUniqueOrThrow({ where: { siteId_role: { siteId, role } } }));
    return { siteId, role, revision: created.revision, ...(created.config as { widgets: unknown[] }) };
  }
  async saveLayout(user: AuthenticatedUser, dto: SaveDashboardLayoutDto) {
    await this.assertWorkspace(user, dto.siteId, dto.role);
    if (!user.roles.includes('ADMIN') && !user.roles.includes(dto.role as 'NETWORK_OPERATOR' | 'SYSTEMS_OPERATOR')) throw new ForbiddenException('Só podes editar o layout da tua role');
    await this.assertOperationalWorkspace(user, dto.siteId);
    if (!dto.widgets.length || dto.widgets.some((widget) => !this.widgetIds.has(widget.id))) throw new BadRequestException('O layout contém widgets inválidos');
    if (new Set(dto.widgets.map((widget) => widget.id)).size !== dto.widgets.length) throw new BadRequestException('O layout contém widgets duplicados');
    if (dto.widgets.some((widget) => widget.x + widget.w > 12)) throw new BadRequestException('Um widget ultrapassa as 12 colunas do dashboard');
    const current = await this.prisma.dashboardLayout.findUnique({ where: { siteId_role: { siteId: dto.siteId, role: dto.role } } });
    const config = { widgets: dto.widgets.map(({ id, x, y, w, h, visible }) => ({ id, x, y, w, h, visible: visible ?? true })) };
    let saved;
    if (current) {
      const updated = await this.prisma.dashboardLayout.updateMany({ where: { id: current.id, revision: dto.revision ?? current.revision }, data: { config, updatedById: user.id, revision: { increment: 1 } } });
      if (updated.count !== 1) throw new ConflictException({ code: 'DASHBOARD_LAYOUT_REVISION_CONFLICT', message: 'O layout foi alterado por outro utilizador.' });
      saved = await this.prisma.dashboardLayout.findUniqueOrThrow({ where: { id: current.id } });
    } else {
      saved = await this.prisma.dashboardLayout.create({ data: { siteId: dto.siteId, role: dto.role, config, updatedById: user.id } }).catch(() => { throw new ConflictException({ code: 'DASHBOARD_LAYOUT_REVISION_CONFLICT', message: 'O layout foi criado por outro utilizador.' }); });
    }
    return { siteId: dto.siteId, role: dto.role, revision: saved.revision, widgets: config.widgets };
  }
  async savePreference(user: AuthenticatedUser, dto: SaveDashboardPreferenceDto) {
    await this.assertWorkspace(user, dto.siteId, dto.role);
    return this.prisma.userDashboardPreference.upsert({ where: { userId_siteId: { userId: user.id, siteId: dto.siteId } }, create: { userId: user.id, siteId: dto.siteId, selectedRole: dto.role }, update: { selectedRole: dto.role } });
  }
  async operationalSummary(user: AuthenticatedUser, siteId: string, role: DashboardRoleDto) {
    await this.assertWorkspace(user, siteId, role);
    const [roomIds, unplacedSiteIds, vlanAccess, subnetAccess, ipAccess] = await Promise.all([
      this.infrastructureAccess.visibleRoomIds(user, siteId), this.infrastructureAccess.visibleUnplacedSiteIds(user, siteId),
      this.ipamAccess.whereFor(user, 'READ', 'vlan'), this.ipamAccess.whereFor(user, 'READ', 'subnet'), this.ipamAccess.whereFor(user, 'READ', 'ip'),
    ]);
    const deviceAccess = { OR: [{ rack: { roomId: { in: roomIds } } }, { rackId: null, siteId: { in: unplacedSiteIds } }] };
    const subnetWhere = { AND: [subnetAccess, { siteId }] };
    const [alerts, quality, processes, drifts, devices, vlans, subnets, ips, topbar] = await Promise.all([
      this.operations.summary(user, siteId), this.quality.summary(user, siteId),
      this.prisma.discoveryJob.findMany({ where: { subnet: subnetWhere, status: { in: ['PENDING', 'RUNNING', 'FAILED'] } }, include: { subnet: { select: { cidr: true } } }, orderBy: { createdAt: 'desc' }, take: 20 }),
      this.prisma.snmpDrift.count({ where: { device: deviceAccess, status: 'PENDING' } }),
      this.prisma.device.count({ where: deviceAccess }),
      this.prisma.vlan.count({ where: { AND: [vlanAccess, { siteId }] } }), this.prisma.subnet.count({ where: subnetWhere }),
      this.prisma.ipAddress.count({ where: { AND: [ipAccess, { subnet: { siteId } }] } }), this.topbarState(user),
    ]);
    return {
      siteId, role, alerts, quality,
      discovery: processes.filter((item) => item.status === 'FAILED').length,
      drifts, inventory: { sites: 1, devices, vlans, subnets, ips }, services: topbar.environment.services,
      processes: processes.filter((item) => item.status === 'PENDING' || item.status === 'RUNNING').map((item) => ({ id: item.id, label: item.name, detail: item.subnet.cidr, state: item.status, href: `/descoberta?jobId=${item.id}` })),
      updatedAt: new Date().toISOString(),
    };
  }
}
