'use client';

import { useMemo, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, ChevronLeft, ChevronRight, X } from 'lucide-react';
import { DataTable, sortByColumns, useTableUrlState, type DataTableColumn, type TableStateConfig } from '@/components/data-table';
import { BULK_REVIEW_MAX, BulkReviewDialog } from '@/components/ui/bulk-review-dialog';
import { formatDateTime } from '@/lib/format/date';
import { bulkReviewSnmpDrifts, listSnmpDrifts, reviewSnmpDrift, type SnmpFleetDrift } from './api';

type ReviewStatus = 'ACCEPTED' | 'IGNORED';

export const SNMP_DRIFT_PAGE_SIZE = 100;

const driftTableConfig: TableStateConfig<{ status: string }> = {
  filters: { status: 'PENDING' },
  sortable: ['device', 'field', 'status', 'createdAt'],
  defaultSort: { column: 'createdAt', direction: 'desc' },
  prefix: 'drifts',
};

export const driftStatusOptions: Array<[string, string]> = [
  ['PENDING', 'Pendentes'],
  ['ACCEPTED', 'Aceites'],
  ['IGNORED', 'Ignoradas'],
  ['ALL', 'Todas'],
];
const statusParam = (value: string) => value === 'ALL' ? 'PENDING,ACCEPTED,IGNORED' : value || 'PENDING';
const statusTone: Record<string, string> = { PENDING: 'pending', ACCEPTED: 'approved', IGNORED: 'rejected' };

/** Drift values are JSON: strings as-is, empty as "—", anything else serialised. */
export function formatDriftValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try { return JSON.stringify(value); } catch { return String(value); }
}

type Props = { siteId: string; canReview: boolean; openDevice: (deviceId: string) => void };

