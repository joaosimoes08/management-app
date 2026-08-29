import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';
import { IpamAccessService } from '../ipam/ipam-access.service';

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
  type: 'SITE' | 'DEVICE' | 'VLAN' | 'SUBNET' | 'IP' | 'APPLICATION';
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
    const [siteWhere, vlanWhere, subnetWhere, ipWhere, roomIds, unplacedSiteIds] = await Promise.all([
      this.ipamAccess.whereFor(user, 'READ', 'site'),
      this.ipamAccess.whereFor(user, 'READ', 'vlan'),
      this.ipamAccess.whereFor(user, 'READ', 'subnet'),
      this.ipamAccess.whereFor(user, 'READ', 'ip'),
      this.infrastructureAccess.visibleRoomIds(user),
      this.infrastructureAccess.visibleUnplacedSiteIds(user),
    ]);
    const [sites, devices, vlans, subnets, ips, applications] = await Promise.all([
      this.prisma.site.findMany({ where: { AND: [siteWhere, { OR: [{ name: contains }, { code: contains }, { city: contains }] }] }, select: { id: true, name: true, code: true }, orderBy: { name: 'asc' }, take: limit }),
      this.prisma.device.findMany({ where: { AND: [{ OR: [{ rack: { roomId: { in: roomIds } } }, { rackId: null, siteId: { in: unplacedSiteIds } }] }, { OR: [{ name: contains }, { hostname: contains }, { managementIp: contains }, { serialNumber: contains }, { assetTag: contains }] }] }, select: { id: true, name: true, hostname: true, managementIp: true, siteId: true, site: { select: { name: true } } }, orderBy: { name: 'asc' }, take: limit }),
      this.prisma.vlan.findMany({ where: { AND: [vlanWhere, { OR: [{ name: contains }, ...(/^\d+$/.test(query) ? [{ vlanId: Number(query) }] : [])] }] }, select: { id: true, vlanId: true, name: true, siteId: true, site: { select: { name: true } } }, orderBy: { vlanId: 'asc' }, take: limit }),
      this.prisma.subnet.findMany({ where: { AND: [subnetWhere, { OR: [{ cidr: contains }, { purpose: contains }, { gateway: contains }] }] }, select: { id: true, cidr: true, purpose: true, siteId: true, site: { select: { name: true } } }, orderBy: { cidr: 'asc' }, take: limit }),
      this.prisma.ipAddress.findMany({ where: { AND: [ipWhere, { OR: [{ address: contains }, { hostname: contains }, { macAddress: contains }] }] }, select: { id: true, address: true, hostname: true, subnetId: true, subnet: { select: { cidr: true, siteId: true } } }, orderBy: { address: 'asc' }, take: limit }),
      this.prisma.applicationLink.findMany({ where: { isActive: true, AND: [{ OR: [{ name: contains }, { description: contains }, { category: contains }] }, { OR: [{ roles: { none: {} } }, { roles: { some: { role: { in: user.roles } } } }] }] }, select: { id: true, name: true, category: true, url: true }, orderBy: [{ category: 'asc' }, { sortOrder: 'asc' }], take: limit }),
    ]);

    const items: GlobalSearchResult[] = [
      ...sites.map((site) => ({ id: site.id, type: 'SITE' as const, title: site.name, detail: `Site · ${site.code}`, href: `/ipam?siteId=${site.id}` })),
      ...devices.map((device) => ({ id: device.id, type: 'DEVICE' as const, title: device.name, detail: `Equipamento · ${device.site?.name ?? device.hostname ?? device.managementIp ?? 'sem Site'}`, href: `/infraestrutura${device.siteId ? `?siteId=${device.siteId}&tab=devices` : ''}` })),
      ...vlans.map((vlan) => ({ id: vlan.id, type: 'VLAN' as const, title: `VLAN ${vlan.vlanId} · ${vlan.name}`, detail: vlan.site?.name ?? 'VLAN sem Site', href: `/ipam?${new URLSearchParams({ ...(vlan.siteId ? { siteId: vlan.siteId } : {}), vlanId: vlan.id }).toString()}` })),
      ...subnets.map((subnet) => ({ id: subnet.id, type: 'SUBNET' as const, title: subnet.cidr, detail: `Subnet · ${subnet.site?.name ?? subnet.purpose ?? 'sem Site'}`, href: `/ipam?${new URLSearchParams({ ...(subnet.siteId ? { siteId: subnet.siteId } : {}), subnetId: subnet.id, tab: 'subnets' }).toString()}` })),
      ...ips.map((ip) => ({ id: ip.id, type: 'IP' as const, title: ip.address, detail: `IP · ${ip.hostname ?? ip.subnet.cidr}`, href: `/ipam?${new URLSearchParams({ ...(ip.subnet.siteId ? { siteId: ip.subnet.siteId } : {}), subnetId: ip.subnetId, tab: 'subnets' }).toString()}` })),
      ...applications.map((application) => ({ id: application.id, type: 'APPLICATION' as const, title: application.name, detail: `Aplicação · ${application.category}`, href: application.url })),
    ];
    return { items: items.slice(0, limit) };
  }

  async topbarState(user?: AuthenticatedUser) {
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const canDiscover = Boolean(user?.roles.some((role) => role === 'ADMIN' || role === 'NETWORK_OPERATOR'));
    const subnetWhere = user && canDiscover ? await this.ipamAccess.whereFor(user, 'READ', 'subnet') : { id: { in: [] } };
    const [failedJobs, pendingResults, processes, redis, settings, pendingRoleRequests, notifications] = await Promise.all([
      this.prisma.discoveryJob.findMany({
        where: { status: 'FAILED', createdAt: { gte: cutoff }, subnet: subnetWhere },
        include: { subnet: { select: { cidr: true, site: { select: { name: true } } } } },
        orderBy: { createdAt: 'desc' },
        take: 5,
      }),
      this.prisma.discoveryResult.count({ where: { status: 'PENDING', job: { subnet: subnetWhere } } }),
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
    ]);

    const alerts: TopbarAlert[] = [];
    if (!redis.available) alerts.push({ id: 'redis-unavailable', severity: 'CRITICAL', title: 'Fila de discovery indisponível', detail: 'Não foi possível contactar o Redis/BullMQ.', href: '/definicoes?tab=system', occurredAt: new Date().toISOString() });
    alerts.push(...failedJobs.map((job) => ({ id: `discovery-failed-${job.id}`, severity: 'WARNING' as const, title: `Discovery falhou em ${job.subnet.cidr}`, detail: job.errorMessage || `Site ${job.subnet.site?.name ?? 'não definido'}`, href: `/descoberta?jobId=${job.id}`, occurredAt: (job.completedAt ?? job.createdAt).toISOString() })));
    if (pendingResults > 0) alerts.push({ id: 'discovery-pending-review', severity: 'INFO', title: `${pendingResults} resultado${pendingResults === 1 ? '' : 's'} por rever`, detail: 'Existem resultados de discovery à espera de aprovação.', href: '/descoberta', occurredAt: new Date().toISOString() });
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
}
