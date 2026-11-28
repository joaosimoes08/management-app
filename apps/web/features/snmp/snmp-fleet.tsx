'use client';

import { useQuery } from '@tanstack/react-query';
import { RadioTower, Settings2, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format/date';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useTableUrlState } from '@/components/data-table/use-table-url-state';
import { FilterChipBar, FilterChips } from '@/components/ui/filter-chips';
import { applyChipFilters, chipOptions, facetCounts, type ChipAccessors } from '@/lib/filter-chips';
import { getSnmpFleetSummary, type SnmpAttentionReason, type SnmpFleetSummary } from './api';
import { useUiText } from '@/components/ui/use-ui-text';

const reasonBadges: Record<string, { tone: string; label: string }> = {
  FAILED: { tone: 'excluded', label: 'snmp.fleet.reason.failed' },
  BLOCKED: { tone: 'reserved', label: 'snmp.fleet.reason.blocked' },
  NO_SCHEDULE: { tone: 'excluded', label: 'snmp.fleet.reason.noSchedule' },
  STALE: { tone: 'reserved', label: 'snmp.fleet.reason.stale' },
  NEVER_POLLED: { tone: 'pending', label: 'snmp.fleet.reason.neverPolled' },
  NOT_CONFIGURED: { tone: 'pending', label: 'snmp.fleet.reason.notConfigured' },
};

/** Badge for an attention reason; unknown reasons render as a neutral badge with the raw code. */
export function SnmpAttentionBadge({ reason }: { reason: SnmpAttentionReason }) {
  const t = useUiText();
  const badge = reasonBadges[reason];
  return <span className={`state-badge ${badge?.tone ?? ''}`.trim()}><i />{badge ? t(badge.label) : reason}</span>;
}

/** Message for a failed fleet summary request: SITE_NOT_FOUND is explained, anything else shows the API message. */
export function fleetErrorMessage(t: ReturnType<typeof useUiText>, cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.code === 'SITE_NOT_FOUND') return t('snmp.fleet.siteNotFound');
  return cause instanceof Error && cause.message ? cause.message : t('snmp.fleet.loadFailed');
}

const count = (value: number | undefined) => value ?? 0;

type Props = {
  siteId: string;
  openDevice: (deviceId: string) => void;
  openDrifts: () => void;
  /** SNMP Phase 1 step 5: opens the "Configurar SNMP" wizard for a device without SNMP config (ADMIN only). */
  configureDevice?: (deviceId: string, name: string) => void;
};
type AttentionRow = NonNullable<SnmpFleetSummary['attention']>[number];

/** Reason chips over the attention list; the choice lives in `?attention.reason=`. */
const attentionTableConfig = { filters: { reason: '' }, sortable: [] as string[], prefix: 'attention.' };
const attentionAccessors: ChipAccessors<AttentionRow> = { reason: (row) => row.reason };
const reasonChipKeys = Object.entries(reasonBadges).map(([value, badge]) => [value, badge.label] as const);

const attentionColumns = (t: ReturnType<typeof useUiText>, openDevice: Props['openDevice'], configureDevice?: Props['configureDevice']): DataTableColumn<AttentionRow>[] => [
  { id: 'device', header: t('snmp.fleet.column.device'), cell: (item) => <><strong>{item.name}</strong>{item.lastStatus ? <small>{item.lastStatus}</small> : null}</> },
  { id: 'reason', header: t('snmp.fleet.column.reason'), cell: (item) => <SnmpAttentionBadge reason={item.reason} /> },
  { id: 'lastPoll', header: t('snmp.fleet.column.lastPoll'), cell: (item) => (item.lastPollAt ? formatDateTime(item.lastPollAt) : <span className="muted-cell">{t('snmp.fleet.never')}</span>) },
  { id: 'error', header: t('snmp.fleet.column.error'), cell: (item) => (item.lastErrorCode ? <span className="mono">{item.lastErrorCode}</span> : <span className="muted-cell">—</span>) },
  { id: 'drifts', header: t('snmp.fleet.column.drifts'), cell: (item) => count(item.pendingDrifts) },
  { id: 'actions', header: null, className: 'table-actions', cell: (item) => <span className="button-row">{item.reason === 'NOT_CONFIGURED' && configureDevice && <button type="button" className="primary-button" aria-label={t('snmp.fleet.configureNamed', undefined, { name: item.name })} onClick={() => configureDevice(item.deviceId, item.name)}><Settings2 size={13} /> {t('snmp.fleet.configure')}</button>}<button type="button" className="secondary-button" aria-label={t('snmp.fleet.openNamed', undefined, { name: item.name })} onClick={() => openDevice(item.deviceId)}>{t('snmp.fleet.open')}</button></span> },
];

