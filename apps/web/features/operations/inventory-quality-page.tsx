'use client';

import { useEffect, useMemo, useState } from 'react';
import { useInfiniteQuery, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, Clock3, ExternalLink, RefreshCw, Server, UserPlus, X } from 'lucide-react';
import { AppShell, PageToolbarPortal } from '@/components/layout/app-shell';
import { DataTable, entityHref, SavedViews, sortByColumns, useTableUrlState, type DataTableColumn } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { formatDateTime } from '@/lib/format/date';
import { bulkInventoryFindings, getInventoryQualityAssignees, getInventoryQualityFacets, listInventoryFindings, type BulkFindingAction, type InventoryFinding } from './api';
import { QualityBulkDialog, type BulkParams } from './quality-bulk-dialog';
import {
  ALL, BULK_LIMIT, bulkOutcome, findingDeviceId, findingQueryFrom, findingSeverities, findingStatuses, groupByRule, hasQualityFilters, isActionable,
  personName, qualityTableConfig, ruleLabel, severityLabels, severityRank, statusCount, statusLabels, statusTabLabels, visibleSelection, type BulkOutcome,
} from './quality-workspace';

const shortDateTime = (value: string) => formatDateTime(value, { dateStyle: 'short', timeStyle: 'short' });

function useDebounced<T>(value: T, delay = 300): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return current;
}

