import { Injectable, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';
import { OperationsService } from './operations.service';
import { collectTrapAlerts } from './trap-alerts';

@Injectable()
export class OperationsReconcilerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private readonly queue = new Queue('discovery', { connection: this.connection() });
  constructor(private readonly prisma: PrismaClient, private readonly operations: OperationsService) {}
  private connection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1500, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) }; }
  onModuleInit() { void this.reconcile().catch(() => undefined); this.timer = setInterval(() => void this.reconcile().catch(() => undefined), 10_000); }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.queue.disconnect(); }
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
    await this.operations.reopenExpiredSnoozes();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const driftCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const redis = await this.queue.getJobCounts('waiting', 'active', 'failed').then(() => true).catch(() => false);
    const [failedDiscovery, pendingDiscovery, failedSnmp, trapAlerts, drifts] = await Promise.all([
      this.prisma.discoveryJob.findMany({ where: { status: 'FAILED', createdAt: { gte: cutoff } }, include: { subnet: { select: { siteId: true, cidr: true } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      this.prisma.discoveryJob.findMany({ where: { results: { some: { status: 'PENDING' } } }, include: { subnet: { select: { siteId: true } }, _count: { select: { results: { where: { status: 'PENDING' } } } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      this.prisma.snmpJob.findMany({ where: { status: 'FAILED', createdAt: { gte: cutoff } }, include: { device: { select: { siteId: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      collectTrapAlerts(this.prisma, cutoff),
      this.prisma.snmpDrift.findMany({ where: { status: 'PENDING', createdAt: { lte: driftCutoff } }, include: { device: { select: { siteId: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
    ]);
    const system: UpsertOperationalAlert[] = redis ? [] : [{ dedupKey: 'system:redis-unavailable', source: 'SYSTEM_HEALTH', severity: AlertSeverityDto.CRITICAL, title: 'Redis / BullMQ indisponível', detail: 'As filas e os eventos em tempo real estão indisponíveis. A aplicação continua a usar PostgreSQL e polling.', actionHref: '/definicoes?tab=system' }];
    await this.operations.reconcileSource('SYSTEM_HEALTH', system);
    await this.operations.reconcileSource('DISCOVERY', [
      ...failedDiscovery.slice(0, 100).map((job) => ({ dedupKey: `discovery:failed:${job.id}`, source: 'DISCOVERY', severity: AlertSeverityDto.WARNING, siteId: job.subnet.siteId, entityType: 'DiscoveryJob', entityId: job.id, title: `Discovery falhou em ${job.subnet.cidr}`, detail: job.errorMessage ?? 'A execução terminou com erro.', actionHref: `/descoberta?jobId=${job.id}` })),
      ...pendingDiscovery.slice(0, 100).map((job) => ({ dedupKey: `discovery:review:${job.id}`, source: 'DISCOVERY', severity: AlertSeverityDto.INFO, siteId: job.subnet.siteId, entityType: 'DiscoveryJob', entityId: job.id, title: 'Discovery pendente de revisão', detail: `${job._count.results} resultado(s) aguardam revisão.`, actionHref: `/descoberta?jobId=${job.id}` })),
    ], undefined, failedDiscovery.length <= 100 && pendingDiscovery.length <= 100);
    await this.operations.reconcileSource('SNMP_POLL', failedSnmp.slice(0, 100).map((job) => ({ dedupKey: `snmp:failed:${job.id}`, source: 'SNMP_POLL', severity: AlertSeverityDto.WARNING, siteId: job.device.siteId, entityType: 'SnmpJob', entityId: job.id, title: `Polling SNMP falhou em ${job.device.name}`, detail: job.errorCode ?? 'A consulta SNMP terminou com erro.', actionHref: '/snmp' })), undefined, failedSnmp.length <= 100);
    await this.operations.reconcileSource('SNMP_TRAP', trapAlerts.candidates, undefined, trapAlerts.resolveMissing, trapAlerts.resolveKeys);
    await this.operations.reconcileSource('SNMP_DRIFT', drifts.slice(0, 100).map((drift) => ({ dedupKey: `snmp:drift:${drift.id}`, source: 'SNMP_DRIFT', severity: AlertSeverityDto.HIGH, siteId: drift.device.siteId, entityType: 'SnmpDrift', entityId: drift.id, title: 'Divergência SNMP pendente', detail: `${drift.device.name}: ${drift.field}`, actionHref: '/snmp' })), undefined, drifts.length <= 100);
    } finally { this.running = false; }
  }
}
