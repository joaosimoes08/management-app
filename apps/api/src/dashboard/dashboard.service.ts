import { Injectable } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';

@Injectable()
export class DashboardService {
  constructor(private readonly prisma: PrismaClient) {}

  async summary() {
    const [sites, devices, vlans, subnets, ips, occupiedIps, freeIps, applications, recentAudit] = await Promise.all([
      this.prisma.site.count(),
      this.prisma.device.count(),
      this.prisma.vlan.count(),
      this.prisma.subnet.count(),
      this.prisma.ipAddress.count(),
      this.prisma.ipAddress.count({ where: { state: 'OCCUPIED' } }),
      this.prisma.ipAddress.count({ where: { state: 'FREE' } }),
      this.prisma.applicationLink.count({ where: { isActive: true } }),
      this.prisma.auditLog.findMany({
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
}
