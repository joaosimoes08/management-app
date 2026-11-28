'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useInfiniteQuery, useQuery } from '@tanstack/react-query';
import { Download, Eye, RefreshCw, X } from 'lucide-react';
import { PageShell, PageToolbarPortal, ToolbarMore } from '@/components/layout/app-shell';
import { DataTable, EntityLink, SavedViews, csvFileName, useTableUrlState, type DataTableColumn } from '@/components/data-table';
import { formatDateTime } from '@/lib/format/date';
import { exportAuditCsv, facetWindowDays, getAuditFacets, getAuditPage, type AuditPageEvent } from './api';
import { actorName, auditEntityRef, auditQueryFrom, auditTableConfig, dayBoundary, formatAuditValue, hasAuditFilters, metadataEntries } from './workspace';
import { useUiText } from '@/components/ui/use-ui-text';

const dateTime = (value: string) => formatDateTime(value, { dateStyle: 'short', timeStyle: 'medium' });

/** The search box writes the URL on every key; the server is asked once typing pauses. */
function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return current;
}

function EntityCell({ event }: { event: AuditPageEvent }) {
  const tx = useUiText();
  const ref = auditEntityRef(event);
  return <span>
    <strong>{event.entityType ?? tx('audit.system')}</strong>
    {ref ? <small><EntityLink {...ref} /></small> : event.entityId ? <small className="mono">{event.entityId}</small> : null}
  </span>;
}

