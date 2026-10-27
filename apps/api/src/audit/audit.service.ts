import { Injectable, OnModuleDestroy } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';

@Injectable()
export class AuditService implements OnModuleDestroy {
  private readonly maintenance = new Queue('maintenance', { connection: this.redisConnection() });
  constructor(private readonly prisma: PrismaClient) {}
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1000, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) }; }
  async onModuleDestroy() { await this.maintenance.disconnect(); }
  list(limit = 50) { return this.prisma.auditLog.findMany({ take: limit, orderBy: { createdAt: 'desc' }, include: { user: { select: { username: true, displayName: true } } } }); }
  async record(input: { userId?: string; action: string; entityType?: string; entityId?: string; metadata?: unknown; ipAddress?: string }) {
    const entry = await this.prisma.auditLog.create({ data: { ...input, metadata: input.metadata as object | undefined } });
    if (['Device', 'DeviceInterface', 'DeviceModel', 'SnmpDrift', 'SnmpSnapshot', 'IpAddress', 'Subnet'].includes(input.entityType ?? '')) {
      await this.maintenance.add('inventory-quality-reconcile', {}, { delay: 2_000, jobId: 'inventory-quality-reconcile-global', removeOnComplete: true, removeOnFail: 100 }).catch(() => undefined);
    }
    return entry;
  }
}
