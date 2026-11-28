'use client';

import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DiscoveryResultsCsvButton, useDiscoveryResultsTools } from './discovery-results-tools';
import { DataTable, sortByColumns, useTableUrlState, type DataTableColumn, type TableStateConfig } from '@/components/data-table';
import { BULK_REVIEW_MAX, BulkReviewDialog, type BulkReviewResponse } from '@/features/discovery/bulk-review-dialog';
import { FilterChipBar, FilterChips } from '@/components/ui/filter-chips';
import { applyChipFilters, chipOptions, CHIP_NONE, facetCounts, type ChipAccessors } from '@/lib/filter-chips';
import { formatDateTime } from '@/lib/format/date';
import { bulkReviewDiscoveryResults, type DiscoveryResult, type DiscoveryResultIpam } from './api';
import { DiscoverySnmpCell } from './discovery-snmp-enrichment';
import { DiscoveryPromoteAction } from './discovery-promote';
import { DiscoveryOutcomeCell } from './discovery-outcomes';
import { DiscoveryIdentityCell, identitySortValue } from './discovery-identity';
import { useUiText } from '@/components/ui/use-ui-text';

type ReviewStatus = 'APPROVED' | 'IGNORED';

/** Review and IPAM chips live in `?resultsReview=` / `?resultsIpam=`; the table sort in `?resultssort=`. */
const resultsTableConfig: TableStateConfig<{ Review: string; Ipam: string }> = {
  filters: { Review: '', Ipam: '' },
  sortable: ['address', 'hostname', 'snmp', 'identity', 'ipam', 'status'],
  prefix: 'results',
};

/** Run duration as "45 s", "3 min 05 s" or "1 h 02 min". Unit symbols are language-neutral. */
export function formatDurationMs(ms: number | null | undefined): string {
  if (ms === null || ms === undefined || !Number.isFinite(ms) || ms < 0) return '—';
  if (ms < 1000) return '< 1 s';
  const total = Math.round(ms / 1000);
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  if (hours) return `${hours} h ${String(minutes).padStart(2, '0')} min`;
  if (minutes) return `${minutes} min ${String(seconds).padStart(2, '0')} s`;
  return `${seconds} s`;
}

/** IPAM state of a result as the chips see it: an active reservation counts as RESERVED. */
const resultIpamState = (result: DiscoveryResult) => (result.ipam ? (result.ipam.activeReservation ? 'RESERVED' : result.ipam.state) : null);
const resultAccessors: ChipAccessors<DiscoveryResult> = { Review: (result) => result.status, Ipam: resultIpamState };
const reviewChipLabels = [['PENDING', 'discovery.results.chip.review.pending'], ['APPROVED', 'discovery.results.chip.review.approved'], ['IGNORED', 'discovery.results.chip.review.ignored']] as const;
const ipamChipLabels = [['FREE', 'discovery.results.chip.ipam.free'], ['OCCUPIED', 'discovery.results.chip.ipam.occupied'], ['RESERVED', 'discovery.results.chip.ipam.reserved'], ['EXCLUDED', 'discovery.results.chip.ipam.excluded'], [CHIP_NONE, 'discovery.results.chip.ipam.none']] as const;

const ipamTone: Record<string, string> = { FREE: 'free', OCCUPIED: 'occupied', RESERVED: 'reserved', EXCLUDED: 'excluded' };

/** IPAM status of a discovered address; unknown states render as a neutral badge. */
export function DiscoveryIpamStatus({ ipam }: { ipam?: DiscoveryResultIpam | null }) {
  const t = useUiText();
  if (!ipam) return <span className="muted-cell">{t('discovery.results.notRecordedInIpam')}</span>;
  const reserved = ipam.activeReservation;
  return <>
    <span className={`state-badge ${reserved ? 'reserved' : ipamTone[ipam.state] ?? ''}`.trim()}><i />{reserved ? 'RESERVED' : ipam.state}</span>
    {ipam.hostName && <small>{`Host ${ipam.hostName}`}</small>}
    {reserved && <small>{t('discovery.results.reservedUntil', undefined, { time: formatDateTime(reserved.expiresAt) })}</small>}
  </>;
}

