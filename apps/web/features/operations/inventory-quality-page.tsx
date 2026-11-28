'use client';

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, ExternalLink, RefreshCw, Server, UserPlus, X } from 'lucide-react';
import { PageShell, PageToolbarPortal } from '@/components/layout/app-shell';
import { DataTable, SavedViews, sortByColumns, useTableUrlState, type DataTableColumn } from '@/components/data-table';
import { entityHref } from '@/lib/routes';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { formatDateTime } from '@/lib/format/date';
import { bulkInventoryFindings, inventoryQualityKeys, getInventoryQualityAssignees, getInventoryQualityFacets, listInventoryFindings, type BulkFindingAction, type InventoryFinding } from './api';
import { QualityBulkDialog, type BulkParams } from './quality-bulk-dialog';
import { useUiText } from '@/components/ui/use-ui-text';
import {
  ALL, BULK_LIMIT, bulkOutcome, findingDeviceId, findingQueryFrom, findingSeverities, findingStatuses, groupByRule, hasQualityFilters, isActionable,
  isKnownRule, personName, qualityTableConfig, ruleLabel, severityLabel, severityRank, statusCount, statusLabel, statusTabLabel, visibleSelection, type BulkOutcome,
} from './quality-workspace';

const shortDateTime = (value: string) => formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' });

function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return current;
}

