'use client';

import { useMemo, type ReactNode } from 'react';
import { Check, Search } from 'lucide-react';
import { CsvExportButton, useTableUrlState, type CsvColumn, type TableStateConfig } from '@/components/data-table';
import { FilterChips } from '@/components/ui/filter-chips';
import { useUiText } from '@/components/ui/use-ui-text';
import { chipOptions, countBy } from '@/lib/filter-chips';
import type { DiscoveryComparisonItem, DiscoveryResult } from './api';
import { DiscoveryPromoteAction } from './discovery-promote';

/** D-P2b: what answered the probes for one address. */
export type DiscoveryResponseType = 'ICMP_TCP' | 'ICMP' | 'TCP' | 'NONE';

export function discoveryResponseType(result: Pick<DiscoveryResult, 'icmpReachable' | 'openPorts'>): DiscoveryResponseType {
  const tcp = Boolean(result.openPorts?.length);
  if (result.icmpReachable) return tcp ? 'ICMP_TCP' : 'ICMP';
  return tcp ? 'TCP' : 'NONE';
}

/** Every word must appear in the address, hostname, open ports, review state, IPAM state/host or linked device. */
export function matchesDiscoveryResultSearch(result: DiscoveryResult, query: string): boolean {
  const terms = query.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const text = [result.address, result.hostname, result.status, result.ipam?.state, result.ipam?.hostName, result.device?.name, ...(result.openPorts ?? []).map(String)]
    .filter(Boolean).join(' ').toLowerCase();
  return terms.every((term) => text.includes(term));
}

/** Search in `?probeSearch=`, response type in `?probeType=`: own keys, so the table's `results*` sort and chips are never rewritten. */
const toolsConfig: TableStateConfig<{ Type: string }> = { filters: { Type: '' }, sortable: [], prefix: 'probe', searchKey: 'Search' };
const responseTypes: DiscoveryResponseType[] = ['ICMP_TCP', 'ICMP', 'TCP', 'NONE'];

/**
 * D-P2b: text search and the response-type chips for one run's results. `rows` is what the results table
 * should work on (its review/IPAM chips, sort and bulk selection then apply on top).
 */
export function useDiscoveryResultsTools(results: DiscoveryResult[]): { rows: DiscoveryResult[]; searchField: ReactNode; typeChips: ReactNode } {
  const t = useUiText();
  const state = useTableUrlState(toolsConfig);
  const searched = useMemo(() => results.filter((result) => matchesDiscoveryResultSearch(result, state.search)), [results, state.search]);
  const type = state.filters.Type;
  const rows = useMemo(() => (type ? searched.filter((result) => discoveryResponseType(result) === type) : searched), [searched, type]);
  const labels = responseTypes.map((value) => [value, t(`discoveryResults.type.${value}`)] as const);
  const options = chipOptions(labels, countBy(searched, discoveryResponseType), { complete: true, selected: type, hideEmpty: true });
  const searchField = <label className="discovery-results-search">
    <Search size={14} aria-hidden="true" />
    <input type="search" value={state.search} onChange={(event) => state.setSearch(event.target.value)} placeholder={t('discoveryResults.searchPlaceholder')} aria-label={t('discoveryResults.search')} />
  </label>;
  const typeChips = <FilterChips label={t('discoveryResults.typeLabel')} value={type} options={options} total={searched.length} onChange={(value) => state.setFilter('Type', value)} />;
  return { rows, searchField, typeChips };
}

/** CSV columns of a results export (the filtered, sorted rows on screen). */
export function discoveryResultsCsvColumns(t: (key: string, fallback?: string, params?: Record<string, string | number>) => string): CsvColumn<DiscoveryResult>[] {
  return [
    { header: t('discoveryResults.csv.address'), value: (result) => result.address },
    { header: t('discoveryResults.csv.hostname'), value: (result) => result.hostname ?? '' },
    { header: t('discoveryResults.csv.type'), value: (result) => t(`discoveryResults.type.${discoveryResponseType(result)}`) },
    { header: t('discoveryResults.csv.icmp'), value: (result) => t(result.icmpReachable ? 'discoveryResults.csv.yes' : 'discoveryResults.csv.no') },
    { header: t('discoveryResults.csv.responseMs'), value: (result) => result.responseMs ?? '' },
    { header: t('discoveryResults.csv.openPorts'), value: (result) => (result.openPorts ?? []).join(' ') },
    { header: t('discoveryResults.csv.ipam'), value: (result) => (result.ipam ? (result.ipam.activeReservation ? 'RESERVED' : result.ipam.state) : '') },
    { header: t('discoveryResults.csv.ipamHost'), value: (result) => result.ipam?.hostName ?? '' },
    { header: t('discoveryResults.csv.review'), value: (result) => result.status },
  ];
}

export function DiscoveryResultsCsvButton({ rows }: { rows: DiscoveryResult[] }) {
  const t = useUiText();
  const columns = useMemo(() => discoveryResultsCsvColumns(t), [t]);
  return <CsvExportButton rows={rows} columns={columns} fileName={t('discoveryResults.csv.fileName')} label={t('discoveryResults.exportCsv', undefined, { count: rows.length })} />;
}

/**
 * D-P2b: approve a newly seen or changed address straight from the comparison list. The comparison's current run is
 * the selected run, so its row is found by address among that run's results. Reviewed rows show their state instead,
 * and approved ones also get "Promover a equipamento" (D-P1b follow-up).
 */
export function DiscoveryComparisonApprove({ item, results, review }: { item: DiscoveryComparisonItem; results: DiscoveryResult[]; review: (id: string, status: 'APPROVED' | 'IGNORED') => Promise<void> }) {
  const t = useUiText();
  const result = item.current ? results.find((candidate) => candidate.address === item.address) : undefined;
  if (!result) return null;
  if (result.status !== 'PENDING') {
    const badge = <span className={`state-badge ${result.status === 'APPROVED' ? 'approved' : 'rejected'}`}><i />{t(`discoveryResults.review.${result.status}`, result.status)}</span>;
    // An approved address can be promoted to a device from here too (same check and create flow as the results table).
    return result.status === 'APPROVED' ? <span className="discovery-comparison-approved">{badge}<DiscoveryPromoteAction result={result} /></span> : badge;
  }
  return <span className="result-actions"><button type="button" aria-label={t('discoveryResults.approveFor', undefined, { address: result.address })} onClick={() => void review(result.id, 'APPROVED')}><Check size={13} aria-hidden="true" /> {t('discoveryResults.approve')}</button></span>;
}
