import { apiFetch } from '@/lib/api/client';

export interface ApplicationLink {
  id: string;
  name: string;
  url: string;
  icon: string;
  description?: string | null;
  category: string;
  sortOrder: number;
  isActive: boolean;
  checkAvailability: boolean;
  lastCheckedAt?: string | null;
  isAvailable?: boolean | null;
  roles: { role: string }[];
}

export interface ApplicationLinkPayload {
  name: string;
  url: string;
  icon: string;
  description?: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  checkAvailability: boolean;
  roles: string[];
}

export function listApplicationLinks(includeInactive: boolean): Promise<ApplicationLink[]> {
  return apiFetch<ApplicationLink[]>(`/api/v1/application-links${includeInactive ? '?includeInactive=true' : ''}`);
}

export function createApplicationLink(payload: ApplicationLinkPayload): Promise<ApplicationLink> {
  return apiFetch<ApplicationLink>('/api/v1/application-links', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateApplicationLink(id: string, payload: ApplicationLinkPayload): Promise<ApplicationLink> {
  return apiFetch<ApplicationLink>(`/api/v1/application-links/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function removeApplicationLink(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/application-links/${id}`, { method: 'DELETE' });
}

export function checkApplicationLink(id: string): Promise<ApplicationLink> {
  return apiFetch<ApplicationLink>(`/api/v1/application-links/${id}/check`, { method: 'POST' });
}
