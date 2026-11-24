import { Prisma, PrismaClient } from '@simoes/database';
import { hostsFor } from './discovery-network';
import { assertDiscoveryAllowed, normalizeDiscoveryPorts } from './discovery-policy';
import {
  addOutcomeCounts, classifyReverseDns, classifyReverseDnsError, countHost, DISCOVERY_OUTCOME_VERSION, emptyOutcomeCounts, icmpOutcomeFor,
  readOutcomeCounts, snmpOutcomeFor, tcpOutcomeFor, type DiscoveryHostOutcome, type DnsLookup, type TcpPortState,
} from './discovery-outcome';
import { ProbeAbortedError, resolveDiscoveryLimits, subnetProbeLimiter, type LimiterClock, type ProbeRunner } from './discovery-limiter';
import { loadDiscoverySnmpEnricher, type DiscoverySnmpEnricher, type DiscoverySnmpEnrichment, type DiscoverySnmpSkipReason } from './discovery-snmp';

/**
 * Round 2 #10/#11: one discovery scan, saved batch by batch.
 *
 * - Progress: each batch's results and counters are written in one transaction, guarded by the resume cursor
 *   (`processedCount`). A retry or a re-delivered job resumes after the last saved batch, and two workers that pick up
 *   the same job never count a batch twice (the second one's guarded update matches no row and it stops).
 * - Cancel: `cancelRequestedAt` is checked before every batch and, while a batch runs (probes and reverse DNS), every
 *   `controlPollMs` (1 s), so a cancel is honoured within about `controlPollMs` plus one status query. A cancel or a
 *   passed deadline aborts the probes still queued in the limiter and stops waiting for those in flight; the unfinished batch is not saved
 *   (a retry would probe it again) and the scan ends as CANCELLED / LIMIT_DURATION, keeping the saved batches.
 * - Limits: `maxDurationSeconds` (from the first start, across retries) and `maxProbes` (ICMP pings plus TCP connects).
 *   Reaching one ends the scan as COMPLETED with stopReason LIMIT_DURATION / LIMIT_PROBES ("stopped at limit").
 * - Load (discovery P0): every probe goes through the subnet's process-wide `ProbeLimiter` (shared by all scans of the
 *   subnet, see discovery-limiter.ts), built from `discoveryProbesPerSecond` / `discoveryMaxSockets` (null = defaults),
 *   plus the process-wide socket ceiling. `probe` must run each ping and TCP connect through `limiter.run`.
 * - SNMP enrichment (D-P1a): when the subnet has a READ credential set, the scan fixes it on its first start and, after
 *   each batch's probes, enriches only the hosts that answered ping or TCP, one limiter slot per host (discovery-snmp.ts).
 *   Per-target failures are stored on the result; a credential that cannot be used skips enrichment, never the scan.
 *   Enrichment attempts are added to `probeCount` (so `maxProbes` also bounds them), but batches are still sized by
 *   ping/TCP probes only, so a scan can pass `maxProbes` by at most one batch of SNMP attempts.
 * - Outcomes (D-P2a): each saved result carries `outcome` (ICMP, TCP per port, reverse DNS, SNMP), and the job keeps
 *   `outcomeCounts`, summed in the same guarded transaction as the other counters, so silent hosts are counted without
 *   a row (discovery-outcome.ts). Hosts never scanned are `totalCount - processedCount`.
 */
export const DISCOVERY_BATCH_SIZE = 32;
export const DISCOVERY_DEFAULT_MAX_DURATION_SECONDS = positiveInt(process.env.DISCOVERY_MAX_DURATION_SECONDS, 3600);
export const DISCOVERY_DEFAULT_MAX_PROBES = positiveInt(process.env.DISCOVERY_MAX_PROBES, 100_000);
export const DISCOVERY_JOB_ATTEMPTS = 3;
/** BullMQ options for scan jobs: retries resume from the saved cursor. */
export const DISCOVERY_JOB_OPTIONS = { attempts: DISCOVERY_JOB_ATTEMPTS, backoff: { type: 'exponential', delay: 5_000 }, removeOnComplete: 100, removeOnFail: 100 } as const;

