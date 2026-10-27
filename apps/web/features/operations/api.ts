import { apiFetch } from '@/lib/api/client';

export type OperationalAlert = { id: string; title: string; detail?: string; severity: 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'WARNING' | 'INFO'; status?: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; occurredAt?: string; href?: string };
export type InventoryQuality = { score?: number; total?: number; valid?: number; invalid?: number; stale?: number; deviceCount?: number; affectedDeviceCount?: number; validDeviceCount?: number; affectedEntityCount?: number; findingCount?: number; staleFindingCount?: number };
export type InventoryFinding = { id: string; siteId: string; rule: string; severity: 'CRITICAL' | 'HIGH' | 'WARNING' | 'INFO'; status: 'OPEN' | 'ACKNOWLEDGED' | 'SNOOZED' | 'RESOLVED'; title: string; detail: string; lastDetectedAt: string; assignedTo?: { id: string; username: string; displayName?: string | null } | null };

export const listOperationalAlerts = (siteId?: string) => apiFetch<{ items: OperationalAlert[] }>(`/api/v1/operations/alerts${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
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
