'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { keepPreviousData, useQuery, useQueryClient } from '@tanstack/react-query';
import { CheckCircle2, Server, ShieldCheck, Users, X } from 'lucide-react';
import { PageShell, PageToolbarPortal } from '@/components/layout/app-shell';
import { CsvExportButton, DataTable, EntityLink, HistoryBlock, csvColumnsOf, sortByColumns, useTableUrlState, type DataTableColumn, type TableStateConfig } from '@/components/data-table';
import { ApiRequestError } from '@/lib/api/errors';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { Empty } from '@/features/ipam/components/ipam-modal';
import { closeCorrection as postCloseCorrection, confirmAttestation, confirmAttestations, criticalAssetsKeys, getCriticalAssets, listAssetConnections, listCorrections, listCriticalAssetsPage, listOwnerGroups, saveOwnerMapping } from './api';
import { BulkConfirmDialog, CorrectionCloseDialog, CorrectionRequestDialog, OwnerDialog, ReviewDialog, type BulkItem, type BulkResult } from './critical-assets-dialogs';
import {
  assetTypes, buildRows, countRows, dueLabelKey, dueOrder, dueStates, dueTone, emptyFilters, filterRows, hasActiveFilters, MAX_SERVER_PAGE, NO_OUTCOME, NO_OWNER, outcomeLabelKey, outcomeTone, PAGE_SIZE, toRow, withRecordedAttestation, currentCycle, hasOlderPending,
  type AssetRow, type Attestation, type ComplianceCell, type CriticalAssetsResult, type Correction, type Filters, type Group, type Outcome, complianceCells,
} from './workbench';
import { useUiText } from '@/components/ui/use-ui-text';
import { STORAGE_KEYS, getLocalItem } from '@/lib/storage-keys';
import { isAppLocale } from '@/lib/i18n/locales/catalog';

type View = 'assets' | 'corrections' | 'compliance';

const reviewerRoles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'];
const errorText = (cause: unknown, fallback: string) => (cause instanceof Error && cause.message ? cause.message : fallback);
const isAlreadyRecorded = (cause: unknown) => cause instanceof ApiRequestError && (cause.code === 'CRITICAL_ASSET_ATTESTATION_ALREADY_RECORDED' || cause.status === 409);

type Review = { asset: AssetRow; attestation: Attestation };
type Notice = { tone: 'success' | 'error'; text: string } | null;

const noGroups: Group[] = [];
/** Bulk confirm is capped per request on the server (BULK_CONFIRM_LIMIT); bigger selections go in chunks. */
const BULK_CHUNK = 100;

/** Search, filters and sort live in the URL (`?q=&type=&owner=&outcome=&due=&sort=`); no sort keeps the overdue-first order. */
const tableConfig: TableStateConfig<Filters> = { filters: emptyFilters, sortable: ['name', 'type', 'owner', 'outcome', 'due'] };

