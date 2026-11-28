'use client';

import { isLocalDateTime } from '@/lib/format/date';
import { DateTimeInput } from '@/components/ui/date-time-input';
import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { CalendarDays, List, X, RefreshCw } from 'lucide-react';
import { PageShell, PageToolbarPortal } from '@/components/layout/app-shell';
import { CsvExportButton, DataTable, EntityLink, HistoryBlock, SavedViews, sortByColumns, useTableUrlState, type CsvColumn, type DataTableColumn } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { cancelChangePlan, createChangePlan, getChangeActivity, getChangeCalendar, getChangeCandidates, getChangePlan, getChangeSummary, listChangePlans, previewChangePlan, reviewChangePlan, submitChangePlan, updateChangePlan, type ChangeActivity, type ChangeCandidate, type ChangeDraft, type ChangeEntityType, type ChangeItem, type ChangePlan, type ChangeSummary, type ImpactNode, type ImpactPreview } from './api';
import { formatDateTime } from '@/lib/format/date';
import { ChangeCalendar } from './change-calendar';
import { ChangeExecution } from './change-execution';
import { translateMessage } from '@/lib/i18n/i18n';
import { statusTabText, statusText, typeText, useChangeT } from './i18n';
import { PlanImpactSection } from './plan-impact';
import { activityTone, buildTimeline, calendarChunks, calendarRange, candidateKey, candidateLabels, changeStatuses, changeTableConfig, changeTypes, dayBoundary, emptyOverlapData, filterPlans, mergeCalendars, overlapsFor, parseMonth, personName, spanOf, targetLabel, type OverlapData } from './workspace';

const blankDraft = (): ChangeDraft => ({ siteId: '', title: '', reason: '', plannedStartAt: '', plannedEndAt: '', items: [] });
const localInput = (value?: string) => { if (!value) return ''; const date = new Date(value); const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000); return local.toISOString().slice(0, 16); };
const isoValue = (value: string) => value ? new Date(value).toISOString() : '';
/**
 * A new draft copied from a plan: same Site, reason and targets (only the fields the API accepts),
 * title prefixed with "Cópia de". The planned window is kept only while it is still in the future;
 * otherwise it is left empty so a new window is chosen before saving.
 */
export function duplicateDraft(plan: ChangePlan, copyPrefix = translateMessage('pt-PT', 'changePlans.copyPrefix'), now = Date.now()): ChangeDraft {
  const keepWindow = new Date(plan.plannedStartAt).getTime() > now;
  return {
    siteId: plan.siteId,
    title: `${copyPrefix} ${plan.title}`.slice(0, 160),
    reason: plan.reason,
    plannedStartAt: keepWindow ? localInput(plan.plannedStartAt) : '',
    plannedEndAt: keepWindow ? localInput(plan.plannedEndAt) : '',
    items: plan.items.map(({ entityType, entityId, operationSummary, currentValue, proposedValue }) => ({ entityType, entityId, operationSummary, ...(currentValue ? { currentValue: { ...currentValue } } : {}), ...(proposedValue ? { proposedValue: { ...proposedValue } } : {}) })),
  };
}
const dateTime = (value: string) => formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
const csvDate = (value?: string | null) => (value ? new Date(value) : null);
const noOverlaps = emptyOverlapData();

/** `value` once it has stopped changing for `delay` ms (the first value is used at once). */
function useDebounced<T>(value: T, delay = 250): T {
  const [current, setCurrent] = useState(value);
  useEffect(() => { const timer = window.setTimeout(() => setCurrent(value), delay); return () => window.clearTimeout(timer); }, [value, delay]);
  return current;
}

/**
 * Overlaps for `[from, to)` from `GET /change-plans/calendar` (server-side, so
 * maintenance windows count too), in ≤120-day calls merged together.
 */
