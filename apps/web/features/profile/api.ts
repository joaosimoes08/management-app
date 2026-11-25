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

export function getMyRoleRequests(requestId?: string): Promise<RoleResponse> {
  const query = requestId ? `?requestId=${encodeURIComponent(requestId)}` : '';
  return apiFetch<RoleResponse>(`/api/v1/settings/role-requests/me${query}`);
}

export function submitRoleRequest(roles: string[]): Promise<unknown> {
  return apiFetch('/api/v1/settings/role-requests', { method: 'POST', body: JSON.stringify({ roles }) });
}

export const NOTIFICATIONS_CHANGED = 'civernode:notifications-changed';

export async function markNotificationsRead(): Promise<void> {
  await apiFetch('/api/v1/dashboard/notifications/read-all', { method: 'PATCH' });
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export const notificationTopics = ['ROLE_REQUEST', 'CRITICAL_ASSET_ATTESTATION', 'LIFECYCLE_DATE'] as const;
export type NotificationTopic = typeof notificationTopics[number];
export type NotificationItem = {
  id: string;
  type: string;
  title: string;
  message: string;
  createdAt: string;
  readAt: string | null;
  href: string | null;
};
export type NotificationPage = { items: NotificationItem[]; nextCursor: string | null };
/** `teams` (Step 31) is the per-topic Microsoft Teams copy; `teamsAvailable` is false until an ADMIN enables the channel. `email` is the same for the user's own e-mail address. */
export type NotificationPreference = {
  type: NotificationTopic; muted: boolean; teams?: boolean; teamsAvailable?: boolean;
  /** Copy by e-mail to the user's own address; needs the ADMIN SMTP channel on and an e-mail on the account. */
  email?: boolean; emailAvailable?: boolean; hasEmail?: boolean;
};
export type NotificationPreferenceChange = { muted?: boolean; teams?: boolean; email?: boolean };

export function listNotifications(status: 'all' | 'unread', type: string, cursor: string | null) {
  const query = new URLSearchParams({ status });
  if (type) query.set('type', type);
  if (cursor) query.set('cursor', cursor);
  return apiFetch<NotificationPage>(`/api/v1/notifications?${query}`);
}

export async function markNotificationRead(id: string, read: boolean): Promise<void> {
  await apiFetch(`/api/v1/notifications/${encodeURIComponent(id)}/read`, { method: 'PATCH', body: JSON.stringify({ read }) });
  window.dispatchEvent(new Event(NOTIFICATIONS_CHANGED));
}

export function getNotificationPreferences() {
  return apiFetch<NotificationPreference[]>('/api/v1/notifications/preferences');
}

export function saveNotificationPreference(type: NotificationTopic, change: NotificationPreferenceChange) {
  return apiFetch<NotificationPreference>(`/api/v1/notifications/preferences/${type}`, { method: 'PATCH', body: JSON.stringify(change) });
}
