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

/** GET answer for a Site without a NetApp integration (200, not an error). */
export interface NetAppNotConfigured { siteId: string; configured: false }

export interface NetAppIntegrationInput { endpointUrl: string; username: string; password: string }

export const getNetAppIntegration = (siteId: string) => apiFetch<NetAppIntegration | NetAppNotConfigured>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}`);
export const configureNetAppIntegration = (siteId: string, body: NetAppIntegrationInput) => apiFetch<NetAppIntegration>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/integration`, { method: 'PUT', body: JSON.stringify(body) });
export const refreshNetAppSnapshot = (siteId: string) => apiFetch<NetAppIntegration>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/refresh`, { method: 'POST' });

// ── Capacity trend (#85) ───────────────────────────────────────────────────

export type NetAppTrendKind = 'CLUSTER' | 'AGGREGATE' | 'VOLUME';

export interface NetAppTrendPoint { date: string; observedAt: string; sizeBytes: number | null; usedBytes: number | null; usedPercent: number | null; state?: string | null }

export interface NetAppTrend {
  siteId: string;
  kind: NetAppTrendKind;
  key: string | null;
  name: string | null;
  svm?: string | null;
  days: number;
  retentionDays: number;
  points: NetAppTrendPoint[];
  summary: { days: number; firstUsedBytes: number | null; lastUsedBytes: number | null; changeBytes: number | null; growthBytesPerDay: number | null; latestUsedPercent: number | null; projectedFullAt: string | null };
}

export interface NetAppTrendObject { key: string; name: string; svm?: string | null; state?: string | null; observedAt?: string; sizeBytes?: number | null; usedBytes?: number | null; usedPercent?: number | null; firstObservedAt?: string; changeBytes?: number | null; growthBytesPerDay?: number | null }

export interface NetAppTrendObjects { siteId: string; kind: NetAppTrendKind; days: number; retentionDays: number; items: NetAppTrendObject[]; truncated?: boolean }

const trendQuery = (values: Record<string, string | number | null | undefined>) => {
  const params = new URLSearchParams();
  for (const [name, value] of Object.entries(values)) if (value !== undefined && value !== null && value !== '') params.set(name, String(value));
  return params.toString();
};

/** Daily capacity points for the cluster, one aggregate or one volume (key = uuid or name). 400 NETAPP_TREND_INVALID. Each read is audited. */
export const getNetAppTrend = (siteId: string, input: { kind: NetAppTrendKind; key?: string | null; days?: number }) =>
  apiFetch<NetAppTrend>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/trend?${trendQuery({ kind: input.kind, key: input.kind === 'CLUSTER' ? undefined : input.key, days: input.days })}`);

/** Aggregates or volumes with trend samples in the window, to pick the trend object. */
export const listNetAppTrendObjects = (siteId: string, input: { kind: Exclude<NetAppTrendKind, 'CLUSTER'>; days?: number }) =>
  apiFetch<NetAppTrendObjects>(`/api/v1/netapp/sites/${encodeURIComponent(siteId)}/trend/objects?${trendQuery({ kind: input.kind, days: input.days })}`);
