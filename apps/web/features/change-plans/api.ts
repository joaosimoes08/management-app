import { apiFetch } from '@/lib/api/client';

export type ChangeEntityType = 'DEVICE' | 'INTERFACE' | 'VLAN' | 'SUBNET' | 'IP_ADDRESS' | 'HOST' | 'SERVICE';
export type ChangeStatus = 'DRAFT' | 'SUBMITTED' | 'APPROVED' | 'REJECTED' | 'CANCELLED';
export type ChangeItem = { id?: string; entityType: ChangeEntityType; entityId: string; operationSummary: string; currentValue?: Record<string, unknown>; proposedValue?: Record<string, unknown> };
export type ChangePlan = { id: string; siteId: string; title: string; reason: string; plannedStartAt: string; plannedEndAt: string; status: ChangeStatus; revision: number; previewRevision: number | null; previewSnapshot: ImpactPreview | null; previewedAt: string | null; submittedAt: string | null; reviewer?: { displayName?: string | null; username: string } | null; reviewNote?: string | null; items: ChangeItem[] };
export type ChangeCandidate = { entityType: ChangeEntityType; entityId: string; label: string; detail?: string };
export type ImpactNode = { entityType: ChangeEntityType; entityId: string; label: string; href: string; depth: number; dependencyPath: string[]; freshness: 'CURRENT' | 'STALE' | 'UNKNOWN'; confidence: 'RECORDED' | 'LOW' };
export type ImpactPreview = { analysisStatus: string; revision: number; generatedAt: string; knownImpacts: ImpactNode[]; maintenanceOverlaps: Array<{ id: string; name: string; reason?: string | null; startsAt: string; endsAt: string }>; changeOverlaps: Array<{ id: string; title: string; plannedStartAt: string; plannedEndAt: string; status: string }>; coverage: { status: 'COMPLETE' | 'PARTIAL' | 'UNKNOWN'; reason: string; latestInventoryUpdate: string | null; staleItems: number; unknownFreshnessItems: number }; graphSignature: string };
export type ChangeDraft = { siteId: string; title: string; reason: string; plannedStartAt: string; plannedEndAt: string; items: ChangeItem[] };

export const listChangePlans = (siteId: string) => apiFetch<ChangePlan[]>(`/api/v1/change-plans?siteId=${encodeURIComponent(siteId)}`);
export const getChangeCandidates = (siteId: string) => apiFetch<{ groups: ChangeCandidate[][]; truncated: boolean }>(`/api/v1/change-plans/candidates?siteId=${encodeURIComponent(siteId)}`);
export const getChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}`);
export const createChangePlan = (draft: ChangeDraft) => apiFetch<ChangePlan>('/api/v1/change-plans', { method: 'POST', body: JSON.stringify(draft) });
export const updateChangePlan = (id: string, revision: number, draft: Omit<ChangeDraft, 'siteId'>) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ ...draft, expectedRevision: revision }) });
export const previewChangePlan = (id: string) => apiFetch<ImpactPreview>(`/api/v1/change-plans/${encodeURIComponent(id)}/impact-preview`, { method: 'POST', body: JSON.stringify({}) });
export const submitChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/submit`, { method: 'POST', body: JSON.stringify({}) });
export const reviewChangePlan = (id: string, status: 'APPROVED' | 'REJECTED', reviewNote?: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/review`, { method: 'POST', body: JSON.stringify({ status, reviewNote }) });
export const cancelChangePlan = (id: string) => apiFetch<ChangePlan>(`/api/v1/change-plans/${encodeURIComponent(id)}/cancel`, { method: 'POST', body: JSON.stringify({}) });
