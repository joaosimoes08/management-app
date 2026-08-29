import type { AppLocale } from '@/lib/i18n';
import { apiFetch } from '@/lib/api/client';

export interface SetupStatus {
  setupCompleted: boolean;
  organizationName?: string | null;
  organizationCode?: string | null;
  locale?: AppLocale;
  siteCount: number;
  hasSite: boolean;
}

export interface SetupOrganizationPayload {
  name: string;
  code?: string;
  timezone: string;
  locale: AppLocale;
}

export interface SetupSitePayload {
  name: string;
  code: string;
  address?: string;
  city?: string;
  region?: string;
  country?: string;
  buildingName?: string;
  roomName?: string;
  rackName?: string;
}

export function getSetupStatus(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>('/api/v1/setup/status');
}

export function createSetupOrganization(payload: SetupOrganizationPayload): Promise<unknown> {
  return apiFetch('/api/v1/setup/organization', { method: 'POST', body: JSON.stringify(payload) });
}

export function createSetupSite(payload: SetupSitePayload): Promise<unknown> {
  return apiFetch('/api/v1/setup/site', { method: 'POST', body: JSON.stringify(payload) });
}

export function completeSetup(): Promise<unknown> {
  return apiFetch('/api/v1/setup/complete', { method: 'POST' });
}
