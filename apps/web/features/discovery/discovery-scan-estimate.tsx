'use client';

import { useQuery } from '@tanstack/react-query';
import { Timer } from 'lucide-react';
import { useUiText } from '@/components/ui/use-ui-text';
import { getDiscoveryDefaults, getDiscoverySchedule } from './api';
import { formatDurationMs } from './discovery-results';

/**
 * D-P2b: the scan form checks a run before it is sent, with the same limits the API applies.
 * Mirrors apps/api: MAX_DISCOVERY_HOSTS and MAX_DISCOVERY_PORTS (discovery-network / discovery-policy), the default
 * duration and probe caps (discovery-scan) and the #148 limiter defaults (discovery-limiter), used when neither the
 * subnet nor the settings answer with their own values.
 */
export const DISCOVERY_MAX_HOSTS = 4096;
export const DISCOVERY_MAX_PORTS = 64;
export const DISCOVERY_MAX_DURATION_SECONDS = 3600;
export const DISCOVERY_MAX_PROBES = 100_000;
export const DISCOVERY_DEFAULT_LIMITS = { probesPerSecond: 100, maxSockets: 64 } as const;
/** Worst case per probe when nothing answers: ping waits up to 1 s, a TCP connect 0.8 s. */
const PROBE_TIMEOUT_SECONDS = 1;

export type DiscoveryScanProblem = { level: 'error' | 'warning'; key: string; params?: Record<string, string | number> };
export type DiscoveryScanCheck = {
  hosts: number | null;
  probesPerHost: number;
  probes: number;
  /** Seconds when hosts answer fast (rate bound) and when nothing answers (timeouts bound by the socket cap). */
  seconds: { min: number; max: number } | null;
  limits: { probesPerSecond: number; maxSockets: number };
  problems: DiscoveryScanProblem[];
  blocked: boolean;
};

/** Hosts a scan of this CIDR probes, as the API enumerates them (/31 and /32 keep every address). null = not IPv4. */
export function discoveryHostCount(cidr: string): number | null {
  const [address, bitsText] = cidr.trim().split('/');
  const octets = address?.split('.') ?? [];
  const bits = Number(bitsText);
  if (octets.length !== 4 || octets.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255) || !Number.isInteger(bits) || bits < 0 || bits > 32) return null;
  const size = 2 ** (32 - bits);
  return bits >= 31 ? size : size - 2;
}

/** Ports as the form sends them, plus the tokens that are not a port (1-65535). */
export function parseDiscoveryPorts(text: string): { ports: number[]; invalid: string[] } {
  const tokens = text.split(',').map((token) => token.trim()).filter(Boolean);
  const invalid = tokens.filter((token) => !/^\d+$/.test(token) || Number(token) < 1 || Number(token) > 65535);
  const ports = [...new Set(tokens.filter((token) => !invalid.includes(token)).map(Number))];
  return { ports, invalid };
}

