import type { AppLocale } from '@/lib/i18n';
import { apiFetch } from '@/lib/api/client';
import type { Site } from '@/features/infrastructure/types';

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

/** The SystemSettings row saved by the organization step (its discovery and audit settings are left out here). */
export interface SetupOrganizationRecord {
  id: string;
  organizationName: string | null;
  organizationCode: string | null;
  timezone: string;
  locale: string;
  setupCompleted: boolean;
  setupCompletedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export function getSetupStatus(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>('/api/v1/setup/status');
}

export function createSetupOrganization(payload: SetupOrganizationPayload): Promise<SetupOrganizationRecord> {
  return apiFetch<SetupOrganizationRecord>('/api/v1/setup/organization', { method: 'POST', body: JSON.stringify(payload) });
}

/** Answers the new Site row (the optional building, room and rack are created but not returned). */
export function createSetupSite(payload: SetupSitePayload): Promise<Site> {
  return apiFetch<Site>('/api/v1/setup/site', { method: 'POST', body: JSON.stringify(payload) });
}

export function completeSetup(): Promise<SetupStatus> {
  return apiFetch<SetupStatus>('/api/v1/setup/complete', { method: 'POST' });
}
