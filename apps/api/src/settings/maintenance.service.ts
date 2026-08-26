import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { Queue } from 'bullmq';

@Injectable()
export class MaintenanceService implements OnModuleInit, OnModuleDestroy {
  private readonly queue = new Queue('maintenance', { connection: this.redisConnection() });
  private redisConnection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), ...(url.password ? { password: url.password } : {}) }; }
  async onModuleInit() { await this.queue.upsertJobScheduler('audit-retention-daily', { every: 24 * 60 * 60 * 1000 }, { name: 'audit-retention-cleanup', data: {} }).catch(() => undefined); }
  async onModuleDestroy() { await this.queue.disconnect(); }
}