function useOverlaps(siteId: string | null | undefined, range: { from: Date; to: Date } | null, refresh: number, includeCancelled = false): { data: OverlapData; failed: boolean } {
  const key = siteId && range ? `${siteId}|${range.from.toISOString()}|${range.to.toISOString()}|${refresh}|${includeCancelled}` : '';
  const [state, setState] = useState<{ key: string; data: OverlapData; failed: boolean }>({ key: '', data: noOverlaps, failed: false });
  useEffect(() => {
    if (!key || !siteId || !range) return;
    let live = true;
    const chunks = calendarChunks(range.from, range.to);
    Promise.all(chunks.map((chunk) => (includeCancelled ? getChangeCalendar(siteId, chunk.from, chunk.to, true) : getChangeCalendar(siteId, chunk.from, chunk.to))))
      .then((results) => { if (live) setState({ key, data: mergeCalendars(results, chunks.some((chunk) => !chunk.complete)), failed: false }); })
      .catch(() => { if (live) setState({ key, data: noOverlaps, failed: true }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- the key covers the Site, the range and refreshes
  }, [key]);
  return state.key === key ? state : { data: noOverlaps, failed: false };
}

type SelectedPlan = ChangePlan & { previewUi?: { revision: number; status: 'calculating' } | { revision: number; status: 'complete'; snapshot: ImpactPreview } };

/** Targets with a detail view open it; the rest have none yet. */
function TargetLink({ item, label, siteId }: { item: ChangeItem; label: string; siteId: string }) {
  if (item.entityType === 'DEVICE') return <EntityLink kind="device" id={item.entityId} label={label} siteId={siteId} />;
  if (item.entityType === 'SUBNET') return <EntityLink kind="subnet" id={item.entityId} label={label} siteId={siteId} />;
  if (item.entityType === 'IP_ADDRESS') return <EntityLink kind="ip" id={item.entityId} label={label} siteId={siteId} />;
  return <>{label}</>;
}

export function ChangePlansPage() {
  const t = useChangeT();
  // The list/detail loaders keep their dependencies; their error text reads the current language from here.
  const tRef = useRef(t);
  useEffect(() => { tRef.current = t; });
  const { siteId, activeSite } = useSiteContext(); const { hasRole } = useAuth();
  const canDraft = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'].some(hasRole); const canReview = hasRole('ADMIN');
  const table = useTableUrlState(changeTableConfig);
  const { search, filters, setSearch, setFilter, setFilters } = table;
  const { confirm, confirmDialog } = useConfirm();
  const [plans, setPlans] = useState<ChangePlan[]>([]); const [candidates, setCandidates] = useState<ChangeCandidate[]>([]); const [candidateLimit, setCandidateLimit] = useState(false);
  const [summary, setSummary] = useState<ChangeSummary | null>(null);
  /** Targets matching the search (`candidates?q=`); `null` when the search matched no target. */
  const [targetMatches, setTargetMatches] = useState<ChangeCandidate[] | null>(null);
  /** Targets picked in the editor from a search, so their labels stay known. */
  const [pickedCandidates, setPickedCandidates] = useState<ChangeCandidate[]>([]);
  const [loading, setLoading] = useState(true); const [refreshTick, setRefreshTick] = useState(0);
  const listRequest = useRef(0);
  const query = useDebounced(search);
  const view = filters.view === 'calendar' ? 'calendar' : 'list';
  const [selected, setSelected] = useState<SelectedPlan | null>(null); const [draft, setDraft] = useState<ChangeDraft>(blankDraft()); const [editorOpen, setEditorOpen] = useState(false);
  const editorBaseline = useRef('');
  // A successful calculation is authoritative while list/detail reads catch up.
  const [previewOverrides, setPreviewOverrides] = useState<Record<string, ImpactPreview>>({});
  const [targetType, setTargetType] = useState<ChangeEntityType>('DEVICE'); const [targetId, setTargetId] = useState(''); const [operation, setOperation] = useState(''); const [currentValue, setCurrentValue] = useState(''); const [proposedValue, setProposedValue] = useState('');
  const [reviewNote, setReviewNote] = useState(''); const [busy, setBusy] = useState(false); const [error, setError] = useState(''); const [notice, setNotice] = useState('');
  const [targetQuery, setTargetQuery] = useState(''); const targetSearch = useDebounced(targetQuery);
  const [targetResults, setTargetResults] = useState<{ key: string; items: ChangeCandidate[]; truncated: boolean } | null>(null);
  const [activity, setActivity] = useState<{ key: string; entries: ChangeActivity[]; failed: boolean } | null>(null);
  const selectedRequest = useRef(0);
  /** `siteId|changeId` the detail view last followed from the URL. */
  const followedChange = useRef<string | null>(null);
  const previousSite = useRef<string | null | undefined>(undefined);
  const targetKey = `${targetType}|${targetSearch.trim()}`;
  const searchedTargets = targetQuery.trim() && targetResults?.key === targetKey ? targetResults : null;
  const visibleCandidates = useMemo(() => (searchedTargets ? searchedTargets.items : candidates).filter((item) => item.entityType === targetType), [searchedTargets, candidates, targetType]);
  const labels = useMemo(() => candidateLabels([...candidates, ...pickedCandidates, ...(targetMatches ?? [])]), [candidates, pickedCandidates, targetMatches]);
  const withSavedPreview = useCallback((plan: ChangePlan): ChangePlan => {
    const preview = previewOverrides[`${plan.id}:${plan.revision}`];
    return preview ? { ...plan, previewRevision: preview.revision, previewSnapshot: preview, previewedAt: preview.generatedAt } : plan;
  }, [previewOverrides]);
  // Targets for labels and the editor: once per Site (the editor searches the rest).
  useEffect(() => {
    if (!siteId) { setCandidates([]); setCandidateLimit(false); return; }
    let live = true;
    getChangeCandidates(siteId).then((result) => { if (live) { setCandidates(result.groups.flat()); setCandidateLimit(result.truncated); } }).catch(() => { if (live) { setCandidates([]); setCandidateLimit(false); } });
    return () => { live = false; };
  }, [siteId]);
  // The list's date range applies to the list view; the calendar shows its own month.
  const listFrom = view === 'list' ? dayBoundary(filters.from) : undefined;
  const listTo = view === 'list' ? dayBoundary(filters.to, true) : undefined;
  const load = useCallback(async () => {
    const requestId = ++selectedRequest.current; const listId = ++listRequest.current;
    const selectedId = selected?.id;
    if (!siteId) { setPlans([]); setSummary(null); setTargetMatches(null); setSelected(null); setLoading(false); return; }
    try {
      // Status, window and text are filtered by the API; a search that names a target also keeps the plans touching it.
      const q = query.trim();
      const serverFilters = { status: filters.status || undefined, from: listFrom, to: listTo };
      const [matches, nextSummary] = await Promise.all([
        q ? getChangeCandidates(siteId, { q, type: filters.type || undefined }).then((result) => result.groups.flat()) : Promise.resolve([] as ChangeCandidate[]),
        getChangeSummary(siteId).catch(() => null),
      ]);
      const nextPlans = await listChangePlans(siteId, matches.length ? serverFilters : { ...serverFilters, q: q || undefined });
      if (listId !== listRequest.current) return;
      setPlans(nextPlans.map(withSavedPreview)); setSummary(nextSummary); setTargetMatches(matches.length ? matches : null); setError(''); setRefreshTick((tick) => tick + 1);
      if (selectedId) { const detail = withSavedPreview(await getChangePlan(selectedId)); if (requestId === selectedRequest.current) setSelected((current) => current?.id === detail.id && current.revision === detail.revision && current.previewUi ? { ...detail, previewUi: current.previewUi, previewRevision: current.previewRevision, previewSnapshot: current.previewSnapshot, previewedAt: current.previewedAt } : detail); }
    } catch (cause) { if (listId === listRequest.current) setError(cause instanceof Error ? cause.message : tRef.current('changePlans.page.loadFailed')); }
    finally { if (listId === listRequest.current) setLoading(false); }
  }, [siteId, selected?.id, withSavedPreview, query, filters.status, filters.type, listFrom, listTo]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => {
    const previous = previousSite.current; previousSite.current = siteId;
    selectedRequest.current += 1; setDraft((current) => ({ ...current, siteId: siteId ?? '' })); setSelected(null); setBusy(false); setNotice(''); setEditorOpen(false);
    // A real Site switch drops the open change (it belongs to the previous Site); the first resolve keeps a shared link.
    if (previous && previous !== siteId && new URLSearchParams(window.location.search).get('changeId')) { followedChange.current = `${siteId}|`; setFilter('changeId', '', { replace: true }); }
    else followedChange.current = null;
  }, [siteId, setFilter]);

  const showDetail = useCallback(async (id: string) => {
    const requestId = ++selectedRequest.current; setBusy(true); setError(''); setNotice('');
    try { const detail = withSavedPreview(await getChangePlan(id)); if (requestId === selectedRequest.current) { setSelected(detail); setEditorOpen(false); setReviewNote(''); } }
    catch (cause) { if (requestId === selectedRequest.current) setError(cause instanceof Error ? cause.message : tRef.current('changePlans.page.openFailed')); }
    finally { if (requestId === selectedRequest.current) setBusy(false); }
  }, [withSavedPreview]);
  const closeDetail = useCallback(() => { selectedRequest.current += 1; setSelected(null); setNotice(''); setError(''); }, []);
  // `?changeId=` opens that change (shared links, back/forward); clearing it returns to the list.
  useEffect(() => {
    if (!siteId) return;
    const changeId = new URLSearchParams(window.location.search).get('changeId') ?? '';
    const key = `${siteId}|${changeId}`;
    if (followedChange.current === key) return;
    followedChange.current = key;
    if (changeId && selected?.id !== changeId) void showDetail(changeId);
    else if (!changeId && selected && !editorOpen) closeDetail();
  }, [filters.changeId, siteId, selected, editorOpen, showDetail, closeDetail]);
  const followChange = (id: string) => { followedChange.current = `${siteId}|${id}`; if (filters.changeId !== id) setFilter('changeId', id); };

  const openNew = () => { selectedRequest.current += 1; followChange(''); setSelected(null); const fresh = { ...blankDraft(), siteId: siteId ?? '' }; setDraft(fresh); editorBaseline.current = JSON.stringify(fresh); setTargetType('DEVICE'); setTargetId(''); setTargetQuery(''); setOperation(''); setCurrentValue(''); setProposedValue(''); setError(''); setNotice(''); setEditorOpen(true); };
  const openEdit = (plan: ChangePlan) => { const next = { siteId: plan.siteId, title: plan.title, reason: plan.reason, plannedStartAt: localInput(plan.plannedStartAt), plannedEndAt: localInput(plan.plannedEndAt), items: plan.items.map((item) => ({ ...item })) }; setSelected(plan); setDraft(next); editorBaseline.current = JSON.stringify(next); setTargetQuery(''); setEditorOpen(true); setError(''); };
  /** {t('changePlans.page.duplicatePlan')}: opens the editor with a new draft copied from this plan (title, reason, targets). Nothing is saved until Guardar rascunho. */
  const openDuplicate = (plan: ChangePlan) => {
    selectedRequest.current += 1; followChange(''); setSelected(null);
    const next = duplicateDraft(plan, t('changePlans.copyPrefix'));
    setDraft(next); editorBaseline.current = JSON.stringify(next);
    setTargetType('DEVICE'); setTargetId(''); setTargetQuery(''); setOperation(''); setCurrentValue(''); setProposedValue(''); setError(''); setNotice(''); setEditorOpen(true);
  };
  const closeEditor = async () => {
    if (JSON.stringify(draft) !== editorBaseline.current && !(await confirm({ title: t('changePlans.page.discardDraftTitle'), message: t('changePlans.page.discardDraftMessage'), confirmLabel: t('changePlans.page.discard'), cancelLabel: t('changePlans.page.keepEditing'), destructive: true }))) return;
    setEditorOpen(false);
  };
  useEscapeClose(() => { void closeEditor(); }, editorOpen);
  const dialogRef = useDialogFocusRef<HTMLElement>(editorOpen);
  const openPlan = (plan: Pick<ChangePlan, 'id'>) => { followChange(plan.id); void showDetail(plan.id); };
  const backToList = () => { followChange(''); closeDetail(); };
  // Editor target search: `candidates?q=&type=` finds targets beyond the first page of the full list.
  useEffect(() => {
    const q = targetSearch.trim();
    if (!editorOpen || !siteId || !q) return;
    let live = true; const key = `${targetType}|${q}`;
    getChangeCandidates(siteId, { q, type: targetType || undefined })
      .then((result) => { if (live) setTargetResults({ key, items: result.groups.flat(), truncated: result.truncated }); })
      .catch(() => { if (live) setTargetResults({ key, items: [], truncated: false }); });
    return () => { live = false; };
  }, [editorOpen, siteId, targetType, targetSearch]);
  const addTarget = () => {
    const candidate = visibleCandidates.find((item) => item.entityId === targetId && item.entityType === targetType);
    if (!candidate || !operation.trim() || draft.items.some((item) => item.entityId === targetId && item.entityType === targetType)) return;
    const objectValue = (value: string) => value.trim() ? { summary: value.trim() } : undefined;
    if (!candidates.some((item) => candidateKey(item.entityType, item.entityId) === candidateKey(candidate.entityType, candidate.entityId))) setPickedCandidates((current) => [...current, candidate]);
    setDraft((current) => ({ ...current, items: [...current.items, { entityType: targetType, entityId: targetId, operationSummary: operation.trim(), currentValue: objectValue(currentValue), proposedValue: objectValue(proposedValue) }] }));
    setTargetId(''); setOperation(''); setCurrentValue(''); setProposedValue('');
  };
  const removeTarget = (item: ChangeItem) => { setDraft((current) => ({ ...current, items: current.items.filter((target) => !(target.entityType === item.entityType && target.entityId === item.entityId)) })); };
  const persist = async () => {
    setBusy(true); setError(''); setNotice('');
    try {
      const payload = { ...draft, plannedStartAt: isoValue(draft.plannedStartAt), plannedEndAt: isoValue(draft.plannedEndAt) };
      const saved = selected ? await updateChangePlan(selected.id, selected.revision, { title: payload.title, reason: payload.reason, plannedStartAt: payload.plannedStartAt, plannedEndAt: payload.plannedEndAt, items: payload.items }) : await createChangePlan(payload);
      const detail = await getChangePlan(saved.id); setSelected(detail); followChange(detail.id); setEditorOpen(false); setNotice(t('changePlans.page.draftSaved')); await load();
    } catch (cause) { setError(cause instanceof Error ? cause.message : t('changePlans.page.saveDraftFailed')); }
    finally { setBusy(false); }
  };
  const calculate = async () => {
    if (!selected) return;
    const planId = selected.id;
    const planRevision = selected.revision;
    const requestId = ++selectedRequest.current;
    setBusy(true); setSelected((current) => current?.id === planId && current.revision === planRevision ? { ...current, previewUi: { revision: planRevision, status: 'calculating' }, previewRevision: null, previewSnapshot: null, previewedAt: null } : current); setError(''); setNotice('');
    try {
      const result = await previewChangePlan(planId);
      if (requestId !== selectedRequest.current) return;
      if (result.revision !== planRevision) throw new Error(t('changePlans.page.changedDuringAnalysis'));
      setPreviewOverrides((current) => ({ ...current, [`${planId}:${planRevision}`]: result }));
      setPlans((current) => current.map((plan) => plan.id === planId && plan.revision === planRevision ? { ...plan, previewRevision: result.revision, previewSnapshot: result, previewedAt: result.generatedAt } : plan));
      setSelected((current) => current?.id === planId && current.revision === planRevision ? { ...current, previewRevision: result.revision, previewSnapshot: result, previewedAt: result.generatedAt, previewUi: { revision: result.revision, status: 'complete', snapshot: result } } : current);
    }
    catch (cause) {
      if (requestId === selectedRequest.current) {
        setSelected((current) => current?.id === planId && current.revision === planRevision ? { ...current, previewRevision: null, previewSnapshot: null, previewedAt: null, previewUi: undefined } : current);
        setError(cause instanceof Error ? cause.message : t('changePlans.page.calculateFailed'));
        setNotice('');
      }
    }
    finally { if (requestId === selectedRequest.current) setBusy(false); }
  };
  const submit = async () => {
    if (!selected) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await submitChangePlan(selected.id); const detail = await getChangePlan(result.id); setSelected(detail); setNotice(t('changePlans.page.submitted')); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('changePlans.page.submitFailed')); }
    finally { setBusy(false); }
  };
  const review = async (status: 'APPROVED' | 'REJECTED') => {
    if (!selected) return;
    if (status === 'APPROVED' && !(await confirm({ title: t('changePlans.page.approveChange'), message: t('changePlans.review.approveConfirm', { title: selected.title }), confirmLabel: t('changePlans.page.approveChange') }))) return;
    setBusy(true); setError(''); setNotice('');
    try { const result = await reviewChangePlan(selected.id, status, reviewNote.trim() || undefined); const detail = await getChangePlan(result.id); setSelected(detail); setNotice(status === 'APPROVED' ? t('changePlans.page.approved') : t('changePlans.page.returned')); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('changePlans.page.reviewFailed')); }
    finally { setBusy(false); }
  };
  /** Started, closed or steps changed in the implementation section. */
  const onPlanChanged = async (plan: ChangePlan | null, message: string) => {
    if (plan) setSelected(withSavedPreview(plan));
    setError(''); setNotice(message); await load();
  };
  const cancel = async () => {
    if (!selected) return;
    if (!(await confirm({ title: t('changePlans.page.cancelChange'), message: t('changePlans.cancel.confirm', { title: selected.title }), confirmLabel: t('changePlans.page.cancelChange'), cancelLabel: t('changePlans.page.keep'), destructive: true }))) return;
    setBusy(true); setError('');
    try { const result = await cancelChangePlan(selected.id); const detail = await getChangePlan(result.id); setSelected(detail); setNotice(t('changePlans.page.cancelled')); await load(); }
    catch (cause) { setError(cause instanceof Error ? cause.message : t('changePlans.page.cancelFailed')); }
    finally { setBusy(false); }
  };

  // Activity log from the audit trail (`GET /change-plans/:id/activity`).
  const activityKey = selected ? `${selected.id}:${selected.revision}:${selected.status}:${selected.previewedAt ?? ''}` : '';
  useEffect(() => {
    if (!selected) return;
    let live = true;
    const key = activityKey;
    getChangeActivity(selected.id)
      .then((entries) => { if (live) setActivity({ key, entries, failed: false }); })
      .catch(() => { if (live) setActivity({ key, entries: [], failed: true }); });
    return () => { live = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps -- refetch only when the plan's state moves on
  }, [activityKey]);

  const currentPreviewState = selected && selected.previewUi?.revision === selected.revision ? selected.previewUi : null;
  const previewForPlan = (plan: ChangePlan): ImpactPreview | null => {
    const selectedState = selected?.id === plan.id && selected.revision === plan.revision ? currentPreviewState : null;
    if (selectedState?.status === 'calculating') return null;
    if (selectedState?.status === 'complete') return selectedState.snapshot;
    const cached = previewOverrides[`${plan.id}:${plan.revision}`];
    if (cached && Number(cached.revision) === Number(plan.revision)) return cached;
    const snapshot = plan.previewSnapshot;
    return snapshot && Number(snapshot.revision) === Number(plan.revision) ? snapshot : null;
  };
  const savedPreview = selected ? previewForPlan(selected) : null;
  const canSubmit = Boolean(selected && savedPreview?.revision === selected.revision && savedPreview.analysisStatus === 'COMPLETE' && savedPreview.coverage.status !== 'PARTIAL' && ['DRAFT', 'REJECTED'].includes(selected.status));
  const canEdit = Boolean(selected && canDraft && ['DRAFT', 'REJECTED'].includes(selected.status));
  const impactGroups = useMemo(() => {
    const grouped = new Map<ChangeEntityType, ImpactNode[]>();
    for (const item of savedPreview?.knownImpacts ?? []) grouped.set(item.entityType, [...(grouped.get(item.entityType) ?? []), item]);
    return [...grouped.entries()];
  }, [savedPreview]);

  // ── List and calendar ────────────────────────────────────────────────────
  const visible = useMemo(() => filterPlans(plans, { search: query, type: filters.type, targetKeys: targetMatches ? new Set(targetMatches.map((item) => candidateKey(item.entityType, item.entityId))) : null }), [plans, query, filters.type, targetMatches]);
  const filtering = Boolean(search.trim() || filters.status || filters.type || filters.from || filters.to);
  const total = summary?.total ?? plans.length;
  const month = useMemo(() => parseMonth(filters.month), [filters.month]);
  // Overlaps come from the API: the calendar's grid, or the span of the listed plans.
  const listSpan = spanOf(visible);
  const overlapRange = view === 'calendar' ? calendarRange(month) : listSpan;
  // The calendar API leaves cancelled plans out unless asked; the Canceladas tab asks.
  const overlaps = useOverlaps(siteId, overlapRange, refreshTick, view === 'calendar' && filters.status === 'CANCELLED');
  const detailOverlaps = useOverlaps(siteId, selected ? { from: new Date(selected.plannedStartAt), to: new Date(selected.plannedEndAt) } : null, refreshTick);
  const calendarPlans = useMemo(() => {
    // Search and target type narrow the calendar to the plans the (unpaged) list kept.
    const kept = query.trim() || filters.type ? new Set(visible.map((plan) => plan.id)) : null;
    return [...overlaps.data.plans.values()].filter((plan) => (!filters.status || plan.status === filters.status) && (!kept || kept.has(plan.id)));
  }, [overlaps.data, visible, query, filters.status, filters.type]);
  const planOverlaps = (plan: Pick<ChangePlan, 'id'>) => overlapsFor(overlaps.data, plan.id);
  const clearFilters = () => { setFilters({ status: '', type: '', from: '', to: '' }); setSearch(''); };
  const targetsText = (plan: ChangePlan) => plan.items.map((item) => `${typeText(t, item.entityType)}: ${targetLabel(labels, item)}`).join('; ');
  const columns: DataTableColumn<ChangePlan>[] = [
    {
      id: 'title', header: t('changePlans.page.columnChange'), sortValue: (plan) => plan.title,
      cell: (plan) => <><button type="button" className="link-button" onClick={() => openPlan(plan)}><strong>{plan.title}</strong></button><small>{plan.reason}</small></>,
      csv: [{ header: 'ID', value: (plan) => plan.id }, { header: t('changePlans.csv.title'), value: (plan) => plan.title }, { header: t('changePlans.csv.reason'), value: (plan) => plan.reason }],
    },
    {
      id: 'status', header: t('changePlans.page.columnStatus'), sortValue: (plan) => changeStatuses.indexOf(plan.status),
      cell: (plan) => { const preview = previewForPlan(withSavedPreview(plan)); return <><span className={`change-status status-${plan.status.toLowerCase()}`}>{statusText(t, plan.status)}</span><small>{plan.closedAt ? t('changePlans.list.closedAt', { date: dateTime(plan.closedAt) }) : plan.startedAt ? t('changePlans.list.startedAt', { date: dateTime(plan.startedAt) }) : preview ? t('changePlans.list.previewAt', { date: dateTime(preview.generatedAt) }) : t('changePlans.list.previewPending')}</small></>; },
      csv: [{ header: t('changePlans.csv.status'), value: (plan) => statusText(t, plan.status) }, { header: t('changePlans.csv.revision'), value: (plan) => plan.revision }, { header: t('changePlans.csv.startedAt'), value: (plan) => csvDate(plan.startedAt) }, { header: t('changePlans.csv.closedAt'), value: (plan) => csvDate(plan.closedAt) }],
    },
    {
      id: 'window', header: t('changePlans.page.plannedWindow'), sortValue: (plan) => new Date(plan.plannedStartAt),
      cell: (plan) => <><strong>{dateTime(plan.plannedStartAt)}</strong><small>{t('changePlans.list.until', { date: dateTime(plan.plannedEndAt) })}</small></>,
      csv: [{ header: t('changePlans.csv.plannedStart'), value: (plan) => csvDate(plan.plannedStartAt) }, { header: t('changePlans.csv.plannedEnd'), value: (plan) => csvDate(plan.plannedEndAt) }],
    },
    {
      id: 'targets', header: t('changePlans.page.targets'), sortValue: (plan) => plan.items.length,
      cell: (plan) => <><strong>{t('changePlans.list.targets', { count: plan.items.length })}</strong><small>{plan.items.slice(0, 3).map((item) => targetLabel(labels, item)).join(', ')}{plan.items.length > 3 ? ` +${plan.items.length - 3}` : ''}</small></>,
      csv: [{ header: t('changePlans.csv.targets'), value: targetsText }, { header: t('changePlans.csv.operations'), value: (plan) => plan.items.map((item) => item.operationSummary).join('; ') }],
    },
    {
      id: 'overlaps', header: t('changePlans.page.columnOverlaps'), sortValue: (plan) => planOverlaps(plan).length,
      cell: (plan) => { const others = planOverlaps(plan); return others.length ? <><span className="state-badge excluded"><i />{t('changePlans.list.overlaps', { count: others.length })}</span><small>{others.map((other) => other.title).join(', ')}</small></> : <span className="muted-cell">—</span>; },
      csv: [{ header: t('changePlans.csv.overlapsWith'), value: (plan) => planOverlaps(plan).map((other) => other.title).join('; ') }],
    },
  ];
  const peopleCsv: CsvColumn<ChangePlan>[] = [{ header: t('changePlans.csv.createdBy'), value: (plan) => personName(plan.creator) }, { header: t('changePlans.csv.reviewer'), value: (plan) => personName(plan.reviewer) }, { header: t('changePlans.csv.reviewNote'), value: (plan) => plan.reviewNote ?? '' }, { header: t('changePlans.csv.startedBy'), value: (plan) => personName(plan.startedBy) }, { header: t('changePlans.csv.closedBy'), value: (plan) => personName(plan.closedBy) }, { header: t('changePlans.csv.closingNote'), value: (plan) => plan.closingNote ?? '' }];
  const csvColumns = [...columns.flatMap((column) => column.csv ?? []), ...peopleCsv];
  const sorted = sortByColumns(visible, columns, table.sort);
  const selectedOverlaps = selected ? overlapsFor(detailOverlaps.data, selected.id) : [];
  const timeline = activity?.key === activityKey ? buildTimeline(activity.entries) : [];
  const listing = !selected && !editorOpen;

  return <PageShell section={t('changePlans.page.section')} search={{ value: search, onChange: setSearch, placeholder: t('changePlans.page.searchPlaceholder'), ariaLabel: t('changePlans.page.searchLabel') }}><div className="module-page change-plans-page aligned-workspace">{confirmDialog}<PageToolbarPortal><div className="change-page-actions">
      {siteId && listing && <div className="interface-toolbar-controls">
        <label><span className="toolbar-filter-label">{t('changePlans.page.targetType')}</span><select aria-label={t('changePlans.page.filterByTargetType')} title={t('changePlans.page.filterByTargetType')} value={filters.type} onChange={(event) => setFilter('type', event.target.value)}><option value="">{t('changePlans.page.targetType')}</option>{changeTypes.map((type) => <option key={type} value={type}>{typeText(t, type)}</option>)}</select></label>
        {view === 'list' && <><label>{t('changePlans.page.from')}<input type="date" aria-label={t('changePlans.page.windowFrom')} value={filters.from} max={filters.to || undefined} onChange={(event) => setFilter('from', event.target.value)} /></label><label>{t('changePlans.page.to')}<input type="date" aria-label={t('changePlans.page.windowTo')} value={filters.to} min={filters.from || undefined} onChange={(event) => setFilter('to', event.target.value)} /></label></>}
        {filtering && <button className="secondary-button" aria-label={t('changePlans.page.clearFilters')} title={t('changePlans.page.clearFilters')} onClick={clearFilters}><X size={14} /> <span className="toolbar-action-label">{t('changePlans.page.clearFilters')}</span></button>}
        <button className="secondary-button" aria-pressed={view === 'calendar'} aria-label={view === 'calendar' ? t('changePlans.page.list') : t('changePlans.page.calendar')} title={view === 'calendar' ? t('changePlans.page.list') : t('changePlans.page.calendar')} onClick={() => setFilter('view', view === 'calendar' ? '' : 'calendar')}>{view === 'calendar' ? <><List size={14} /> <span className="toolbar-action-label">{t('changePlans.page.list')}</span></> : <><CalendarDays size={14} /> <span className="toolbar-action-label">{t('changePlans.page.calendar')}</span></>}</button>
        {view === 'list' && <CsvExportButton rows={sorted} columns={csvColumns} fileName={t('changePlans.csv.fileName')} />}
        <SavedViews pageId="changes" config={changeTableConfig} table={table} />
      </div>}
      <button className="secondary-button" disabled={!siteId || busy} aria-label={t('changePlans.page.refresh')} title={t('changePlans.page.refresh')} onClick={() => void load()}><RefreshCw size={14} /> <span className="toolbar-action-label">{t('changePlans.page.refresh')}</span></button>{canDraft && <button className="primary-button" disabled={!siteId || busy} onClick={openNew}>{t('changePlans.page.createChangeButton')}</button>}</div></PageToolbarPortal>
    {error && <div className="ipam-alert error" role="alert">{error}</div>}{notice && <div className="ipam-alert change-success" role="status">{notice}</div>}
    {selected && currentPreviewState?.status === 'calculating' && <div className="ipam-alert" role="status">{t('changePlans.page.calculatingPreview')}</div>}
    {selected && currentPreviewState?.status === 'complete' && savedPreview === currentPreviewState.snapshot && <div className="ipam-alert change-success" role="status">{t('changePlans.page.previewUpdated')}</div>}
    {!siteId && <section className="ipam-card page-primary-card"><div className="panel-heading"><div><h1>{t('changePlans.page.heading')}</h1></div></div><div className="no-data">{t('changePlans.page.selectSite')}</div></section>}
    {siteId && <div className="change-layout">{listing && <section className="ipam-card change-list-card page-primary-card"><div className="change-section-heading panel-heading"><div><h1>{t('changePlans.page.heading')}</h1></div><span className="change-count" aria-label={filtering ? t('changePlans.list.countFiltered', { shown: visible.length, count: total }) : t('changePlans.list.count', { count: total })}>{filtering ? `${visible.length}/${total}` : total}</span></div>
      <div className="ipam-tabs" role="group" aria-label={t('changePlans.page.filterByStatus')}>
        <button type="button" className={!filters.status ? 'active' : ''} aria-pressed={!filters.status} onClick={() => setFilter('status', '')}>{summary ? t('changePlans.tabs.allCount', { count: summary.total }) : t('changePlans.tabs.all')}</button>
        {changeStatuses.map((status) => <button type="button" key={status} className={filters.status === status ? 'active' : ''} aria-pressed={filters.status === status} onClick={() => setFilter('status', filters.status === status ? '' : status)}>{summary ? t('changePlans.tabs.statusCount', { label: statusTabText(t, status), count: summary.byStatus[status] ?? 0 }) : statusTabText(t, status)}</button>)}
      </div>
      {view === 'list' && overlaps.failed && <p className="panel-description">{t('changePlans.page.overlapsCheckFailed')}</p>}
      {overlaps.data.truncated && <p className="panel-description">{t('changePlans.page.overlapsPartial')}</p>}
      {view === 'calendar'
        ? <ChangeCalendar month={month} plans={calendarPlans} windows={[...overlaps.data.windows.values()]} overlaps={overlaps.data} overlapError={overlaps.failed} onMonthChange={(value) => setFilter('month', value)} onOpen={openPlan} />
        : <DataTable
          rows={sorted}
          columns={columns}
          rowKey={(plan) => plan.id}
          label={t('changePlans.page.tableLabel')}
          sort={table.sort}
          onSortChange={table.setSort}
          defaultSort={table.defaultSort}
          loading={loading}
          empty={error ? null : <div className="no-data">{filtering ? t('changePlans.page.noMatches') : t('changePlans.page.noChanges')}</div>}
        />}
    </section>}
      <div className="change-main-column">{editorOpen && <div className="modal-backdrop change-editor-backdrop"><section ref={dialogRef} className="modal-card change-editor" role="dialog" aria-modal="true" aria-labelledby="change-editor-title"><div className="change-section-heading panel-heading"><div><h2 id="change-editor-title">{selected ? t('changePlans.page.editChange') : t('changePlans.page.createChange')}</h2></div><button className="secondary-button" onClick={() => void closeEditor()}>{t('changePlans.page.close')}</button></div><p className="change-muted">{t('changePlans.page.readOnlyNote')}</p><div className="change-form-grid"><label>{t('changePlans.page.title')}<input required maxLength={160} value={draft.title} onChange={(event) => { setDraft({ ...draft, title: event.target.value }); }} placeholder={t('changePlans.page.titlePlaceholder')} /></label><label>{t('changePlans.page.reason')}<textarea required maxLength={1000} value={draft.reason} onChange={(event) => { setDraft({ ...draft, reason: event.target.value }); }} placeholder={t('changePlans.page.reasonPlaceholder')} /></label><DateTimeInput label={t('changePlans.page.plannedStart')} required value={draft.plannedStartAt} onChange={(value) => { setDraft({ ...draft, plannedStartAt: value }); }} /><DateTimeInput label={t('changePlans.page.plannedEnd')} required value={draft.plannedEndAt} onChange={(value) => { setDraft({ ...draft, plannedEndAt: value }); }} /></div><h3>{t('changePlans.page.targetsAndOperation')}</h3><div className="change-target-builder"><label>{t('changePlans.page.type')}<select value={targetType} onChange={(event) => { setTargetType(event.target.value as ChangeEntityType); setTargetId(''); }}><option value="">{t('changePlans.page.selectType')}</option>{changeTypes.map((type) => <option value={type} key={type}>{typeText(t, type)}</option>)}</select></label><label>{t('changePlans.page.searchTarget')}<input type="search" value={targetQuery} maxLength={120} onChange={(event) => { setTargetQuery(event.target.value); setTargetId(''); }} placeholder={t('changePlans.page.searchTargetPlaceholder')} /></label><label className="change-target-select">{t('changePlans.page.target')}<select value={targetId} onChange={(event) => setTargetId(event.target.value)}><option value="">{t('changePlans.page.selectTarget')}</option>{visibleCandidates.map((candidate) => <option value={candidate.entityId} key={candidate.entityId}>{candidate.label}{candidate.detail ? ` · ${candidate.detail}` : ''}</option>)}</select></label><label>{t('changePlans.page.proposedOperation')}<input value={operation} maxLength={240} onChange={(event) => setOperation(event.target.value)} placeholder={t('changePlans.page.operationPlaceholder')} /></label><label>{t('changePlans.page.currentValue')}<input value={currentValue} onChange={(event) => setCurrentValue(event.target.value)} placeholder={t('changePlans.page.currentValuePlaceholder')} /></label><label>{t('changePlans.page.proposedValue')}<input value={proposedValue} onChange={(event) => setProposedValue(event.target.value)} placeholder={t('changePlans.page.proposedValuePlaceholder')} /></label><button type="button" className="secondary-button change-add-target" disabled={!targetId || !operation.trim()} onClick={addTarget}>{t('changePlans.page.addTarget')}</button></div>{(searchedTargets ? searchedTargets.truncated : candidateLimit) && <div className="change-warning">{t('changePlans.page.targetsLimited')}</div>}{searchedTargets && !visibleCandidates.length && <p className="change-muted">{t('changePlans.page.noTargetMatches')}</p>}<div className="change-target-list">{draft.items.map((item) => <div className="change-target-item" key={`${item.entityType}:${item.entityId}`}><span><strong>{typeText(t, item.entityType)}</strong><small>{targetLabel(labels, item)} · {item.operationSummary}</small>{item.currentValue?.summary ? <small>{t('changePlans.editor.currentProposed', { current: String(item.currentValue.summary), proposed: String(item.proposedValue?.summary ?? '—') })}</small> : null}</span><button type="button" className="secondary-button" onClick={() => removeTarget(item)}>{t('changePlans.page.remove')}</button></div>)}{!draft.items.length && <p className="change-muted">{t('changePlans.page.addAtLeastOneTarget')}</p>}</div><PlanImpactSection items={draft.items} label={(item) => targetLabel(labels, item)} siteId={siteId} /><div className="change-actions"><button type="button" className="secondary-button" disabled={busy || !draft.title.trim() || !draft.reason.trim() || !isLocalDateTime(draft.plannedStartAt) || !isLocalDateTime(draft.plannedEndAt) || !draft.items.length} onClick={() => void persist()}>{busy ? t('changePlans.page.saving') : t('changePlans.page.saveDraft')}</button></div></section></div>}
      {selected && !editorOpen && <section className="ipam-card change-detail"><div className="change-section-heading panel-heading"><div><h2>{selected.title}</h2></div><div className="change-detail-heading-actions"><span className={`change-status status-${selected.status.toLowerCase()}`}>{statusText(t, selected.status)}</span><button className="secondary-button" onClick={backToList}>{t('changePlans.page.allChanges')}</button></div></div><p>{selected.reason}</p><div className="change-summary-grid"><div><small>Site</small><strong>{activeSite?.name ?? t('changePlans.page.selectedSite')}</strong></div><div><small>{t('changePlans.page.plannedWindow')}</small><strong>{dateTime(selected.plannedStartAt)} – {dateTime(selected.plannedEndAt)}</strong></div><div><small>{t('changePlans.page.targets')}</small><strong>{selected.items.length}</strong></div><div><small>{t('changePlans.page.preview')}</small><strong>{savedPreview ? t('changePlans.detail.calculatedAt', { date: dateTime(savedPreview.generatedAt) }) : currentPreviewState?.status === 'calculating' ? t('changePlans.page.calculating') : t('changePlans.page.notCalculated')}</strong></div></div><div className="change-target-list">{selected.items.map((item) => <div className="change-target-item" key={`${item.entityType}:${item.entityId}`}><span><strong>{typeText(t, item.entityType)}</strong><small><TargetLink item={item} label={targetLabel(labels, item)} siteId={selected.siteId} /> · {item.operationSummary}</small></span></div>)}</div>
        {selectedOverlaps.length > 0 && <div className="change-warning"><strong>{t('changePlans.page.windowOverlaps')}</strong>{selectedOverlaps.map((other) => <p key={`${other.kind}:${other.id}`}>{other.kind === 'CHANGE_PLAN' ? <><a href={`/alteracoes?changeId=${encodeURIComponent(other.id)}`} onClick={(event) => { event.preventDefault(); openPlan(other); }}>{other.title}</a>{other.status ? ` · ${statusText(t, other.status)}` : ''}</> : <>{t('changePlans.page.maintenancePrefix')}{other.title}</>} · {dateTime(other.startsAt)} – {dateTime(other.endsAt)}{other.sharedTargetCount ? ` · ${t('changePlans.sharedTargets', { count: other.sharedTargetCount })}` : ''}</p>)}</div>}
        {detailOverlaps.failed && <p className="panel-description">{t('changePlans.page.detailOverlapsFailed')}</p>}
        {savedPreview && <section className="impact-preview" aria-labelledby="impact-preview-title"><div className="change-section-heading panel-heading"><div><h3 id="impact-preview-title">{t('changePlans.page.knownImpact')}</h3></div><span className={`change-status status-${savedPreview.coverage.status.toLowerCase()}`}>{savedPreview.coverage.status === 'PARTIAL' ? t('changePlans.page.partialCoverage') : t('changePlans.page.analysisComplete')}</span></div><div className="change-summary-grid"><div><small>{t('changePlans.page.knownImpacts')}</small><strong>{savedPreview.knownImpacts.length}</strong></div><div><small>{t('changePlans.page.staleData')}</small><strong>{savedPreview.coverage.staleItems}</strong></div><div><small>{t('changePlans.page.inventoryUpdate')}</small><strong>{savedPreview.coverage.latestInventoryUpdate ? dateTime(savedPreview.coverage.latestInventoryUpdate) : t('changePlans.page.noRecord')}</strong></div></div><p className={savedPreview.coverage.status === 'PARTIAL' ? 'change-warning' : 'change-muted'}>{savedPreview.coverage.reason}</p>{!savedPreview.knownImpacts.length && <div className="change-empty-impact"><strong>{t('changePlans.page.noRelationsFound')}</strong><span>{t('changePlans.page.notZeroImpact')}</span></div>}{impactGroups.map(([type, items]) => <div className="impact-group" key={type}><h4>{typeText(t, type)} · {items.length}</h4><ul>{items.map((item) => <li key={`${item.entityType}:${item.entityId}`}><a href={item.href}>{item.label}</a><span>{item.depth === 1 ? t('changePlans.impact.directDependency') : t('changePlans.impact.dependencyDepth', { depth: item.depth })} · {item.dependencyPath.join(' → ')} · {item.freshness === 'STALE' ? t('changePlans.page.observedOver24h') : item.freshness === 'UNKNOWN' ? t('changePlans.page.updateUnknown') : t('changePlans.page.observedLast24h')}{item.confidence === 'LOW' && <>{t('changePlans.page.lowConfidence')}</>}</span></li>)}</ul></div>)}{savedPreview.maintenanceOverlaps.length > 0 && <div className="change-warning"><strong>{t('changePlans.page.maintenanceOverlap')}</strong>{savedPreview.maintenanceOverlaps.map((item) => <p key={item.id}>{item.name} · {dateTime(item.startsAt)} – {dateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ''}</p>)}</div>}{savedPreview.changeOverlaps.length > 0 && <div className="change-warning"><strong>{t('changePlans.page.changeOverlap')}</strong>{savedPreview.changeOverlaps.map((item) => <p key={item.id}><a href={`/alteracoes?changeId=${encodeURIComponent(item.id)}`} onClick={(event) => { event.preventDefault(); openPlan(item); }}>{item.title}</a> · {dateTime(item.plannedStartAt)} – {dateTime(item.plannedEndAt)}</p>)}</div>}<p className="change-muted">{t('changePlans.impact.coverageNote', { date: dateTime(savedPreview.generatedAt) })}</p></section>}
        <PlanImpactSection key={selected.id} items={selected.items} label={(item) => targetLabel(labels, item)} siteId={selected.siteId} defaultOpen />
        {selected.reviewNote && <div className="change-warning"><strong>{t('changePlans.page.reviewNoteLabel')}</strong> {selected.reviewNote}</div>}
        <div className="change-actions">{canEdit && <button className="secondary-button" disabled={busy} onClick={() => openEdit(selected)}>{t('changePlans.page.editDraft')}</button>}{canEdit && <button className="secondary-button" disabled={busy} onClick={() => void calculate()}>{currentPreviewState?.status === 'calculating' ? t('changePlans.page.calculating') : t('changePlans.page.recalculatePreview')}</button>}{canEdit && <button className="primary-button" disabled={busy || !canSubmit} title={!canSubmit ? t('changePlans.page.saveCompletePreview') : undefined} onClick={() => void submit()}>{t('changePlans.page.submitForReview')}</button>}{canDraft && <button className="secondary-button" disabled={busy} onClick={() => openDuplicate(selected)}>{t('changePlans.page.duplicatePlan')}</button>}{canDraft && ['DRAFT', 'SUBMITTED', 'REJECTED'].includes(selected.status) && <button className="secondary-button" disabled={busy} onClick={() => void cancel()}>{t('changePlans.page.cancelChange')}</button>}</div>
        {canReview && selected.status === 'SUBMITTED' && <section className="change-review"><h3>{t('changePlans.page.adminReview')}</h3><label>{t('changePlans.page.reviewNote')}<textarea maxLength={1000} value={reviewNote} onChange={(event) => setReviewNote(event.target.value)} placeholder={t('changePlans.page.reviewNotePlaceholder')} /></label><div className="change-actions"><button className="secondary-button" disabled={busy || !reviewNote.trim()} onClick={() => void review('REJECTED')}>{t('changePlans.page.returnForCorrection')}</button><button className="primary-button" disabled={busy} onClick={() => void review('APPROVED')}>{t('changePlans.page.approveChange')}</button></div></section>}
        <ChangeExecution plan={selected} canAct={canDraft} confirm={confirm} targetLabel={(item) => targetLabel(labels, item)} onPlanChanged={onPlanChanged} onOpenPlan={openPlan} />
        <HistoryBlock
          heading={t('changePlans.page.activity')}
          formatDate={dateTime}
          noteLabel={t('changePlans.page.note')}
          empty={t('changePlans.page.noActivity')}
          events={timeline.map((entry) => ({
            id: entry.id,
            title: t(`changePlans.activity.${entry.action}`, undefined, entry.action),
            status: entry.revision ? <span className={`state-badge ${activityTone[entry.action] ?? ''}`.trim()}><i />{t('changePlans.activity.revision', { revision: entry.revision })}</span> : undefined,
            at: entry.at,
            actor: entry.actor || null,
            note: entry.note,
          }))}
        />
        {activity?.key === activityKey && activity.failed && <p className="panel-description">{t('changePlans.page.activityFailed')}</p>}
      </section>}
      </div></div>}
    </div></PageShell>;
}
