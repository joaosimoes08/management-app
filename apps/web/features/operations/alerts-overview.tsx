'use client';

/**
 * Alertas page, Phase D: the filtered alert list (dashboard drill-through target)
 * and the maintenance summary. Both are visible to every role; the API scopes
 * them to the Sites the user can see.
 */
import { useCallback, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Info, X } from 'lucide-react';
import { DataTable, sortByColumns, type DataTableColumn, type TableStateConfig, type TableUrlState } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format/date';
import { getMaintenanceSummary, listAlerts, type AlertListItem, type MaintenanceWindowSummaryItem } from './api';
import { alertKindLabel, alertNextStep, alertSourceLabel, alertStatusLabels, alertTargetHref, deviceHref, SEVERITY_ORDER, severityNames } from './alert-meta';
import { AlertActionStatus, AlertBulkBar, AlertRowActions, isAlertActionable, OPERATOR_ROLES, ReadOnlyAlertNote, useAlertActions } from './alert-actions';
import { AlertDetailDialog } from './alert-detail';
import { SeverityLegend, SeverityTag } from './alert-severity';
import { useLiveAlertRefresh } from './use-live-alert-refresh';

export type AlertListUrlFilters = { severity: string; status: string; source: string; scope: string };
/** `scope=all` lists every visible Site; otherwise the active Site. `q` is the search. */
export const alertListConfig: TableStateConfig<AlertListUrlFilters> = {
  filters: { severity: '', status: '', source: '', scope: '' },
  sortable: ['severity', 'occurred'],
};

export const alertSeverities = SEVERITY_ORDER;
export { alertStatusLabels };
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };
const PAGE_SIZE = 100;

const baseColumns = (openDetail: (row: AlertListItem) => void): DataTableColumn<AlertListItem>[] => [
  { id: 'severity', header: 'Severidade', cell: (row) => <SeverityTag severity={row.severity} />, sortValue: (row) => severityRank[row.severity] ?? 9 },
  { id: 'title', header: 'Alerta', cell: (row) => {
    const href = alertTargetHref(row);
    return <span className="alert-title-cell"><strong>{href ? <a href={href}>{row.title}</a> : row.title}</strong>{row.detail && <small>{row.detail}</small>}<small className="alert-next-step">{alertNextStep(row)}</small><button type="button" className="text-button" onClick={() => openDetail(row)} aria-label={`Ver detalhe de ${row.title}`}>Detalhe</button></span>;
  } },
  { id: 'device', header: 'Equipamento', cell: (row) => (row.device
    ? <span className="alert-device-cell"><a href={deviceHref(row.device.id, row.siteId)}>{row.device.name || 'Equipamento removido'}</a>{row.device.managementIp && <small>{row.device.managementIp}</small>}</span>
    : '—') },
  { id: 'source', header: 'Origem', cell: (row) => <span className="alert-source-cell">{alertKindLabel(row)}{alertKindLabel(row) !== row.source && <code>{row.source}</code>}</span> },
  { id: 'site', header: 'Site', cell: (row) => row.site?.name ?? 'Todos os Sites' },
  { id: 'status', header: 'Estado', cell: (row) => <>{alertStatusLabels[row.status] ?? row.status}{row.status === 'SNOOZED' && row.snoozedUntil && <small>{`até ${formatDateTime(row.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' })}`}</small>}</> },
  { id: 'occurred', header: 'Última ocorrência', cell: (row) => <>{row.lastOccurredAt ? formatDateTime(row.lastOccurredAt) : '—'}{(row.occurrenceCount ?? 1) > 1 && <small>{row.occurrenceCount}×</small>}</>, sortValue: (row) => (row.lastOccurredAt ? new Date(row.lastOccurredAt) : null) },
];