export function InventoryQualityPage() {
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
    queryKey: ['inventory-quality', 'findings', query],
    queryFn: ({ pageParam }) => listInventoryFindings(query, pageParam),
    initialPageParam: 1,
    getNextPageParam: (last, all) => (all.reduce((sum, page) => sum + page.items.length, 0) < last.total ? last.page + 1 : undefined),
    enabled: Boolean(siteId),
  });
  const facets = useQuery({ queryKey: ['inventory-quality', 'facets', facetQuery], queryFn: () => getInventoryQualityFacets(facetQuery), enabled: Boolean(siteId) });
  const assignees = useQuery({ queryKey: ['inventory-quality', 'assignees', siteId], queryFn: () => getInventoryQualityAssignees(siteId ?? ''), enabled: Boolean(siteId && canAct) });

  const rows = useMemo(() => pages.data?.pages.flatMap((page) => page.items) ?? [], [pages.data]);
  const total = pages.data?.pages[0]?.total ?? 0;
  const loadError = pages.error instanceof Error ? pages.error.message : '';

  const columns: DataTableColumn<InventoryFinding>[] = [
    { id: 'severity', header: 'Severidade', sortValue: (row) => severityRank[row.severity], cell: (row) => <span className={`status-pill ${row.severity === 'CRITICAL' || row.severity === 'HIGH' ? 'orange' : 'blue'}`}>{severityLabels[row.severity]}</span> },
    { id: 'title', header: 'Finding', sortValue: (row) => row.title, cell: (row) => <span><strong>{row.title}</strong><small>{row.detail}</small>{row.suggestedCorrection && <small>{`Correção sugerida: ${row.suggestedCorrection}`}</small>}</span> },
    { id: 'rule', header: 'Regra', sortValue: (row) => ruleLabel(row.rule), cell: (row) => ruleLabel(row.rule) },
    { id: 'status', header: 'Estado', sortValue: (row) => findingStatuses.indexOf(row.status), cell: (row) => <span>{statusLabels[row.status]}{row.status === 'SNOOZED' && row.snoozedUntil && <small>{`até ${shortDateTime(row.snoozedUntil)}`}</small>}</span> },
    { id: 'assignee', header: 'Responsável', sortValue: (row) => personName(row.assignedTo) || null, cell: (row) => (row.assignedTo ? personName(row.assignedTo) : <span className="muted-cell">Sem responsável</span>) },
    { id: 'detected', header: 'Última deteção', sortValue: (row) => row.lastDetectedAt, cell: (row) => <time dateTime={row.lastDetectedAt}>{shortDateTime(row.lastDetectedAt)}</time> },
    { id: 'actions', header: <span className="topology-sr-only">Ações</span>, cell: (row) => <span className="table-actions">
      {canAct && isActionable(row) && <>
        <button type="button" className="icon-button subtle" disabled={running || row.status === 'ACKNOWLEDGED'} onClick={() => void acknowledgeOne(row)} aria-label={`Reconhecer ${row.title}`} title="Reconhecer"><Check size={14} /></button>
        <button type="button" className="icon-button subtle" disabled={running} onClick={() => openDialog('ASSIGN', row)} aria-label={`Atribuir ${row.title}`} title="Atribuir…"><UserPlus size={14} /></button>
        <button type="button" className="icon-button subtle" disabled={running} onClick={() => openDialog('SNOOZE', row)} aria-label={`Adiar ${row.title}`} title="Adiar…"><Clock3 size={14} /></button>
      </>}
      {findingDeviceId(row) && <a className="icon-button subtle" href={entityHref({ kind: 'device', id: findingDeviceId(row)!, siteId: row.siteId })} aria-label={`Abrir equipamento de ${row.title}`} title="Abrir equipamento"><Server size={14} /></a>}
      {row.actionHref && <a className="icon-button subtle" href={row.actionHref} aria-label={`Abrir registo de ${row.title}`} title="Abrir registo"><ExternalLink size={14} /></a>}
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
      const result = bulkOutcome(response, titles);
      setOutcome(result);
      const succeeded = new Set(result.items.filter((item) => item.ok).map((item) => item.id));
      setSelected((current) => new Set([...current].filter((id) => !succeeded.has(id))));
      await queryClient.invalidateQueries({ queryKey: ['inventory-quality'] });
    } catch (cause) {
      setDialog(null); setOutcome(null);
      setError(cause instanceof Error ? cause.message : 'A operação em massa falhou.');
    } finally { setRunning(false); }
  };
  const acknowledge = async () => {
    const single = actionable.length === 1;
    const message = single
      ? 'Reconhecer 1 finding selecionado? Continua na fila até deixar de ser detetado.'
      : `Reconhecer ${actionable.length} findings selecionados? Continuam na fila até deixarem de ser detetados.`;
    const ok = await confirm({ title: single ? 'Reconhecer finding' : 'Reconhecer findings', message, confirmLabel: `Reconhecer ${actionable.length}` });
    if (!ok) return;
    setOutcome(null); setDialog('ACKNOWLEDGE');
    await run('ACKNOWLEDGE');
  };
  /** One finding from its row: same endpoint and per-item result, no selection needed. */
  const acknowledgeOne = async (row: InventoryFinding) => {
    setRunning(true); setError(''); setOutcome(null);
    try {
      const result = bulkOutcome(await bulkInventoryFindings({ action: 'ACKNOWLEDGE', ids: [row.id] }), titles);
      const failed = result.items.find((item) => !item.ok);
      if (failed) setError(`${row.title}: ${failed.message}`);
      await queryClient.invalidateQueries({ queryKey: ['inventory-quality'] });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível reconhecer o finding.');
    } finally { setRunning(false); }
  };
  const openDialog = (action: BulkFindingAction, row: InventoryFinding | null = null) => { setOutcome(null); setRowTarget(row); setDialog(action); };
  const closeDialog = () => { setDialog(null); setOutcome(null); setRowTarget(null); };
  const dialogIds = rowTarget ? [rowTarget.id] : actionable;

  const facetData = facets.data;
  const myCount = facetData?.byAssignee.find((item) => item.userId && item.userId === user?.id)?.total;
  const unassignedCount = facetData?.byAssignee.find((item) => item.userId === null)?.total;
  const withCount = (label: string, count?: number) => (count === undefined ? label : `${label} (${count})`);
  const statusTabs: Array<{ value: string; label: string; count: number }> = [
    ...findingStatuses.map((status) => ({ value: status, label: statusTabLabels[status], count: statusCount(facetData, status) })),
    { value: ALL, label: 'Todos', count: statusCount(facetData, ALL) },
  ];

  const disabled = running || !actionable.length || overLimit;
  const actions = <>
    {canAct && <>
      <button className="topbar-action secondary-button" disabled={disabled} onClick={() => void acknowledge()}><Check size={14} /> {`Reconhecer (${actionable.length})`}</button>
      <button className="topbar-action secondary-button" disabled={disabled} onClick={() => openDialog('ASSIGN')}><UserPlus size={14} /> {`Atribuir… (${actionable.length})`}</button>
      <button className="topbar-action secondary-button" disabled={disabled} onClick={() => openDialog('SNOOZE')}><Clock3 size={14} /> {`Adiar… (${actionable.length})`}</button>
    </>}
    <button className="topbar-action secondary-button" onClick={() => void queryClient.invalidateQueries({ queryKey: ['inventory-quality'] })} disabled={pages.isFetching}><RefreshCw size={14} /> Atualizar</button>
  </>;

  const selection = canAct ? { selected, onChange: setSelected, isSelectable: isActionable, rowLabel: (row: InventoryFinding, selectable: boolean) => (selectable ? `Selecionar ${row.title}` : `${row.title} resolvido`), allLabel: 'Selecionar todos os findings visíveis' } : undefined;
  const empty = loadError ? null : <div className="no-data">{filtering ? 'Sem findings correspondentes.' : filters.status === 'OPEN' ? 'Sem findings abertos neste Site.' : 'Sem findings neste estado.'}</div>;
  const tableProps = { columns, rowKey: (row: InventoryFinding) => row.id, sort: table.sort, onSortChange: table.setSort, defaultSort: table.defaultSort, selection };

  return <>{confirmDialog}<AppShell section="Qualidade do inventário" search={{ value: search, onChange: setSearch, placeholder: 'Pesquisar título, detalhe ou correção…', ariaLabel: 'Pesquisar findings', scopeLabel: 'Qualidade do inventário' }} actions={actions}>
    <PageToolbarPortal><div className="interface-toolbar-controls">
      <label>Severidade<select aria-label="Filtrar por severidade" value={filters.severity} onChange={(event) => setFilter('severity', event.target.value)}><option value="">Todas</option>{findingSeverities.map((severity) => <option key={severity} value={severity}>{withCount(severityLabels[severity], facetData?.bySeverity[severity] ?? (facetData ? 0 : undefined))}</option>)}</select></label>
      <label>Regra<select aria-label="Filtrar por regra" value={filters.rule} onChange={(event) => setFilter('rule', event.target.value)}><option value="">Todas</option>{(facetData?.byRule ?? []).map((item) => <option key={item.rule} value={item.rule}>{withCount(ruleLabel(item.rule), item.total)}</option>)}{filters.rule && !facetData?.byRule.some((item) => item.rule === filters.rule) && <option value={filters.rule}>{ruleLabel(filters.rule)}</option>}</select></label>
      <label>Responsável<select aria-label="Filtrar por responsável" value={filters.assignee} onChange={(event) => setFilter('assignee', event.target.value)}>
        <option value="">Todos</option>
        <option value="me">{withCount('Atribuídos a mim', facetData ? myCount ?? 0 : undefined)}</option>
        <option value="unassigned">{withCount('Sem responsável', unassignedCount ?? (facetData ? 0 : undefined))}</option>
        {(facetData?.byAssignee ?? []).filter((item) => item.userId && item.userId !== user?.id).map((item) => <option key={item.userId} value={item.userId ?? ''}>{withCount(personName(item), item.total)}</option>)}
      </select></label>
      <label>Agrupar<select aria-label="Agrupar findings" value={filters.group} onChange={(event) => setFilter('group', event.target.value)}><option value="">Sem agrupamento</option><option value="rule">Por regra</option></select></label>
      {filtering && <button className="secondary-button" onClick={clearFilters}><X size={14} /> Limpar filtros</button>}
      <SavedViews pageId="quality" config={qualityTableConfig} table={table} />
    </div></PageToolbarPortal>
    <main className="module-page aligned-workspace"><section className="ipam-card page-primary-card">
      <div className="panel-heading"><div><h1>Fila do inventário</h1><p className="panel-description">Problemas detetados automaticamente. Age em cada finding na sua linha, ou seleciona findings visíveis para os reconhecer, atribuir ou adiar em conjunto.</p></div></div>
      {!siteId && <div className="no-data">Escolhe um Site para ver a fila.</div>}
      {loadError && <div className="ipam-alert error" role="alert"><X size={15} />{loadError}</div>}
      {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
      {overLimit && <div className="ipam-alert warning" role="note">{`Seleciona no máximo ${BULK_LIMIT} findings de cada vez.`}</div>}

      <div className="summary-stats settings-audit-stats critical-assets-counts" role="group" aria-label="Findings por estado">
        {statusTabs.map((tab) => <button key={tab.value} type="button" aria-pressed={filters.status === tab.value} className={filters.status === tab.value ? 'active' : ''} onClick={() => setFilter('status', tab.value)}><strong>{tab.count}</strong><span>{tab.label}</span></button>)}
      </div>

      <h2 className="critical-assets-count" aria-live="polite">{rows.length < total ? `${rows.length} de ${total} findings carregados` : total === 1 ? '1 finding' : `${total} findings`}{canAct && actionable.length ? ` · ${actionable.length} selecionados` : ''}</h2>
      {grouped && sorted.length
        ? groups.map((group) => <section key={group.rule} className="host-section">
          <h3>{`${ruleLabel(group.rule)} (${group.rows.length})`}</h3>
          <DataTable {...tableProps} rows={group.rows} label={`Findings da regra ${ruleLabel(group.rule)}`} selection={selection ? { ...selection, allLabel: `Selecionar findings visíveis da regra ${ruleLabel(group.rule)}` } : undefined} />
        </section>)
        : <DataTable {...tableProps} rows={sorted} label="Findings de qualidade do inventário" loading={pages.isLoading} empty={siteId ? empty : null} />}
      {pages.hasNextPage && <div className="form-actions"><button type="button" className="secondary-button" disabled={pages.isFetchingNextPage} onClick={() => void pages.fetchNextPage()}>{pages.isFetchingNextPage ? 'A carregar…' : 'Carregar mais findings'}</button></div>}
    </section></main>

    {dialog && <QualityBulkDialog action={dialog} count={dialogIds.length} finding={rowTarget?.title} assignees={assignees.data ?? []} running={running} outcome={outcome} close={closeDialog} run={(params) => void run(dialog, params, dialogIds)} />}
  </AppShell></>;
}
