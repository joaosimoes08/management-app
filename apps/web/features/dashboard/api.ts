import { apiFetch } from '@/lib/api/client';

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
export interface OperationalSummary { alerts: { total: number }; quality: { total: number }; discovery: number; drifts: number; inventory: { sites: number; devices: number; vlans: number; subnets: number; ips: number }; services: Array<{ key: string; label: string; state: string }>; processes: Array<{ id: string; state: string }>; updatedAt: string; }

export const getDashboardWorkspaces = (siteId?: string) => apiFetch<{ items: DashboardWorkspace[] }>(`/api/v1/dashboard/workspaces${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const getDashboardLayout = (siteId: string, role: DashboardRole) => apiFetch<DashboardLayout>(`/api/v1/dashboard/layout?siteId=${encodeURIComponent(siteId)}&role=${encodeURIComponent(role)}`);
export const saveDashboardLayout = (layout: DashboardLayout) => apiFetch<DashboardLayout>('/api/v1/dashboard/layout', { method: 'PUT', body: JSON.stringify(layout) });
export const saveDashboardPreference = (siteId: string, role: DashboardRole) => apiFetch('/api/v1/dashboard/preference', { method: 'PUT', body: JSON.stringify({ siteId, role }) });
export const getOperationalSummary = (siteId: string, role: DashboardRole) => apiFetch<OperationalSummary>(`/api/v1/dashboard/operational-summary?siteId=${encodeURIComponent(siteId)}&role=${encodeURIComponent(role)}`);
