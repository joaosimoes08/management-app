import { apiFetch } from '@/lib/api/client';
import type { BulkReviewResponse } from '@/components/ui/bulk-review-dialog';

export type SnmpCredentialPurpose = 'READ' | 'WRITE' | 'TRAP';
export type SnmpVersion = 'V2C' | 'V3';
export interface SnmpCredentialSummary { id: string; purpose: SnmpCredentialPurpose; version: SnmpVersion; label?: string | null; username?: string | null; authProtocol?: string | null; privProtocol?: string | null; configured: boolean; lastTestedAt?: string | null; lastTestStatus?: string | null }
export interface SnmpConfig { id: string; enabled: boolean; port: number; intervalMinutes: number; timeoutMs: number; retries: number; compatibilitySha1: boolean; lastPollAt?: string | null; nextPollAt?: string | null; lastStatus?: string | null; lastErrorCode?: string | null }
export interface SnmpObservation { id: string; deviceInterfaceId?: string | null; ifIndex: number; name?: string | null; description?: string | null; alias?: string | null; adminUp?: boolean | null; operUp?: boolean | null; speedMbps?: number | null; macAddress?: string | null }
export interface SnmpOverview {
  config: SnmpConfig | null;
  credentials: SnmpCredentialSummary[];
  latestSnapshot: null | { id: string; sysName?: string | null; sysDescr?: string | null; sysObjectId?: string | null; sysLocation?: string | null; uptimeTicks?: string | null; observedAt: string; interfaces: SnmpObservation[] };
  jobs: Array<{ id: string; type: string; status: string; errorCode?: string | null; createdAt: string; completedAt?: string | null }>;
  drifts: Array<{ id: string; field: string; documentedValue: unknown; observedValue: unknown; status: string; createdAt: string }>;
  traps: Array<{ id: string; receivedAt: string; category?: string | null; severity?: string | null; trapOid?: string | null; label?: string | null; summary?: string | null; sourceAddress: string; status: string }>;
  setEnabled: boolean;
}
export interface SnmpMetrics {
  days: number;
  expectedIntervalMinutes: number | null;
  selectedInterfaceIndex: number | null;
  interfaces: Array<{ ifIndex: number; name?: string | null; description?: string | null }>;
  availability: Array<{ id: string; observedAt: string; available: boolean | null; status: string; errorCode?: string | null }>;
  interfacesHistory: Array<{ observedAt: string; ifIndex: number; name?: string | null; description?: string | null; adminUp?: boolean | null; operUp?: boolean | null; speedMbps?: number | null; inMbps: number | null; outMbps: number | null }>;
}

export const getSnmpOverview = (deviceId: string) => apiFetch<SnmpOverview>(`/api/v1/snmp/devices/${deviceId}`);
export const getSnmpMetrics = (deviceId: string, interfaceIndex?: number, days = 7) => apiFetch<SnmpMetrics>(`/api/v1/snmp/devices/${deviceId}/metrics?days=${days}${interfaceIndex === undefined ? '' : `&interfaceIndex=${interfaceIndex}`}`);
export const saveSnmpConfig = (deviceId: string, body: Omit<SnmpConfig, 'id' | 'lastPollAt' | 'nextPollAt' | 'lastStatus' | 'lastErrorCode'>) => apiFetch<SnmpConfig>(`/api/v1/snmp/devices/${deviceId}/config`, { method: 'PATCH', body: JSON.stringify(body) });
export const saveSnmpCredential = (deviceId: string, body: Record<string, unknown>) => apiFetch<SnmpCredentialSummary>(`/api/v1/snmp/devices/${deviceId}/credentials`, { method: 'POST', body: JSON.stringify(body) });
export const testSnmpCredential = (deviceId: string, purpose: SnmpCredentialPurpose) => apiFetch(`/api/v1/snmp/devices/${deviceId}/credentials/${purpose}/test`, { method: 'POST' });
export const runSnmpPoll = (deviceId: string) => apiFetch(`/api/v1/snmp/devices/${deviceId}/poll`, { method: 'POST' });
export const reviewSnmpDrift = (id: string, status: 'ACCEPTED' | 'IGNORED') => apiFetch(`/api/v1/snmp/drifts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export type SnmpImpactPreview = { applicable: boolean; summary: string; knownImpacts: { id: string; name: string; type: string; href: string; source: string; observedAt?: string }[]; coverage: { status: string; source?: string; lastObservedAt?: string | null; reason: string } };
export const previewSnmpWrite = (deviceId: string, operation: string, parameters: Record<string, unknown>) => apiFetch<{ id: string; status: string; impactPreview: SnmpImpactPreview }>(`/api/v1/snmp/devices/${deviceId}/write-requests/preview`, { method: 'POST', body: JSON.stringify({ operation, parameters }) });
export const executeSnmpWrite = (id: string, impactAcknowledged: boolean) => apiFetch(`/api/v1/snmp/write-requests/${id}/execute`, { method: 'POST', body: JSON.stringify({ impactAcknowledged }) });

// Phase E: fleet summary and drift review across devices. Types are kept loose
// (optional fields, string unions open-ended) so API additions never break the UI.
export type SnmpAttentionReason = 'FAILED' | 'BLOCKED' | 'STALE' | 'NEVER_POLLED' | (string & {});
export interface SnmpFleetSummary {
  siteId?: string | null;
  generatedAt?: string;
  devices: { total: number; configured: number; enabled: number; disabled: number; notConfigured: number };
  polling: { byStatus: Record<string, number>; stale: number; lastPollAt?: string | null; oldestPollAt?: string | null };
  drift: { pending: number; devicesWithPending: number };
  attention: Array<{ deviceId: string; name: string; siteId?: string | null; reason: SnmpAttentionReason; lastStatus?: string | null; lastPollAt?: string | null; lastErrorCode?: string | null; pendingDrifts?: number }>;
  attentionTotal?: number;
}
export type SnmpDriftStatus = 'PENDING' | 'ACCEPTED' | 'IGNORED';
export interface SnmpFleetDrift {
  id: string;
  field: string;
  documentedValue: unknown;
  observedValue: unknown;
  status: SnmpDriftStatus | (string & {});
  reviewedAt?: string | null;
  createdAt: string;
  device?: { id: string; name: string; type?: string; siteId?: string | null } | null;
  interface?: { id: string; name: string } | null;
}
export interface SnmpDriftPage { items: SnmpFleetDrift[]; page: number; pageSize: number; total: number; totalPages: number }
export type SnmpDriftQuery = { status?: string; siteId?: string; deviceId?: string; page?: number; pageSize?: number };

const query = (values: Record<string, string | number | undefined>) => {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) if (value !== undefined && value !== '') params.set(key, String(value));
  const text = params.toString();
  return text ? `?${text}` : '';
};
export const getSnmpFleetSummary = (siteId?: string) => apiFetch<SnmpFleetSummary>(`/api/v1/snmp/fleet/summary${query({ siteId })}`);
export const listSnmpDrifts = (params: SnmpDriftQuery = {}) => apiFetch<SnmpDriftPage>(`/api/v1/snmp/drifts${query(params)}`);
export const bulkReviewSnmpDrifts = (ids: string[], status: 'ACCEPTED' | 'IGNORED') => apiFetch<BulkReviewResponse>('/api/v1/snmp/drifts/bulk-review', { method: 'POST', body: JSON.stringify({ ids, status }) });
