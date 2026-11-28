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
import { FilterChipBar, FilterChips } from '@/components/ui/filter-chips';
import { chipOptions, totalOf } from '@/lib/filter-chips';
import { useServerChipCounts } from '@/lib/use-server-chip-counts';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format/date';
import { getMaintenanceSummary, listAlerts, operationsKeys, type AlertListItem, type MaintenanceWindowSummaryItem } from './api';
import { ALERT_STATUSES, alertKindLabel, alertNextStep, alertSourceLabel, alertStatusLabel, alertTargetHref, deviceHref, SEVERITY_ORDER, severityName, type Translate } from './alert-meta';
import { AlertActionStatus, AlertBulkBar, AlertRowActions, isAlertActionable, OPERATOR_ROLES, ReadOnlyAlertNote, useAlertActions } from './alert-actions';
import { AlertDetailDialog } from './alert-detail';
import { SeverityLegend, SeverityTag } from './alert-severity';
import { useLiveAlertRefresh } from './use-live-alert-refresh';
import { useUiText } from '@/components/ui/use-ui-text';

export type AlertListUrlFilters = { severity: string; status: string; source: string; scope: string };
/** `scope=all` lists every visible Site; otherwise the active Site. `q` is the search. */
export const alertListConfig: TableStateConfig<AlertListUrlFilters> = {
  filters: { severity: '', status: '', source: '', scope: '' },
  sortable: ['severity', 'occurred'],
};

export const alertSeverities = SEVERITY_ORDER;
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };
const PAGE_SIZE = 100;

const baseColumns = (openDetail: (row: AlertListItem) => void, t: Translate): DataTableColumn<AlertListItem>[] => [
  { id: 'severity', header: t('operations.alerts.field.severity'), cell: (row) => <SeverityTag severity={row.severity} />, sortValue: (row) => severityRank[row.severity] ?? 9 },
  { id: 'title', header: t('operations.alerts.field.alert'), cell: (row) => {
    const href = alertTargetHref(row);
    return <span className="alert-title-cell"><strong>{href ? <a href={href}>{row.title}</a> : row.title}</strong>{row.detail && <small>{row.detail}</small>}<small className="alert-next-step">{alertNextStep(row, t)}</small><button type="button" className="text-button" onClick={() => openDetail(row)} aria-label={t('operations.alerts.viewDetailNamed', undefined, { title: row.title })}>{t('operations.alerts.detail.historyNote')}</button></span>;
  } },
  { id: 'device', header: t('operations.alerts.field.device'), cell: (row) => (row.device
    ? <span className="alert-device-cell"><a href={deviceHref(row.device.id, row.siteId)}>{row.device.name || t('operations.alerts.deviceRemoved')}</a>{row.device.managementIp && <small>{row.device.managementIp}</small>}</span>
    : '—') },
  { id: 'source', header: t('operations.alerts.field.source'), cell: (row) => <span className="alert-source-cell">{alertKindLabel(row, t)}{alertKindLabel(row, t) !== row.source && <code>{row.source}</code>}</span> },
  { id: 'site', header: t('operations.alerts.field.site'), cell: (row) => row.site?.name ?? t('operations.alerts.allSites') },
  { id: 'status', header: t('operations.alerts.field.status'), cell: (row) => <>{alertStatusLabel(row.status, t)}{row.status === 'SNOOZED' && row.snoozedUntil && <small>{t('operations.alerts.until', undefined, { date: formatDateTime(row.snoozedUntil, { dateStyle: 'short', timeStyle: 'short' }) })}</small>}</> },
  { id: 'occurred', header: t('operations.alerts.field.lastSeen'), cell: (row) => <>{row.lastOccurredAt ? formatDateTime(row.lastOccurredAt) : '—'}{(row.occurrenceCount ?? 1) > 1 && <small>{row.occurrenceCount}×</small>}</>, sortValue: (row) => (row.lastOccurredAt ? new Date(row.lastOccurredAt) : null) },
];

