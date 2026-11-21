import { apiFetch } from '@/lib/api/client';
import type { AccessGroup, AccessGroupUser, SettingsMutation } from './types';

export const settingsKeys = {
  groups: ['settings', 'access-groups'] as const,
  users: ['settings', 'access-group-users'] as const,
};

export const listAccessGroups = (siteId?: string) => apiFetch<AccessGroup[]>(`/api/v1/settings/access-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const listAccessGroupUsers = () => apiFetch<AccessGroupUser[]>('/api/v1/settings/access-group-users');
export const mutateSettings = ({ path, method, body }: SettingsMutation) => apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });

export type RoleRequestStatus = 'PENDING' | 'PROCESSING' | 'APPROVED' | 'REJECTED';
export interface RoleRequestPerson { id: string; username: string; displayName?: string | null; email?: string | null }
export interface RoleRequestItem {
  id: string;
  requestedRoles: string[];
  /** Kept as string: a status added later must still render. */
  status: RoleRequestStatus | string;
  createdAt: string;
  processingAt?: string | null;
  decidedAt?: string | null;
  user?: RoleRequestPerson | null;
  reviewer?: RoleRequestPerson | null;
}
export interface RoleRequestPage { items: RoleRequestItem[]; page: number; pageSize: number; total: number; totalPages: number; pendingTotal?: number }

/** ADMIN queue. `status` is a comma list; the API defaults to PENDING,PROCESSING and answers 400 ROLE_REQUEST_STATUS_INVALID otherwise. */
export const listRoleRequests = ({ status, page = 1, pageSize = 20 }: { status?: string; page?: number; pageSize?: number } = {}) => {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<RoleRequestPage>(`/api/v1/settings/role-requests?${query.toString()}`);
};
export const decideRoleRequest = (id: string, decision: 'APPROVE' | 'REJECT') => apiFetch<unknown>(`/api/v1/settings/role-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