export default function AuditPage() {
  const tx = useUiText();
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
      setNotice({ tone: 'success', text: result.rows === null ? tx('audit.csvExported') : result.truncated ? tx('groupB.audit.csvTruncated', undefined, { count: result.rows }) : tx('groupB.audit.csvRows', undefined, { count: result.rows }) });
    } catch (cause) { setNotice({ tone: 'error', text: cause instanceof Error ? cause.message : tx('audit.csvExportError') }); }
    finally { setExporting(false); }
  };

  const columns: DataTableColumn<AuditPageEvent>[] = [
    { id: 'createdAt', header: tx('audit.column.createdAt'), cell: (event) => <time dateTime={event.createdAt}>{dateTime(event.createdAt)}</time> },
    { id: 'action', header: tx('audit.column.action'), cell: (event) => <button type="button" className="link-button" aria-label={tx('audit.viewDetail', undefined, { action: event.action })} onClick={() => openDetail(event)}>{event.action}</button> },
    { id: 'entity', header: tx('audit.column.entity'), cell: (event) => <EntityCell event={event} /> },
    { id: 'actor', header: tx('audit.column.actor'), cell: (event) => actorName(event, tx) },
    { id: 'ip', header: 'IP', cell: (event) => (event.ipAddress ? <span className="mono">{event.ipAddress}</span> : <span className="muted-cell">—</span>) },
    { id: 'diff', header: tx('audit.column.diff'), cell: (event) => (event.hasDiff ? <span className="state-badge approved"><i />{tx('audit.diffRecorded')}</span> : <span className="muted-cell">{tx('audit.diffMissing')}</span>) },
    { id: 'open', header: <span className="topology-sr-only">{tx('audit.column.open')}</span>, cell: (event) => <button type="button" className="icon-button" aria-label={tx('audit.openDetail', undefined, { action: event.action })} aria-pressed={filters.event === event.id} onClick={() => openDetail(event)}><Eye size={14} /></button> },
  ];

  const count = events.length;
  const facetDays = !filters.from && !filters.to ? facetWindowDays(facets.data) : null;
  const countLabel = pages.hasNextPage ? tx('audit.countLoaded', undefined, { count }) : tx('audit.count', undefined, { count });

  return <PageShell section={tx('audit.section')} search={{ value: search, onChange: setSearch, placeholder: tx('audit.search.placeholder'), ariaLabel: tx('audit.search.label'), scopeLabel: tx('audit.section') }} actions={<><ToolbarMore label={tx('audit.filters')}><div className="audit-filters">
    <label>{tx('audit.column.actor')}<select aria-label={tx('audit.filter.actor')} value={filters.actor} onChange={(event) => setFilter('actor', event.target.value)}><option value="">{tx('audit.filter.allMasculine')}</option>{(facets.data?.actors ?? []).map((actor) => <option key={actor.id} value={actor.id}>{`${actor.displayName || actor.username} (${actor.count})`}</option>)}</select></label>
    <label>{tx('audit.filter.entityTypeLabel')}<select aria-label={tx('audit.filter.entityType')} value={filters.entityType} onChange={(event) => setFilter('entityType', event.target.value)}><option value="">{tx('audit.filter.allMasculine')}</option>{(facets.data?.entityTypes ?? []).map((item) => <option key={item.value} value={item.value}>{`${item.value} (${item.count})`}</option>)}</select></label>
    <label>{tx('audit.column.action')}<select aria-label={tx('audit.filter.action')} value={filters.action} onChange={(event) => setFilter('action', event.target.value)}><option value="">{tx('audit.filter.allFeminine')}</option>{(facets.data?.actions ?? []).map((item) => <option key={item.value} value={item.value}>{`${item.value} (${item.count})`}</option>)}</select></label>
    <label>{tx('audit.filter.from')}<input type="date" value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label>
    <label>{tx('audit.filter.to')}<input type="date" value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label>
    <label>{tx('audit.filter.http')}<select aria-label={tx('audit.filter.http')} value={filters.http} onChange={(event) => setFilter('http', event.target.value)}><option value="">{tx('audit.filter.hide')}</option><option value="1">{tx('audit.filter.show')}</option></select></label>
  </div>{facetDays !== null && <p className="form-help">{tx('audit.filter.facetDays', undefined, { days: facetDays })}</p>}</ToolbarMore>
    {filtering && <button className="topbar-action secondary-button" onClick={clearFilters}><X size={14} /> {tx('audit.clearFilters')}</button>}
    <button className="topbar-action secondary-button" onClick={() => void download()} disabled={exporting || !count}><Download size={14} /> {exporting ? tx('audit.exporting') : tx('audit.exportCsv')}</button>
    <button className="topbar-action secondary-button" onClick={() => { void pages.refetch(); void facets.refetch(); }} disabled={pages.isFetching}><RefreshCw size={14} /> {tx('audit.refresh')}</button>
  </>}>
    <PageToolbarPortal><SavedViews pageId="audit" config={auditTableConfig} table={table} /></PageToolbarPortal>
    <div className="module-page aligned-workspace"><section className="ipam-card page-primary-card">
      <div className="panel-heading"><div><h1>{tx('audit.section')}</h1><p className="panel-description">{tx('audit.description')}</p></div></div>
      {errorMessage && <div className="ipam-alert error" role="alert">{errorMessage}</div>}
      {notice && <div className={`ipam-alert ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.text}</div>}
      {facets.data?.truncated && <div className="ipam-alert warning" role="note">{tx('audit.facetsTruncated')}</div>}
      <h2 className="critical-assets-count" aria-live="polite">{countLabel}</h2>
      <DataTable
        rows={events}
        columns={columns}
        rowKey={(event) => event.id}
        label={tx('audit.table')}
        loading={pages.isLoading}
        empty={errorMessage ? null : <div className="no-data">{filtering ? tx('audit.emptyFiltered') : tx('audit.empty')}</div>}
      />
      {pages.hasNextPage && <div className="form-actions"><button type="button" className="secondary-button" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? tx('audit.loading') : tx('audit.loadMore')}</button></div>}
    </section></div>

    {detail && <aside className="host-panel" aria-label={tx('audit.detail.label', undefined, { action: detail.action })}>
      <div className="host-panel-head"><div><h2>{detail.action}</h2><span>{`${dateTime(detail.createdAt)} · ${actorName(detail, tx)}`}</span></div><button ref={panelClose} className="icon-button" onClick={closeDetail} aria-label={tx('audit.detail.close')}><X size={18} /></button></div>
      <div className="host-detail-grid">
        <div><span>{tx('audit.filter.entityTypeLabel')}</span><strong>{detail.entityType ?? tx('audit.system')}</strong></div>
        <div><span>{tx('audit.column.entity')}</span><strong className="mono">{detail.entityId || '—'}</strong></div>
        <div><span>{tx('audit.column.actor')}</span><strong>{detail.user ? `${actorName(detail, tx)} (${detail.user.username})` : tx('audit.system')}</strong></div>
        <div><span>{tx('audit.detail.ipAddress')}</span><strong className="mono">{detail.ipAddress || '—'}</strong></div>
      </div>
      {(() => { const ref = auditEntityRef(detail); return ref ? <div className="form-actions"><EntityLink {...ref} className="secondary-button">{tx('audit.detail.openEntity')}</EntityLink><EntityLink kind="audit" id={detail.entityId ?? ''} label="" className="secondary-button">{tx('audit.detail.entityHistory')}</EntityLink></div> : detail.entityId ? <div className="form-actions"><EntityLink kind="audit" id={detail.entityId} label="" className="secondary-button">{tx('audit.detail.entityHistory')}</EntityLink></div> : null; })()}
      <section className="host-section">
        <h3>{tx('audit.column.diff')}</h3>
        {detail.diff?.length
          ? <DataTable rows={detail.diff} rowKey={(entry) => entry.field} label={tx('audit.detail.diffTable')} columns={[
            { id: 'field', header: tx('audit.detail.field'), cell: (entry) => entry.field },
            { id: 'before', header: tx('audit.detail.before'), className: 'mono', cell: (entry) => formatAuditValue(entry.before) },
            { id: 'after', header: tx('audit.detail.after'), className: 'mono', cell: (entry) => formatAuditValue(entry.after) },
          ]} />
          : <p className="panel-description">{tx('audit.detail.noDiff')}</p>}
      </section>
      <section className="host-section">
        <h3>{tx('audit.detail.metadata')}</h3>
        {(() => { const entries = metadataEntries(detail.metadata, Boolean(detail.diff?.length)); return entries.length
          ? <div className="host-detail-grid">{entries.map(([key, value]) => <div key={key}><span>{key}</span><strong className="mono">{value}</strong></div>)}</div>
          : <p className="panel-description">{tx('audit.detail.noMetadata')}</p>; })()}
      </section>
    </aside>}
  </PageShell>;
}
