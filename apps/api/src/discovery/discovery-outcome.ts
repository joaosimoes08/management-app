import type { DiscoverySnmpEnrichment, DiscoverySnmpSkipReason } from './discovery-snmp';

/**
 * D-P2a: structured scan outcomes.
 *
 * Every saved DiscoveryResult (a host that answered ping or a TCP connect) carries `outcome`: what each method saw for
 * that host, so a failure reads as "TCP 443 refused" or "DNS lookup failed" instead of a missing value.
 * Every DiscoveryJob carries `outcomeCounts`: the same states counted over all scanned hosts, including the ones that
 * did not answer (they get no row, as before, so result volume, comparison and IPAM approval do not change).
 * Hosts never scanned because the run stopped at a limit or was cancelled are `totalCount - processedCount`.
 * Both are nullable JSON: runs saved before D-P2a have none and the UI shows nothing for them.
 */

export const DISCOVERY_OUTCOME_VERSION = 1;

export type IcmpOutcome = 'REPLY' | 'NO_REPLY' | 'ERROR' | 'NOT_PROBED';
export type TcpPortState = 'OPEN' | 'REFUSED' | 'TIMEOUT' | 'ERROR';
export type DnsOutcome = 'PTR' | 'NO_PTR' | 'LOOKUP_FAILED' | 'NOT_REQUESTED';
export type SnmpOutcome = 'OK' | 'PARTIAL' | 'AUTH_FAILED' | 'TIMEOUT' | 'ERROR' | 'SKIPPED_POLICY' | 'NOT_ENABLED';

export type DiscoveryHostOutcome = {
  v: typeof DISCOVERY_OUTCOME_VERSION;
  result: 'RESPONDED';
  icmp: IcmpOutcome;
  /** One entry per probed port; null when TCP was not part of the scan. */
  tcp: Array<{ port: number; state: TcpPortState }> | null;
  dns: DnsOutcome;
  /** Error code of a failed reverse lookup (e.g. ETIMEOUT, ESERVFAIL). */
  dnsError?: string;
  snmp: SnmpOutcome;
  /** Why SNMP was skipped for the whole run (e.g. SNMP_CREDENTIAL_OUT_OF_SCOPE). */
  snmpSkipReason?: string;
};

export const DISCOVERY_OUTCOME_COUNT_KEYS = [
  'responded', 'noResponse',
  'icmpReply', 'icmpNoReply', 'icmpError',
  'tcpOpen', 'tcpRefused', 'tcpTimeout', 'tcpError',
  'dnsPtr', 'dnsNoPtr', 'dnsLookupFailed',
  'snmpOk', 'snmpPartial', 'snmpAuthFailed', 'snmpTimeout', 'snmpError', 'snmpSkippedPolicy',
] as const;
export type DiscoveryOutcomeCountKey = typeof DISCOVERY_OUTCOME_COUNT_KEYS[number];
/** Host counts, except tcp* which count probed ports. */
export type DiscoveryOutcomeCounts = { v: typeof DISCOVERY_OUTCOME_VERSION } & Record<DiscoveryOutcomeCountKey, number>;

export function emptyOutcomeCounts(): DiscoveryOutcomeCounts {
  return { v: DISCOVERY_OUTCOME_VERSION, ...Object.fromEntries(DISCOVERY_OUTCOME_COUNT_KEYS.map((key) => [key, 0])) } as DiscoveryOutcomeCounts;
}

/** Reads a stored value back; anything unexpected (older shape, null) counts as zero. */
export function readOutcomeCounts(value: unknown): DiscoveryOutcomeCounts {
  const counts = emptyOutcomeCounts();
  if (value && typeof value === 'object') {
    for (const key of DISCOVERY_OUTCOME_COUNT_KEYS) {
      const item = (value as Record<string, unknown>)[key];
      if (typeof item === 'number' && Number.isInteger(item) && item > 0) counts[key] = item;
    }
  }
  return counts;
}

export function addOutcomeCounts(base: DiscoveryOutcomeCounts, extra: DiscoveryOutcomeCounts): DiscoveryOutcomeCounts {
  const sum = emptyOutcomeCounts();
  for (const key of DISCOVERY_OUTCOME_COUNT_KEYS) sum[key] = base[key] + extra[key];
  return sum;
}

/** No-answer and missing-name codes from Node's resolver; anything else is a failed lookup. */
const NO_PTR_CODES = new Set(['ENOTFOUND', 'ENODATA', 'NOTFOUND', 'NODATA']);

export type DnsLookup = { dns: DnsOutcome; hostname?: string; dnsError?: string };

export function classifyReverseDns(hostname: string | undefined | null): DnsLookup {
  return hostname ? { dns: 'PTR', hostname } : { dns: 'NO_PTR' };
}

