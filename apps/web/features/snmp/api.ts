import { apiFetch } from '@/lib/api/client';
import type { PaginatedResponse } from '@/lib/api/types';
import type { BulkReviewResponse } from '@/components/ui/bulk-review-dialog';
import type { SnmpJobView, SnmpReceiverSettings } from './snmp-setup';

export type SnmpCredentialPurpose = 'READ' | 'WRITE' | 'TRAP';
export type SnmpVersion = 'V2C' | 'V3';
export interface SnmpCredentialSummary { id: string; purpose: SnmpCredentialPurpose; version: SnmpVersion; label?: string | null; username?: string | null; authProtocol?: string | null; privProtocol?: string | null; configured: boolean; lastTestedAt?: string | null; lastTestStatus?: string | null }
export interface SnmpConfig { id: string; enabled: boolean; port: number; intervalMinutes: number; timeoutMs: number; retries: number; compatibilitySha1: boolean; lastPollAt?: string | null; nextPollAt?: string | null; lastStatus?: string | null; lastErrorCode?: string | null }
export interface SnmpObservation { id: string; deviceInterfaceId?: string | null; ifIndex: number; name?: string | null; description?: string | null; alias?: string | null; adminUp?: boolean | null; operUp?: boolean | null; speedMbps?: number | null; macAddress?: string | null }
export interface SnmpOverview {
  config: SnmpConfig | null;
  credentials: SnmpCredentialSummary[];
  latestSnapshot: null | { id: string; sysName?: string | null; sysDescr?: string | null; sysObjectId?: string | null; sysLocation?: string | null; uptimeTicks?: string | null; observedAt: string; interfaces: SnmpObservation[] };
  jobs: SnmpJobView[];
  drifts: Array<{ id: string; field: string; documentedValue: unknown; observedValue: unknown; status: string; createdAt: string }>;
  traps: Array<{ id: string; receivedAt: string; category?: string | null; severity?: string | null; trapOid?: string | null; label?: string | null; summary?: string | null; sourceAddress: string; status: string }>;
  /** SNMP Phase 1 step 3: newest trap from this device, or null while waiting for the first one. */
  lastTrapReceivedAt?: string | null;
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
/** Removes one credential: this device, this purpose. Nothing else changes. */
/** Plain delete is refused with 409 SNMP_CREDENTIAL_IN_USE when the credential is in use; `force` (the confirmed "Eliminar mesmo assim" path) deletes anyway. A running job is refused with 409 SNMP_CREDENTIAL_BUSY either way (#176). */
export const deleteSnmpCredential = (deviceId: string, purpose: SnmpCredentialPurpose, force = false) => apiFetch<{ success: boolean; forced?: boolean }>(`/api/v1/snmp/devices/${deviceId}/credentials/${purpose}${force ? '?force=true' : ''}`, { method: 'DELETE' });
export const testSnmpCredential = (deviceId: string, purpose: SnmpCredentialPurpose) => apiFetch<SnmpJobView>(`/api/v1/snmp/devices/${deviceId}/credentials/${purpose}/test`, { method: 'POST' });
export const runSnmpPoll = (deviceId: string) => apiFetch<SnmpJobView>(`/api/v1/snmp/devices/${deviceId}/poll`, { method: 'POST' });
export const reviewSnmpDrift = (id: string, status: 'ACCEPTED' | 'IGNORED') => apiFetch(`/api/v1/snmp/drifts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export type SnmpImpactPreview = { applicable: boolean; summary: string; knownImpacts: { id: string; name: string; type: string; href: string; source: string; observedAt?: string }[]; coverage: { status: string; source?: string; lastObservedAt?: string | null; reason: string } };
export const previewSnmpWrite = (deviceId: string, operation: string, parameters: Record<string, unknown>) => apiFetch<{ id: string; status: string; impactPreview: SnmpImpactPreview }>(`/api/v1/snmp/devices/${deviceId}/write-requests/preview`, { method: 'POST', body: JSON.stringify({ operation, parameters }) });
export const executeSnmpWrite = (id: string, impactAcknowledged: boolean) => apiFetch(`/api/v1/snmp/write-requests/${id}/execute`, { method: 'POST', body: JSON.stringify({ impactAcknowledged }) });

// Phase E: fleet summary and drift review across devices. Types are kept loose
// (optional fields, string unions open-ended) so API additions never break the UI.
export type SnmpAttentionReason = 'FAILED' | 'BLOCKED' | 'NO_SCHEDULE' | 'STALE' | 'NEVER_POLLED' | 'NOT_CONFIGURED' | (string & {});
export interface SnmpFleetSummary {
  siteId?: string | null;
  generatedAt?: string;
  devices: { total: number; configured: number; enabled: number; disabled: number; notConfigured: number };
  polling: { byStatus: Record<string, number>; stale: number; noSchedule?: number; lastPollAt?: string | null; oldestPollAt?: string | null };
  scheduler?: { lastRunAt: string | null; ok: boolean | null; checked: number; repaired: number; failed: number; errorCode: string | null };
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
export type SnmpDriftPage = PaginatedResponse<SnmpFleetDrift>;
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

/** Approved or in-progress change plans whose window is open now and that include this device or one of its interfaces (Step 30). */
export type AttachableChangePlan = { id: string; title: string; status: 'APPROVED' | 'IN_PROGRESS'; plannedStartAt: string; plannedEndAt: string };
export const getAttachableChangePlans = (deviceId: string) => apiFetch<AttachableChangePlan[]>(`/api/v1/change-plans/attachable?deviceId=${encodeURIComponent(deviceId)}`);
export const linkSnmpWriteToChangePlan = (changePlanId: string, snmpWriteRequestId: string) => apiFetch<{ changePlanId: string; snmpWriteRequestId: string }>(`/api/v1/change-plans/${encodeURIComponent(changePlanId)}/snmp-writes`, { method: 'POST', body: JSON.stringify({ snmpWriteRequestId }) });

/** SNMP Phase 1 step 3: the trap receiver's addresses, UDP port, engine ID and whether v2c is allowed (ADMIN only). */
export const snmpReceiverKey = ['snmp', 'receiver'] as const;
export const getSnmpReceiverSettings = () => apiFetch<SnmpReceiverSettings>('/api/v1/settings/snmp-listeners');

/** SNMP Phase 1 step 4.3: unmatched traps grouped by source IP, and ignoring one source (ADMIN only). */
export type UnmatchedTrapSource = { sourceAddress: string; count: number; firstSeenAt: string | null; lastSeenAt: string | null; lastTrapLabel?: string | null; lastTrapOid?: string | null; version?: string | null; preRegistered?: boolean };
export const unmatchedTrapSourcesKey = ['snmp', 'unmatched-sources'] as const;
export const listUnmatchedTrapSources = () => apiFetch<{ items: UnmatchedTrapSource[] }>('/api/v1/snmp/traps/unmatched/sources');
export const ignoreUnmatchedTraps = (sourceAddress: string) => apiFetch<{ sourceAddress: string; ignored: number }>('/api/v1/snmp/traps/unmatched/ignore', { method: 'POST', body: JSON.stringify({ sourceAddress }) });
