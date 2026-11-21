import { apiFetch } from '@/lib/api/client';

export type OperationalAlert = { id: string; title: string; detail?: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING' | 'INFO'; status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; entityType?: string | null; entityId?: string | null; relatedDeviceId?: string | null; occurredAt?: string; href?: string };
export type InventoryQuality = { score?: number; total?: number; valid?: number; invalid?: number; stale?: number; deviceCount?: number; affectedDeviceCount?: number; validDeviceCount?: number; affectedEntityCount?: number; findingCount?: number; staleFindingCount?: number };
export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED';
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';
export type FindingPerson = { id: string; username: string; displayName?: string | null };
export type InventoryFinding = { id: string; siteId: string; rule: string; entityType: string; entityId: string; actionHref?: string | null; suggestedCorrection: string; severity: FindingSeverity; status: FindingStatus; title: string; detail: string; lastDetectedAt: string; assignedTo?: FindingPerson | null; snoozedUntil?: string | null; acknowledgedAt?: string | null; occurrenceCount?: number };

export type OperationalAlertPage = { items: OperationalAlert[]; total: number; page: number; pageSize: number };
export const listOperationalAlerts = (siteId?: string, pageSize = 25, page = 1, status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED') => apiFetch<OperationalAlertPage>(`/api/v1/operations/alerts?${siteId ? `siteId=${encodeURIComponent(siteId)}&` : ''}${status ? `status=${status}&` : ''}page=${page}&pageSize=${pageSize}`);
export const acknowledgeOperationalAlert = (id: string) => apiFetch(`/api/v1/operations/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' });
export const snoozeOperationalAlert = (id: string, until = new Date(Date.now() + 60 * 60 * 1000).toISOString()) => apiFetch(`/api/v1/operations/alerts/${encodeURIComponent(id)}/snooze`, { method: 'PATCH', body: JSON.stringify({ until }) });
export const resolveOperationalAlert = (id: string) => apiFetch(`/api/v1/operations/alerts/${encodeURIComponent(id)}/resolve`, { method: 'PATCH', body: JSON.stringify({}) });
export const readAllOperationalAlerts = () => apiFetch('/api/v1/operations/alerts/read-all', { method: 'PATCH' });
export const getInventoryQuality = (siteId?: string) => apiFetch<InventoryQuality>(`/api/v1/inventory-quality/summary${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getInventoryQualityItems = (siteId?: string) => apiFetch<{ items: InventoryFinding[] }>(`/api/v1/inventory-quality/findings${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getInventoryQualityAssignees = (siteId: string) => apiFetch<Array<{ id: string; username: string; displayName?: string | null }>>(`/api/v1/inventory-quality/assignees?siteId=${encodeURIComponent(siteId)}`);
export const acknowledgeInventoryFinding = (id: string) => apiFetch(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' });
export const assignInventoryFinding = (id: string, userId?: string) => apiFetch(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/assign`, { method: 'PATCH', body: JSON.stringify({ userId: userId || null }) });
export const snoozeInventoryFinding = (id: string, until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()) => apiFetch(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/snooze`, { method: 'PATCH', body: JSON.stringify({ until }) });

/** Server filters of the findings list and its facets. `assignee` is a user id, `me` or `unassigned`. */
export type FindingQuery = { siteId?: string; status?: FindingStatus; severity?: FindingSeverity; rule?: string; search?: string; assignee?: string };
export type FindingPage = { items: InventoryFinding[]; total: number; page: number; pageSize: number };
export type FindingFacets = {
  total: number;
  byStatus: Partial<Record<FindingStatus, number>>;
  bySeverity: Partial<Record<FindingSeverity, number>>;
  byRule: Array<{ rule: string; total: number; byStatus: Partial<Record<FindingStatus, number>> }>;
  byAssignee: Array<{ userId: string | null; username?: string | null; displayName?: string | null; total: number }>;
};
export type BulkFindingAction = 'ACKNOWLEDGE' | 'ASSIGN' | 'SNOOZE';
export type BulkFindingRequest = { action: BulkFindingAction; ids: string[]; userId?: string | null; durationHours?: number; reason?: string };
export type BulkFindingResult = { id: string; ok: true; status?: FindingStatus } | { id: string; ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'ERROR'; message?: string };
export type BulkFindingResponse = { action: BulkFindingAction; succeeded: number; failed: number; snoozedUntil?: string; results: BulkFindingResult[] };

const findingQuery = (query: FindingQuery, extra: Record<string, string> = {}) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  return params.toString();
};
export const FINDING_PAGE_SIZE = 100;
export const listInventoryFindings = (query: FindingQuery, page = 1) => apiFetch<FindingPage>(`/api/v1/inventory-quality/findings?${findingQuery(query, { page: String(page), pageSize: String(FINDING_PAGE_SIZE) })}`);
export const getInventoryQualityFacets = (query: FindingQuery) => apiFetch<FindingFacets>(`/api/v1/inventory-quality/facets?${findingQuery(query)}`);
/** At most 200 ids per call; each item is checked and reported on its own. */
export const bulkInventoryFindings = (body: BulkFindingRequest) => apiFetch<BulkFindingResponse>('/api/v1/inventory-quality/findings/bulk', { method: 'POST', body: JSON.stringify(body) });
