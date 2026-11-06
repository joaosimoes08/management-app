import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { Prisma, PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly maintenance = new Queue('maintenance', { connection: this.redisConnection() });
  constructor(private readonly prisma: PrismaClient) {}
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1000, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) }; }
  async onModuleDestroy() { await this.maintenance.disconnect(); }
  list(filters: { limit?: number; search?: string; action?: string; entityType?: string; user?: string; from?: string; to?: string } = {}) {
    const term = (value?: string) => value?.trim().slice(0, 120) || undefined;
    const from = filters.from && Number.isFinite(Date.parse(filters.from)) ? new Date(filters.from) : undefined;
    const to = filters.to && Number.isFinite(Date.parse(filters.to)) ? new Date(filters.to) : undefined;
    return this.prisma.auditLog.findMany({
      take: Math.min(Math.max(filters.limit ?? 100, 1), 200), orderBy: { createdAt: 'desc' },
      where: {
        ...(term(filters.action) ? { action: { contains: term(filters.action), mode: 'insensitive' as const } } : {}),
        ...(term(filters.entityType) ? { entityType: { contains: term(filters.entityType), mode: 'insensitive' as const } } : {}),
        ...(term(filters.user) ? { user: { is: { OR: [{ username: { contains: term(filters.user), mode: 'insensitive' as const } }, { displayName: { contains: term(filters.user), mode: 'insensitive' as const } }] } } } : {}),
        ...(from || to ? { createdAt: { ...(from ? { gte: from } : {}), ...(to ? { lte: to } : {}) } } : {}),
        ...(term(filters.search) ? { OR: [
          { action: { contains: term(filters.search), mode: 'insensitive' as const } },
          { entityType: { contains: term(filters.search), mode: 'insensitive' as const } },
          { entityId: { contains: term(filters.search), mode: 'insensitive' as const } },
          { user: { is: { OR: [{ username: { contains: term(filters.search), mode: 'insensitive' as const } }, { displayName: { contains: term(filters.search), mode: 'insensitive' as const } }] } } },
        ] } : {}),
      },
      include: { user: { select: { username: true, displayName: true } } },
    });
  }
  async record(input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    const entry = await this.prisma.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
    await this.scheduleInventoryQualityReconcile(input.entityType);
    return entry;
  }
  async recordInTransaction(tx: Prisma.TransactionClient, input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    return tx.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
  }
  async scheduleInventoryQualityReconcile(entityType?: string) {
    if (['Device', 'DeviceInterface', 'DeviceModel', 'SnmpDrift', 'SnmpSnapshot', 'IpAddress', 'Subnet'].includes(entityType ?? '')) {
      await this.maintenance.add('inventory-quality-reconcile', {}, { delay: 2_000, jobId: 'inventory-quality-reconcile-global', removeOnComplete: true, removeOnFail: 100 }).catch(() => undefined);
    }
  }
}
