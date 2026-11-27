import { apiFetch } from '@/lib/api/client';
import type { PaginatedResponse, SuccessResponse } from '@/lib/api/types';
import type { AccessGroup, AccessGroupInput, AccessGroupMemberRecord, AccessGroupRecord, AccessGroupSiteAssignment, AccessGroupUser, CreatedAccessGroup, IpamAction } from './types';

export const settingsKeys = {
  groups: ['settings', 'access-groups'] as const,
  users: ['settings', 'access-group-users'] as const,
};

export const listAccessGroups = (siteId?: string) => apiFetch<AccessGroup[]>(`/api/v1/settings/access-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const listAccessGroupUsers = () => apiFetch<AccessGroupUser[]>('/api/v1/settings/access-group-users');
const accessGroupPath = (groupId: string) => `/api/v1/settings/access-groups/${groupId}`;
export const createAccessGroup = (body: AccessGroupInput & { siteIds: string[] }) => apiFetch<CreatedAccessGroup>('/api/v1/settings/access-groups', { method: 'POST', body: JSON.stringify(body) });
export const updateAccessGroup = (groupId: string, body: AccessGroupInput) => apiFetch<AccessGroupRecord>(accessGroupPath(groupId), { method: 'PATCH', body: JSON.stringify(body) });
export const deleteAccessGroup = (groupId: string) => apiFetch<SuccessResponse>(accessGroupPath(groupId), { method: 'DELETE' });
export const addAccessGroupMember = (groupId: string, userId: string) => apiFetch<AccessGroupMemberRecord>(`${accessGroupPath(groupId)}/members`, { method: 'POST', body: JSON.stringify({ userId }) });
export const removeAccessGroupMember = (groupId: string, userId: string) => apiFetch<SuccessResponse>(`${accessGroupPath(groupId)}/members/${userId}`, { method: 'DELETE' });
/** Adds the Site to the group, or replaces its permissions. Answers the assignment with its site and permissions (null only if it vanished meanwhile). */
export const assignAccessGroupSite = (groupId: string, siteId: string, permissions: IpamAction[]) => apiFetch<AccessGroupSiteAssignment | null>(`${accessGroupPath(groupId)}/sites/${siteId}`, { method: 'PUT', body: JSON.stringify({ permissions }) });
export const removeAccessGroupSite = (groupId: string, siteId: string) => apiFetch<SuccessResponse>(`${accessGroupPath(groupId)}/sites/${siteId}`, { method: 'DELETE' });

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
/** GET /settings/role-requests: the standard page plus the PENDING count across every page. */
export type RoleRequestPage = PaginatedResponse<RoleRequestItem> & { pendingTotal?: number };

/** ADMIN queue. `status` is a comma list; the API defaults to PENDING,PROCESSING and answers 400 ROLE_REQUEST_STATUS_INVALID otherwise. */
export const listRoleRequests = ({ status, page = 1, pageSize = 20 }: { status?: string; page?: number; pageSize?: number } = {}) => {
  const query = new URLSearchParams({ page: String(page), pageSize: String(pageSize) });
  if (status) query.set('status', status);
  return apiFetch<RoleRequestPage>(`/api/v1/settings/role-requests?${query.toString()}`);
};
export const decideRoleRequest = (id: string, decision: 'APPROVE' | 'REJECT') => apiFetch<RoleRequestItem>(`/api/v1/settings/role-requests/${encodeURIComponent(id)}`, { method: 'PATCH', body: JSON.stringify({ decision }) });
