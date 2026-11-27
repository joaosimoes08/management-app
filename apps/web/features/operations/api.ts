import { apiFetch } from '@/lib/api/client';

export type OperationalAlert = { id: string; title: string; detail?: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING' | 'INFO'; status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; entityType?: string | null; entityId?: string | null; relatedDeviceId?: string | null; occurredAt?: string; href?: string; source?: string; dedupKey?: string | null; siteId?: string | null; actionHref?: string | null; device?: AlertDevice | null };
export type AlertDevice = { id: string; name: string; managementIp?: string | null };
export type InventoryQuality = { score?: number; total?: number; valid?: number; invalid?: number; stale?: number; deviceCount?: number; affectedDeviceCount?: number; validDeviceCount?: number; affectedEntityCount?: number; findingCount?: number; staleFindingCount?: number };
export type FindingStatus = 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED';
export type FindingSeverity = 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO';
export type FindingPerson = { id: string; username: string; displayName?: string | null };
export type InventoryFinding = { id: string; siteId: string; rule: string; entityType: string; entityId: string; actionHref?: string | null; suggestedCorrection: string; severity: FindingSeverity; status: FindingStatus; title: string; detail: string; lastDetectedAt: string; assignedTo?: FindingPerson | null; snoozedUntil?: string | null; acknowledgedAt?: string | null; occurrenceCount?: number };

/** Raw OperationalAlert row: what acknowledge, snooze and resolve answer (no device, people or action label). */
export type OperationalAlertRecord = {
  id: string; dedupKey: string; source: string; severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO'; status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED';
  siteId: string | null; entityType: string | null; entityId: string | null; title: string; detail: string; actionHref: string | null;
  occurrenceCount: number; firstOccurredAt: string; lastOccurredAt: string;
  acknowledgedById: string | null; acknowledgedAt: string | null; snoozedUntil: string | null; snoozeReason: string | null;
  resolvedById: string | null; resolvedAt: string | null; resolutionReason: string | null; createdAt: string; updatedAt: string;
};
/** Raw InventoryFinding row: what acknowledge, assign and snooze answer (no assignee object, actionHref or suggestedCorrection). */
export type InventoryFindingRecord = {
  id: string; dedupKey: string; siteId: string | null; rule: string; severity: FindingSeverity; status: FindingStatus;
  entityType: string; entityId: string; title: string; detail: string; metadata: Record<string, unknown> | null;
  occurrenceCount: number; firstDetectedAt: string; lastDetectedAt: string; assignedToId: string | null;
  acknowledgedById: string | null; acknowledgedAt: string | null; snoozedUntil: string | null; snoozeReason: string | null;
  resolvedAt: string | null; createdAt: string; updatedAt: string;
};

export type OperationalAlertPage = { items: OperationalAlert[]; total: number; page: number; pageSize: number };
export const listOperationalAlerts = (siteId?: string, pageSize = 25, page = 1, status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED') => apiFetch<OperationalAlertPage>(`/api/v1/operations/alerts?${siteId ? `siteId=${encodeURIComponent(siteId)}&` : ''}${status ? `status=${status}&` : ''}page=${page}&pageSize=${pageSize}`);
export const acknowledgeOperationalAlert = (id: string) => apiFetch<OperationalAlertRecord>(`/api/v1/operations/alerts/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' });
/** Snoozes for a number of hours (1 to 720); the server works out the end time. */
export const snoozeOperationalAlert = (id: string, durationHours = 1) => apiFetch<OperationalAlertRecord>(`/api/v1/operations/alerts/${encodeURIComponent(id)}/snooze`, { method: 'PATCH', body: JSON.stringify({ durationHours }) });
export const resolveOperationalAlert = (id: string, reason?: string) => apiFetch<OperationalAlertRecord>(`/api/v1/operations/alerts/${encodeURIComponent(id)}/resolve`, { method: 'PATCH', body: JSON.stringify(reason ? { reason } : {}) });
export type BulkAlertAction = 'ACKNOWLEDGE' | 'SNOOZE' | 'RESOLVE';
export type BulkAlertRequest = { action: BulkAlertAction; ids: string[]; durationHours?: number; reason?: string };
export type BulkAlertResult = { id: string; ok: true; status?: string } | { id: string; ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'ERROR' | (string & {}); message?: string };
export type BulkAlertResponse = { action: BulkAlertAction; succeeded: number; failed: number; snoozedUntil?: string; results: BulkAlertResult[] };
export const BULK_ALERT_LIMIT = 200;
/** At most 200 ids per call; each alert is checked and reported on its own. */
export const bulkOperationalAlerts = (body: BulkAlertRequest) => apiFetch<BulkAlertResponse>('/api/v1/operations/alerts/bulk', { method: 'POST', body: JSON.stringify(body) });
export type AlertPerson = { id: string; username: string; displayName?: string | null };
export type AlertHistoryEntry = { id: string; action: string; metadata?: Record<string, unknown> | null; createdAt: string; user?: AlertPerson | null };
export type AlertDetail = AlertListItem & { entityType?: string | null; entityId?: string | null; acknowledgedAt?: string | null; acknowledgedBy?: AlertPerson | null; snoozedUntil?: string | null; snoozeReason?: string | null; resolvedAt?: string | null; resolvedBy?: AlertPerson | null; resolutionReason?: string | null; canAct: boolean; history: AlertHistoryEntry[] };
export const getOperationalAlert = (id: string) => apiFetch<AlertDetail>(`/api/v1/operations/alerts/${encodeURIComponent(id)}`);
/** Known event types for alert rules (known producers plus any stored source). */
export const listAlertSources = () => apiFetch<{ items: string[] }>('/api/v1/operations/alerts/sources');
export const readAllOperationalAlerts = () => apiFetch<{ updated: number }>('/api/v1/operations/alerts/read-all', { method: 'PATCH' });
export const getInventoryQuality = (siteId?: string) => apiFetch<InventoryQuality>(`/api/v1/inventory-quality/summary${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getInventoryQualityItems = (siteId?: string) => apiFetch<{ items: InventoryFinding[] }>(`/api/v1/inventory-quality/findings${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getInventoryQualityAssignees = (siteId: string) => apiFetch<Array<{ id: string; username: string; displayName?: string | null }>>(`/api/v1/inventory-quality/assignees?siteId=${encodeURIComponent(siteId)}`);
export const acknowledgeInventoryFinding = (id: string) => apiFetch<InventoryFindingRecord>(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/acknowledge`, { method: 'PATCH' });
export const assignInventoryFinding = (id: string, userId?: string) => apiFetch<InventoryFindingRecord>(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/assign`, { method: 'PATCH', body: JSON.stringify({ userId: userId || null }) });
export const snoozeInventoryFinding = (id: string, until = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString()) => apiFetch<InventoryFindingRecord>(`/api/v1/inventory-quality/findings/${encodeURIComponent(id)}/snooze`, { method: 'PATCH', body: JSON.stringify({ until }) });

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
export type BulkFindingResult = { id: string; ok: true; status?: FindingStatus } | { id: string; ok: false; code: 'NOT_FOUND' | 'FORBIDDEN' | 'INVALID' | 'ERROR' | (string & {}); message?: string };
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

// Phase D: Alertas list, maintenance summary and inline rule / window edits (PR #85 contract).
export type AlertListItem = { id: string; source: string; dedupKey?: string | null; siteId?: string | null; site?: { id: string; name: string } | null; status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; severity: string; title: string; detail?: string | null; actionHref?: string | null; lastOccurredAt?: string | null; firstOccurredAt?: string | null; occurrenceCount?: number; relatedDeviceId?: string | null; device?: AlertDevice | null; readAt?: string | null; snoozedUntil?: string | null };
export type AlertListFilters = { siteId?: string; severity?: string; status?: string; source?: string; search?: string };
/** GET /operations/alerts; unresolved by default. Invalid filters answer 400 with a message. */
export const listAlerts = (filters: AlertListFilters, pageSize = 100) => {
  const query = new URLSearchParams();
  for (const key of ['siteId', 'severity', 'status', 'source', 'search'] as const) if (filters[key]) query.set(key, filters[key]!);
  query.set('page', '1');
  query.set('pageSize', String(pageSize));
  return apiFetch<{ items: AlertListItem[]; total: number; page: number; pageSize: number }>(`/api/v1/operations/alerts?${query.toString()}`);
};

export type MaintenanceWindowSummaryItem = { id: string; name: string; reason?: string | null; siteId?: string | null; startsAt: string; endsAt: string; site?: { id: string; name: string } | null };
export type MaintenanceSummary = { generatedAt: string; horizonDays: number; counts: { active: number; upcoming: number }; nextStartsAt?: string | null; active: MaintenanceWindowSummaryItem[]; upcoming: MaintenanceWindowSummaryItem[]; criticalAlertsUnaffected?: boolean };
export const getMaintenanceSummary = (siteId?: string) => apiFetch<MaintenanceSummary>(`/api/v1/operations/maintenance/summary${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);

export type RuleAlertCounts = { matching: number; governed: number; shown: number; belowThreshold: number; inMaintenance: number };
export type AlertRule = { id: string; name: string; source: string; siteId?: string | null; minSeverity: string; enabled: boolean; site?: { id: string; name: string } | null; activeAlerts?: RuleAlertCounts };
export type AlertRulePatch = Partial<{ name: string; source: string; siteId: string | null; minSeverity: string; enabled: boolean }>;
export const patchAlertRule = (id: string, patch: AlertRulePatch) => apiFetch<AlertRule>(`/api/v1/operations/configuration/rules/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
export type MaintenanceWindowPatch = Partial<{ name: string; reason: string | null; siteId: string | null; startsAt: string; endsAt: string }>;
/** Raw MaintenanceWindow row, as PATCH answers it (no site object). */
export type MaintenanceWindowRecord = { id: string; name: string; reason: string | null; siteId: string | null; startsAt: string; endsAt: string; createdById: string | null; createdAt: string };
export const patchMaintenanceWindow = (id: string, patch: MaintenanceWindowPatch) => apiFetch<MaintenanceWindowRecord>(`/api/v1/operations/configuration/maintenance-windows/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
