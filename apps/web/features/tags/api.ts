import { apiFetch } from '@/lib/api/client';
import type { Tag, TagColor, TagInput, TagSummary } from './types';

export const tagsQueryKey = (siteId: string | null | undefined) => ['tags', siteId ?? null] as const;

export function listTags(siteId: string) {
  return apiFetch<Tag[]>(`/api/v1/tags?siteId=${encodeURIComponent(siteId)}`);
}

export function createTag(input: TagInput) {
  return apiFetch<Tag>('/api/v1/tags', { method: 'POST', body: JSON.stringify(input) });
}

export function updateTag(id: string, input: { name?: string; color?: TagColor }) {
  return apiFetch<Tag>(`/api/v1/tags/${id}`, { method: 'PATCH', body: JSON.stringify(input) });
}

export function deleteTag(id: string) {
  return apiFetch<{ success: boolean }>(`/api/v1/tags/${id}`, { method: 'DELETE' });
}

export function setDeviceTags(deviceId: string, tagIds: string[]) {
  return apiFetch<{ deviceId: string; tags: TagSummary[] }>(`/api/v1/devices/${deviceId}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) });
}

export function setSubnetTags(subnetId: string, tagIds: string[]) {
  return apiFetch<{ subnetId: string; tags: TagSummary[] }>(`/api/v1/subnets/${subnetId}/tags`, { method: 'PUT', body: JSON.stringify({ tagIds }) });
}
