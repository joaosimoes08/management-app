'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, Eye, RefreshCw, X } from 'lucide-react';
import { AppShell, PageToolbarPortal, ToolbarMore } from '@/components/layout/app-shell';
import { DataTable, EntityLink, SavedViews, csvFileName, useTableUrlState, type DataTableColumn } from '@/components/data-table';
import { formatDateTime } from '@/lib/format/date';
import { exportAuditCsv, facetWindowDays, getAuditFacets, getAuditPage, type AuditPageEvent } from './api';
import { actorName, auditEntityRef, auditQueryFrom, auditTableConfig, dayBoundary, formatAuditValue, hasAuditFilters, metadataEntries } from './workspace';

const dateTime = (value: string) => formatDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });

/** The search box writes the URL on every key; the server is asked once typing pauses. */
function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return current;
}

function EntityCell({ event }: { event: AuditPageEvent }) {
  const ref = auditEntityRef(event);
  return <span>
    <strong>{event.entityType ?? 'Sistema'}</strong>
    {ref ? <small><EntityLink {...ref} /></small> : event.entityId ? <small className="mono">{event.entityId}</small> : null}
  </span>;
}

export default function AuditPage() {
  const table = useTableUrlState(auditTableConfig);
  const { search, filters, setSearch, setFilter, clearFilters } = table;
  const debouncedSearch = useDebounced(search);
  const query = useMemo(() => auditQueryFrom(debouncedSearch, filters), [debouncedSearch, filters]);
  const filtering = hasAuditFilters(search, filters);
  const [exporting, setExporting] = useState(false);
  const [notice, setNotice] = useState<{ tone: 'success' | 'error'; text: string } | null>(null);
  const panelClose = useRef<HTMLButtonElement>(null);

  const pages = useInfiniteQuery({
    queryKey: ['audit', 'page', query],
    queryFn: ({ pageParam }) => getAuditPage(query, pageParam),
    initialPageParam: null as string | null,
    getNextPageParam: (last) => (last.hasMore ? last.nextCursor : undefined),
  });
  const facets = useQuery({
    queryKey: ['audit', 'facets', filters.from, filters.to],
    queryFn: () => getAuditFacets({ from: dayBoundary(filters.from, 'start'), to: dayBoundary(filters.to, 'end') }),
  });
  const events = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  const detail = filters.event ? events.find((event) => event.id === filters.event) ?? null : null;
  const errorMessage = pages.error instanceof Error ? pages.error.message : '';

  const detailOpen = Boolean(detail);
  useEffect(() => {
    if (!detailOpen) return;
    panelClose.current?.focus();
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') setFilter('event', ''); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [detailOpen, setFilter]);

  const openDetail = (event: AuditPageEvent) => setFilter('event', event.id, { replace: Boolean(filters.event) });
  const closeDetail = () => setFilter('event', '');

  const download = async () => {
    setExporting(true); setNotice(null);
    try {
      const result = await exportAuditCsv(query, csvFileName('auditoria'));
      setNotice({ tone: 'success', text: result.rows === null ? 'CSV exportado.' : result.truncated ? `CSV exportado com ${result.rows} eventos (limite de 10 000). Reduz o período para exportar o resto.` : `CSV exportado com ${result.rows} eventos.` });
    } catch (cause) { setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : 'Não foi possível exportar o CSV.' }); }
    finally { setExporting(false); }
  };

  const columns: DataTableColumn<AuditPageEvent>[] = [
    { id: 'createdAt', header: 'Data e hora', cell: (event) => <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time> },
    { id: 'action', header: 'Ação', cell: (event) => <button type="button" className="link-button" aria-label={`Ver detalhe de ${event.action}`} onClick={() => openDetail(event)}>{event.action}</button> },
    { id: 'entity', header: 'Registo', cell: (event) => <EntityCell event={event} /> },
    { id: 'actor', header: 'Utilizador', cell: (event) => actorName(event) },
    { id: 'ip', header: 'IP', cell: (event) => (event.ipAddress ? <span className="mono">{event.ipAddress}</span> : <span className="muted-cell">—</span>) },
    { id: 'diff', header: 'Antes → depois', cell: (event) => (event.hasDiff ? <span className="state-badge approved"><i />Registado</span> : <span className="muted-cell">Sem registo</span>) },
    { id: 'open', header: <span className="topology-sr-only">Detalhe</span>, cell: (event) => <button type="button" className="icon-button" aria-label={`Abrir detalhe de ${event.action}`} aria-pressed={filters.event === event.id} onClick={() => openDetail(event)}><Eye size={14} /></button> },
  ];

  const count = events.length;
  const facetDays = !filters.from && !filters.to ? facetWindowDays(facets.data) : null;
  const countLabel = pages.hasNextPage ? `${count} eventos carregados` : `${count} eventos`;

  return <AppShell section="Auditoria" search={{ value: search, onChange: setSearch, placeholder: 'Pesquisar ação, registo, IP ou utilizador…', ariaLabel: 'Pesquisar eventos de auditoria', scopeLabel: 'Auditoria' }} actions={<><ToolbarMore label="Filtros"><div className="audit-filters">
    <label>Utilizador<select aria-label="Filtrar por utilizador" value={filters.actor} onChange={(event) => setFilter('actor', event.target.value)}><option value="">Todos</option>{(facets.data?.actors ?? []).map((actor) => <option key={actor.id} value={actor.id}>{`${actor.displayName || actor.username} (${actor.count})`}</option>)}</select></label>
    <label>Tipo de registo<select aria-label="Filtrar por tipo de registo" value={filters.entityType} onChange={(event) => setFilter('entityType', event.target.value)}><option value="">Todos</option>{(facets.data?.entityTypes ?? []).map((item) => <option key={item.value} value={item.value}>{`${item.value} (${item.count})`}</option>)}</select></label>
    <label>Ação<select aria-label="Filtrar por ação" value={filters.action} onChange={(event) => setFilter('action', event.target.value)}><option value="">Todas</option>{(facets.data?.actions ?? []).map((item) => <option key={item.value} value={item.value}>{`${item.value} (${item.count})`}</option>)}</select></label>
    <label>Desde<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label>
    <label>Até<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
    <label>Pedidos HTTP<select aria-label="Pedidos HTTP" value={filters.http} onChange={(event) => setFilter('http', event.target.value)}><option value="">Ocultar</option><option value="1">Mostrar</option></select></label>
  </div>{facetDays !== null && <p className="form-help">{`Valores dos últimos ${facetDays} dias`}</p>}</ToolbarMore>
    {filtering && <button className="topbar-action secondary-button" onClick={clearFilters}><X size={14} /> Limpar filtros</button>}
    <button className="topbar-action secondary-button" onClick={() => void download()} disabled={exporting || !count}><Download size={14} /> {exporting ? 'A exportar…' : 'Exportar CSV'}</button>
    <button className="topbar-action secondary-button" onClick={() => { void pages.refetch(); void facets.refetch(); }} disabled={pages.isFetching}><RefreshCw size={14} /> Atualizar</button>
  </>}>
    <PageToolbarPortal><SavedViews pageId="audit" config={auditTableConfig} table={table} /></PageToolbarPortal>
    <div className="module-page aligned-workspace"><section className="ipam-card page-primary-card">
      <div className="panel-heading"><div><h1>Auditoria</h1><p className="panel-description">Eventos administrativos, alterações de inventário e execuções de discovery, do mais recente para o mais antigo.</p></div></div>
      {errorMessage && <div className="ipam-alert error" role="alert">{errorMessage}</div>}
      {notice && <div className={`ipam-alert ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {facets.data?.truncated && <div className="ipam-alert warning" role="note">As listas de filtros foram limitadas a 500 valores. Escolhe um período para as reduzir.</div>}
      <h2 className="critical-assets-count" aria-live="polite">{countLabel}</h2>
      <DataTable
        rows={events}
        columns={columns}
        rowKey={(event) => event.id}
        label="Eventos de auditoria"
        loading={pages.isLoading}
        empty={errorMessage ? null : <div className="no-data">{filtering ? 'Sem eventos correspondentes.' : 'Ainda não existem eventos de auditoria.'}</div>}
      />
      {pages.hasNextPage && <div className="form-actions"><button type="button" className="secondary-button" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? 'A carregar…' : 'Carregar mais'}</button></div>}
    </section></div>

    {detail && <aside className="host-panel" aria-label={`Detalhe de ${detail.action}`}>
      <div className="host-panel-head"><div><span className="section-kicker">EVENTO DE AUDITORIA</span><h2>{detail.action}</h2><span>{`${dateTime(detail.createdAt)} · ${actorName(detail)}`}</span></div><button ref={panelClose} className="icon-button" onClick={closeDetail} aria-label="Fechar"><X size={18} /></button></div>
      <div className="host-detail-grid">
        <div><span>Tipo de registo</span><strong>{detail.entityType ?? 'Sistema'}</strong></div>
        <div><span>Registo</span><strong className="mono">{detail.entityId || '—'}</strong></div>
        <div><span>Utilizador</span><strong>{detail.user ? `${actorName(detail)} (${detail.user.username})` : 'Sistema'}</strong></div>
        <div><span>Endereço IP</span><strong className="mono">{detail.ipAddress || '—'}</strong></div>
      </div>
      {(() => { const ref = auditEntityRef(detail); return ref ? <div className="form-actions"><EntityLink {...ref} className="secondary-button">Abrir registo</EntityLink><EntityLink kind="audit" id={detail.entityId ?? ''} label="" className="secondary-button">Histórico deste registo</EntityLink></div> : detail.entityId ? <div className="form-actions"><EntityLink kind="audit" id={detail.entityId} label="" className="secondary-button">Histórico deste registo</EntityLink></div> : null; })()}
      <section className="host-section">
        <h3>Antes → depois</h3>
        {detail.diff?.length
          ? <div className="ip-table-wrap" role="region" aria-label="Valores antes e depois" tabIndex={0}><table className="ip-table">
            <thead><tr><th scope="col">Campo</th><th scope="col">Antes</th><th scope="col">Depois</th></tr></thead>
            <tbody>{detail.diff.map((entry) => <tr key={entry.field}><td>{entry.field}</td><td className="mono">{formatAuditValue(entry.before)}</td><td className="mono">{formatAuditValue(entry.after)}</td></tr>)}</tbody>
          </table></div>
          : <p className="panel-description">Este evento não guardou os valores anteriores, por isso não há antes → depois. Mostram-se os dados registados.</p>}
      </section>
      <section className="host-section">
        <h3>Dados registados</h3>
        {(() => { const entries = metadataEntries(detail.metadata, Boolean(detail.diff?.length)); return entries.length
          ? <div className="host-detail-grid">{entries.map(([key, value]) => <div key={key}><span>{key}</span><strong className="mono">{value}</strong></div>)}</div>
          : <p className="panel-description">Sem dados adicionais.</p>; })()}
      </section>
    </aside>}
  </AppShell>;
}