export function CriticalAssetsPage() {
  const ui = useUiText();
  const { siteId } = useSiteContext();
  const { hasRole } = useAuth();
  const isAdmin = hasRole('ADMIN');
  const canReview = reviewerRoles.some(hasRole);
  const queryClient = useQueryClient();
  const [hydrated, setHydrated] = useState(false);
  useEffect(() => setHydrated(true), []);

  const table = useTableUrlState(tableConfig);
  const { search, filters, setSearch, setFilter, clearFilters: clearUrlFilters } = table;
  // Selected rows across pages, keyed by asset id: a row keeps its pending reviews until the selection is cleared.
  const [selection, setSelection] = useState<Map<string, AssetRow>>(new Map());
  const [page, setPage] = useState(1);
  const [selectingAll, setSelectingAll] = useState(false);
  const [detailId, setDetailId] = useState('');
  const [linkedWeek, setLinkedWeek] = useState('');
  const openedLink = useRef(false);
  const [review, setReview] = useState<Review | null>(null);
  const [request, setRequest] = useState<Review | null>(null);
  const [ownerType, setOwnerType] = useState<string | null>(null);
  const [bulkPlan, setBulkPlan] = useState<{ selectedCount: number; olderCount: number; items: BulkItem[] } | null>(null);
  const [bulkRunning, setBulkRunning] = useState(false);
  const [bulkResults, setBulkResults] = useState<Record<string, BulkResult> | null>(null);
  const [notice, setNotice] = useState<Notice>(null);
  const [view, setView] = useState<View>('assets');
  const [correctionTab, setCorrectionTab] = useState<'open' | 'closed'>('open');
  const [correctionDialog, setCorrectionDialog] = useState<{ correction: Correction; outcome: 'RESOLVED' | 'REJECTED' } | null>(null);
  const returnFocus = useRef<HTMLElement | null>(null);

  const queryKey = criticalAssetsKeys.list(siteId);
  const { data: queryData, error: queryError, isLoading } = useQuery({ queryKey, queryFn: () => getCriticalAssets(siteId), enabled: Boolean(siteId) });
  const { data: queryGroups } = useQuery({ queryKey: criticalAssetsKeys.groups(siteId), queryFn: () => listOwnerGroups(siteId), enabled: Boolean(siteId) && isAdmin });
  const { data: correctionData, isLoading: correctionsLoading, error: correctionsError } = useQuery({ queryKey: criticalAssetsKeys.corrections(siteId), queryFn: () => listCorrections(siteId), enabled: Boolean(siteId) && hydrated && view === 'corrections' });
  const data = hydrated ? queryData : undefined;
  // The table pages through the server: filters, search and paging are applied there, one page at a time.
  const pageKey = criticalAssetsKeys.page(siteId, filters, search, page);
  const { data: pageData, error: pageError, isLoading: pageLoading } = useQuery({ queryKey: pageKey, queryFn: () => listCriticalAssetsPage(siteId, filters, search, page, PAGE_SIZE), enabled: Boolean(siteId) && hydrated && view === 'assets', placeholderData: keepPreviousData });
  // The server render has no query data, so it is always "loading" until hydration finishes.
  const loading = hydrated ? (view === 'assets' ? pageLoading : isLoading) : true;
  const error = hydrated ? queryError ?? (view === 'assets' ? pageError : null) : null;
  const groups = (hydrated && queryGroups) || noGroups;
  const storedLocale = hydrated ? getLocalItem(STORAGE_KEYS.locale) : null;
  const locale = isAppLocale(storedLocale) ? storedLocale : 'pt-PT';
  const formatDate = useCallback((value?: string | null, withTime = false) => {
    if (!value) return '—';
    const date = new Date(value.length === 10 ? `${value}T00:00:00.000Z` : value);
    return withTime ? new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeStyle: 'short' }).format(date) : new Intl.DateTimeFormat(locale, { dateStyle: 'short', timeZone: 'UTC' }).format(date);
  }, [locale]);

  const rows = useMemo(() => buildRows(data), [data]);
  useEffect(() => {
    if (openedLink.current || !rows.length) return;
    const query = new URLSearchParams(window.location.search);
    const asset = rows.find((row) => row.id === query.get('assetId'));
    if (!asset) return;
    openedLink.current = true;
    setDetailId(asset.id);
    setLinkedWeek(query.get('week') ?? '');
  }, [rows]);
  const counts = useMemo(() => countRows(rows), [rows]);
  const pageRows = useMemo(() => (pageData?.items ?? []).map((asset) => toRow(asset, data?.mappings ?? [])), [pageData, data?.mappings]);
  const total = pageData?.total ?? 0;
  const pageCount = Math.max(1, Math.ceil(total / PAGE_SIZE));
  const owners = useMemo(() => {
    const byId = new Map<string, Group>();
    for (const group of [...(data?.mappings.map((mapping) => mapping.group) ?? []), ...groups]) byId.set(group.id, group);
    return [...byId.values()].sort((a, b) => a.name.localeCompare(b.name));
  }, [data?.mappings, groups]);
  const eligible = (row: AssetRow) => canReview && row.pending.length > 0;
  // Only reviewable rows count; the selection is cleared whenever search or filters change, so a bulk action never mixes filters.
  const selectedRows = [...selection.values()].filter(eligible);
  const selectedIds = useMemo(() => new Set(selection.keys()), [selection]);
  const bulkItems: BulkItem[] = selectedRows.flatMap((row) => { const attestation = currentCycle(row); return attestation ? [{ key: attestation.id, attestationId: attestation.id, assetName: row.name, weekStart: attestation.weekStart }] : []; });
  const bulkOlder = selectedRows.filter(hasOlderPending).length;
  const detail = rows.find((row) => row.id === detailId) ?? null;
  // Dependencies: topology connections that name this device at either end (search matches the device name, so filter by id).
  const { data: connectionData } = useQuery({ queryKey: criticalAssetsKeys.connections(siteId, detail?.id), queryFn: () => listAssetConnections(siteId, detail?.name ?? ''), enabled: Boolean(detail && siteId && hydrated) });
  const dependencies = detail ? (connectionData?.items ?? []).filter((item) => item.sourceDevice.id === detail.id || item.targetDevice.id === detail.id).map((item) => (item.sourceDevice.id === detail.id ? { item, other: item.targetDevice, direction: ui('criticalAssets.detail.linksTo') } : { item, other: item.sourceDevice, direction: ui('criticalAssets.detail.linksFrom') })) : [];
  // The compliance view and CSV export use the full asset list, not the current page: acceptable at current site sizes; move to a server aggregate if a site outgrows it.
  const compliance = useMemo(() => complianceCells(rows), [rows]);
  const correctionRows = (correctionData?.items ?? []).filter((item) => (correctionTab === 'open' ? item.status === 'OPEN' : item.status !== 'OPEN'));
  const openCorrectionCount = (correctionData?.items ?? []).filter((item) => item.status === 'OPEN').length;
  const filtering = hasActiveFilters(search, filters);

  // After a Site switch the owner filter may name a group of the previous Site: clear it (no history entry)
  // once this Site's assets, and for admins its groups, have loaded, so an empty list while loading never clears it.
  const ownersLoaded = Boolean(data) && (!isAdmin || queryGroups !== undefined);
  useEffect(() => {
    if (!ownersLoaded || !filters.owner || filters.owner === NO_OWNER) return;
    const known = owners.some((group) => group.id === filters.owner) || rows.some((row) => row.owner?.id === filters.owner);
    if (!known) setFilter('owner', '', { replace: true });
  }, [ownersLoaded, filters.owner, owners, rows, setFilter]);

  const remember = () => { returnFocus.current = document.activeElement instanceof HTMLElement ? document.activeElement : null; };
  const restoreFocus = () => { const target = returnFocus.current; returnFocus.current = null; window.setTimeout(() => target?.isConnected && target.focus(), 0); };
  const openDetail = (row: AssetRow) => { remember(); setLinkedWeek(''); setDetailId(row.id); };
  const closeDetail = () => { setDetailId(''); restoreFocus(); };
  const openReview = (asset: AssetRow, attestation: Attestation) => { if (!detailId) remember(); setReview({ asset, attestation }); };
  const closeReview = () => { setReview(null); if (!detailId) restoreFocus(); };
  const openRequest = (asset: AssetRow, attestation: Attestation) => { if (!detailId) remember(); setRequest({ asset, attestation }); };
  const closeRequest = () => { setRequest(null); if (!detailId) restoreFocus(); };
  /** A new search or filter starts a new result set: the page goes back to 1 and the selection is cleared. */
  const changeSearch = (value: string) => { setPage(1); setSelection(new Map()); setSearch(value); };
  const changeFilter = (key: keyof Filters, value: string) => { setPage(1); setSelection(new Map()); setFilter(key, value); };
  const clearFilters = () => { setPage(1); setSelection(new Map()); clearUrlFilters(); };
  const setRowsSelected = (next: Set<string>) => setSelection((current) => {
    const map = new Map<string, AssetRow>();
    for (const id of next) {
      const row = current.get(id) ?? pageRows.find((item) => item.id === id);
      if (row) map.set(id, row);
    }
    return map;
  });
  const openOwner = (type: string) => { if (!detailId) remember(); setOwnerType(type); };
  const closeOwner = () => { setOwnerType(null); if (!detailId) restoreFocus(); };
  const closeBulk = () => { if (bulkRunning) return; setBulkPlan(null); setBulkResults(null); restoreFocus(); };

  const closeTopmost = useRef<() => void>(() => undefined);
  closeTopmost.current = () => {
    if (review) closeReview();
    else if (request) closeRequest();
    else if (ownerType !== null) closeOwner();
    else if (bulkPlan) closeBulk();
    else if (detailId) closeDetail();
  };
  useEffect(() => {
    const onKey = (event: KeyboardEvent) => { if (event.key === 'Escape') closeTopmost.current(); };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);
  const panelClose = useRef<HTMLButtonElement>(null);
  useEffect(() => { if (detailId) panelClose.current?.focus(); }, [detailId]);

  const refresh = () => queryClient.invalidateQueries({ queryKey: criticalAssetsKeys.all });
  // The full list is patched at once; the paged table refetches with the rest of the 'critical-assets' queries.
  const applySaved = (saved: Attestation) => queryClient.setQueryData<CriticalAssetsResult>(queryKey, (current) => withRecordedAttestation(current, saved));

  /** Single review. Returns an error text for the dialog, or null on success. */
  const record = async (asset: AssetRow, attestation: Attestation, outcome: Outcome, notes?: string): Promise<string | null> => {
    setNotice(null);
    try {
      const saved = await confirmAttestation(attestation.id, outcome, notes);
      applySaved({ ...saved, id: attestation.id });
      setNotice({ tone: 'success', text: outcome === 'CONFIRMED' ? ui('criticalAssets.notice.confirmed', undefined, { name: asset.name }) : ui('criticalAssets.notice.correctionRequested', undefined, { name: asset.name }) });
      void refresh();
      return null;
    } catch (cause) {
      const text = errorText(cause, ui('criticalAssets.error.record'));
      if (isAlreadyRecorded(cause)) { setNotice({ tone: 'error', text }); void refresh(); return null; }
      setNotice({ tone: 'error', text });
      return text;
    }
  };
  const quickConfirm = (asset: AssetRow) => { const attestation = asset.pending[0]; if (attestation) void record(asset, attestation, 'CONFIRMED'); };
  const submitReview = async (notes: string) => {
    if (!review) return null;
    const failure = await record(review.asset, review.attestation, 'CONFIRMED', notes);
    if (!failure) closeReview();
    return failure;
  };
  const submitRequest = async (description: string) => {
    if (!request) return null;
    const failure = await record(request.asset, request.attestation, 'NEEDS_CORRECTION', description);
    if (!failure) closeRequest();
    return failure;
  };

  /** Adds every reviewable asset that matches the current filters, across all pages, to the selection. */
  const selectAllMatching = async () => {
    setSelectingAll(true);
    setNotice(null);
    try {
      const collected: AssetRow[] = [];
      const pages = Math.ceil(total / MAX_SERVER_PAGE);
      for (let number = 1; number <= pages; number += 1) {
        const response = await listCriticalAssetsPage(siteId, filters, search, number, MAX_SERVER_PAGE);
        collected.push(...response.items.map((asset) => toRow(asset, data?.mappings ?? [])));
      }
      setSelection((current) => {
        const next = new Map(current);
        for (const row of collected) if (eligible(row)) next.set(row.id, row);
        return next;
      });
    } catch (cause) {
      setNotice({ tone: 'error', text: errorText(cause, ui('criticalAssets.error.selectAll')) });
    }
    setSelectingAll(false);
  };

  const runBulk = async () => {
    if (!bulkPlan) return;
    setBulkRunning(true);
    const results: Record<string, BulkResult> = {};
    setBulkResults(results);
    for (let start = 0; start < bulkPlan.items.length; start += BULK_CHUNK) {
      const chunk = bulkPlan.items.slice(start, start + BULK_CHUNK);
      try {
        // One request per chunk, one transaction on the server; it answers with a result per item.
        const response = await confirmAttestations(chunk.map((item) => item.attestationId));
        const byId = new Map(response.results.map((result) => [result.id, result]));
        for (const item of chunk) {
          const result = byId.get(item.attestationId);
          if (!result) results[item.key] = { key: item.key, state: 'failed', message: ui('criticalAssets.bulk.noResponse') };
          else if (result.ok) results[item.key] = { key: item.key, state: 'recorded' };
          else results[item.key] = result.code === 'ALREADY_RECORDED' ? { key: item.key, state: 'already', message: result.message } : { key: item.key, state: 'failed', message: result.message };
        }
      } catch (cause) {
        const message = errorText(cause, ui('criticalAssets.error.bulk'));
        for (const item of chunk) results[item.key] = { key: item.key, state: 'failed', message };
      }
      setBulkResults({ ...results });
    }
    setBulkRunning(false);
    setSelection(new Map());
    void refresh();
  };

  const closeCorrection = async (correction: Correction, outcome: 'RESOLVED' | 'REJECTED', value: string): Promise<string | null> => {
    try {
      await postCloseCorrection(correction.id, outcome, value);
      setNotice({ tone: 'success', text: outcome === 'RESOLVED' ? ui('groupB.assets.correctionResolved', undefined, { name: correction.device?.name ?? ui('groupB.assets.asset') }) : ui('groupB.assets.correctionRejected', undefined, { name: correction.device?.name ?? ui('groupB.assets.asset') }) });
      setCorrectionDialog(null);
      await queryClient.invalidateQueries({ queryKey: criticalAssetsKeys.correctionsAll });
      return null;
    } catch (cause) {
      return errorText(cause, ui('criticalAssets.error.closeCorrection'));
    }
  };

  const saveOwner = async (input: { assetType: string; groupId: string; timezone: string }) => {
    try {
      await saveOwnerMapping(siteId, input);
      setNotice({ tone: 'success', text: ui('criticalAssets.notice.ownerSaved', undefined, { type: input.assetType }) });
      setOwnerType(null);
      if (!detailId) restoreFocus();
      await refresh();
      return null;
    } catch (cause) {
      return errorText(cause, ui('criticalAssets.error.save'));
    }
  };

  const toggleCountFilter = (key: keyof Filters, value: string) => changeFilter(key, filters[key] === value ? '' : value);

  const columns: DataTableColumn<AssetRow>[] = [
    {
      id: 'name', header: ui('criticalAssets.column.asset'), sortValue: (row) => row.name,
      cell: (row) => <><button className="link-button" aria-label={ui('criticalAssets.row.openHistory', undefined, { name: row.name })} onClick={() => openDetail(row)}>{row.name}</button>{row.criticalityTier && <span className="state-badge" title={ui('criticalAssets.column.tier')}><i />{row.criticalityTier}</span>}<small className="mono">{[row.hostname, row.managementIp].filter(Boolean).join(' · ') || '—'}</small></>,
      csv: [{ header: ui('criticalAssets.column.asset'), value: (row) => row.name }, { header: 'Hostname', value: (row) => row.hostname }, { header: ui('criticalAssets.column.managementIp'), value: (row) => row.managementIp }, { header: ui('criticalAssets.column.serialNumber'), value: (row) => row.serialNumber }, { header: ui('criticalAssets.column.assetTag'), value: (row) => row.assetTag }],
    },
    { id: 'type', header: ui('criticalAssets.column.type'), sortValue: (row) => row.type, cell: (row) => row.type, csv: [{ header: ui('criticalAssets.column.type'), value: (row) => row.type }] },
    {
      id: 'owner', header: ui('criticalAssets.column.owner'), sortValue: (row) => row.owner?.name,
      cell: (row) => (row.owner ? row.owner.name : <span className="state-badge excluded"><i />{ui('criticalAssets.noOwner')}</span>),
      csv: [{ header: ui('criticalAssets.column.owner'), value: (row) => row.owner?.name ?? ui('criticalAssets.noOwner') }],
    },
    {
      // Groups by result, then by review date; assets never reviewed go last.
      id: 'outcome', header: ui('criticalAssets.column.outcome'), sortValue: (row) => (row.latestOutcome ? `${outcomeLabelKey(row.latestOutcome)}|${row.latestConfirmedAt ?? ''}` : null),
      cell: (row) => (row.latestOutcome ? <><span className={`state-badge ${outcomeTone(row.latestOutcome)}`}><i />{ui(outcomeLabelKey(row.latestOutcome))}</span><small>{formatDate(row.latestConfirmedAt, true)}{row.latestReviewer ? ` · ${row.latestReviewer}` : ''}</small></> : <span className="muted-cell">{ui('criticalAssets.noReview')}</span>),
      csv: [{ header: ui('criticalAssets.column.outcome'), value: (row) => ui(row.latestOutcome ? outcomeLabelKey(row.latestOutcome) : 'criticalAssets.noReview') }, { header: ui('criticalAssets.csv.outcomeDate'), value: (row) => row.latestConfirmedAt }, { header: ui('criticalAssets.csv.reviewer'), value: (row) => row.latestReviewer }],
    },
    {
      // Same order as the default view (overdue first), then by due date.
      id: 'due', header: ui('criticalAssets.column.due'), sortValue: (row) => `${dueOrder[row.dueState]}|${row.dueDate ?? ''}`,
      cell: (row) => <><span className={`state-badge ${dueTone[row.dueState]}`}><i />{ui(dueLabelKey(row.dueState))}</span>{row.dueDate && row.dueState !== 'unscheduled' && <small>{row.dueState === 'up_to_date' ? ui('criticalAssets.due.next') : ui('criticalAssets.column.due')}: {formatDate(row.dueDate, true)}</small>}{!row.owner && row.pendingCount > 0 ? <small>{ui('criticalAssets.due.pendingNoOwner', undefined, { count: row.pendingCount })}</small> : row.pendingCount > 1 && <small>{ui('criticalAssets.due.pendingWeeks', undefined, { count: row.pendingCount })}</small>}</>,
      csv: [{ header: ui('criticalAssets.column.due'), value: (row) => ui(dueLabelKey(row.dueState)) }, { header: ui('criticalAssets.csv.dueDate'), value: (row) => row.dueDate }, { header: ui('criticalAssets.csv.pendingReviews'), value: (row) => row.pendingCount }],
    },
    {
      id: 'actions', header: ui('criticalAssets.column.actions'), className: 'table-actions',
      cell: (row) => <>
        {eligible(row) && <><button className="secondary-button" aria-label={ui('criticalAssets.review.title', undefined, { name: row.name })} onClick={() => quickConfirm(row)}>{ui('criticalAssets.row.confirm')}</button><button className="secondary-button" aria-label={ui('criticalAssets.request.title', undefined, { name: row.name })} onClick={() => openRequest(row, row.pending[0])}>{ui('criticalAssets.row.requestCorrection')}</button></>}
        {isAdmin && !row.owner && <button className="secondary-button" aria-label={ui('criticalAssets.row.assignOwnerTo', undefined, { name: row.name })} onClick={() => openOwner(row.type)}>{ui('criticalAssets.owner.assign')}</button>}
      </>,
    },
  ];
  // The table shows one server page, sorted within that page; the CSV export covers every matching row of the full list.
  const sorted = sortByColumns(pageRows, columns, table.sort);
  const exported = sortByColumns(filterRows(rows, search, filters), columns, table.sort);
  // The page's text translator never sees the CSV file: headers and status labels come from the messages above.
  const csvColumns = csvColumnsOf(columns);

  const countButtons: Array<{ label: string; value: number; key: keyof Filters; filter: string }> = [
    { label: ui('criticalAssets.dueState.overdue'), value: counts.overdue, key: 'due', filter: 'overdue' },
    { label: ui('criticalAssets.dueState.due_this_week'), value: counts.dueThisWeek, key: 'due', filter: 'due_this_week' },
    { label: ui('criticalAssets.outcome.needsCorrection'), value: counts.needsCorrection, key: 'outcome', filter: 'NEEDS_CORRECTION' },
    { label: ui('criticalAssets.noOwner'), value: counts.noOwner, key: 'owner', filter: NO_OWNER },
    { label: ui('criticalAssets.tier.count.T1'), value: rows.filter((row) => row.criticalityTier === 'T1').length, key: 'tier', filter: 'T1' },
    { label: ui('criticalAssets.tier.count.T2'), value: rows.filter((row) => row.criticalityTier === 'T2').length, key: 'tier', filter: 'T2' },
    { label: ui('criticalAssets.tier.count.T3'), value: rows.filter((row) => row.criticalityTier === 'T3').length, key: 'tier', filter: 'T3' },
  ];

  const correctionColumns: DataTableColumn<Correction>[] = [
    { id: 'asset', header: ui('criticalAssets.column.asset'), sortValue: (item) => item.device?.name ?? '', cell: (item) => <EntityLink kind="device" id={item.device?.id ?? ''} label={item.device?.name ?? '—'} siteId={siteId}>{item.device?.name ?? '—'}</EntityLink>, csv: [{ header: ui('criticalAssets.column.asset'), value: (item) => item.device?.name }] },
    { id: 'request', header: ui('criticalAssets.corrections.request'), cell: (item) => <>{item.description}<small>{formatDate(item.requestedAt, true)}</small></>, csv: [{ header: ui('criticalAssets.corrections.request'), value: (item) => item.description }, { header: ui('criticalAssets.csv.requestedAt'), value: (item) => item.requestedAt }] },
    { id: 'group', header: ui('criticalAssets.column.owner'), cell: (item) => item.groupName ?? '—', csv: [{ header: ui('criticalAssets.column.owner'), value: (item) => item.groupName }] },
    {
      id: 'status', header: ui('criticalAssets.column.status'), cell: (item) => <>
        <span className={`state-badge ${item.status === 'OPEN' ? 'reserved' : item.status === 'RESOLVED' ? 'occupied' : 'excluded'}`}><i />{ui(`criticalAssets.corrections.status.${item.status}`)}</span>
        {item.status !== 'OPEN' && <small>{[formatDate(item.closedAt, true), item.changeReference || item.closeNote].filter(Boolean).join(' · ')}</small>}
      </>,
      csv: [{ header: ui('criticalAssets.column.status'), value: (item) => item.status }, { header: ui('criticalAssets.csv.closedAt'), value: (item) => item.closedAt }, { header: ui('criticalAssets.csv.reference'), value: (item) => item.changeReference || item.closeNote }],
    },
    {
      id: 'actions', header: ui('criticalAssets.column.actions'), className: 'table-actions', cell: (item) => item.status === 'OPEN' && canReview ? <>
        <button className="secondary-button" aria-label={ui('groupB.assets.resolveCorrection', undefined, { name: item.device?.name ?? ui('groupB.assets.asset') })} onClick={() => setCorrectionDialog({ correction: item, outcome: 'RESOLVED' })}>{ui('criticalAssets.corrections.resolve')}</button>
        <button className="secondary-button" aria-label={ui('groupB.assets.rejectCorrection', undefined, { name: item.device?.name ?? ui('groupB.assets.asset') })} onClick={() => setCorrectionDialog({ correction: item, outcome: 'REJECTED' })}>{ui('criticalAssets.corrections.reject')}</button>
      </> : null,
    },
  ];
  const complianceColumns: DataTableColumn<string>[] = [
    { id: 'group', header: ui('criticalAssets.column.owner'), cell: (group) => group, csv: [{ header: ui('criticalAssets.column.owner'), value: (group) => group }] },
    ...compliance.weeks.map((week): DataTableColumn<string> => ({
      id: `week-${week}`, header: ui('groupB.assets.weekOf', undefined, { date: formatDate(week) }),
      cell: (group) => { const cell = compliance.cells.find((item) => item.group === group && item.weekStart === week); return cell && cell.expected ? <>{`${cell.percent}%`}<small>{ui('groupB.assets.onTime', undefined, { onTime: cell.onTime, expected: cell.expected })}</small></> : <span className="muted-cell">—</span>; },
      csv: [{ header: ui('groupB.assets.weekOfPercent', undefined, { date: formatDate(week) }), value: (group) => compliance.cells.find((item) => item.group === group && item.weekStart === week)?.percent ?? '' }],
    })),
  ];
  const complianceCsvColumns: Array<{ header: string; value: (cell: ComplianceCell) => string | number | null | undefined }> = [
    { header: ui('criticalAssets.column.owner'), value: (cell) => cell.group }, { header: ui('criticalAssets.column.week'), value: (cell) => cell.weekStart }, { header: ui('criticalAssets.csv.reviews'), value: (cell) => cell.expected }, { header: ui('criticalAssets.csv.onTime'), value: (cell) => cell.onTime }, { header: ui('criticalAssets.csv.percent'), value: (cell) => cell.percent ?? '' },
  ];

  const actions = <>
    <CsvExportButton rows={exported} columns={csvColumns} fileName="ativos-criticos" />
    {isAdmin && <button className="secondary-button" aria-label={ui('criticalAssets.toolbar.owners')} title={ui('criticalAssets.toolbar.owners')} onClick={() => openOwner(assetTypes[0])}><Users size={14} /> <span className="toolbar-action-label">{ui('criticalAssets.toolbar.owners')}</span></button>}
    {canReview && <button className="primary-button" disabled={!selectedRows.length} onClick={() => { remember(); setBulkResults(null); setBulkPlan({ selectedCount: selectedRows.length, olderCount: bulkOlder, items: bulkItems }); }}><ShieldCheck size={14} /> {ui('criticalAssets.toolbar.confirmSelected', undefined, { count: selectedRows.length })}</button>}
  </>;

  return <PageShell section={ui('criticalAssets.page.title')} search={{ value: search, onChange: changeSearch, placeholder: ui('criticalAssets.page.searchPlaceholder'), ariaLabel: ui('criticalAssets.page.searchLabel') }} actions={actions}>
    <PageToolbarPortal><div className="interface-toolbar-controls critical-assets-filters">
      <label><span className="toolbar-filter-label">{ui('criticalAssets.column.type')}</span><select aria-label={ui('criticalAssets.filter.type')} title={ui('criticalAssets.filter.type')} value={filters.type} onChange={(event) => changeFilter('type', event.target.value)}><option value="">{ui('criticalAssets.column.type')}</option>{assetTypes.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>
      <label><span className="toolbar-filter-label">{ui('criticalAssets.filter.ownerLabel')}</span><select aria-label={ui('criticalAssets.filter.owner')} title={ui('criticalAssets.filter.owner')} value={filters.owner} onChange={(event) => changeFilter('owner', event.target.value)}><option value="">{ui('criticalAssets.filter.ownerLabel')}</option><option value={NO_OWNER}>{ui('criticalAssets.noOwner')}</option>{owners.map((group) => <option key={group.id} value={group.id}>{group.name}</option>)}</select></label>
      <label><span className="toolbar-filter-label">{ui('criticalAssets.column.outcome')}</span><select aria-label={ui('criticalAssets.filter.outcome')} title={ui('criticalAssets.filter.outcome')} value={filters.outcome} onChange={(event) => changeFilter('outcome', event.target.value)}><option value="">{ui('criticalAssets.column.outcome')}</option><option value="CONFIRMED">{ui('criticalAssets.outcome.confirmed')}</option><option value="NEEDS_CORRECTION">{ui('criticalAssets.outcome.needsCorrection')}</option><option value={NO_OUTCOME}>{ui('criticalAssets.noReview')}</option></select></label>
      <label><span className="toolbar-filter-label">{ui('criticalAssets.column.due')}</span><select aria-label={ui('criticalAssets.filter.due')} title={ui('criticalAssets.filter.due')} value={filters.due} onChange={(event) => changeFilter('due', event.target.value)}><option value="">{ui('criticalAssets.column.due')}</option>{dueStates.map((state) => <option key={state} value={state}>{ui(dueLabelKey(state))}</option>)}</select></label>
      <label><span className="toolbar-filter-label">{ui('criticalAssets.column.tier')}</span><select aria-label={ui('criticalAssets.filter.tier')} title={ui('criticalAssets.filter.tier')} value={filters.tier} onChange={(event) => changeFilter('tier', event.target.value)}><option value="">{ui('criticalAssets.column.tier')}</option><option value="T1">{ui('criticalAssets.tier.option.T1')}</option><option value="T2">{ui('criticalAssets.tier.option.T2')}</option><option value="T3">{ui('criticalAssets.tier.option.T3')}</option></select></label>
      {filtering && <button className="secondary-button" onClick={clearFilters}><X size={14} /> {ui('criticalAssets.filter.clear')}</button>}
    </div></PageToolbarPortal>
    <div className="module-page aligned-workspace"><section className="ipam-card page-primary-card critical-assets-card">
      <div className="panel-heading"><div><h1>{ui('criticalAssets.page.title')}</h1><p className="panel-description">{ui('criticalAssets.page.description')}</p></div></div>
      {error && <div className="ipam-alert error" role="alert"><X size={15} />{ui('criticalAssets.page.loadError')}</div>}
      {notice && <div className={`ipam-alert ${notice.tone}`} role={notice.tone === 'error' ? 'alert' : 'status'}>{notice.tone === 'success' ? <CheckCircle2 size={15} /> : <X size={15} />}{notice.text}</div>}

      <div className="critical-assets-views" role="group" aria-label={ui('criticalAssets.views.label')}>
        <button type="button" aria-pressed={view === 'assets'} className={view === 'assets' ? 'active' : ''} onClick={() => setView('assets')}>{ui('criticalAssets.views.assets')}</button>
        <button type="button" aria-pressed={view === 'corrections'} className={view === 'corrections' ? 'active' : ''} onClick={() => setView('corrections')}>{ui('criticalAssets.views.corrections', undefined, { count: openCorrectionCount })}</button>
        <button type="button" aria-pressed={view === 'compliance'} className={view === 'compliance' ? 'active' : ''} onClick={() => setView('compliance')}>{ui('criticalAssets.views.compliance')}</button>
      </div>
      {view === 'assets' && <>
      <div className="summary-stats settings-audit-stats critical-assets-counts" role="group" aria-label={ui('criticalAssets.counts.label')}>
        {countButtons.map((item) => <button key={item.label} type="button" aria-pressed={filters[item.key] === item.filter} className={filters[item.key] === item.filter ? 'active' : ''} onClick={() => toggleCountFilter(item.key, item.filter)}><strong>{item.value}</strong><span>{item.label}</span></button>)}
      </div>

      <h2 className="critical-assets-count" aria-live="polite">{filtering ? ui('criticalAssets.counts.filtered', undefined, { shown: total, total: rows.length }) : ui('criticalAssets.counts.all', undefined, { count: rows.length })}</h2>
      {canReview && total > pageRows.length && <div className="table-actions"><button className="secondary-button" disabled={selectingAll} onClick={() => void selectAllMatching()}>{selectingAll ? ui('criticalAssets.selectingAll') : ui('groupB.assets.selectAllMatching', undefined, { count: total })}</button></div>}
      <DataTable
        rows={sorted}
        columns={columns}
        rowKey={(row) => row.id}
        label={ui('criticalAssets.page.title')}
        className="critical-assets-table"
        sort={table.sort}
        onSortChange={table.setSort}
        defaultSort={table.defaultSort}
        loading={loading}
        selection={canReview ? { selected: selectedIds, onChange: setRowsSelected, isSelectable: eligible, rowLabel: (row, selectable) => (selectable ? ui('criticalAssets.row.select', undefined, { name: row.name }) : ui('criticalAssets.row.notSelectable', undefined, { name: row.name })), allLabel: ui('criticalAssets.row.selectAll') } : undefined}
        empty={error ? null : <Empty title={filtering ? ui('criticalAssets.empty.filteredTitle') : ui('criticalAssets.empty.title')} text={filtering ? ui('criticalAssets.empty.filteredText') : ui('criticalAssets.empty.text')} />}
      />
      {total > PAGE_SIZE && <nav className="table-actions" aria-label={ui('criticalAssets.pagination.label')}>
        <button className="secondary-button" disabled={page <= 1} onClick={() => setPage((current) => Math.max(1, current - 1))}>{ui('common.previous')}</button>
        <span>{ui('ui.pageOf', undefined, { page, total: pageCount })}</span>
        <button className="secondary-button" disabled={page >= pageCount} onClick={() => setPage((current) => Math.min(pageCount, current + 1))}>{ui('common.next')}</button>
      </nav>}
      </>}
      {view === 'corrections' && <>
        <div className="critical-assets-views" role="group" aria-label={ui('criticalAssets.corrections.tabsLabel')}>
          <button type="button" aria-pressed={correctionTab === 'open'} className={correctionTab === 'open' ? 'active' : ''} onClick={() => setCorrectionTab('open')}>{ui('criticalAssets.corrections.open')}</button>
          <button type="button" aria-pressed={correctionTab === 'closed'} className={correctionTab === 'closed' ? 'active' : ''} onClick={() => setCorrectionTab('closed')}>{ui('criticalAssets.corrections.closed')}</button>
        </div>
        {correctionsError && <div className="ipam-alert error" role="alert"><X size={15} />{ui('criticalAssets.corrections.loadError')}</div>}
        <DataTable rows={correctionRows} columns={correctionColumns} rowKey={(item) => item.id} label={ui('criticalAssets.corrections.label')} className="critical-assets-table" loading={correctionsLoading} empty={<Empty title={correctionTab === 'open' ? ui('criticalAssets.corrections.emptyOpen') : ui('criticalAssets.corrections.emptyClosed')} text={ui('criticalAssets.corrections.emptyText')} />} />
      </>}
      {view === 'compliance' && <>
        <p className="panel-description">{ui('groupB.assets.complianceDescription', undefined, { count: compliance.weeks.length })}</p>
        <div className="table-actions"><CsvExportButton rows={compliance.cells} columns={complianceCsvColumns} fileName="conformidade-ativos-criticos" /></div>
        <DataTable rows={compliance.groups} columns={complianceColumns} rowKey={(group) => group} label={ui('criticalAssets.views.compliance')} className="critical-assets-table" empty={<Empty title={ui('criticalAssets.compliance.emptyTitle')} text={ui('criticalAssets.compliance.emptyText')} />} />
      </>}
    </section></div>

    {detail && <aside className="host-panel critical-assets-panel" aria-label={ui('criticalAssets.detail.historyOf', undefined, { name: detail.name })}>
      <div className="host-panel-head"><div><h2>{detail.name}</h2><span>{detail.type} · {detail.owner?.name ?? ui('criticalAssets.noOwner')}</span></div><button ref={panelClose} className="icon-button" onClick={closeDetail} aria-label={ui('criticalAssets.close')}><X size={18} /></button></div>
      <div className="host-status-line">
        <span>{ui('criticalAssets.detail.due')} <strong>{ui(dueLabelKey(detail.dueState))}</strong></span>
        <span>{ui('criticalAssets.detail.outcome')} <strong>{ui(detail.latestOutcome ? outcomeLabelKey(detail.latestOutcome) : 'criticalAssets.noReview')}</strong></span>
        <span>{ui('criticalAssets.detail.pending')} <strong>{detail.pendingCount}</strong></span>
      </div>
      <div className="host-detail-grid">
        <div><span>Hostname</span><strong>{detail.hostname || '—'}</strong></div>
        <div><span>{ui('criticalAssets.column.managementIp')}</span><strong className="mono">{detail.managementIp || '—'}</strong></div>
        <div><span>{ui('criticalAssets.column.serialNumber')}</span><strong>{detail.serialNumber || '—'}</strong></div>
        <div><span>{ui('criticalAssets.column.assetTag')}</span><strong>{detail.assetTag || '—'}</strong></div>
        <div><span>{ui('criticalAssets.column.status')}</span><strong>{detail.status}</strong></div>
        <div><span>{ui('criticalAssets.column.owner')}</span><strong>{detail.owner?.name ?? ui('criticalAssets.noOwner')}</strong></div>
      </div>
      <div className="form-actions">
        <EntityLink kind="device" id={detail.id} label={detail.name} siteId={siteId} className="secondary-button"><Server size={14} /> {ui('criticalAssets.detail.openDevice')}</EntityLink>
        {isAdmin && <button className="secondary-button" onClick={() => openOwner(detail.type)}><Users size={14} /> {detail.owner ? ui('criticalAssets.detail.changeOwner') : ui('criticalAssets.owner.assign')}</button>}
      </div>
      <section className="critical-assets-dependencies" aria-label={ui('criticalAssets.detail.dependencies')}>
        <h3>{ui('groupB.assets.dependencies', undefined, { count: dependencies.length })}</h3>
        {dependencies.length ? <ul>{dependencies.map(({ item, other, direction }) => <li key={item.id}><span>{direction}</span> <EntityLink kind="device" id={other.id} label={other.name} siteId={siteId}>{other.name}</EntityLink>{item.label && <small>{item.label}</small>}</li>)}</ul> : <p className="panel-description">{ui('criticalAssets.detail.noDependencies')}</p>}
      </section>
      <HistoryBlock
        heading={ui('criticalAssets.detail.reviewHistory', undefined, { count: detail.attestations.length })}
        formatDate={(value) => formatDate(value, true)}
        empty={ui('criticalAssets.detail.noReviews')}
        events={detail.attestations.map((attestation) => ({
          id: attestation.id,
          title: <>{ui('groupB.assets.weekOf', undefined, { date: formatDate(attestation.weekStart) })}{attestation.weekStart.slice(0, 10) === linkedWeek && <> · {ui('criticalAssets.detail.linkedReview')}</>}</>,
          status: <span className={`state-badge ${outcomeTone(attestation.outcome)}`}><i />{ui(outcomeLabelKey(attestation.outcome))}</span>,
          at: attestation.outcome ? attestation.confirmedAt : null,
          actor: attestation.outcome ? attestation.confirmedByName ?? ui('criticalAssets.detail.unknownReviewer') : null,
          note: attestation.notes,
          actions: !attestation.outcome && canReview ? <div className="table-actions">
            <button className="secondary-button" onClick={() => openReview(detail, attestation)}>{ui('criticalAssets.row.confirm')}</button>
            <button className="secondary-button" onClick={() => openRequest(detail, attestation)}>{ui('criticalAssets.row.requestCorrection')}</button>
          </div> : null,
        }))}
      />
    </aside>}

    {review && <ReviewDialog key={review.attestation.id} asset={review.asset} attestation={review.attestation} formatDate={formatDate} close={closeReview} submit={submitReview} />}
    {request && <CorrectionRequestDialog key={`request-${request.attestation.id}`} asset={request.asset} attestation={request.attestation} formatDate={formatDate} close={closeRequest} submit={submitRequest} />}
    {correctionDialog && <CorrectionCloseDialog assetName={correctionDialog.correction.device?.name ?? ui('groupB.assets.asset')} description={correctionDialog.correction.description} outcome={correctionDialog.outcome} close={() => setCorrectionDialog(null)} submit={(value) => closeCorrection(correctionDialog.correction, correctionDialog.outcome, value)} />}
    {ownerType !== null && <OwnerDialog initialType={ownerType} mappings={data?.mappings ?? []} groups={groups} timezone={data?.timezone ?? 'Europe/Lisbon'} close={closeOwner} save={saveOwner} />}
    {bulkPlan && <BulkConfirmDialog selectedCount={bulkPlan.selectedCount} olderCount={bulkPlan.olderCount} items={bulkPlan.items} results={bulkResults} running={bulkRunning} formatDate={formatDate} close={closeBulk} run={() => void runBulk()} />}
  </PageShell>;
}
