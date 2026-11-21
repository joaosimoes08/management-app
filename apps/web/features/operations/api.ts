import { apiFetch } from '@/lib/api/client';

export type OperationalAlert = { id: string; title: string; detail?: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING' | 'INFO'; status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; entityType?: string | null; entityId?: string | null; relatedDeviceId?: string | null; occurredAt?: string; href?: string };
export type InventoryQuality = { score?: number; total?: number; valid?: number; invalid?: number; stale?: number; deviceCount?: number; affectedDeviceCount?: number; validDeviceCount?: number; affectedEntityCount?: number; findingCount?: number; staleFindingCount?: number };
export type InventoryFinding = { id: string; siteId: string; rule: string; entityType: string; entityId: string; actionHref?: string | null; suggestedCorrection: string; severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO'; status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; title: string; detail: string; lastDetectedAt: string; assignedTo?: { id: string; username: string; displayName?: string | null } | null };

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

// Phase D: Alertas list, maintenance summary and inline rule / window edits (PR #85 contract).
export type AlertListItem = { id: string; source: string; siteId?: string | null; site?: { id: string; name: string } | null; status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; severity: string; title: string; detail?: string | null; actionHref?: string | null; lastOccurredAt?: string | null; firstOccurredAt?: string | null; occurrenceCount?: number; relatedDeviceId?: string | null; readAt?: string | null };
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
export const patchMaintenanceWindow = (id: string, patch: MaintenanceWindowPatch) => apiFetch(`/api/v1/operations/configuration/maintenance-windows/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify(patch) });
