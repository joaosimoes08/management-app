'use client';

import { useMemo, useState } from 'react';
import { Check, X } from 'lucide-react';
import { DataTable, sortByColumns, useTableUrlState, type DataTableColumn, type TableStateConfig } from '@/components/data-table';
import { BULK_REVIEW_MAX, BulkReviewDialog, type BulkReviewResponse } from '@/components/ui/bulk-review-dialog';
import { formatDateTime } from '@/lib/format/date';
import { bulkReviewDiscoveryResults, type DiscoveryResult, type DiscoveryResultIpam } from './api';

type ReviewStatus = 'APPROVED' | 'IGNORED';

const resultsTableConfig: TableStateConfig<Record<string, string>> = {
  filters: {},
  sortable: ['address', 'hostname', 'ipam', 'status'],
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

const ipamTone: Record<string, string> = { FREE: 'free', OCCUPIED: 'occupied', RESERVED: 'reserved', EXCLUDED: 'excluded' };

/** IPAM status of a discovered address; unknown states render as a neutral badge. */
export function DiscoveryIpamStatus({ ipam }: { ipam?: DiscoveryResultIpam | null }) {
  if (!ipam) return <span className="muted-cell">Não registado no IPAM</span>;
  const reserved = ipam.activeReservation;
  return <>
    <span className={`state-badge ${reserved ? 'reserved' : ipamTone[ipam.state] ?? ''}`.trim()}><i />{reserved ? 'RESERVED' : ipam.state}</span>
    {ipam.hostName && <small>{`Host ${ipam.hostName}`}</small>}
    {reserved && <small>{`Reservado até ${formatDateTime(reserved.expiresAt)}`}</small>}
  </>;
}

const probeSummary = (result: DiscoveryResult) => `${result.icmpReachable ? `ICMP respondeu${result.responseMs != null ? ` em ${result.responseMs}ms` : ''}` : 'Sem resposta ICMP'}${result.openPorts?.length ? ` · Ligação TCP aceite na(s) porta(s) ${result.openPorts.join(', ')}` : ''}`;

type Props = {
  results: DiscoveryResult[];
  canEdit: boolean;
  review: (id: string, status: ReviewStatus) => Promise<void>;
  /** Applies the per-item outcome of a bulk review to the cached results. */
  bulkDone: (response: BulkReviewResponse) => void;
};

/** Probe results of one run: sortable table, per-row review and bulk approve/ignore (ADMIN / NETWORK_OPERATOR). */
export function DiscoveryResultsTable({ results, canEdit, review, bulkDone }: Props) {
  const table = useTableUrlState(resultsTableConfig);
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ status: ReviewStatus; ids: string[] } | null>(null);
  const pendingIds = useMemo(() => new Set(results.filter((result) => result.status === 'PENDING').map((result) => result.id)), [results]);
  // Selection only keeps rows that are still pending (a row reviewed elsewhere drops out).
  const selectedIds = useMemo(() => [...selected].filter((id) => pendingIds.has(id)), [pendingIds, selected]);

  const columns = useMemo<DataTableColumn<DiscoveryResult>[]>(() => [
    { id: 'address', header: 'Endereço', sortValue: (result) => result.address.split(/[.:]/).map((part) => part.padStart(5, '0')).join('.'), cell: (result) => <strong className="mono">{result.address}</strong> },
    { id: 'hostname', header: 'Hostname', sortValue: (result) => result.hostname ?? null, cell: (result) => result.hostname || <span className="muted-cell">reverse DNS não encontrado</span> },
    { id: 'probe', header: 'Sonda', cell: (result) => <small>{probeSummary(result)}</small> },
    { id: 'ipam', header: 'IPAM', sortValue: (result) => result.ipam ? (result.ipam.activeReservation ? 'RESERVED' : result.ipam.state) : null, cell: (result) => <DiscoveryIpamStatus ipam={result.ipam} /> },
    { id: 'status', header: 'Revisão', sortValue: (result) => result.status, cell: (result) => <span className={`state-badge ${result.status === 'APPROVED' ? 'approved' : result.status === 'IGNORED' ? 'rejected' : 'pending'}`}><i />{result.status}</span> },
    ...(canEdit ? [{ id: 'actions', header: 'Ações', className: 'table-actions', cell: (result: DiscoveryResult) => result.status === 'PENDING' ? <><button className="secondary-button" aria-label={`Aprovar ${result.address}`} onClick={() => void review(result.id, 'APPROVED')}><Check size={13} /> Aprovar</button><button className="danger-button" aria-label={`Ignorar ${result.address}`} onClick={() => void review(result.id, 'IGNORED')}><X size={13} /> Ignorar</button></> : null }] : []),
  ], [canEdit, review]);
  const rows = useMemo(() => sortByColumns(results, columns, table.sort), [columns, results, table.sort]);
  const byId = useMemo(() => new Map(results.map((result) => [result.id, result])), [results]);
  const tooMany = selectedIds.length > BULK_REVIEW_MAX;

  return <>
    {canEdit && <div className="table-actions" role="toolbar" aria-label="Revisão em massa">
      <span className="muted-cell">{selectedIds.length ? `${selectedIds.length} selecionados` : 'Seleciona resultados pendentes para rever em massa.'}</span>
      <button className="secondary-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'APPROVED', ids: selectedIds })}><Check size={13} /> Aprovar selecionados</button>
      <button className="danger-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'IGNORED', ids: selectedIds })}><X size={13} /> Ignorar selecionados</button>
    </div>}
    {tooMany && <div className="ipam-alert warning" role="note">{`Seleciona no máximo ${BULK_REVIEW_MAX} resultados por pedido.`}</div>}
    <DataTable rows={rows} columns={columns} rowKey={(result) => result.id} label="Resultados de sondas" sort={table.sort} onSortChange={table.setSort} defaultSort={table.defaultSort}
      selection={canEdit ? { selected: new Set(selectedIds), onChange: setSelected, isSelectable: (result) => result.status === 'PENDING', rowLabel: (result, selectable) => selectable ? `Selecionar ${result.address}` : `${result.address} já revisto`, allLabel: 'Selecionar todos os resultados pendentes' } : undefined}
      empty={<div className="no-data">Não existem resultados alcançáveis para esta execução.</div>} />
    {bulk && <BulkReviewDialog
      title={bulk.status === 'APPROVED' ? 'Aprovar resultados selecionados' : 'Ignorar resultados selecionados'}
      actionLabel={bulk.status === 'APPROVED' ? 'Aprovar' : 'Ignorar'}
      noun="resultados"
      items={bulk.ids.map((id) => { const result = byId.get(id); return { id, label: result?.address ?? id, detail: result?.hostname ?? undefined }; })}
      run={() => bulkReviewDiscoveryResults(bulk.ids, bulk.status)}
      onDone={(response) => { bulkDone(response); setSelected(new Set()); }}
      close={() => setBulk(null)} />}
  </>;
}