/** Filtered list of unresolved alerts; filters live in the URL so dashboard links open it pre-filtered. */
export function AlertList({ siteId, table }: { siteId: string; table: TableUrlState<AlertListUrlFilters> }) {
  const tx = useUiText();
  const { filters, search, sort, setFilter, setSort, clearFilters, filtering, defaultSort } = table;
  const { hasRole } = useAuth();
  const canAct = OPERATOR_ROLES.some((role) => hasRole(role));
  const isAdmin = hasRole('ADMIN');
  const scopedSiteId = filters.scope === 'all' ? undefined : siteId || undefined;
  const query = useQuery({
    queryKey: operationsKeys.alertList(scopedSiteId ?? 'all', filters.severity, filters.status, filters.source, search),
    queryFn: () => listAlerts({ siteId: scopedSiteId, severity: filters.severity, status: filters.status, source: filters.source, search: search.trim() }, PAGE_SIZE),
    enabled: filters.scope === 'all' || Boolean(siteId),
    retry: false,
  });
  const listEnabled = filters.scope === 'all' || Boolean(siteId);
  // Severity chips: one total-only request per severity with every other filter and the search applied.
  const severityCounts = useServerChipCounts(SEVERITY_ORDER, operationsKeys.alertListCounts(scopedSiteId ?? 'all', filters.status, filters.source, search),
    async (severity) => (await listAlerts({ siteId: scopedSiteId, severity, status: filters.status, source: filters.source, search: search.trim() }, 1)).total, listEnabled);
  const severityChipLabels = SEVERITY_ORDER.map((value) => [value, severityName(value, tx)] as const);
  const severityOptions = chipOptions(severityChipLabels, severityCounts, { selected: filters.severity });
  useLiveAlertRefresh();
  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [detailFor, setDetailFor] = useState<AlertListItem | null>(null);
  const onDone = useCallback((_: unknown, ids: string[]) => setSelected((current) => { const next = new Set(current); ids.forEach((id) => next.delete(id)); return next; }), []);
  const actions = useAlertActions(onDone);
  const items = useMemo(() => query.data?.items ?? [], [query.data]);
  // The selection only keeps alerts still listed and still actionable (another user may have resolved them).
  const selectedRows = items.filter((row) => selected.has(row.id) && isAlertActionable(row, isAdmin));
  const columns = useMemo(() => {
    const list = baseColumns(setDetailFor, tx);
    if (!canAct) return list;
    return [...list, { id: 'actions', header: tx('operations.alerts.field.actions'), cell: (row: AlertListItem) => (isAlertActionable(row, isAdmin) ? <AlertRowActions alert={row} disabled={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} /> : null) }];
  }, [actions, canAct, isAdmin, tx]);
  const rows = sortByColumns(items, columns, sort);
  const total = query.data?.total ?? 0;
  const selection = canAct ? { selected, onChange: setSelected, isSelectable: (row: AlertListItem) => isAlertActionable(row, isAdmin), rowLabel: (row: AlertListItem, selectable: boolean) => (selectable ? tx('operations.alerts.selectNamed', undefined, { title: row.title }) : tx('groupB.alerts.noActions', undefined, { title: row.title })), allLabel: tx('operations.alerts.selectAll') } : undefined;
  return <>
    {actions.confirmDialog}
    <PageToolbarPortal><div className="interface-toolbar-controls alerts-filters">
      <label>{tx('operations.alerts.field.status')}<select aria-label={tx('operations.alerts.filter.statusAria')} value={filters.status} onChange={(event) => setFilter('status', event.target.value)}><option value="">{tx('operations.alerts.filter.unresolved')}</option>{ALERT_STATUSES.map((value) => <option key={value} value={value}>{alertStatusLabel(value, tx)}</option>)}</select></label>
      <label>{tx('operations.alerts.filter.scope')}<select aria-label={tx('operations.alerts.filter.scopeAria')} value={filters.scope} onChange={(event) => setFilter('scope', event.target.value)}><option value="">{tx('operations.alerts.filter.activeSite')}</option><option value="all">{tx('operations.alerts.allSites')}</option></select></label>
      {filtering && <button className="secondary-button" onClick={clearFilters}><X size={14} /> {tx('operations.alerts.filter.clear')}</button>}
    </div></PageToolbarPortal>
    <section className="panel settings-panel" aria-labelledby="alert-list-title">
      <div className="panel-heading"><div><h2 id="alert-list-title">{tx('operations.alerts.active')}</h2></div></div>
      <SeverityLegend />
      <FilterChipBar><FilterChips label={tx('operations.alerts.field.severity')} value={filters.severity} options={severityOptions} total={totalOf(severityCounts, SEVERITY_ORDER)} allLabel={tx('operations.alerts.filter.allSeverities')} onChange={(value) => setFilter('severity', value)} /></FilterChipBar>
      {!filters.status && <p className="panel-description"><Info size={13} aria-hidden="true" /> {tx('operations.alerts.list.defaultNote')}</p>}
      {!canAct && <ReadOnlyAlertNote />}
      {filters.source && <p className="ipam-scope-note" role="status">{tx('operations.alerts.list.eventType')} <strong>{alertSourceLabel(filters.source, tx)}</strong> <button type="button" className="text-button" onClick={() => setFilter('source', '')}><X size={12} /> {tx('operations.alerts.list.removeSource')}</button></p>}
      {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : tx('operations.alerts.loadError')}</div>}
      <AlertActionStatus outcome={actions.outcome} error={actions.error} onClose={actions.clear} />
      {canAct && <AlertBulkBar selected={selectedRows} disabled={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} clearSelection={() => setSelected(new Set())} />}
      <DataTable className="alerts-table" label={tx('operations.alerts.active')} rows={rows} columns={columns} rowKey={(row) => row.id} sort={sort} onSortChange={setSort} defaultSort={defaultSort} loading={query.isLoading} selection={selection}
        empty={!query.error && <div className="no-data">{filtering ? tx('operations.alerts.list.noMatch') : tx('operations.alerts.empty')}</div>} />
      {total > items.length && <p className="panel-description">{tx('operations.alerts.list.showing', undefined, { shown: items.length, total })}</p>}
    </section>
    {detailFor && <AlertDetailDialog alertId={detailFor.id} title={detailFor.title} close={() => setDetailFor(null)} running={actions.running} run={(action, alerts, hours) => void actions.run(action, alerts, hours)} />}
  </>;
}

