import { apiFetch } from '@/lib/api/client';

export interface RoleRequest {
  id: string;
  requestedRoles: string[];
  status: string;
  createdAt: string;
  decidedAt?: string | null;
}

export interface RoleResponse {
  eligibleRoles: string[];
  currentRoles: string[];
  pendingRequest?: RoleRequest | null;
  history: RoleRequest[];
}

export function getMyRoleRequests(): Promise<RoleResponse> {
  return apiFetch<RoleResponse>('/api/v1/settings/role-requests/me');
}

export function submitRoleRequest(roles: string[]): Promise<unknown> {
  return apiFetch('/api/v1/settings/role-requests', { method: 'POST', body: JSON.stringify({ roles }) });
}

export function markNotificationsRead(): Promise<unknown> {
  return apiFetch('/api/v1/dashboard/notifications/read-all', { method: 'PATCH' });
}
