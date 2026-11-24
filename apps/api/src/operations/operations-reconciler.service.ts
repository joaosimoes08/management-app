import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { Queue } from 'bullmq';
import { AlertSeverityDto, UpsertOperationalAlert } from './dto';
import { OperationsService } from './operations.service';
import { collectTrapAlerts, collectTrapSourceAlerts, TRAP_SOURCE_ALERT_SOURCE } from './trap-alerts';
import { snmpPollingStopReason } from '../snmp/snmp-fleet.service';
import { collectInterfaceAlerts, INTERFACE_ALERT_SOURCE } from './interface-alerts';
import { CAPACITY_ALERT_SOURCE, collectCapacityAlerts } from './capacity-alerts';
import { collectHealthAlerts, HEALTH_ALERT_SOURCE } from './health-alerts';

/** Round 2 #7: interface alerts read snapshots and observations, so they are recomputed at most once a minute. */
const INTERFACE_ALERT_INTERVAL_MS = 60_000;
/** SNMP Phase 2 step 9: health readings arrive once per poll (5 min or more), so health alerts are recomputed once a minute. */
export const HEALTH_ALERT_INTERVAL_MS = 60_000;
/** Round 2 #15: capacity changes slowly; its pass reads every subnet, rack and NetApp snapshot, so it runs every 5 minutes. */
export const CAPACITY_ALERT_INTERVAL_MS = 5 * 60_000;
/** SNMP Phase 1 step 1: a device is unreachable after this many consecutive failed polls (env SNMP_UNREACHABLE_AFTER_FAILURES). */
export const DEFAULT_UNREACHABLE_AFTER_FAILURES = 3;

export function unreachableThreshold(value = process.env.SNMP_UNREACHABLE_AFTER_FAILURES) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed >= 1 && parsed <= 100 ? parsed : DEFAULT_UNREACHABLE_AFTER_FAILURES;
}