/** Fleet-wide SNMP health for the active Site: configuration, polling state, drift and the devices needing attention. */
export function SnmpFleetSummaryView({ siteId, openDevice, openDrifts, configureDevice }: Props) {
  const t = useUiText();
  const { data, error, isLoading } = useQuery({ queryKey: ['snmp', 'fleet', siteId], queryFn: () => getSnmpFleetSummary(siteId || undefined), refetchInterval: 60_000, retry: false });
  if (error) return <div className="ipam-alert error" role="alert"><X size={15} />{fleetErrorMessage(t, error)}</div>;
  if (isLoading || !data) return <div className="empty-context" aria-busy="true"><RadioTower size={24} /><strong>{t('snmp.fleet.loadingTheFleetSummary')}</strong></div>;
  return <FleetSummaryContent data={data} openDevice={openDevice} openDrifts={openDrifts} configureDevice={configureDevice} />;
}

function FleetSummaryContent({ data, openDevice, openDrifts, configureDevice }: { data: SnmpFleetSummary; openDevice: (deviceId: string) => void; openDrifts: () => void; configureDevice?: Props['configureDevice'] }) {
  const tx = useUiText();
  const byStatus = data.polling?.byStatus ?? {};
  const attention = data.attention ?? [];
  const attentionTotal = data.attentionTotal ?? attention.length;
  const { filters, setFilter } = useTableUrlState(attentionTableConfig);
  const reasonCounts = facetCounts(attention, filters, attentionAccessors, 'reason');
  const reasonOptions = chipOptions(reasonChipKeys.map(([value, key]) => [value, tx(key)] as const), reasonCounts, { complete: true, selected: filters.reason, hideEmpty: true });
  const visibleAttention = applyChipFilters(attention, filters, attentionAccessors);
  return <>
    <div className="summary-stats" role="group" aria-label={tx('snmp.fleet.snmpFleetSummary')}>
      <div><strong>{`${count(data.devices?.configured)} / ${count(data.devices?.total)}`}</strong><span>{tx('snmp.fleet.devicesWithSnmpConfigured')}</span></div>
      <div><strong>{count(data.devices?.enabled)}</strong><span>{tx('snmp.fleet.pollingActive', undefined, { disabled: count(data.devices?.disabled) })}</span></div>
      <div><strong>{count(data.devices?.notConfigured)}</strong><span>{tx('snmp.fleet.noSnmpConfiguration')}</span></div>
      <div><strong>{count(byStatus.FAILED)}</strong><span>{tx('snmp.fleet.pollingFailed', undefined, { blocked: count(byStatus.BLOCKED) })}</span></div>
      <div><strong>{count(data.polling?.stale)}</strong><span>{data.polling?.noSchedule ? tx('groupB.snmp.staleUnscheduled', undefined, { never: count(byStatus.NEVER_POLLED), unscheduled: data.polling.noSchedule }) : tx('groupB.snmp.stale', undefined, { never: count(byStatus.NEVER_POLLED) })}</span></div>
      <div><strong>{count(data.drift?.pending)}</strong><span>{tx('snmp.fleet.pendingDrifts', undefined, { devices: count(data.drift?.devicesWithPending) })}</span></div>
    </div>
    <p className="ipam-scope-note">{tx('groupB.snmp.pollTimes', undefined, { last: data.polling?.lastPollAt ? formatDateTime(data.polling.lastPollAt) : '—', oldest: data.polling?.oldestPollAt ? formatDateTime(data.polling.oldestPollAt) : '—' })}{data.generatedAt ? tx('groupB.snmp.generatedAt', undefined, { date: formatDateTime(data.generatedAt) }) : ''}{data.scheduler?.ok === false ? tx('groupB.snmp.schedulerFailed', undefined, { reason: data.scheduler.errorCode ?? tx('groupB.snmp.devicesCount', undefined, { count: data.scheduler.failed ?? 0 }) }) : ''}</p>
    <section className="ipam-card">
      <div className="panel-heading"><div><h2>{tx('snmp.fleet.devicesNeedingAttention')}</h2><p className="panel-description">{attentionTotal > attention.length ? tx('snmp.fleet.showingSome', undefined, { shown: attention.length, total: attentionTotal }) : tx('snmp.fleet.pollingFailedBlockedStaleNever')}</p></div>{count(data.drift?.pending) > 0 && <button type="button" className="secondary-button" onClick={openDrifts}>{tx('snmp.fleet.reviewDrifts')}</button>}</div>
      {attention.length > 0 && <FilterChipBar><FilterChips label={tx('snmp.fleet.reason')} value={filters.reason} options={reasonOptions} total={attention.length} onChange={(value) => setFilter('reason', value)} /></FilterChipBar>}
      {visibleAttention.length ? <DataTable rows={visibleAttention} columns={attentionColumns(tx, openDevice, configureDevice)} rowKey={(item) => item.deviceId} label={tx('snmp.fleet.devicesNeedingAttention')} /> : <div className="no-data">{attention.length ? tx('snmp.fleet.noDevicesWithThisReason') : tx('snmp.fleet.noDeviceNeedsAttention')}</div>}
    </section>
  </>;
}