export function classifyReverseDnsError(error: unknown): DnsLookup {
  const code = typeof error === 'object' && error !== null && 'code' in error && typeof error.code === 'string' ? error.code : undefined;
  if (code && NO_PTR_CODES.has(code)) return { dns: 'NO_PTR' };
  return { dns: 'LOOKUP_FAILED', dnsError: code && /^[A-Z_]{2,40}$/.test(code) ? code : 'DNS_LOOKUP_FAILED' };
}

export function snmpOutcomeFor(enrichment: DiscoverySnmpEnrichment | undefined, skipped: DiscoverySnmpSkipReason | string | null | undefined): { snmp: SnmpOutcome; snmpSkipReason?: string } {
  if (enrichment) return { snmp: enrichment.status };
  if (skipped) return { snmp: 'SKIPPED_POLICY', snmpSkipReason: skipped };
  return { snmp: 'NOT_ENABLED' };
}

/** What the probe reported for one address. `icmp.status` and `tcp` are optional so older probes still work. */
export type ProbeDetail = {
  icmp: { reachable: boolean; status?: 'REPLY' | 'NO_REPLY' | 'ERROR' };
  openPorts: number[];
  tcp?: Array<{ port: number; state: TcpPortState }>;
};

export function icmpOutcomeFor(probe: ProbeDetail, methods: string[]): IcmpOutcome {
  if (!methods.includes('ICMP')) return 'NOT_PROBED';
  if (probe.icmp.reachable) return 'REPLY';
  return probe.icmp.status === 'ERROR' ? 'ERROR' : 'NO_REPLY';
}

/** Per-port states; probes without `tcp` detail report open ports as OPEN and the rest as TIMEOUT (no answer). */
export function tcpOutcomeFor(probe: ProbeDetail, methods: string[], tcpPorts: number[]): DiscoveryHostOutcome['tcp'] {
  if (!methods.includes('TCP') || !tcpPorts.length) return null;
  const detail = new Map((probe.tcp ?? []).map((item) => [item.port, item.state]));
  return tcpPorts.map((port) => ({ port, state: detail.get(port) ?? (probe.openPorts.includes(port) ? 'OPEN' : 'TIMEOUT') }));
}

/** Adds one scanned host to the counts. `outcome` is null for a host that did not answer (it gets no result row). */
export function countHost(counts: DiscoveryOutcomeCounts, icmp: IcmpOutcome, tcp: DiscoveryHostOutcome['tcp'], outcome: DiscoveryHostOutcome | null) {
  if (icmp === 'REPLY') counts.icmpReply += 1; else if (icmp === 'NO_REPLY') counts.icmpNoReply += 1; else if (icmp === 'ERROR') counts.icmpError += 1;
  for (const item of tcp ?? []) {
    if (item.state === 'OPEN') counts.tcpOpen += 1; else if (item.state === 'REFUSED') counts.tcpRefused += 1; else if (item.state === 'TIMEOUT') counts.tcpTimeout += 1; else counts.tcpError += 1;
  }
  if (!outcome) { counts.noResponse += 1; return; }
  counts.responded += 1;
  if (outcome.dns === 'PTR') counts.dnsPtr += 1; else if (outcome.dns === 'NO_PTR') counts.dnsNoPtr += 1; else if (outcome.dns === 'LOOKUP_FAILED') counts.dnsLookupFailed += 1;
  const snmpKey = ({ OK: 'snmpOk', PARTIAL: 'snmpPartial', AUTH_FAILED: 'snmpAuthFailed', TIMEOUT: 'snmpTimeout', ERROR: 'snmpError', SKIPPED_POLICY: 'snmpSkippedPolicy' } as Partial<Record<SnmpOutcome, DiscoveryOutcomeCountKey>>)[outcome.snmp];
  if (snmpKey) counts[snmpKey] += 1;
}

/**
 * A failed `ping`: "no reply" is exit status 1 (Linux iputils, busybox in the node:alpine image) or 2 (macOS/BSD
 * ping), or our own timeout; any other failure (no ping binary, unknown host on macOS, Linux exit 2) is an error.
 */
export function classifyPingFailure(error: unknown, platform: string = process.platform): 'NO_REPLY' | 'ERROR' {
  const failure = (typeof error === 'object' && error !== null ? error : {}) as { code?: unknown; killed?: unknown; signal?: unknown };
  const noReplyCode = platform === 'darwin' || platform.endsWith('bsd') ? 2 : 1;
  if (failure.code === noReplyCode || failure.killed === true || failure.signal === 'SIGTERM') return 'NO_REPLY';
  return 'ERROR';
}

/** A failed TCP connect: an RST is REFUSED, everything else that is not a timeout (unreachable, reset…) is ERROR. */
export function classifyTcpFailure(code: unknown): Exclude<TcpPortState, 'OPEN' | 'TIMEOUT'> {
  return code === 'ECONNREFUSED' ? 'REFUSED' : 'ERROR';
}
