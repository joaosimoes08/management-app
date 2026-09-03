import { PrismaClient } from '@simoes/database';
import { assertSnmpPayload, snmpPayload, SNMP_JOB_NAMES, SNMP_QUEUE } from '@simoes/snmp-core';
import { Queue, Worker } from 'bullmq';
import Redis from 'ioredis';
import { DeviceLocks } from './locks';
import { PollProcessor } from './poll';
import { SetProcessor } from './set';
import { TrapReceiver } from './traps';
import { log, publicErrorCode } from './log';
import { startHealthServer, SnmpMetrics } from './health';
import type { Server } from 'node:http';

if (process.env.SNMP_DATABASE_URL) process.env.DATABASE_URL = process.env.SNMP_DATABASE_URL;
const role = process.env.SNMP_ROLE ?? 'all';
if (!['all', 'receiver', 'worker'].includes(role)) throw new Error('SNMP_ROLE_INVALID');
const receiverEnabled = role === 'all' || role === 'receiver';
const prisma = new PrismaClient();
const redisUrl = process.env.REDIS_URL ?? 'redis://localhost:6379';
const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
const queue = new Queue(SNMP_QUEUE, { connection: redis });
const locks = new DeviceLocks(redis);
const poll = new PollProcessor(prisma, locks);
const set = new SetProcessor(prisma, locks);
const traps = new TrapReceiver(prisma, queue);
const metrics: SnmpMetrics = { jobsCompleted: 0, jobsFailed: 0, trapsProcessed: 0 };
let worker: Worker | undefined;
let healthServer: Server | undefined;
const timers: NodeJS.Timeout[] = [];

async function start() {
  if (process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE === 'true') {
    if (process.env.SNMP_SELF_TEST_ENABLED !== 'true') throw Object.assign(new Error('SNMP_SELF_TEST_CONFIG_INVALID'), { code: 'SNMP_SELF_TEST_CONFIG_INVALID' });
    log('warn', 'translated-source SNMP self-test is enabled; source IP association is relaxed for authenticated local enrollments', { errorCode: 'SNMP_SELF_TEST_TRANSLATED_SOURCE_ENABLED' });
  }
  if (receiverEnabled) await traps.start();
  if (role === 'all' || role === 'worker') {
    worker = new Worker(SNMP_QUEUE, async (job) => {
      assertSnmpPayload(job.data);
      try {
        if (job.name === SNMP_JOB_NAMES.poll) return poll.scheduled(job.data.recordId);
        if (job.name === SNMP_JOB_NAMES.pollJob) return poll.run(job.data.recordId);
        if (job.name === SNMP_JOB_NAMES.credentialTest) return poll.test(job.data.recordId);
        if (job.name === SNMP_JOB_NAMES.set) return set.run(job.data.recordId);
        if (job.name === SNMP_JOB_NAMES.processTrap) { const result = await traps.process(job.data.recordId); metrics.trapsProcessed++; return result; }
        if (job.name === SNMP_JOB_NAMES.reloadCredentials) return receiverEnabled ? traps.refresh() : undefined;
        throw Object.assign(new Error('SNMP_JOB_NAME_INVALID'), { code: 'SNMP_JOB_NAME_INVALID' });
      } catch (error) {
        if (publicErrorCode(error) !== 'SNMP_DEVICE_BUSY' || ![SNMP_JOB_NAMES.pollJob, SNMP_JOB_NAMES.set].includes(job.name as any)) throw error;
        await prisma.$transaction([
          prisma.snmpJob.update({ where: { id: job.data.recordId }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_DEVICE_BUSY' } }),
          ...(job.name === SNMP_JOB_NAMES.set ? [prisma.snmpWriteRequest.updateMany({ where: { jobId: job.data.recordId }, data: { status: 'BLOCKED', completedAt: new Date(), errorCode: 'SNMP_DEVICE_BUSY' } })] : []),
        ]);
        return;
      }
    }, { connection: redis, concurrency: Number(process.env.SNMP_WORKER_CONCURRENCY ?? 4) });
    worker.on('completed', (job) => { metrics.jobsCompleted++; log('info', 'job completed', { jobId: job.id, jobName: job.name }); });
    worker.on('failed', (job, error) => { metrics.jobsFailed++; log('error', 'job failed', { jobId: job?.id, jobName: job?.name, errorCode: publicErrorCode(error) }); });
    await recoverPendingJobs();
  }
  await traps.recoverPending();
  if (receiverEnabled) {
    const timer = setInterval(() => void traps.refresh().catch((error) => log('error', 'trap listener refresh failed', { errorCode: publicErrorCode(error) })), 30_000);
    timer.unref(); timers.push(timer);
  }
  const recoveryTimer = setInterval(() => void traps.recoverPending(), 60_000);
  const retentionTimer = setInterval(() => void prisma.snmpTrapEvent.deleteMany({ where: { expiresAt: { lt: new Date() } } }), 60 * 60 * 1000);
  recoveryTimer.unref(); retentionTimer.unref(); timers.push(recoveryTimer, retentionTimer);
  healthServer = startHealthServer(prisma, redis, () => role === 'worker' || traps.ready, metrics);
  log('info', 'SNMP component started', { role, setEnabled: process.env.SNMP_SET_ENABLED === 'true' });
}

async function recoverPendingJobs() {
  const jobs = await prisma.snmpJob.findMany({ where: { status: 'PENDING' }, select: { id: true, type: true }, take: 500 });
  const names = {
    POLL: SNMP_JOB_NAMES.pollJob,
    CREDENTIAL_TEST: SNMP_JOB_NAMES.credentialTest,
    SET: SNMP_JOB_NAMES.set,
  } as const;
  for (const job of jobs) {
    await queue.add(names[job.type], snmpPayload(job.id), { jobId: job.id, attempts: 1, removeOnComplete: 100, removeOnFail: 100 }).catch(() => undefined);
  }
}

async function shutdown() {
  log('info', 'SNMP component stopping');
  for (const timer of timers) clearInterval(timer);
  await Promise.all([
    worker?.close(),
    traps.close(),
    queue.close(),
    new Promise<void>((resolve) => healthServer ? healthServer.close(() => resolve()) : resolve()),
  ]);
  redis.disconnect(); await prisma.$disconnect(); process.exit(0);
}
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
void start().catch((error) => { log('error', 'SNMP startup failed', { errorCode: publicErrorCode(error) }); process.exit(1); });