const probeSummary = (result: DiscoveryResult, t: Translate) => {
  const icmp = result.icmpReachable ? (result.responseMs != null ? t('groupB.discovery.icmpRepliedIn', undefined, { ms: result.responseMs }) : t('groupB.discovery.icmpReplied')) : t('groupB.discovery.icmpNoReply');
  return result.openPorts?.length ? t('groupB.discovery.probeWithPorts', undefined, { icmp, ports: result.openPorts.join(', ') }) : icmp;
};
type Translate = ReturnType<typeof useUiText>;

type Props = {
  results: DiscoveryResult[];
  canEdit: boolean;
  review: (id: string, status: ReviewStatus) => Promise<void>;
  /** Applies the per-item outcome of a bulk review to the cached results. */
  bulkDone: (response: BulkReviewResponse) => void;
};

/** Probe results of one run: sortable table, per-row review and bulk approve/ignore (ADMIN / NETWORK_OPERATOR). */
export function DiscoveryResultsTable({ results, canEdit, review, bulkDone }: Props) {
  const t = useUiText();
  const table = useTableUrlState(resultsTableConfig);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ status: ReviewStatus; ids: string[] } | null>(null);
  // D-P2b: text search and response-type chips narrow the rows first; review/IPAM chips, sort and bulk selection apply on top.
  const tools = useDiscoveryResultsTools(results);
  const visibleResults = useMemo(() => applyChipFilters(tools.rows, table.filters, resultAccessors), [tools.rows, table.filters]);
  const reviewOptions = chipOptions(reviewChipLabels.map(([value, key]) => [value, t(key)] as const), facetCounts(tools.rows, table.filters, resultAccessors, 'Review'), { complete: true, selected: table.filters.Review });
  const ipamOptions = chipOptions(ipamChipLabels.map(([value, key]) => [value, t(key)] as const), facetCounts(tools.rows, table.filters, resultAccessors, 'Ipam'), { complete: true, selected: table.filters.Ipam, hideEmpty: true });
  // Only visible pending rows can stay selected, so a bulk action never touches rows hidden by a chip.
  const pendingIds = useMemo(() => new Set(visibleResults.filter((result) => result.status === 'PENDING').map((result) => result.id)), [visibleResults]);
  // Selection only keeps rows that are still pending (a row reviewed elsewhere drops out).
  const selectedIds = useMemo(() => [...selected].filter((id) => pendingIds.has(id)), [pendingIds, selected]);

  // D-P1a: the SNMP column appears only for runs that tried SNMP enrichment.
  const hasSnmp = useMemo(() => results.some((result) => result.snmp), [results]);
  // D-P1c: the identity column appears only when the API sends identity suggestions.
  const hasIdentity = useMemo(() => results.some((result) => result.identity), [results]);
  const columns = useMemo<DataTableColumn<DiscoveryResult>[]>(() => [
    { id: 'address', header: t('discovery.results.address'), sortValue: (result) => result.address.split(/[.:]/).map((part) => part.padStart(5, '0')).join('.'), cell: (result) => <strong className="mono">{result.address}</strong> },
    { id: 'hostname', header: 'Hostname', sortValue: (result) => result.hostname ?? null, cell: (result) => result.hostname || <span className="muted-cell">{t('discovery.results.reverseDnsNotFound')}</span> },
    { id: 'probe', header: t('discovery.results.probe'), cell: (result) => result.outcome ? <DiscoveryOutcomeCell outcome={result.outcome} /> : <small>{probeSummary(result, t)}</small> },
    ...(hasSnmp ? [{ id: 'snmp', header: 'SNMP', sortValue: (result: DiscoveryResult) => result.snmp?.fields.sysName?.value ?? null, cell: (result: DiscoveryResult) => <DiscoverySnmpCell snmp={result.snmp} /> }] : []),
    ...(hasIdentity ? [{ id: 'identity', header: t('discoveryIdentity.column'), sortValue: (result: DiscoveryResult) => identitySortValue(result.identity), cell: (result: DiscoveryResult) => <DiscoveryIdentityCell identity={result.identity} /> }] : []),
    { id: 'ipam', header: 'IPAM', sortValue: resultIpamState, cell: (result) => <DiscoveryIpamStatus ipam={result.ipam} /> },
    { id: 'status', header: t('discovery.results.revision'), sortValue: (result) => result.status, cell: (result) => <span className={`state-badge ${result.status === 'APPROVED' ? 'approved' : result.status === 'IGNORED' ? 'rejected' : 'pending'}`}><i />{result.status}</span> },
    ...(canEdit ? [{ id: 'actions', header: t('discovery.results.actions'), className: 'table-actions', cell: (result: DiscoveryResult) => result.status === 'PENDING' ? <><button className="secondary-button" aria-label={t('discovery.results.approveNamed', undefined, { address: result.address })} onClick={() => void review(result.id, 'APPROVED')}><Check size={13} /> {t('discovery.results.approve')}</button><button className="danger-button" aria-label={t('discovery.results.ignoreNamed', undefined, { address: result.address })} onClick={() => void review(result.id, 'IGNORED')}><X size={13} /> {t('discovery.results.ignore')}</button></> : <DiscoveryPromoteAction result={result} /> }] : []),
  ], [canEdit, hasIdentity, hasSnmp, review, t]);
  const rows = useMemo(() => sortByColumns(visibleResults, columns, table.sort), [columns, visibleResults, table.sort]);
  const byId = useMemo(() => new Map(results.map((result) => [result.id, result])), [results]);
  const tooMany = selectedIds.length > BULK_REVIEW_MAX;

  return <>
    {canEdit && <div className="table-actions" role="toolbar" aria-label={t('discovery.results.bulkReview')}>
      <span className="muted-cell">{selectedIds.length ? t('discovery.results.selectedCount', undefined, { count: selectedIds.length }) : t('discovery.results.selectPendingResultsToReview')}</span>
      <button className="secondary-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'APPROVED', ids: selectedIds })}><Check size={13} /> {t('discovery.results.approveSelected')}</button>
      <button className="danger-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'IGNORED', ids: selectedIds })}><X size={13} /> {t('discovery.results.ignoreSelected')}</button>
    </div>}
    {results.length > 0 && <div className="discovery-results-tools">{tools.searchField}<DiscoveryResultsCsvButton rows={rows} /></div>}
    {results.length > 0 && <FilterChipBar>
      <FilterChips label={t('discovery.results.revision')} value={table.filters.Review} options={reviewOptions} total={tools.rows.length} onChange={(value) => table.setFilter('Review', value)} />
      <FilterChips label="IPAM" value={table.filters.Ipam} options={ipamOptions} total={tools.rows.length} onChange={(value) => table.setFilter('Ipam', value)} />
      {tools.typeChips}
    </FilterChipBar>}
    {tooMany && <div className="ipam-alert warning" role="note">{t('groupB.discovery.bulkMax', undefined, { count: BULK_REVIEW_MAX })}</div>}
    <DataTable rows={rows} columns={columns} rowKey={(result) => result.id} label={t('discovery.results.probeResults')} sort={table.sort} onSortChange={table.setSort} defaultSort={table.defaultSort}
      selection={canEdit ? { selected: new Set(selectedIds), onChange: setSelected, isSelectable: (result) => result.status === 'PENDING', rowLabel: (result, selectable) => t(selectable ? 'groupB.discovery.selectRow' : 'groupB.discovery.rowReviewed', undefined, { address: result.address }), allLabel: t('discovery.results.selectAllPendingResults') } : undefined}
      empty={<div className="no-data">{results.length ? t('discovery.results.noResultsMatchTheseFilters') : t('discovery.results.thereAreNoReachableResults')}</div>} />
    {bulk && <BulkReviewDialog
      title={t(bulk.status === 'APPROVED' ? 'groupB.discovery.bulkApproveTitle' : 'groupB.discovery.bulkIgnoreTitle')}
      actionLabel={t(bulk.status === 'APPROVED' ? 'groupB.discovery.approve' : 'groupB.common.ignore')}
      noun={t('groupB.discovery.noun')}
      items={bulk.ids.map((id) => { const result = byId.get(id); return { id, label: result?.address ?? id, detail: result?.hostname ?? undefined }; })}
      run={() => bulkReviewDiscoveryResults(bulk.ids, bulk.status)}
      onDone={(response) => { bulkDone(response); setSelected(new Set()); }}
      close={() => setBulk(null)} />}
  </>;
}