/** SNMP drifts across the Site's devices, with per-row and bulk accept/ignore (ADMIN / NETWORK_OPERATOR). */
export function SnmpDriftsView({ siteId, canReview, openDevice }: Props) {
  const queryClient = useQueryClient();
  const table = useTableUrlState(driftTableConfig);
  const status = table.filters.status;
  const [page, setPage] = useState(1);
  const [pageKey, setPageKey] = useState(`${siteId}|${status}`);
  // Back to the first page whenever the Site or the status filter changes.
  if (pageKey !== `${siteId}|${status}`) { setPageKey(`${siteId}|${status}`); setPage(1); }
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [bulk, setBulk] = useState<{ status: ReviewStatus; ids: string[] } | null>(null);
  const [error, setError] = useState('');
  const { data, error: loadError, isLoading } = useQuery({
    queryKey: ['snmp', 'drifts', siteId, status, page],
    queryFn: () => listSnmpDrifts({ siteId: siteId || undefined, status: statusParam(status), page, pageSize: SNMP_DRIFT_PAGE_SIZE }),
    retry: false,
  });
  const items = useMemo(() => data?.items ?? [], [data]);
  const pendingIds = useMemo(() => new Set(items.filter((item) => item.status === 'PENDING').map((item) => item.id)), [items]);
  const selectedIds = useMemo(() => [...selected].filter((id) => pendingIds.has(id)), [pendingIds, selected]);
  const byId = useMemo(() => new Map(items.map((item) => [item.id, item])), [items]);
  const tooMany = selectedIds.length > BULK_REVIEW_MAX;
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['snmp'] });

  const columns = useMemo<DataTableColumn<SnmpFleetDrift>[]>(() => {
    const review = async (id: string, next: ReviewStatus) => {
      setError('');
      try { await reviewSnmpDrift(id, next); await queryClient.invalidateQueries({ queryKey: ['snmp'] }); }
      catch (cause) { setError(cause instanceof Error && cause.message ? cause.message : 'Não foi possível rever a divergência.'); }
    };
    return [
      { id: 'device', header: 'Equipamento', sortValue: (drift) => drift.device?.name ?? null, cell: (drift) => <>{drift.device ? <button type="button" className="link-button" onClick={() => openDevice(drift.device!.id)}><strong>{drift.device.name}</strong></button> : <span className="muted-cell">—</span>}{drift.interface ? <small>{`Interface ${drift.interface.name}`}</small> : null}</> },
      { id: 'field', header: 'Campo', sortValue: (drift) => drift.field, cell: (drift) => <span className="mono">{drift.field}</span> },
      { id: 'values', header: 'Documentado → Observado', cell: (drift) => <>{`${formatDriftValue(drift.documentedValue)} → ${formatDriftValue(drift.observedValue)}`}</> },
      { id: 'status', header: 'Estado', sortValue: (drift) => drift.status, cell: (drift) => <><span className={`state-badge ${statusTone[drift.status] ?? ''}`.trim()}><i />{drift.status}</span>{drift.reviewedAt ? <small>{`Revista em ${formatDateTime(drift.reviewedAt)}`}</small> : null}</> },
      { id: 'createdAt', header: 'Detetada', sortValue: (drift) => drift.createdAt, cell: (drift) => formatDateTime(drift.createdAt) },
      ...(canReview ? [{ id: 'actions', header: 'Ações', className: 'table-actions', cell: (drift: SnmpFleetDrift) => drift.status === 'PENDING' ? <><button type="button" className="secondary-button" aria-label={`Aceitar ${drift.field} de ${drift.device?.name ?? drift.id}`} onClick={() => void review(drift.id, 'ACCEPTED')}><Check size={13} /> Aceitar</button><button type="button" className="danger-button" aria-label={`Ignorar ${drift.field} de ${drift.device?.name ?? drift.id}`} onClick={() => void review(drift.id, 'IGNORED')}><X size={13} /> Ignorar</button></> : null }] : []),
    ];
  }, [canReview, openDevice, queryClient]);
  const rows = useMemo(() => sortByColumns(items, columns, table.sort), [columns, items, table.sort]);
  const totalPages = Math.max(1, data?.totalPages ?? 1);

  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>Divergências SNMP</h2><p className="panel-description">Diferenças entre o inventário documentado e o que o polling observou, em todos os equipamentos do Site.</p></div>
      <label className="interface-toolbar-controls">Estado<select aria-label="Filtrar divergências por estado" value={status} onChange={(event) => { setSelected(new Set()); table.setFilter('status', event.target.value); }}>{driftStatusOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label></div>
    {loadError && <div className="ipam-alert error" role="alert"><X size={15} />{loadError instanceof Error && loadError.message ? loadError.message : 'Não foi possível carregar as divergências.'}</div>}
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    {canReview && <div className="table-actions" role="toolbar" aria-label="Revisão em massa">
      <span className="muted-cell">{selectedIds.length ? `${selectedIds.length} selecionadas` : 'Seleciona divergências pendentes para rever em massa.'}</span>
      <button type="button" className="secondary-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'ACCEPTED', ids: selectedIds })}><Check size={13} /> Aceitar selecionadas</button>
      <button type="button" className="danger-button" disabled={!selectedIds.length || tooMany} onClick={() => setBulk({ status: 'IGNORED', ids: selectedIds })}><X size={13} /> Ignorar selecionadas</button>
    </div>}
    {tooMany && <div className="ipam-alert warning" role="note">{`Seleciona no máximo ${BULK_REVIEW_MAX} divergências por pedido.`}</div>}
    <DataTable rows={rows} columns={columns} rowKey={(drift) => drift.id} label="Divergências SNMP" sort={table.sort} onSortChange={table.setSort} defaultSort={table.defaultSort} loading={isLoading}
      selection={canReview ? { selected: new Set(selectedIds), onChange: setSelected, isSelectable: (drift) => drift.status === 'PENDING', rowLabel: (drift, selectable) => selectable ? `Selecionar ${drift.field} de ${drift.device?.name ?? drift.id}` : `${drift.field} de ${drift.device?.name ?? drift.id} já revista`, allLabel: 'Selecionar todas as divergências pendentes' } : undefined}
      empty={<div className="no-data">Sem divergências para este filtro.</div>} />
    {data && (data.totalPages > 1 || page > 1) && <div className="group-member-pagination">
      <button type="button" aria-label="Página anterior" disabled={page <= 1} onClick={() => setPage(page - 1)}><ChevronLeft size={15} /></button>
      <span>{`${page} / ${totalPages} · ${data.total} divergências`}</span>
      <button type="button" aria-label="Página seguinte" disabled={page >= totalPages} onClick={() => setPage(page + 1)}><ChevronRight size={15} /></button>
    </div>}
    {bulk && <BulkReviewDialog
      title={bulk.status === 'ACCEPTED' ? 'Aceitar divergências selecionadas' : 'Ignorar divergências selecionadas'}
      actionLabel={bulk.status === 'ACCEPTED' ? 'Aceitar' : 'Ignorar'}
      noun="divergências"
      items={bulk.ids.map((id) => { const drift = byId.get(id); return { id, label: drift ? `${drift.device?.name ?? '—'} · ${drift.field}` : id, detail: drift ? `${formatDriftValue(drift.documentedValue)} → ${formatDriftValue(drift.observedValue)}` : undefined }; })}
      run={() => bulkReviewSnmpDrifts(bulk.ids, bulk.status)}
      onDone={() => { setSelected(new Set()); void refresh(); }}
      close={() => setBulk(null)} />}
  </section>;
}