export function InventoryQualityPage() {
  const tx = useUiText();
  const { siteId } = useSiteContext();
  const { hasRole, user } = useAuth();
  const canAct = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const table = useTableUrlState(qualityTableConfig);
  const { search, filters, setSearch, setFilter, clearFilters } = table;
  const debouncedSearch = useDebounced(search);
  const query = useMemo(() => findingQueryFrom(siteId ?? '', debouncedSearch, filters), [siteId, debouncedSearch, filters]);
  // Tab counts ignore the status tab itself, so every tab shows its own total.
  const facetQuery = useMemo(() => ({ ...query, status: undefined }), [query]);
  const filtering = hasQualityFilters(search, filters);
  const grouped = filters.group === 'rule';

  const [selected, setSelected] = useState<Set<string>>(() => new Set());
  const [dialog, setDialog] = useState<BulkFindingAction | null>(null);
  // Set when a dialog was opened from a row: it then acts on that finding only, not the selection.
  const [rowTarget, setRowTarget] = useState<InventoryFinding | null>(null);
  const [running, setRunning] = useState(false);
  const [outcome, setOutcome] = useState<BulkOutcome | null>(null);
  const [error, setError] = useState('');

  const pages = useInfiniteQuery({
    queryKey: inventoryQualityKeys.findings(query),
    queryFn: ({ pageParam }) => listInventoryFindings(query, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((sum, page) => sum + page.items.length, 0) < last.total ? last.page + 1 : undefined),
    enabled: Boolean(siteId),
  });
  const facets = useQuery({ queryKey: inventoryQualityKeys.facets(facetQuery), queryFn: () => getInventoryQualityFacets(facetQuery), enabled: Boolean(siteId) });
  const assignees = useQuery({ queryKey: inventoryQualityKeys.assignees(siteId), queryFn: () => getInventoryQualityAssignees(siteId ?? ''), enabled: Boolean(siteId && canAct) });

  const rows = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;
  const loadError = pages.error instanceof Error ? pages.error.message : '';

  const columns: DataTableColumn<InventoryFinding>[] = [
    { id: 'severity', header: tx('operations.alerts.field.severity'), sortValue: (row) => severityRank[row.severity], cell: (row) => <span className={`status-pill ${row.severity === 'CRITICAL' || row.severity === 'HIGH' ? 'orange' : 'blue'}`}>{severityLabel(row.severity, tx)}</span> },
    { id: 'title', header: tx('operations.quality.finding'), sortValue: (row) => row.title, cell: (row) => <span><strong>{row.title}</strong><small>{row.detail}</small>{row.suggestedCorrection && <small>{tx('operations.quality.suggestedCorrection', undefined, { correction: row.suggestedCorrection })}</small>}</span> },
    { id: 'rule', header: tx('operations.quality.rule'), sortValue: (row) => ruleLabel(row.rule, tx), cell: (row) => ruleLabel(row.rule, tx) },
    { id: 'status', header: tx('operations.alerts.field.status'), sortValue: (row) => findingStatuses.indexOf(row.status), cell: (row) => <span>{statusLabel(row.status, tx)}{row.status === 'SNOOZED' && row.snoozedUntil && <small>{tx('operations.alerts.until', undefined, { date: shortDateTime(row.snoozedUntil) })}</small>}</span> },
    { id: 'assignee', header: tx('operations.quality.assignee'), sortValue: (row) => personName(row.assignedTo) || null, cell: (row) => (row.assignedTo ? personName(row.assignedTo) : <span className="muted-cell">{tx('operations.quality.unassigned')}</span>) },
    { id: 'detected', header: tx('operations.quality.lastDetected'), sortValue: (row) => row.lastDetectedAt, cell: (row) => <time dateTime={row.lastDetectedAt}>{shortDateTime(row.lastDetectedAt)}</time> },
    { id: 'actions', header: <span className="topology-sr-only">{tx('operations.alerts.field.actions')}</span>, cell: (row) => <span className="table-actions">
      {canAct && isActionable(row) && <>
        <button type="button" className="icon-button subtle" disabled={running || row.status === 'ACKNOWLEDGED'} onClick={() => void acknowledgeOne(row)} aria-label={tx('operations.alerts.acknowledgeNamed', undefined, { title: row.title })} title={tx('operations.alerts.acknowledge')}><Check size={14} /></button>
        <button type="button" className="icon-button subtle" disabled={running} onClick={() => openDialog('ASSIGN', row)} aria-label={tx('operations.quality.assignNamed', undefined, { title: row.title })} title={tx('operations.quality.assignEllipsis')}><UserPlus size={14} /></button>
        <button type="button" className="icon-button subtle" disabled={running} onClick={() => openDialog('SNOOZE', row)} aria-label={tx('operations.alerts.snoozeNamed', undefined, { title: row.title })} title={tx('operations.quality.snoozeEllipsis')}><Clock3 size={14} /></button>
      </>}
      {findingDeviceId(row) && <a className="icon-button subtle" href={entityHref({ kind: 'device', id: findingDeviceId(row)!, siteId: row.siteId })} aria-label={tx('operations.quality.openDeviceNamed', undefined, { title: row.title })} title={tx('operations.quality.openDevice')}><Server size={14} /></a>}
      {row.actionHref && <a className="icon-button subtle" href={row.actionHref} aria-label={tx('operations.quality.openRecordNamed', undefined, { title: row.title })} title={tx('operations.quality.openRecord')}><ExternalLink size={14} /></a>}
    </span> },
  ];
  const sorted = sortByColumns(rows, columns, table.sort);
  const groups = grouped ? groupByRule(sorted) : [];

  // Bulk only ever acts on rows the person can see; hidden selections are dropped.
  const actionable = visibleSelection(selected, sorted);
  const overLimit = actionable.length > BULK_LIMIT;
  useEffect(() => {
    setSelected((current) => {
      const visible = new Set(visibleSelection(current, rows));
      return visible.size === current.size ? current : visible;
    });
  }, [rows]);

  const titles = useMemo(() => new Map(rows.map((row) => [row.id, row.title])), [rows]);
  const run = async (action: BulkFindingAction, params: BulkParams = {}, ids: string[] = actionable) => {
    setRunning(true); setError('');
    try {
      const response = await bulkInventoryFindings({ action, ids, ...params });
      const result = bulkOutcome(response, titles, tx);
      setOutcome(result);
      const succeeded = new Set(result.items.filter((item) => item.ok).map((item) => item.id));
      setSelected((current) => new Set([...current].filter((id) => !succeeded.has(id))));
      await queryClient.invalidateQueries({ queryKey: inventoryQualityKeys.all });
    } catch (cause) {
      setDialog(null); setOutcome(null);
      setError(cause instanceof Error ? cause.message : tx('operations.quality.bulkFailed'));
    } finally { setRunning(false); }
  };
  const acknowledge = async () => {
    const message = tx('operations.quality.acknowledgeConfirm', undefined, { count: actionable.length });
    const ok = await confirm({ title: tx('operations.quality.acknowledgeTitle', undefined, { count: actionable.length }), message, confirmLabel: tx('operations.quality.bulk.runCount.ACKNOWLEDGE', undefined, { count: actionable.length }) });
    if (!ok) return;
    setOutcome(null); setDialog('ACKNOWLEDGE');
    await run('ACKNOWLEDGE');
  };
  /** One finding from its row: same endpoint and per-item result, no selection needed. */
  const acknowledgeOne = async (row: InventoryFinding) => {
    setRunning(true); setError(''); setOutcome(null);
    try {
      const result = bulkOutcome(await bulkInventoryFindings({ action: 'ACKNOWLEDGE', ids: [row.id] }), titles, tx);
      const failed = result.items.find((item) => !item.ok);
      if (failed) setError(`${row.title}: ${failed.message}`);
      await queryClient.invalidateQueries({ queryKey: inventoryQualityKeys.all });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : tx('operations.quality.acknowledgeError'));
    } finally { setRunning(false); }
  };
  const openDialog = (action: BulkFindingAction, row: InventoryFinding | null = null) => { setOutcome(null); setRowTarget(row); setDialog(action); };
  const closeDialog = () => { setDialog(null); setOutcome(null); setRowTarget(null); };
  const dialogIds = rowTarget ? [rowTarget.id] : actionable;

  const facetData = facets.data;
  const myCount = facetData?.byAssignee.find((item) => item.userId && item.userId === user?.id)?.total;
  const unassignedCount = facetData?.byAssignee.find((item) => item.userId === null)?.total;
  const withCount = (label: string, count?: number) => (count === undefined ? label : `${label} (${count})`);
  // "Label (count)" options are one text each, so their labels are translated by key, not by the page-wide pass.
  const severityText = (severity: (typeof findingSeverities)[number]) => tx(`quality.severity.${severity}`, severityLabel(severity, tx));
  const ruleText = (rule: string) => (isKnownRule(rule) ? tx(`quality.rule.${rule}`, ruleLabel(rule, tx)) : rule);
  const statusTabs: Array<{ value: string; label: string; count: number }> = [
    ...findingStatuses.map((status) => ({ value: status, label: statusTabLabel(status, tx), count: statusCount(facetData, status) })),
    { value: ALL, label: tx('operations.quality.all'), count: statusCount(facetData, ALL) },
  ];

  const disabled = running || !actionable.length || overLimit;
  const actions = <>
    {canAct && <>
      <button className="topbar-action secondary-button" disabled={disabled} aria-label={tx('operations.quality.acknowledgeCount', undefined, { count: actionable.length })} title={tx('operations.quality.acknowledgeCount', undefined, { count: actionable.length })} onClick={() => void acknowledge()}><Check size={14} /> <span className="toolbar-action-label">{tx('operations.alerts.acknowledge')}</span> <span className="toolbar-action-count">{`(${actionable.length})`}</span></button>
      <button className="topbar-action secondary-button" disabled={disabled} aria-label={tx('operations.quality.assignCount', undefined, { count: actionable.length })} title={tx('operations.quality.assignCount', undefined, { count: actionable.length })} onClick={() => openDialog('ASSIGN')}><UserPlus size={14} /> <span className="toolbar-action-label">{tx('operations.quality.assignEllipsis')}</span> <span className="toolbar-action-count">{`(${actionable.length})`}</span></button>
      <button className="topbar-action secondary-button" disabled={disabled} aria-label={tx('operations.quality.snoozeCount', undefined, { count: actionable.length })} title={tx('operations.quality.snoozeCount', undefined, { count: actionable.length })} onClick={() => openDialog('SNOOZE')}><Clock3 size={14} /> <span className="toolbar-action-label">{tx('operations.quality.snoozeEllipsis')}</span> <span className="toolbar-action-count">{`(${actionable.length})`}</span></button>
    </>}
    <button className="topbar-action secondary-button" onClick={() => void queryClient.invalidateQueries({ queryKey: inventoryQualityKeys.all })} disabled={pages.isFetching} aria-label={tx('operations.config.refresh')} title={tx('operations.config.refresh')}><RefreshCw size={14} /> <span className="toolbar-action-label">{tx('operations.config.refresh')}</span></button>
  </>;

  const selection = canAct ? { selected, onChange: setSelected, isSelectable: isActionable, rowLabel: (row: InventoryFinding, selectable: boolean) => (selectable ? tx('operations.alerts.selectNamed', undefined, { title: row.title }) : tx('operations.quality.resolvedNamed', undefined, { title: row.title })), allLabel: tx('operations.quality.selectAll') } : undefined;
  const empty = loadError ? null : <div className="no-data">{filtering ? tx('operations.quality.noMatch') : filters.status === 'OPEN' ? tx('operations.quality.noOpen') : tx('operations.quality.noneInStatus')}</div>;
  const tableProps = { columns, rowKey: (row: InventoryFinding) => row.id, sort: table.sort, onSortChange: table.setSort, defaultSort: table.defaultSort, selection };

  return <>{confirmDialog}<PageShell section={tx('operations.quality.section')} search={{ value: search, onChange: setSearch, placeholder: tx('operations.quality.searchPlaceholder'), ariaLabel: tx('operations.quality.searchAria'), scopeLabel: tx('operations.quality.section') }} actions={actions}>
    <PageToolbarPortal><div className="interface-toolbar-controls">
      <label><span className="toolbar-filter-label">{tx('operations.alerts.field.severity')}</span><select aria-label={tx('operations.quality.filterSeverity')} title={tx('operations.quality.filterSeverity')} value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}><option value="">{tx('operations.alerts.field.severity')}</option>{findingSeverities.map((severity) => <option key={severity} value={severity}>{withCount(severityText(severity), facetData?.bySeverity[severity] ?? (facetData ? 0 : undefined))}</option>)}</select></label>
      <label><span className="toolbar-filter-label">{tx('operations.quality.rule')}</span><select aria-label={tx('operations.quality.filterRule')} title={tx('operations.quality.filterRule')} value={filters.rule} onChange={(event) => setFilter('rule', event.target.value)}><option value="">{tx('operations.quality.rule')}</option>{(facetData?.byRule ?? []).map((item) => <option key={item.rule} value={item.rule}>{withCount(ruleText(item.rule), item.total)}</option>)}{filters.rule && !facetData?.byRule.some((item) => item.rule === filters.rule) && <option value={filters.rule}>{ruleLabel(filters.rule, tx)}</option>}</select></label>
      <label><span className="toolbar-filter-label">{tx('operations.quality.assignee')}</span><select aria-label={tx('operations.quality.filterAssignee')} title={tx('operations.quality.filterAssignee')} value={filters.assignee} onChange={(event) => setFilter('assignee', event.target.value)}>
        <option value="">{tx('operations.quality.assignee')}</option>
        <option value="me">{withCount(tx('quality.assignee.me'), facetData ? myCount ?? 0 : undefined)}</option>
        <option value="unassigned">{withCount(tx('quality.assignee.none'), unassignedCount ?? (facetData ? 0 : undefined))}</option>
        {(facetData?.byAssignee ?? []).filter((item) => item.userId && item.userId !== user?.id).map((item) => <option key={item.userId} value={item.userId ?? ''}>{withCount(personName(item), item.total)}</option>)}
      </select></label>
      <label><span className="toolbar-filter-label">{tx('operations.quality.group')}</span><select aria-label={tx('operations.quality.groupAria')} title={tx('operations.quality.groupAria')} value={filters.group} onChange={(event) => setFilter('group', event.target.value)}><option value="">{tx('operations.quality.noGrouping')}</option><option value="rule">{tx('operations.quality.byRule')}</option></select></label>
      {filtering && <button className="secondary-button" aria-label={tx('operations.alerts.filter.clear')} title={tx('operations.alerts.filter.clear')} onClick={clearFilters}><X size={14} /> <span className="toolbar-action-label">{tx('operations.alerts.filter.clear')}</span></button>}
      <SavedViews pageId="quality" config={qualityTableConfig} table={table} />
    </div></PageToolbarPortal>
    <div className="module-page aligned-workspace"><section className="ipam-card page-primary-card">
      <div className="panel-heading"><div><h1>{tx('operations.quality.title')}</h1><p className="panel-description">{tx('operations.quality.description')}</p></div></div>
      {!siteId && <div className="no-data">{tx('operations.quality.chooseSite')}</div>}
      {loadError && <div className="ipam-alert error" role="alert"><X size={15} />{loadError}</div>}
      {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
      {overLimit && <div className="ipam-alert warning" role="note">{tx('operations.quality.overLimit', undefined, { count: BULK_LIMIT })}</div>}

      <div className="summary-stats settings-audit-stats critical-assets-counts" role="group" aria-label={tx('operations.quality.byStatus')}>
        {statusTabs.map((tab) => <button key={tab.value} type="button" aria-pressed={filters.status === tab.value} className={filters.status === tab.value ? 'active' : ''} onClick={() => setFilter('status', tab.value)}><strong>{tab.count}</strong><span>{tab.label}</span></button>)}
      </div>

      <h2 className="critical-assets-count" aria-live="polite">{rows.length < total ? tx('operations.quality.loadedOf', undefined, { loaded: rows.length, total }) : tx('operations.quality.count', undefined, { count: total })}{canAct && actionable.length ? ` · ${tx('operations.quality.selectedCount', undefined, { count: actionable.length })}` : ''}</h2>
      {grouped && sorted.length
        ? groups.map((group) => <section key={group.rule} className="host-section">
          <h3>{`${ruleText(group.rule)} (${group.rows.length})`}</h3>
          <DataTable {...tableProps} rows={group.rows} label={tx('groupB.quality.ruleFindings', undefined, { rule: ruleLabel(group.rule, tx) })} selection={selection ? { ...selection, allLabel: tx('groupB.quality.selectRuleFindings', undefined, { rule: ruleLabel(group.rule, tx) }) } : undefined} />
        </section>)
        : <DataTable {...tableProps} rows={sorted} label={tx('operations.quality.tableLabel')} loading={pages.isLoading} empty={siteId ? empty : null} />}
      {pages.hasNextPage && <div className="form-actions"><button type="button" className="secondary-button" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? tx('operations.quality.loading') : tx('operations.quality.loadMore')}</button></div>}
    </section></div>

    {dialog && <QualityBulkDialog action={dialog} count={dialogIds.length} finding={rowTarget?.title} assignees={assignees.data ?? []} running={running} outcome={outcome} close={closeDialog} run={(params) => void run(dialog, params, dialogIds)} />}
  </PageShell></>;
}