/** Filtered list of unresolved alerts; filters live in the URL so dashboard links open it pre-filtered. */
export function AlertList({ siteId, table }: { siteId: string; table: TableUrlState<AlertListUrlFilters> }) {
  const { filters, search, sort, setFilter, setSort, clearFilters, filtering, defaultSort } = table;
  const { hasRole } = useAuth();
  const canAct = OPERATOR_ROLES.some((role) => hasRole(role));
  const isAdmin = hasRole('ADMIN');
  const scopedSiteId = filters.scope === 'all' ? undefined : siteId || undefined;
  const query = useQuery({
    queryKey: ['operations', 'alert-list', scopedSiteId ?? 'all', filters.severity, filters.status, filters.source, search],
    queryFn: () => listAlerts({ siteId: scopedSiteId, severity: filters.severity, status: filters.status, source: filters.source, search: search.trim() }, PAGE_SIZE),
    enabled: filters.scope === 'all' || Boolean(siteId),
    retry: false,
  });
  useLiveAlertRefresh();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detailFor, setDetailFor] = useState<AlertListItem | null>(null);
  const onDone = useCallback((_: unknown, ids: string[]) => setSelected((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next; }), []);
  const actions = useAlertActions(onDone);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  // The selection only keeps alerts still listed and still actionable (another user may have resolved them).
  const selectedRows = items.filter((row) => selected.has(row.id) && isAlertActionable(row, isAdmin));
  const columns = useMemo(() => {
    const list = baseColumns(setDetailFor);
    if (!canAct) return list;
    return [...list, { id: 'actions', header: 'Ações', cell: (row: AlertListItem) => (isAlertActionable(row, isAdmin) ? <AlertRowActions alert={row} disabled={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} /> : null) }];
  }, [actions, canAct, isAdmin]);
  const rows = sortByColumns(items, columns, sort);
  const total = query.data?.total ?? 0;
  const selection = canAct ? { selected, onChange: setSelected, isSelectable: (row: AlertListItem) => isAlertActionable(row, isAdmin), rowLabel: (row: AlertListItem, selectable: boolean) => (selectable ? `Selecionar ${row.title}` : `${row.title} sem ações disponíveis`), allLabel: 'Selecionar todos os alertas visíveis' } : undefined;
  return <>
    {actions.confirmDialog}
    <PageToolbarPortal><div className="interface-toolbar-controls">
      <label>Severidade<select aria-label="Filtrar por severidade" value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}><option value="">Todas</option>{alertSeverities.map((value) => <option key={value} value={value}>{severityNames[value]}</option>)}</select></label>
      <label>Estado<select aria-label="Filtrar por estado" value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">Por resolver</option>{Object.entries(alertStatusLabels).map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label>
      <label>Âmbito<select aria-label="Filtrar por âmbito" value={filters.scope} onChange={(event) => setFilter('scope', event.target.value)}><option value="">Site ativo</option><option value="all">Todos os Sites</option></select></label>
      {filtering && <button className="secondary-button" onClick={clearFilters}><X size={14} /> Limpar filtros</button>}
    </div></PageToolbarPortal>
    <section className="panel settings-panel" aria-labelledby="alert-list-title">
      <div className="panel-heading"><div><span className="section-kicker">ALERTAS</span><h2 id="alert-list-title">Alertas ativos</h2></div></div>
      <SeverityLegend />
      {!filters.status && <p className="panel-description"><Info size={13} aria-hidden="true" /> Por omissão a lista mostra abertos, reconhecidos e adiados. Os adiados voltam a abrir no fim do prazo.</p>}
      {!canAct && <ReadOnlyAlertNote />}
      {filters.source && <p className="ipam-scope-note" role="status">Tipo de evento: <strong>{alertSourceLabel(filters.source)}</strong> <button type="button" className="text-button" onClick={() => setFilter('source', '')}><X size={12} /> Remover</button></p>}
      {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : 'Não foi possível carregar os alertas.'}</div>}
      <AlertActionStatus outcome={actions.outcome} error={actions.error} onClose={actions.clear} />
      {canAct && <AlertBulkBar selected={selectedRows} disabled={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} clearSelection={() => setSelected(new Set())} />}
      <DataTable label="Alertas ativos" rows={rows} columns={columns} rowKey={(row) => row.id} sort={sort} onSortChange={setSort} defaultSort={defaultSort} loading={query.isLoading} selection={selection}
        empty={!query.error && <div className="no-data">{filtering ? 'Nenhum alerta corresponde aos filtros.' : 'Sem alertas ativos.'}</div>} />
      {total > items.length && <p className="panel-description">{`A mostrar ${items.length} de ${total} alertas. Use os filtros para refinar.`}</p>}
    </section>
    {detailFor && <AlertDetailDialog alertId={detailFor.id} title={detailFor.title} close={() => setDetailFor(null)} running={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} />}
  </>;
}

const windowLine = (item: MaintenanceWindowSummaryItem) => `${item.site?.name ?? 'Todos os Sites'} · ${formatDateTime(item.startsAt)} — ${formatDateTime(item.endsAt)}${item.reason ? ` · ${item.reason}` : ''}`;

/** Active and upcoming maintenance windows (GET /operations/maintenance/summary). */
export function MaintenanceSummaryPanel({ siteId }: { siteId: string }) {
  const query = useQuery({ queryKey: ['operations', 'maintenance-summary', siteId], queryFn: () => getMaintenanceSummary(siteId || undefined), retry: false });
  const data = query.data;
  return <section className="panel settings-panel" aria-labelledby="maintenance-summary-title">
    <div className="panel-heading"><div><span className="section-kicker">MANUTENÇÃO</span><h2 id="maintenance-summary-title">Janelas ativas e próximas</h2>{data && <p className="panel-description"><span>{`${data.counts.active} ativas · ${data.counts.upcoming} nos próximos ${data.horizonDays} dias`}</span>{data.criticalAlertsUnaffected !== false && <> · <span>Alertas críticos continuam visíveis durante as janelas.</span></>}</p>}</div></div>
    {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : 'Não foi possível carregar as janelas de manutenção.'}</div>}
    {data && <div className="audit-list">
      {data.active.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{windowLine(item)}</small></span><span className="status-pill orange"><i />Em curso</span></div>)}
      {data.upcoming.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{windowLine(item)}</small></span><span className="status-pill"><i />Agendada</span></div>)}
      {!data.active.length && !data.upcoming.length && <div className="no-data">Sem janelas de manutenção ativas ou próximas.</div>}
    </div>}
  </section>;
}
