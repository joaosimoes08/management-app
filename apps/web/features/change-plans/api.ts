import { apiFetch } from '@/lib/api/client';

export type ChangeEntityType = 'DEVICE' | 'INTERFACE' | 'VLAN' | 'SUBNET' | 'IP_ADDRESS' | 'HOST' | 'SERVICE';
export type ChangeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED' | 'IN_PROGRESS' | 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
/** How an IN_PROGRESS plan can be closed; FAILED and ROLLED_BACK need a closing note. */
export type CloseStatus = 'COMPLETED' | 'FAILED' | 'ROLLED_BACK';
export type ChangeItem = { id?: string; entityType: ChangeEntityType; entityId: string; operationSummary: string; currentValue?: Record<string, unknown>; proposedValue?: Record<string, unknown> };
export type ChangePlan = { id: string; siteId: string; title: string; reason: string; plannedStartAt: string; plannedEndAt: string; status: ChangeStatus; revision: number; previewRevision: number | null; previewSnapshot: ImpactPreview | null; previewedAt: string | null; submittedAt: string | null; reviewer?: ChangePerson | null; reviewNote?: string | null; reviewedAt?: string | null; creator?: ChangePerson | null; createdAt?: string; updatedAt?: string; items: ChangeItem[]; startedAt?: string | null; startedBy?: ChangePerson | null; closedAt?: string | null; closedBy?: ChangePerson | null; closingNote?: string | null; checklist?: ChecklistItem[]; snmpWrites?: LinkedSnmpWrite[] };
/** One implementation step; `doneAt`/`doneBy` record who ticked it and when. */
export type ChecklistItem = { id: string; position: number; label: string; doneAt: string | null; doneBy?: ChangePerson | null; createdBy?: ChangePerson | null; createdAt?: string };
/** An SNMP write request linked to the plan (only devices the user can read). */
export type LinkedSnmpWrite = { id: string; deviceId: string; operation: string; status: string; requestedAt: string; completedAt?: string | null };
export type ChangePerson = { id?: string; displayName?: string | null; username: string };
export type ChangeCandidate = { entityType: ChangeEntityType; entityId: string; label: string; detail?: string };
export type ImpactNode = { entityType: ChangeEntityType; entityId: string; label: string; href: string; depth: number; dependencyPath: string[]; freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'; confidence: 'RECORDED' | 'LOW' };
export type ImpactPreview = { analysisStatus: string; revision: number; generatedAt: string; knownImpacts: ImpactNode[]; maintenanceOverlaps: Array<{ id: string; name: string; reason?: string | null; startsAt: string; endsAt: string }>; changeOverlaps: Array<{ id: string; title: string; plannedStartAt: string; plannedEndAt: string; status: string }>; coverage: { status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; reason: string; latestInventoryUpdate: string | null; staleItems: number; unknownFreshnessItems: number }; graphSignature: string };
export type ChangeDraft = { siteId: string; title: string; reason: string; plannedStartAt: string; plannedEndAt: string; items: ChangeItem[] };

/** Builds `?siteId=…&key=value` leaving out empty values. */
const query = (siteId: string, params: Record<string, string | undefined> = {}) => {
  const search = new URLSearchParams({ siteId });
  for (const [key, value] of Object.entries(params)) if (value) search.set(key, value);
  return search.toString();
};

/** Server-side list filters: `status` (comma list), a window intersecting `[from, to)` and `q` (title, reason, operation). */
export type ChangeListFilters = { status?: string; from?: string; to?: string; q?: string };
export const listChangePlans = (siteId: string, filters: ChangeListFilters = {}) => apiFetch<ChangePlan[]>(`/api/v1/change-plans?${query(siteId, filters)}`);
/** Targets the user may read; `q` searches names/addresses and `type` keeps one target type. */
export const getChangeCandidates = (siteId: string, filters: { q?: string; type?: string } = {}) => apiFetch<{ groups: ChangeCandidate[][]; truncated: boolean }>(`/api/v1/change-plans/candidates?${query(siteId, filters)}`);

/** `inProgress` counts plans in status IN_PROGRESS; `approvedInWindow` counts approved plans whose window includes now. */
export type ChangeSummary = { siteId: string; total: number; byStatus: Record<ChangeStatus, number>; inProgress: number; approvedInWindow?: number; upcoming: number; generatedAt: string };
/** Plan counts per status for the whole Site (status tabs). */
export const getChangeSummary = (siteId: string) => apiFetch<ChangeSummary>(`/api/v1/change-plans/summary?${query(siteId)}`);

export type WindowKind = 'CHANGE_PLAN' | 'MAINTENANCE_WINDOW';
export type WindowOverlap = { kind: WindowKind; id: string; overlapStartsAt: string; overlapEndsAt: string; sharedTargetCount: number };
/** `conflict`: the plan overlaps another submitted/approved plan (maintenance windows are reported, not conflicts). */
export type CalendarChangePlan = { id: string; title: string; status: ChangeStatus; plannedStartAt: string; plannedEndAt: string; revision: number; creator?: ChangePerson | null; targetCount: number; overlapsWith: WindowOverlap[]; conflict: boolean };
export type CalendarMaintenanceWindow = { id: string; name: string; reason?: string | null; siteId: string | null; startsAt: string; endsAt: string; global: boolean; overlapsWith: WindowOverlap[]; conflict: boolean };
export type ChangeCalendar = { siteId: string; from: string; to: string; changePlans: CalendarChangePlan[]; maintenanceWindows: CalendarMaintenanceWindow[]; truncated: boolean };
/** Plans (cancelled ones only with `includeCancelled`) and maintenance windows intersecting `[from, to)` with server-computed overlaps; at most 120 days per call. */
export const getChangeCalendar = (siteId: string, from: string, to: string, includeCancelled?: boolean) => apiFetch<ChangeCalendar>(`/api/v1/change-plans/calendar?${query(siteId, { from, to, includeCancelled: includeCancelled ? 'true' : undefined })}`);
export const getChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}`);
export const createChangePlan = (draft: ChangeDraft) => apiFetch<ChangePlan>('/api/v1/change-plans', { method: 'POST', body: JSON.stringify(draft) });
export const updateChangePlan = (id: string, revision: number, draft: Omit<ChangeDraft, 'siteId'>) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...draft, expectedRevision: revision }) });
export const previewChangePlan = (id: string) => apiFetch<ImpactPreview>(`/api/v1/change-plans/${encodeURIComponent(id)}/impact-preview`, { method: 'POST', body: JSON.stringify({}) });
export const submitChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify({}) });
export const reviewChangePlan = (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ status, reviewNote }) });
export const cancelChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) });

/** One audited action on a change plan (`CHANGE_PLAN_*`). */
export type ChangeActivity = { id: string; action: string; at: string; actor?: ChangePerson | null; note?: string | null; revision?: number | null };
/** Who did what to a plan, from the audit log (`GET /change-plans/:id/activity`, oldest first). */
export const getChangeActivity = async (id: string): Promise<ChangeActivity[]> => (await apiFetch<{ items: ChangeActivity[] }>(`/api/v1/change-plans/${encodeURIComponent(id)}/activity`)).items;

// ── Implementation and close-out (Step 30) ──────────────────────────────────

const planPath = (id: string, rest = '') => `/api/v1/change-plans/${encodeURIComponent(id)}${rest}`;

/** Non-blocking warnings for a plan's window and targets. */
export type ConflictWarning =
  | { code: 'OUTSIDE_MAINTENANCE_WINDOW'; message: string; uncovered: { startsAt: string; endsAt: string }[]; maintenanceWindowCount: number }
  | { code: 'TIER1_CRITICAL_ASSET' | 'CRITICAL_ASSET'; message: string; devices: { id: string; name: string }[] }
  | { code: 'OVERLAPS_APPROVED_CHANGE'; message: string; plans: { id: string; title: string; status: ChangeStatus; plannedStartAt: string; plannedEndAt: string; sharedTargetCount: number }[] };
export type ChangeConflicts = { changePlanId: string; tierSource: 'TIER' | 'IS_CRITICAL'; warnings: ConflictWarning[]; generatedAt: string };

export type CheckResult = 'AS_PLANNED' | 'DIFFERENT' | 'NOT_COMPARABLE';
export type CheckItemResult = CheckResult | 'TARGET_MISSING';
export type PostChangeCheckItem = { entityType: ChangeEntityType; entityId: string; operationSummary: string; result: CheckItemResult; fields: { field: string; planned: unknown; current: unknown; before: unknown; matches: boolean }[] };
/** Each item's proposed values against the inventory now ("como planeado / diferente"). */
export type PostChangeCheck = { changePlanId?: string; status?: ChangeStatus; result: CheckResult; counts: Record<CheckItemResult, number>; items: PostChangeCheckItem[]; hiddenItemCount: number; checkedAt: string };

/** APPROVED → IN_PROGRESS; the warnings at that moment come back but never block. */
export const startChangePlan = (id: string, expectedRevision?: number, note?: string) => apiFetch<{ plan: ChangePlan; warnings: ConflictWarning[] }>(planPath(id, '/start'), { method: 'POST', body: JSON.stringify({ expectedRevision, note: note || undefined }) });
/** IN_PROGRESS → COMPLETED / FAILED / ROLLED_BACK, returning the post-change check made at closing time. */
export const closeChangePlan = (id: string, status: CloseStatus, closingNote?: string) => apiFetch<{ plan: ChangePlan; postChangeCheck: PostChangeCheck }>(planPath(id, '/close'), { method: 'POST', body: JSON.stringify({ status, closingNote: closingNote || undefined }) });
export const addChecklistItems = (id: string, labels: string[]) => apiFetch<ChecklistItem[]>(planPath(id, '/checklist'), { method: 'POST', body: JSON.stringify({ labels }) });
export const tickChecklistItem = (id: string, itemId: string, done: boolean) => apiFetch<ChecklistItem>(planPath(id, `/checklist/${encodeURIComponent(itemId)}`), { method: 'PATCH', body: JSON.stringify({ done }) });
export const removeChecklistItem = (id: string, itemId: string) => apiFetch<{ removed: string }>(planPath(id, `/checklist/${encodeURIComponent(itemId)}`), { method: 'DELETE' });
export const getPostChangeCheck = (id: string) => apiFetch<PostChangeCheck>(planPath(id, '/post-change-check'));
export const getChangeConflicts = (id: string) => apiFetch<ChangeConflicts>(planPath(id, '/conflicts'));
