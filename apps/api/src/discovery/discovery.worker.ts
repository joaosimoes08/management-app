import { Worker, Job, UnrecoverableError } from 'bullmq';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { reverse } from 'node:dns/promises';
import * as net from 'node:net';
import { PrismaClient } from '@simoes/database';
import { runAuditRetentionCleanup } from '../audit/audit-retention';
import { normalizeDiscoveryPorts } from './discovery-policy';
import { DiscoveryConfigurationError, recordDiscoveryFailure, runDiscoveryScan } from './discovery-scan';
import type { ProbeRunner } from './discovery-limiter';
import { runInventoryQualityReconciliation } from '../inventory-quality/inventory-quality.service';
import { deliverLifecycleReminders } from '../infrastructure/lifecycle-reminders';

const execFileAsync = promisify(execFile);
const prisma = new PrismaClient();
const redisUrl = new URL(process.env.REDIS_URL ?? 'redis://localhost:6379');
const connection = { host: redisUrl.hostname, port: Number(redisUrl.port || 6379), ...(redisUrl.password ? { password: redisUrl.password } : {}) };

async function ping(address: string) { const started = Date.now(); try { const args = process.platform === 'win32' ? ['-n', '1', '-w', '800', address] : ['-c', '1', '-W', '1', address]; await execFileAsync(process.platform === 'win32' ? 'ping.exe' : 'ping', args, { timeout: 1500, windowsHide: true }); return { reachable: true, responseMs: Date.now() - started }; } catch { return { reachable: false, responseMs: undefined }; } }
function testPort(address: string, port: number) { return new Promise<boolean>((resolve) => { const socket = net.createConnection({ host: address, port, timeout: 800 }); const done = (result: boolean) => { socket.destroy(); resolve(result); }; socket.once('connect', () => done(true)); socket.once('timeout', () => done(false)); socket.once('error', () => done(false)); }); }

type DiscoveryData = { jobId?: string; subnetId?: string; cidr?: string; methods?: string[]; tcpPorts?: number[]; reverseDns?: boolean };

/** Each ping and each TCP connect waits for the subnet's shared limiter (rate, subnet socket cap, process ceiling); a cancelled scan aborts the queued ones. */
async function probe(address: string, methods: string[], tcpPorts: number[], limiter: ProbeRunner) {
  const icmp = methods.includes('ICMP') ? await limiter.run(() => ping(address)) : { reachable: false, responseMs: undefined };
  const openPorts = methods.includes('TCP') ? (await Promise.all(tcpPorts.map(async (port) => (await limiter.run(() => testPort(address, port))) ? port : null))).filter((port): port is number => port !== null) : [];
  return { address, icmp, openPorts };
}
async function reverseName(address: string) { return (await reverse(address))[0]; }

async function processJob(job: Job<DiscoveryData>) {
  let { jobId } = job.data;
  if (!jobId && job.data.subnetId) {
    const schedule = await prisma.discoverySchedule.findUnique({ where: { subnetId: job.data.subnetId }, include: { subnet: true } });
    if (!schedule || !schedule.enabled) return;
    const methods = Array.isArray(schedule.methods) ? schedule.methods.filter((value): value is string => typeof value === 'string') : ['ICMP'];
    const tcpPorts = normalizeDiscoveryPorts(schedule.tcpPorts);
    const reverseDns = schedule.reverseDns;
    const created = await prisma.discoveryJob.create({ data: { name: `Discovery agendado · ${new Date().toISOString()}`, subnetId: schedule.subnetId, methods, tcpPorts, reverseDns } });
    jobId = created.id;
    // Round 2 #10: a retry of this BullMQ job resumes the same scan instead of creating another one.
    await job.updateData({ ...job.data, jobId });
    await prisma.discoverySchedule.update({ where: { id: schedule.id }, data: { lastRunAt: new Date(), nextRunAt: new Date(Date.now() + schedule.intervalHours * 60 * 60 * 1000), lastStatus: 'RUNNING', lastError: null } });
  }
  if (!jobId) throw new UnrecoverableError('Dados de discovery incompletos');
  try {
    const outcome = await runDiscoveryScan(prisma, jobId, { probe, reverse: reverseName });
    if (job.data.subnetId && !outcome.skipped) await prisma.discoverySchedule.updateMany({ where: { subnetId: job.data.subnetId }, data: { lastStatus: outcome.status, lastError: outcome.stopReason ?? null } });
    return outcome;
  } catch (error) {
    const finalAttempt = job.attemptsMade + 1 >= (job.opts.attempts ?? 1);
    const { code, final } = await recordDiscoveryFailure(prisma, jobId, error, finalAttempt);
    if (job.data.subnetId && final) await prisma.discoverySchedule.updateMany({ where: { subnetId: job.data.subnetId }, data: { lastStatus: 'FAILED', lastError: code } });
    if (error instanceof DiscoveryConfigurationError) throw new UnrecoverableError(code);
    throw error;
  }
}

const worker = new Worker<DiscoveryData>('discovery', processJob, { connection, concurrency: 2 });
const maintenanceWorker = new Worker('maintenance', async (job) => {
  if (job.name === 'audit-retention-cleanup') return runAuditRetentionCleanup(prisma);
  if (job.name === 'inventory-quality-reconcile') return runInventoryQualityReconciliation(prisma, typeof job.data?.siteId === 'string' ? job.data.siteId : undefined);
  if (job.name === 'lifecycle-reminders') return deliverLifecycleReminders(prisma);
}, { connection, concurrency: 1 });
worker.on('completed', (job) => console.info(`[discovery-worker] concluído ${job.id}`));
worker.on('failed', (job, error) => console.error(`[discovery-worker] falhou ${job?.id}:`, error.message));
console.info('[discovery-worker] à escuta na fila discovery');

async function shutdown() { await Promise.all([worker.close(), maintenanceWorker.close()]); await prisma.$disconnect(); process.exit(0); }
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