const windowLine = (item: MaintenanceWindowSummaryItem, t: Translate) => `${item.site?.name ?? t('operations.alerts.allSites')} · ${formatDateTime(item.startsAt)} — ${formatDateTime(item.endsAt)}${item.reason ? ` · ${item.reason}` : ''}`;

/** Active and upcoming maintenance windows (GET /operations/maintenance/summary). */
export function MaintenanceSummaryPanel({ siteId }: { siteId: string }) {
  const t = useUiText();
  const query = useQuery({ queryKey: operationsKeys.maintenanceSummary(siteId), queryFn: () => getMaintenanceSummary(siteId || undefined), retry: false });
  const data = query.data;
  return <section className="panel settings-panel" aria-labelledby="maintenance-summary-title">
    <div className="panel-heading"><div><h2 id="maintenance-summary-title">{t('operations.maintenance.title')}</h2>{data && <p className="panel-description"><span>{t('operations.maintenance.counts', undefined, { active: data.counts.active, upcoming: data.counts.upcoming, days: data.horizonDays })}</span>{data.criticalAlertsUnaffected !== false && <> · <span>{t('operations.maintenance.criticalVisible')}</span></>}</p>}</div></div>
    {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : t('operations.maintenance.loadError')}</div>}
    {data && <div className="audit-list">
      {data.active.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{windowLine(item, t)}</small></span><span className="status-pill orange"><i />{t('operations.maintenance.running')}</span></div>)}
      {data.upcoming.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{windowLine(item, t)}</small></span><span className="status-pill"><i />{t('operations.maintenance.scheduled')}</span></div>)}
      {!data.active.length && !data.upcoming.length && <div className="no-data">{t('operations.maintenance.empty')}</div>}
    </div>}
  </section>;
}
