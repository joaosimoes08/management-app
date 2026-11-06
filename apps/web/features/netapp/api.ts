import { apiFetch } from '@/lib/api/client';

export interface NetAppSnapshot {
  systems: Array<{ name: string; uuid?: string; version?: string; serialNumber?: string }>;
  nodes: Array<{ name: string; uuid?: string; health?: string; eligibility?: string }>;
  aggregates: Array<{ name: string; uuid?: string; state?: string; sizeBytes?: number; usedBytes?: number }>;
  volumes: Array<{ name: string; uuid?: string; state?: string; svm?: string; sizeBytes?: number; usedBytes?: number }>;
  capacity: { sizeBytes: number; usedBytes: number; availableBytes: number; usedPercent: number | null };
  health: 'healthy' | 'degraded' | 'unhealthy' | 'unknown';
  observedAt: string;
}

export interface NetAppIntegration {
  id: string;
  siteId: string;
  endpointUrl: string;
  username: string;
  configured: true;
  snapshot: NetAppSnapshot | null;
  lastAttemptAt: string | null;
  lastSuccessAt: string | null;
  lastErrorCode: string | null;
  updatedAt: string;
}

export interface NetAppIntegrationInput { endpointUrl: string; username: string; password: string }

export const getNetAppIntegration = (siteId: string) => apiFetch<NetAppIntegration>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}`);
export const configureNetAppIntegration = (siteId: string, body: NetAppIntegrationInput) => apiFetch<NetAppIntegration>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/integration`, { method: 'PUT', body: JSON.stringify(body) });
export const refreshNetAppSnapshot = (siteId: string) => apiFetch<NetAppIntegration>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/refresh`, { method: 'POST' });
