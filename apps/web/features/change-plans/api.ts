import { apiFetch } from '@/lib/api/client';

export type ChangeEntityType = 'DEVICE' | 'INTERFACE' | 'VLAN' | 'SUBNET' | 'IP_ADDRESS' | 'HOST' | 'SERVICE';
export type ChangeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ChangeItem = { id?: string; entityType: ChangeEntityType; entityId: string; operationSummary: string; currentValue?: Record<string, unknown>; proposedValue?: Record<string, unknown> };
export type ChangePlan = { id: string; siteId: string; title: string; reason: string; plannedStartAt: string; plannedEndAt: string; status: ChangeStatus; revision: number; previewRevision: number | null; previewSnapshot: ImpactPreview | null; previewedAt: string | null; submittedAt: string | null; reviewer?: ChangePerson | null; reviewNote?: string | null; reviewedAt?: string | null; creator?: ChangePerson | null; createdAt?: string; updatedAt?: string; items: ChangeItem[] };
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

export type ChangeSummary = { siteId: string; total: number; byStatus: Record<ChangeStatus, number>; inProgress: number; upcoming: number; generatedAt: string };
/** Plan counts per status for the whole Site (status tabs). */
export const getChangeSummary = (siteId: string) => apiFetch<ChangeSummary>(`/api/v1/change-plans/summary?${query(siteId)}`);

export type WindowKind = 'CHANGE_PLAN' | 'MAINTENANCE_WINDOW';
export type WindowOverlap = { kind: WindowKind; id: string; overlapStartsAt: string; overlapEndsAt: string; sharedTargetCount: number };
/** `conflict`: the plan overlaps another submitted/approved plan (maintenance windows are reported, not conflicts). */
export type CalendarChangePlan = { id: string; title: string; status: ChangeStatus; plannedStartAt: string; plannedEndAt: string; revision: number; creator?: ChangePerson | null; targetCount: number; overlapsWith: WindowOverlap[]; conflict: boolean };
export type CalendarMaintenanceWindow = { id: string; name: string; reason?: string | null; siteId: string | null; startsAt: string; endsAt: string; global: boolean; overlapsWith: WindowOverlap[]; conflict: boolean };
export type ChangeCalendar = { siteId: string; from: string; to: string; changePlans: CalendarChangePlan[]; maintenanceWindows: CalendarMaintenanceWindow[]; truncated: boolean };
/** Plans (not cancelled) and maintenance windows intersecting `[from, to)` with server-computed overlaps; at most 120 days per call. */
export const getChangeCalendar = (siteId: string, from: string, to: string) => apiFetch<ChangeCalendar>(`/api/v1/change-plans/calendar?${query(siteId, { from, to })}`);
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
