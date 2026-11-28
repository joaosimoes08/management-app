import type { useUiText } from '@/components/ui/use-ui-text';
import type { DiscoveryJob } from './api';

type Translate = ReturnType<typeof useUiText>;

/** Discovery P0: words shown for a run's status. The API keeps the English enum; the screen never shows it raw. */
export const discoveryStatusLabels: Record<string, string> = {
  PENDING: 'discovery.status.job.pending',
  RUNNING: 'discovery.status.job.running',
  COMPLETED: 'discovery.status.job.completed',
  FAILED: 'discovery.status.job.failed',
  CANCELLED: 'discovery.status.job.cancelled',
  QUEUED: 'discovery.status.job.queued',
};

export function discoveryStatusLabel(t: Translate, status: string | null | undefined): string {
  if (!status) return '—';
  const key = discoveryStatusLabels[status.trim().toUpperCase()];
  return key ? t(key) : status;
}

/** "1 resultado", "0 resultados", "12 resultados". */
export function formatResultCount(t: Translate, count: number): string {
  return t('discovery.status.resultCount', undefined, { count });
}

/**
 * Why a run failed, in words. The worker stores a code in `errorMessage` (policy codes, network error codes, or
 * DISCOVERY_EXECUTION_FAILED); unknown codes are shown as they are so nothing is hidden.
 */
const failureReasons: Record<string, string> = {
  DISCOVERY_TARGET_NOT_ALLOWED: 'discovery.status.error.targetNotAllowed',
  DISCOVERY_TARGET_FORBIDDEN: 'discovery.status.error.targetForbidden',
  DISCOVERY_CIDR_INVALID: 'discovery.status.error.cidrInvalid',
  DISCOVERY_IPV6_UNSUPPORTED: 'discovery.status.error.ipv6Unsupported',
  DISCOVERY_CONFIGURATION_INVALID: 'discovery.status.error.configurationInvalid',
  DISCOVERY_PORT_LIMIT: 'discovery.status.error.portLimit',
  DISCOVERY_JOB_NOT_FOUND: 'discovery.status.error.jobNotFound',
  DISCOVERY_QUEUE_UNAVAILABLE: 'discovery.status.error.queueUnavailable',
  DISCOVERY_EXECUTION_FAILED: 'discovery.status.error.executionFailed',
  ECONNRESET: 'discovery.status.error.econnreset',
  ECONNREFUSED: 'discovery.status.error.econnrefused',
  ETIMEDOUT: 'discovery.status.error.etimedout',
};

/** A stored error code in words; unknown codes come back unchanged. */
export function describeDiscoveryError(t: Translate, code: string): string {
  const trimmed = code.trim();
  const key = failureReasons[trimmed] ?? stopReasons[trimmed];
  return key ? t(key) : trimmed;
}

/** Schedules store how the last scheduled run stopped in `lastError` too. */
const stopReasons: Record<string, string> = {
  CANCELLED: 'discovery.status.stop.cancelled',
  LIMIT_DURATION: 'discovery.status.stop.limitDuration',
  LIMIT_PROBES: 'discovery.status.stop.limitProbes',
};

export function discoveryFailureReason(t: Translate, job: Pick<DiscoveryJob, 'status' | 'errorMessage'>): string | null {
  if (job.status !== 'FAILED') return null;
  const code = job.errorMessage?.trim();
  if (!code) return t('discovery.status.failedNoReason');
  return describeDiscoveryError(t, code);
}

/** Share of addresses already scanned, 0–100, or null when the run has no known size yet. */
export function discoveryProgressPercent(job: Pick<DiscoveryJob, 'totalCount' | 'processedCount'>): number | null {
  if (!job.totalCount || job.totalCount <= 0) return null;
  const done = Math.min(Math.max(job.processedCount ?? 0, 0), job.totalCount);
  return Math.floor((done / job.totalCount) * 100);
}

export function isActiveDiscoveryJob(job: Pick<DiscoveryJob, 'status'>): boolean {
  return job.status === 'RUNNING' || job.status === 'PENDING';
}
