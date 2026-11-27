import { apiFetch } from '@/lib/api/client';
import type { SeverityGroup } from './severity';
import type { TopbarState } from '@/components/layout/topbar-state';

/** Query keys of the Dashboard feature's shell endpoints (topbar state, global search). */
export const dashboardKeys = {
  all: ['dashboard'] as const,
  topbarState: ['dashboard', 'topbar-state'] as const,
  searchAll: ['dashboard', 'search'] as const,
  search: (query: string) => ['dashboard', 'search', query] as const,
};

export interface DashboardSummary {
  counts: { sites: number; devices: number; vlans: number; subnets: number; ips: number; occupiedIps: number; freeIps: number; applications: number };
  recentAudit: { id: string; action: string; entityType?: string | null; username: string; createdAt: string }[];
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/v1/dashboard/summary');
}

export type DashboardRole = 'ADMIN' | 'NETWORK_OPERATOR' | 'SYSTEMS_OPERATOR' | 'AUDITOR' | 'READ_ONLY';
export interface DashboardWorkspace { id: string; siteId: string; siteName: string; siteCode?: string; role: DashboardRole; selected?: boolean; }
export interface DashboardWidget { id: string; x: number; y: number; w: number; h: number; visible: boolean; }
export interface DashboardLayout { siteId: string; role: DashboardRole; revision: number; widgets: DashboardWidget[]; }
export interface OperationalSummary { alerts: { total: number; unread?: number; groups?: SeverityGroup[] }; quality: { total?: number; score?: number; groups?: SeverityGroup[] }; discovery: number; drifts: number; inventory: { sites: number; devices: number; vlans: number; subnets: number; ips: number }; services: Array<{ key: string; label: string; state: string }>; processes: Array<{ id: string; state: string }>; updatedAt: string; }
export interface DashboardEnvironment { state: 'OPERATIONAL' | 'DEGRADED' | 'UNAVAILABLE'; services: Array<{ key: string; label: string; state: string }>; }

export const getDashboardWorkspaces = (siteId?: string) => apiFetch<{ items: DashboardWorkspace[] }>(`/api/v1/dashboard/workspaces${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getDashboardLayout = (siteId: string, role: DashboardRole) => apiFetch<DashboardLayout>(`/api/v1/dashboard/layout?siteId=${encodeURIComponent(siteId)}&role=${encodeURIComponent(role)}`);
export const saveDashboardLayout = (layout: DashboardLayout) => apiFetch<DashboardLayout>('/api/v1/dashboard/layout', { method: 'PUT', body: JSON.stringify(layout) });
/** The stored per-Site role choice (UserDashboardPreference row). */
export interface DashboardPreference { userId: string; siteId: string; selectedRole: DashboardRole; updatedAt: string }
export const saveDashboardPreference = (siteId: string, role: DashboardRole) => apiFetch<DashboardPreference>('/api/v1/dashboard/preference', { method: 'PUT', body: JSON.stringify({ siteId, role }) });
export const getOperationalSummary = (siteId: string, role: DashboardRole) => apiFetch<OperationalSummary>(`/api/v1/dashboard/operational-summary?siteId=${encodeURIComponent(siteId)}&role=${encodeURIComponent(role)}`);
export const getDashboardEnvironment = () => apiFetch<{ environment: DashboardEnvironment; updatedAt: string }>('/api/v1/dashboard/topbar-state');

/** Header bell, running processes and environment state (GET /dashboard/topbar-state). */
export const getTopbarState = () => apiFetch<TopbarState>('/api/v1/dashboard/topbar-state');

export type GlobalSearchResult = { id: string; type: string; title: string; detail: string; href: string; actionHref?: string };
/** Search params for the palette. `types=all` adds change plans, audit events and quality findings (PR #85). */
export const globalSearchPath = (query: string, types?: 'all') => `/api/v1/dashboard/search?q=${encodeURIComponent(query)}&limit=8${types ? `&types=${types}` : ''}`;
/** An API without the extended types answers 400 SEARCH_TYPES_INVALID; the palette then retries with the default types. */
export const isSearchTypesInvalid = (cause: unknown) => {
  const error = cause as { status?: number; code?: string; payload?: { code?: string } } | null;
  return error?.status === 400 && (error.code ?? error.payload?.code) === 'SEARCH_TYPES_INVALID';
};
/** Global search with every type, falling back to the default types on an API that does not know them. */
export const searchPlatform = async (query: string, signal?: AbortSignal) => {
  const search = (types?: 'all') => apiFetch<{ items: GlobalSearchResult[] }>(globalSearchPath(query, types), { signal });
  try { return await search('all'); }
  catch (cause) { if (isSearchTypesInvalid(cause)) return search(); throw cause; }
};
