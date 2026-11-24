'use client';

import { useUiText } from '@/components/ui/use-ui-text';
import { formatDateTime } from '@/lib/format/date';
import type { SnmpHealthStatus, SnmpHealthSummaryItem } from './health-api';

type UiText = ReturnType<typeof useUiText>;
type BadgeStatus = SnmpHealthStatus | 'NONE';

/** Existing `state-badge` tones: green for OK, amber for Degradado, the neutral grey for Desconhecido / Sem dados. */
const TONES: Record<BadgeStatus, string> = { OK: 'occupied', DEGRADED: 'reserved', UNKNOWN: '', NONE: '' };

export const badgeStatus = (status: SnmpHealthStatus | null | undefined): BadgeStatus => (status === 'OK' || status === 'DEGRADED' || status === 'UNKNOWN' ? status : 'NONE');

export function snmpHealthStatusLabel(t: UiText, status: SnmpHealthStatus | null | undefined) {
  return t(`snmpHealth.status.${badgeStatus(status)}`);
}

/** Full sentence for screen readers and the tooltip: status, issues, reading time and staleness. */
export function snmpHealthDescription(t: UiText, item: Pick<SnmpHealthSummaryItem, 'status' | 'issueCount' | 'observedAt' | 'stale'> | null | undefined) {
  const status = badgeStatus(item?.status);
  const parts = [t('snmpHealth.badgeLabel', undefined, { status: t(`snmpHealth.status.${status}`) })];
  if (status === 'NONE' || !item) return [...parts, t('snmpHealth.noData')].join('. ');
  if (item.issueCount > 0) parts.push(t('snmpHealth.issues', undefined, { count: item.issueCount }));
  if (item.observedAt) parts.push(t('snmpHealth.observed', undefined, { date: formatDateTime(item.observedAt) }));
  if (item.stale) parts.push(t('snmpHealth.stale'));
  return parts.join('. ');
}

/**
 * SNMP Phase 2 step 10: health badge for one network device (lists, Device 360, topology tooltip). The colour is
 * never the only signal: the text says the state, and the tooltip/accessible name adds issues and the reading time.
 */
export function SnmpHealthBadge({ item, className = '' }: { item: Pick<SnmpHealthSummaryItem, 'status' | 'issueCount' | 'observedAt' | 'stale'> | null | undefined; className?: string }) {
  const t = useUiText();
  const status = badgeStatus(item?.status);
  const description = snmpHealthDescription(t, item);
  const count = status === 'DEGRADED' && item && item.issueCount > 0 ? ` · ${item.issueCount}` : '';
  return <span className={`state-badge snmp-health-badge ${TONES[status]}${item?.stale ? ' is-stale' : ''} ${className}`.replace(/\s+/g, ' ').trim()} data-health={status} title={description} role="img" aria-label={description}>
    <i aria-hidden="true" />{snmpHealthStatusLabel(t, item?.status)}{count}
  </span>;
}