export type DiscoveryStopReason = 'CANCELLED' | 'LIMIT_DURATION' | 'LIMIT_PROBES';
/** `icmp.status` and `tcp` (D-P2a) are optional details; without them the outcome is derived from `reachable` / `openPorts`. */
export type ProbeOutcome = { address: string; icmp: { reachable: boolean; responseMs?: number; status?: 'REPLY' | 'NO_REPLY' | 'ERROR' }; openPorts: number[]; tcp?: Array<{ port: number; state: TcpPortState }> };
export type ScanDependencies = {
  probe: (address: string, methods: string[], tcpPorts: number[], limiter: ProbeRunner) => Promise<ProbeOutcome>;
  reverse?: (address: string) => Promise<string | undefined>;
  now?: () => Date;
  batchSize?: number;
  /** Test hook for the limiter's clock. */
  limiterClock?: LimiterClock;
  /** How often a running batch checks for cancel and the deadline (ms). */
  controlPollMs?: number;
  /** D-P1a: builds the SNMP enricher for the scan's credential (default: decrypts it with the SNMP keyring). */
  snmpEnricher?: (credentialId: string, subnetSiteId: string | null) => Promise<{ enricher: DiscoverySnmpEnricher } | { skipped: DiscoverySnmpSkipReason }>;
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
    prisma.discoveryJob.findUnique({ where: { id: jobId }, include: { subnet: { select: { id: true, cidr: true, siteId: true, discoveryProbesPerSecond: true, discoveryMaxSockets: true, discoverySnmpCredentialId: true } } } }),
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
  // D-P1a: the first start fixes the subnet's SNMP credential for this scan; retries keep it (even if the subnet changed).
  const snmpCredentialId = job.startedAt ? job.snmpCredentialId : job.subnet.discoverySnmpCredentialId;
  await prisma.discoveryJob.update({ where: { id: jobId }, data: { status: 'RUNNING', startedAt, errorMessage: null, totalCount: addresses.length, attemptCount: { increment: 1 }, ...(job.startedAt ? {} : { snmpCredentialId }) } });
  let enricher: DiscoverySnmpEnricher | null = null;
  let snmpSkipped: string | null = null;
  if (snmpCredentialId) {
    const loaded = await (deps.snmpEnricher ?? ((id, siteId) => loadDiscoverySnmpEnricher(prisma, id, siteId)))(snmpCredentialId, job.subnet.siteId);
    if ('enricher' in loaded) enricher = loaded.enricher; else snmpSkipped = loaded.skipped;
    await prisma.discoveryJob.update({ where: { id: jobId }, data: { snmpSkippedReason: 'skipped' in loaded ? loaded.skipped : null } });
  }
  const maxDurationMs = (job.maxDurationSeconds ?? DISCOVERY_DEFAULT_MAX_DURATION_SECONDS) * 1000;
  const maxProbes = job.maxProbes ?? DISCOVERY_DEFAULT_MAX_PROBES;
  const perAddress = Math.max(1, probesPerAddress(methods, tcpPorts));
  const limiter = subnetProbeLimiter(job.subnet.id, resolveDiscoveryLimits(job.subnet), deps.limiterClock);
  const controlPollMs = deps.controlPollMs ?? 1000;
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
    const abort = new AbortController();
    let abortReason = null as DiscoveryStopReason | null;
    const deadlineAt = startedAt.getTime() + maxDurationMs;
    let checking = false;
    const watcher = setInterval(() => {
      if (checking || abort.signal.aborted) return;
      checking = true;
      void (async () => {
        if (now().getTime() >= deadlineAt) { abortReason = 'LIMIT_DURATION'; abort.abort(); return; }
        const state = await prisma.discoveryJob.findUnique({ where: { id: jobId }, select: { cancelRequestedAt: true } });
        if (state?.cancelRequestedAt) { abortReason = 'CANCELLED'; abort.abort(); }
      })().catch(() => undefined).finally(() => { checking = false; });
    }, controlPollMs);
    watcher.unref?.();
    const runner = limiter.bind(abort.signal);
    const enrichments = new Map<string, DiscoverySnmpEnrichment>();
    const rows: Prisma.DiscoveryResultCreateManyInput[] = [];
    let icmp = 0; let tcp = 0; let snmpEnriched = 0; let snmpFailed = 0;
    const batchCounts = emptyOutcomeCounts();
    // fix/discovery-scan-cancel-latency: the abort ends the batch at once, not only the probes still queued. Probes and
    // SNMP requests already in flight (ping up to 1.5 s, TCP 0.8 s, SNMP up to its timeout) are left to finish in the
    // background and release their limiter slots; their outcomes are dropped. The watcher also keeps running through
    // reverse DNS, which is abandoned too, and nothing from an aborted batch is saved.
    try {
      const outcomes = await untilAborted(Promise.all(batch.map((address) => deps.probe(address, methods, tcpPorts, runner))), abort.signal);
      // D-P1a: only hosts that answered in this scan, only the scan's one credential, through the same limiter.
      if (enricher) {
        const answered = outcomes.filter((item) => item.icmp.reachable || item.openPorts.length);
        const results = await untilAborted(Promise.all(answered.map((item) => enricher!(item.address, runner))), abort.signal);
        answered.forEach((item, index) => enrichments.set(item.address, results[index]));
      }
      for (const item of outcomes) {
        if (abort.signal.aborted) break;
        if (item.icmp.reachable) icmp += 1;
        if (item.openPorts.length) tcp += 1;
        const icmpOutcome = icmpOutcomeFor(item, methods);
        const tcpOutcome = tcpOutcomeFor(item, methods, tcpPorts);
        if (!item.icmp.reachable && !item.openPorts.length) { countHost(batchCounts, icmpOutcome, tcpOutcome, null); continue; }
        // D-P2a: reverse DNS failures are recorded (no PTR vs. a failed lookup) instead of being swallowed; a cancel is not a lookup failure.
        let lookup: DnsLookup = { dns: 'NOT_REQUESTED' };
        if (job.reverseDns !== false && deps.reverse) {
          try { lookup = classifyReverseDns(await untilAborted(deps.reverse(item.address), abort.signal)); } catch (error) { if (error instanceof ProbeAbortedError) throw error; lookup = classifyReverseDnsError(error); }
        }
        const snmp = enrichments.get(item.address);
        if (snmp) { if (snmp.status === 'OK' || snmp.status === 'PARTIAL') snmpEnriched += 1; else snmpFailed += 1; }
        const outcome: DiscoveryHostOutcome = {
          v: DISCOVERY_OUTCOME_VERSION, result: 'RESPONDED', icmp: icmpOutcome, tcp: tcpOutcome,
          dns: lookup.dns, ...(lookup.dnsError ? { dnsError: lookup.dnsError } : {}), ...snmpOutcomeFor(snmp, snmpSkipped),
        };
        countHost(batchCounts, icmpOutcome, tcpOutcome, outcome);
        rows.push({ jobId, address: item.address, hostname: lookup.hostname, icmpReachable: item.icmp.reachable, responseMs: item.icmp.responseMs, openPorts: item.openPorts, outcome: outcome as unknown as Prisma.InputJsonValue, ...(snmp ? { snmp: snmp as unknown as Prisma.InputJsonValue } : {}) });
      }
    } catch (error) {
      if (!(error instanceof ProbeAbortedError) || !abortReason) throw error;
    } finally {
      clearInterval(watcher);
    }
    if (abortReason) return abortReason === 'CANCELLED' ? finish('CANCELLED', 'CANCELLED') : finish('COMPLETED', 'LIMIT_DURATION');
    try {
      await prisma.$transaction(async (tx) => {
        // The cursor guard below makes this read-modify-write safe: a concurrent writer that advanced first makes it match no row.
        const stored = await tx.discoveryJob.findUnique({ where: { id: jobId }, select: { outcomeCounts: true } });
        const outcomeCounts = addOutcomeCounts(readOutcomeCounts(stored?.outcomeCounts), batchCounts) as unknown as Prisma.InputJsonValue;
        const advanced = await tx.discoveryJob.updateMany({
          where: { id: jobId, status: 'RUNNING', processedCount: cursor },
          data: {
            processedCount: cursor + size, outcomeCounts, probeCount: { increment: size * perAddress + enrichments.size },
            snmpEnrichedCount: { increment: snmpEnriched }, snmpFailedCount: { increment: snmpFailed },
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
    probes += size * perAddress + enrichments.size;
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

/** Resolves with `work`, or rejects as soon as `signal` aborts (the work itself keeps running and its result is dropped). */
function untilAborted<T>(work: Promise<T>, signal: AbortSignal): Promise<T> {
  if (signal.aborted) return Promise.reject(new ProbeAbortedError());
  return new Promise<T>((resolve, reject) => {
    const onAbort = () => reject(new ProbeAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    work.then(resolve, reject).finally(() => signal.removeEventListener('abort', onAbort));
  });
}
