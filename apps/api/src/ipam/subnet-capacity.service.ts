import { Injectable, Logger, NotFoundException, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';
import { calculateSubnetCapacity, forecastSubnetCapacity } from './subnet-capacity';

@Injectable()
export class SubnetCapacityService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(SubnetCapacityService.name);
  private capacitySnapshotTimer?: NodeJS.Timeout;

  constructor(private readonly prisma: PrismaClient, private readonly access: IpamAccessService) {}

  async onModuleInit() {
    await this.captureCapacitySnapshots().catch((error) => this.logger.error('Could not capture subnet capacity snapshots', error));
    this.scheduleCapacitySnapshot();
  }

  async onModuleDestroy() {
    if (this.capacitySnapshotTimer) clearTimeout(this.capacitySnapshotTimer);
  }

  private scheduleCapacitySnapshot() {
    const now = new Date();
    const next = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
    this.capacitySnapshotTimer = setTimeout(async () => {
      await this.captureCapacitySnapshots().catch((error) => this.logger.error('Could not capture subnet capacity snapshots', error));
      this.scheduleCapacitySnapshot();
    }, next.getTime() - now.getTime());
  }

  private async captureCapacitySnapshots(subnetId?: string) {
    const subnets = await this.prisma.subnet.findMany({
      where: subnetId ? { id: subnetId } : {},
      select: { id: true, cidr: true, version: true, gateway: true },
    });
    if (!subnets.length) return;

    const ips = await this.prisma.ipAddress.findMany({
      where: { subnetId: { in: subnets.map((subnet) => subnet.id) } },
      select: { subnetId: true, address: true, state: true },
    });
    const bySubnet = new Map<string, typeof ips>();
    for (const ip of ips) {
      const rows = bySubnet.get(ip.subnetId) ?? [];
      rows.push(ip);
      bySubnet.set(ip.subnetId, rows);
    }

    const now = new Date();
    const sampledAt = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()));
    await Promise.all(subnets.map(async (subnet) => {
      const point = calculateSubnetCapacity(subnet.cidr, subnet.gateway, bySubnet.get(subnet.id) ?? [], sampledAt);
      await this.prisma.subnetCapacitySnapshot.upsert({
        where: { subnetId_sampledAt: { subnetId: subnet.id, sampledAt } },
        create: { subnetId: subnet.id, ...point },
        update: point,
      });
    }));
  }

  async usage(id: string, user: AuthenticatedUser) {
    const subnet = await this.getReadableSubnet(id, user);
    const [counts, addresses] = await Promise.all([
      this.prisma.ipAddress.groupBy({ by: ['state'], where: { subnetId: id }, _count: { _all: true } }),
      this.prisma.ipAddress.findMany({ where: { subnetId: id }, select: { address: true, state: true } }),
    ]);
    const byState = Object.fromEntries(counts.map((item) => [item.state, item._count._all]));
    const capacity = calculateSubnetCapacity(subnet.cidr, subnet.gateway, addresses);
    return {
      subnet,
      version: capacity.version,
      total: capacity.usableCapacity,
      usableCapacity: capacity.usableCapacity,
      known: capacity.trackedAddresses,
      occupied: capacity.occupiedAddresses,
      reserved: capacity.reservedAddresses,
      excluded: byState.EXCLUDED ?? 0,
      free: capacity.freeAddresses,
      byState,
      utilizationPercent: capacity.utilizationPercent,
    };
  }

  async history(id: string, user: AuthenticatedUser) {
    const subnet = await this.getReadableSubnet(id, user);
    await this.captureCapacitySnapshots(id);
    const from = new Date(Date.now() - 90 * 86_400_000);
    const samples = await this.prisma.subnetCapacitySnapshot.findMany({
      where: { subnetId: id, sampledAt: { gte: new Date(Date.UTC(from.getUTCFullYear(), from.getUTCMonth(), from.getUTCDate())) } },
      orderBy: { sampledAt: 'asc' },
      take: 90,
    });
    return {
      subnet: { id: subnet.id, cidr: subnet.cidr, version: subnet.version, gateway: subnet.gateway },
      samples,
      forecast: forecastSubnetCapacity(samples),
    };
  }

  private async getReadableSubnet(id: string, user: AuthenticatedUser) {
    await this.access.assertSubnet(user, 'READ', id);
    const subnet = await this.prisma.subnet.findUnique({ where: { id } });
    if (!subnet) throw new NotFoundException('Subnet não encontrada');
    return subnet;
  }
}
