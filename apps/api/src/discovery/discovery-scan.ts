import { Prisma, PrismaClient } from '@simoes/database';
import { hostsFor } from './discovery-network';
import { assertDiscoveryAllowed, normalizeDiscoveryPorts } from './discovery-policy';

/**
 * Round 2 #10/#11: one discovery scan, saved batch by batch.
 *
 * - Progress: each batch's results and counters are written in one transaction, guarded by the resume cursor
 *   (`processedCount`). A retry or a re-delivered job resumes after the last saved batch, and two workers that pick up
 *   the same job never count a batch twice (the second one's guarded update matches no row and it stops).
 * - Cancel: `cancelRequestedAt` is checked before every batch; the scan ends as CANCELLED and keeps what it saved.
 * - Limits: `maxDurationSeconds` (from the first start, across retries) and `maxProbes` (ICMP pings plus TCP connects).
 *   Reaching one ends the scan as COMPLETED with stopReason LIMIT_DURATION / LIMIT_PROBES ("stopped at limit").
 */
export const DISCOVERY_BATCH_SIZE = 32;
export const DISCOVERY_DEFAULT_MAX_DURATION_SECONDS = positiveInt(process.env.DISCOVERY_MAX_DURATION_SECONDS, 3600);
export const DISCOVERY_DEFAULT_MAX_PROBES = positiveInt(process.env.DISCOVERY_MAX_PROBES, 100_000);
export const DISCOVERY_JOB_ATTEMPTS = 3;
/** BullMQ options for scan jobs: retries resume from the saved cursor. */
export const DISCOVERY_JOB_OPTIONS = { attempts: DISCOVERY_JOB_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 100 } as const;

export type DiscoveryStopReason = 'CANCELLED' | 'LIMIT_DURATION' | 'LIMIT_PROBES';
export type ProbeOutcome = { address: string; icmp: { reachable: boolean; responseMs?: number }; openPorts: number[] };
export type ScanDependencies = {
  probe: (address: string, methods: string[], tcpPorts: number[]) => Promise<ProbeOutcome>;
  reverse?: (address: string) => Promise<string | undefined>;
  now?: () => Date;
  batchSize?: number;
};
export type ScanOutcome = { status: 'COMPLETED' | 'CANCELLED' | 'FAILED' | 'PENDING' | 'RUNNING'; stopReason?: DiscoveryStopReason | null; skipped?: 'TERMINAL' | 'SUPERSEDED' };

/** Policy or configuration problems: retrying cannot help, so the job fails at once. */
export class DiscoveryConfigurationError extends Error {
  constructor(readonly code: string, message: string) { super(message); }
}
class SupersededError extends Error {}

function positiveInt(value: string | undefined, fallback: number) { const parsed = Number(value); return Number.isInteger(parsed) && parsed > 0 ? parsed : fallback; }

export function probesPerAddress(methods: string[], tcpPorts: number[]) {
  return (methods.includes('ICMP') ? 1 : 0) + (methods.includes('TCP') ? tcpPorts.length : 0);
}

const TERMINAL = new Set(['COMPLETED', 'FAILED', 'CANCELLED']);