@Injectable()
export class OperationsReconcilerService implements OnModuleInit, OnModuleDestroy {
  private timer?: NodeJS.Timeout;
  private running = false;
  private interfaceAlertsAt = 0;
  private lastCapacityAt = 0;
  private healthAlertsAt = 0;
  private readonly logger = new Logger('OperationsReconciler');
  private readonly queue = new Queue('discovery', { connection: this.connection() });
  constructor(private readonly prisma: PrismaClient, private readonly operations: OperationsService) {}
  private connection() { const url = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379'); return { host: url.hostname, port: Number(url.port || 6379), connectTimeout: 1500, maxRetriesPerRequest: 1, ...(url.password ? { password: url.password } : {}) }; }
  onModuleInit() { void this.tick(); this.timer = setInterval(() => void this.tick(), 10_000); }
  /** One timer tick: a failed pass is logged, never thrown, and the next tick tries again. */
  private async tick() { await this.reconcile().catch((error) => this.logger.warn(`Reconciliation pass failed: ${errorMessage(error)}`)); }
  /**
   * Runs one periodic alert stage in isolation: if it throws, the error is logged and the later stages still run.
   * The stage's interval timestamp is already advanced, so a failing stage is retried on its next interval, not every tick.
   */
  private async stage(name: string, run: () => Promise<unknown>) {
    try { await run(); } catch (error) { this.logger.warn(`Reconciliation stage ${name} failed; later stages still run: ${errorMessage(error)}`); }
  }
  async onModuleDestroy() { if (this.timer) clearInterval(this.timer); await this.queue.disconnect(); }
  async reconcile() {
    if (this.running) return;
    this.running = true;
    try {
    await this.operations.reopenExpiredSnoozes();
    const cutoff = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const driftCutoff = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
    const redis = await this.queue.getJobCounts('waiting', 'active', 'failed').then(() => true).catch(() => false);
    const failureThreshold = unreachableThreshold();
    const [failedDiscovery, pendingDiscovery, unreachableConfigs, trapAlerts, trapSourceAlerts, drifts, pollConfigs] = await Promise.all([
      this.prisma.discoveryJob.findMany({ where: { status: 'FAILED', createdAt: { gte: cutoff } }, include: { subnet: { select: { siteId: true, cidr: true } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      this.prisma.discoveryJob.findMany({ where: { results: { some: { status: 'PENDING' } } }, include: { subnet: { select: { siteId: true } }, _count: { select: { results: { where: { status: 'PENDING' } } } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      // SNMP Phase 1 step 1: one alert per device after N consecutive failed polls, instead of one per failed job.
      this.prisma.snmpDeviceConfig.findMany({ where: { enabled: true, consecutiveFailures: { gte: failureThreshold }, device: { status: { not: 'RETIRED' } } }, select: { deviceId: true, consecutiveFailures: true, lastPollAt: true, lastErrorCode: true, device: { select: { siteId: true, name: true } } }, orderBy: { lastPollAt: 'desc' }, take: 101 }),
      collectTrapAlerts(this.prisma, cutoff),
      collectTrapSourceAlerts(this.prisma, cutoff),
      this.prisma.snmpDrift.findMany({ where: { status: 'PENDING', createdAt: { lte: driftCutoff } }, include: { device: { select: { siteId: true, name: true } } }, orderBy: { createdAt: 'desc' }, take: 101 }),
      // Round 2 #12: enabled devices whose polling stopped without a failed job (no scheduler, or polls stopped arriving).
      // Pre-filter: the minimum interval is 5 min, so a device polled in the last 10 min can never be stale.
      this.prisma.snmpDeviceConfig.findMany({ where: { enabled: true, device: { status: { not: 'RETIRED' } }, OR: [{ nextPollAt: null }, { lastPollAt: null }, { lastPollAt: { lt: new Date(Date.now() - 10 * 60_000) } }] }, select: { deviceId: true, enabled: true, intervalMinutes: true, lastPollAt: true, nextPollAt: true, lastErrorCode: true, device: { select: { siteId: true, name: true } } } }),
    ]);
    const stoppedPolling = pollingStoppedAlerts(pollConfigs, new Date());
    const unreachable = unreachableAlerts(unreachableConfigs);
    const system: UpsertOperationalAlert[] = redis ? [] : [{ dedupKey: 'system:redis-unavailable', source: 'SYSTEM_HEALTH', severity: AlertSeverityDto.CRITICAL, title: 'Redis / BullMQ indisponível', detail: 'As filas e os eventos em tempo real estão indisponíveis. A aplicação continua a usar PostgreSQL e polling.', actionHref: '/definicoes?tab=system' }];
    await this.operations.reconcileSource('SYSTEM_HEALTH', system);
    await this.operations.reconcileSource('DISCOVERY', [
      ...failedDiscovery.slice(0, 100).map((job) => ({ dedupKey: `discovery:failed:${job.id}`, source: 'DISCOVERY', severity: AlertSeverityDto.WARNING, siteId: job.subnet.siteId, entityType: 'DiscoveryJob', entityId: job.id, title: `Discovery falhou em ${job.subnet.cidr}`, detail: job.errorMessage ?? 'A execução terminou com erro.', actionHref: `/descoberta?jobId=${job.id}` })),
      ...pendingDiscovery.slice(0, 100).map((job) => ({ dedupKey: `discovery:review:${job.id}`, source: 'DISCOVERY', severity: AlertSeverityDto.INFO, siteId: job.subnet.siteId, entityType: 'DiscoveryJob', entityId: job.id, title: 'Discovery pendente de revisão', detail: `${job._count.results} resultado(s) aguardam revisão.`, actionHref: `/descoberta?jobId=${job.id}` })),
    ], undefined, failedDiscovery.length <= 100 && pendingDiscovery.length <= 100);
    await this.operations.reconcileSource('SNMP_POLL', [
      ...unreachable.slice(0, 100),
      ...stoppedPolling.slice(0, 100),
    ], undefined, unreachable.length <= 100 && stoppedPolling.length <= 100);
    await this.operations.reconcileSource('SNMP_TRAP', trapAlerts.candidates, undefined, trapAlerts.resolveMissing, trapAlerts.resolveKeys);
    await this.operations.reconcileSource(TRAP_SOURCE_ALERT_SOURCE, trapSourceAlerts.candidates, undefined, trapSourceAlerts.resolveMissing, trapSourceAlerts.resolveKeys);
    await this.operations.reconcileSource('SNMP_DRIFT', drifts.slice(0, 100).map((drift) => ({ dedupKey: `snmp:drift:${drift.id}`, source: 'SNMP_DRIFT', severity: AlertSeverityDto.HIGH, siteId: drift.device.siteId, entityType: 'SnmpDrift', entityId: drift.id, title: 'Divergência SNMP pendente', detail: `${drift.device.name}: ${drift.field}`, actionHref: '/snmp' })), undefined, drifts.length <= 100);
    if (Date.now() - this.interfaceAlertsAt >= INTERFACE_ALERT_INTERVAL_MS) {
      this.interfaceAlertsAt = Date.now();
      await this.stage(INTERFACE_ALERT_SOURCE, async () => {
        const interfaceAlerts = await collectInterfaceAlerts(this.prisma);
        await this.operations.reconcileSource(INTERFACE_ALERT_SOURCE, interfaceAlerts.candidates, undefined, false, interfaceAlerts.resolveKeys);
      });
    }
    if (Date.now() - this.healthAlertsAt >= HEALTH_ALERT_INTERVAL_MS) {
      this.healthAlertsAt = Date.now();
      await this.stage(HEALTH_ALERT_SOURCE, async () => {
        const health = await collectHealthAlerts(this.prisma);
        await this.operations.reconcileSource(HEALTH_ALERT_SOURCE, health.candidates, undefined, false, health.resolveKeys);
      });
    }
    if (Date.now() - this.lastCapacityAt >= CAPACITY_ALERT_INTERVAL_MS) {
      this.lastCapacityAt = Date.now();
      await this.stage(CAPACITY_ALERT_SOURCE, async () => {
        const capacity = await collectCapacityAlerts(this.prisma);
        await this.operations.reconcileSource(CAPACITY_ALERT_SOURCE, capacity.candidates, undefined, false, capacity.resolveKeys);
      });
    }
    } finally { this.running = false; }
  }
}

const errorMessage = (error: unknown) => (error instanceof Error ? error.message : String(error));

type UnreachableConfigRow = { deviceId: string; consecutiveFailures: number; lastPollAt: Date | null; lastErrorCode: string | null; device: { siteId: string | null; name: string } };

/**
 * SNMP Phase 1 step 1: one HIGH alert per device that failed N polls in a row. The worker resets the counter on the
 * next successful poll, the device drops out of this list and reconcileSource (resolveMissing) resolves the alert.
 * Pre-Phase-1 per-job alerts (snmp:failed:<jobId>) are no longer produced, so they resolve on the first pass.
 */
export function unreachableAlerts(configs: UnreachableConfigRow[]): UpsertOperationalAlert[] {
  return configs.map((config) => ({
    dedupKey: `snmp:unreachable:${config.deviceId}`, source: 'SNMP_POLL', severity: AlertSeverityDto.HIGH, siteId: config.device.siteId, entityType: 'Device', entityId: config.deviceId,
    title: `Equipamento inacessível por SNMP: ${config.device.name}`,
    detail: `${config.consecutiveFailures} polls seguidos falharam${config.lastErrorCode ? ` (${config.lastErrorCode})` : ''}. Último poll: ${config.lastPollAt ? config.lastPollAt.toISOString() : 'nunca'}. Resolve-se sozinho no próximo poll com sucesso.`,
    actionHref: '/snmp',
  }));
}

type PollConfigRow = { deviceId: string; enabled: boolean; intervalMinutes: number; lastPollAt: Date | null; nextPollAt: Date | null; lastErrorCode: string | null; device: { siteId: string | null; name: string } };

/** Round 2 #12: one SNMP_POLL alert per enabled device whose polling stopped silently (no scheduler, or stale). */
export function pollingStoppedAlerts(configs: PollConfigRow[], now: Date): UpsertOperationalAlert[] {
  return configs.flatMap((config) => {
    const reason = snmpPollingStopReason(config, now);
    if (!reason) return [];
    return [{
      dedupKey: `snmp:polling-stopped:${config.deviceId}`, source: 'SNMP_POLL', severity: AlertSeverityDto.WARNING, siteId: config.device.siteId, entityType: 'Device', entityId: config.deviceId,
      title: `Polling SNMP parado em ${config.device.name}`,
      detail: reason === 'NO_SCHEDULE'
        ? `O agendamento do polling não existe${config.lastErrorCode ? ` (${config.lastErrorCode})` : ''}. Guarda a configuração SNMP ou verifica o Redis.`
        : `Sem poll há mais do dobro do intervalo (${config.intervalMinutes} min). Último poll: ${config.lastPollAt ? config.lastPollAt.toISOString() : 'nunca'}.`,
      actionHref: '/snmp',
    }];
  });
}
