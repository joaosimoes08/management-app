import { apiFetch } from '@/lib/api/client';
import type { AccessGroup, AccessGroupUser, SettingsMutation } from './types';

export const settingsKeys = {
  groups: ['settings', 'access-groups'] as const,
  users: ['settings', 'access-group-users'] as const,
};

export const listAccessGroups = (siteId?: string) => apiFetch<AccessGroup[]>(`/api/v1/settings/access-groups${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
export const listAccessGroupUsers = () => apiFetch<AccessGroupUser[]>('/api/v1/settings/access-group-users');
export const mutateSettings = ({ path, method, body }: SettingsMutation) => apiFetch(path, { method, body: body === undefined ? undefined : JSON.stringify(body) });