export async function runDiscoveryScan(prisma: PrismaClient, jobId: string, deps: ScanDependencies): Promise<ScanOutcome> {
  const now = deps.now ?? (() => new Date());
  const batchSize = deps.batchSize ?? DISCOVERY_BATCH_SIZE;
  const [job, settings] = await Promise.all([
    prisma.discoveryJob.findUnique({ where: { id: jobId }, include: { subnet: { select: { cidr: true } } } }),
    prisma.systemSettings.findFirst({ select: { discoveryAllowedCidrs: true } }),
  ]);
  if (!job) throw new DiscoveryConfigurationError('DISCOVERY_JOB_NOT_FOUND', 'Execução de discovery inexistente');
  if (TERMINAL.has(job.status)) return { status: job.status as ScanOutcome['status'], stopReason: job.stopReason as DiscoveryStopReason | null, skipped: 'TERMINAL' };

  const methods = Array.isArray(job.methods) ? job.methods.filter((value): value is string => value === 'ICMP' || value === 'TCP') : [];
  const tcpPorts = normalizeDiscoveryPorts(job.tcpPorts);
  let addresses: string[];
  try {
    const target = assertDiscoveryAllowed(job.subnet.cidr, settings?.discoveryAllowedCidrs);
    if (target.version !== 4) throw new DiscoveryConfigurationError('DISCOVERY_IPV6_UNSUPPORTED', 'A enumeração de subnets IPv6 ainda não é suportada.');
    if (!methods.length || (methods.includes('TCP') && !tcpPorts.length)) throw new DiscoveryConfigurationError('DISCOVERY_CONFIGURATION_INVALID', 'Configuração de discovery inválida');
    addresses = hostsFor(job.subnet.cidr);
  } catch (error) {
    if (error instanceof DiscoveryConfigurationError) throw error;
    const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'DISCOVERY_CONFIGURATION_INVALID';
    throw new DiscoveryConfigurationError(code, error instanceof Error ? error.message : String(error));
  }

  const startedAt = job.startedAt ?? now();
  await prisma.discoveryJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt, errorMessage: null, totalCount: addresses.length, attemptCount: { increment: 1 } } });
  const maxDurationMs = (job.maxDurationSeconds ?? DISCOVERY_DEFAULT_MAX_DURATION_SECONDS) * 1000;
  const maxProbes = job.maxProbes ?? DISCOVERY_DEFAULT_MAX_PROBES;
  const perAddress = Math.max(1, probesPerAddress(methods, tcpPorts));
  let cursor = Math.min(job.processedCount, addresses.length);
  let probes = job.probeCount;

  const finish = async (status: 'COMPLETED' | 'CANCELLED', stopReason: DiscoveryStopReason | null): Promise<ScanOutcome> => {
    await prisma.discoveryJob.updateMany({ where: { id: jobId, status: 'RUNNING' }, data: { status, stopReason, completedAt: now() } });
    return { status, stopReason };
  };

  while (cursor < addresses.length) {
    const control = await prisma.discoveryJob.findUnique({ where: { id: jobId }, select: { cancelRequestedAt: true, status: true, processedCount: true } });
    if (!control || control.status !== 'RUNNING' || control.processedCount !== cursor) return { status: (control?.status ?? 'FAILED') as ScanOutcome['status'], skipped: 'SUPERSEDED' };
    if (control.cancelRequestedAt) return finish('CANCELLED', 'CANCELLED');
    if (now().getTime() - startedAt.getTime() >= maxDurationMs) return finish('COMPLETED', 'LIMIT_DURATION');
    const size = Math.min(batchSize, addresses.length - cursor, Math.floor((maxProbes - probes) / perAddress));
    if (size <= 0) return finish('COMPLETED', 'LIMIT_PROBES');

    const batch = addresses.slice(cursor, cursor + size);
    const outcomes = await Promise.all(batch.map((address) => deps.probe(address, methods, tcpPorts)));
    const rows: Prisma.DiscoveryResultCreateManyInput[] = [];
    let icmp = 0; let tcp = 0;
    for (const item of outcomes) {
      if (item.icmp.reachable) icmp += 1;
      if (item.openPorts.length) tcp += 1;
      if (!item.icmp.reachable && !item.openPorts.length) continue;
      let hostname: string | undefined;
      if (job.reverseDns !== false && deps.reverse) { try { hostname = await deps.reverse(item.address); } catch { /* reverse DNS is best effort */ } }
      rows.push({ jobId, address: item.address, hostname, icmpReachable: item.icmp.reachable, responseMs: item.icmp.responseMs, openPorts: item.openPorts });
    }
    try {
      await prisma.$transaction(async (tx) => {
        const advanced = await tx.discoveryJob.updateMany({
          where: { id: jobId, status: 'RUNNING', processedCount: cursor },
          data: {
            processedCount: cursor + size, probeCount: { increment: size * perAddress },
            scannedCount: { increment: size }, icmpReachableCount: { increment: icmp }, tcpReachableCount: { increment: tcp },
            reachableCount: { increment: rows.length }, unreachableCount: { increment: size - rows.length }, resultCount: { increment: rows.length },
          },
        });
        if (advanced.count !== 1) throw new SupersededError();
        if (rows.length) await tx.discoveryResult.createMany({ data: rows, skipDuplicates: true });
      });
    } catch (error) {
      if (error instanceof SupersededError) return { status: 'RUNNING', skipped: 'SUPERSEDED' };
      throw error;
    }
    cursor += size;
    probes += size * perAddress;
  }
  return finish('COMPLETED', null);
}

/**
 * Records a failed attempt. A retryable failure leaves the scan PENDING (its subnet stays reserved) so the next attempt
 * resumes from the saved cursor; the final or a configuration failure marks it FAILED.
 */
export async function recordDiscoveryFailure(prisma: PrismaClient, jobId: string, error: unknown, finalAttempt: boolean) {
  const code = error instanceof DiscoveryConfigurationError ? error.code : typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : 'DISCOVERY_EXECUTION_FAILED';
  const final = finalAttempt || error instanceof DiscoveryConfigurationError;
  await prisma.discoveryJob.updateMany({ where: { id: jobId, status: { in: ['PENDING', 'RUNNING'] } }, data: final ? { status: 'FAILED', completedAt: new Date(), errorMessage: code } : { status: 'PENDING', errorMessage: code } });
  return { code, final };
}