export function checkDiscoveryScan(input: { cidr: string; methods: string[]; tcpPorts: string; limits?: { probesPerSecond: number; maxSockets: number } | null }): DiscoveryScanCheck {
  const limits = input.limits ?? DISCOVERY_DEFAULT_LIMITS;
  const problems: DiscoveryScanProblem[] = [];
  const tcp = input.methods.includes('TCP');
  const { ports, invalid } = tcp ? parseDiscoveryPorts(input.tcpPorts) : { ports: [], invalid: [] };
  if (tcp && invalid.length) problems.push({ level: 'error', key: 'discoveryScan.portsInvalid', params: { ports: invalid.join(', ') } });
  else if (tcp && !ports.length) problems.push({ level: 'error', key: 'discoveryScan.portsMissing' });
  if (ports.length > DISCOVERY_MAX_PORTS) problems.push({ level: 'error', key: 'discoveryScan.portsTooMany', params: { count: ports.length, max: DISCOVERY_MAX_PORTS } });
  const probesPerHost = (input.methods.includes('ICMP') ? 1 : 0) + ports.length;
  const hosts = input.cidr ? discoveryHostCount(input.cidr) : null;
  if (input.cidr && hosts === null) problems.push({ level: 'error', key: 'discoveryScan.ipv4Only' });
  if (hosts !== null && hosts > DISCOVERY_MAX_HOSTS) problems.push({ level: 'error', key: 'discoveryScan.tooManyHosts', params: { hosts, max: DISCOVERY_MAX_HOSTS } });
  const probes = (hosts ?? 0) * probesPerHost;
  const seconds = hosts !== null && probes > 0 ? { min: probes / limits.probesPerSecond, max: Math.max(probes / limits.probesPerSecond, (probes * PROBE_TIMEOUT_SECONDS) / limits.maxSockets) } : null;
  const blocked = problems.some((problem) => problem.level === 'error');
  if (!blocked && probes > DISCOVERY_MAX_PROBES) problems.push({ level: 'warning', key: 'discoveryScan.probeLimit', params: { probes, max: DISCOVERY_MAX_PROBES } });
  if (!blocked && seconds && seconds.max > DISCOVERY_MAX_DURATION_SECONDS) problems.push({ level: 'warning', key: 'discoveryScan.durationLimit', params: { limit: formatDurationMs(DISCOVERY_MAX_DURATION_SECONDS * 1000) } });
  return { hosts, probesPerHost, probes, seconds, limits, problems, blocked };
}

/** Reads the subnet's effective #148 limits (same cache as the schedule panel), falling back to the settings' defaults. */
export function useDiscoveryScanCheck(form: { subnetId: string; methods: string[]; tcpPorts: string }, subnets: Array<{ id: string; cidr: string }>): DiscoveryScanCheck {
  const subnet = subnets.find((item) => item.id === form.subnetId);
  const { data: schedule } = useQuery({ queryKey: ['discovery', 'schedule', form.subnetId], queryFn: () => getDiscoverySchedule(form.subnetId), enabled: Boolean(form.subnetId), retry: false });
  const { data: defaults } = useQuery({ queryKey: ['discovery', 'defaults'], queryFn: getDiscoveryDefaults });
  const settingsLimits = (defaults as { limits?: { probesPerSecond?: number; maxSockets?: number } } | undefined)?.limits;
  const limits = schedule?.limits?.effective
    ?? (settingsLimits?.probesPerSecond && settingsLimits.maxSockets ? { probesPerSecond: settingsLimits.probesPerSecond, maxSockets: settingsLimits.maxSockets } : null);
  return checkDiscoveryScan({ cidr: subnet?.cidr ?? '', methods: form.methods, tcpPorts: form.tcpPorts, limits });
}

/** Size, probes and estimated duration of the run, and what would stop it, shown under the scan form. */
export function DiscoveryScanEstimate({ check }: { check: DiscoveryScanCheck }) {
  const t = useUiText();
  const errors = check.problems.filter((problem) => problem.level === 'error');
  const warnings = check.problems.filter((problem) => problem.level === 'warning');
  const duration = check.seconds ? (Math.round(check.seconds.min) === Math.round(check.seconds.max)
    ? formatDurationMs(check.seconds.min * 1000)
    : t('discoveryScan.durationRange', undefined, { min: formatDurationMs(check.seconds.min * 1000), max: formatDurationMs(check.seconds.max * 1000) })) : null;
  return <div className="discovery-scan-estimate" aria-live="polite">
    {check.hosts !== null && check.probes > 0 && <p className="form-help"><Timer size={12} aria-hidden="true" /> {t('discoveryScan.summary', undefined, { hosts: check.hosts, probes: check.probes, duration: duration ?? '—' })}</p>}
    {check.hosts !== null && check.probes > 0 && <p className="form-help">{t('discoveryScan.limits', undefined, { rate: check.limits.probesPerSecond, sockets: check.limits.maxSockets })}</p>}
    {errors.map((problem) => <p key={problem.key} className="form-error" role="alert">{t(problem.key, undefined, problem.params)}</p>)}
    {warnings.map((problem) => <p key={problem.key} className="form-help discovery-scan-warning" role="note">{t(problem.key, undefined, problem.params)}</p>)}
  </div>;
}
