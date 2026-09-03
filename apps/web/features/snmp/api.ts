import { apiFetch } from '@/lib/api/client';

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
  traps: Array<{ id: string; receivedAt: string; category?: string | null; severity?: string | null; trapOid?: string | null; sourceAddress: string; status: string }>;
  setEnabled: boolean;
}

export const getSnmpOverview = (deviceId: string) => apiFetch<SnmpOverview>(`/api/v1/snmp/devices/${deviceId}`);
export const saveSnmpConfig = (deviceId: string, body: Omit<SnmpConfig, 'id' | 'lastPollAt' | 'nextPollAt' | 'lastStatus' | 'lastErrorCode'>) => apiFetch<SnmpConfig>(`/api/v1/snmp/devices/${deviceId}/config`, { method: 'PATCH', body: JSON.stringify(body) });
export const saveSnmpCredential = (deviceId: string, body: Record<string, unknown>) => apiFetch<SnmpCredentialSummary>(`/api/v1/snmp/devices/${deviceId}/credentials`, { method: 'POST', body: JSON.stringify(body) });
export const testSnmpCredential = (deviceId: string, purpose: SnmpCredentialPurpose) => apiFetch(`/api/v1/snmp/devices/${deviceId}/credentials/${purpose}/test`, { method: 'POST' });
export const runSnmpPoll = (deviceId: string) => apiFetch(`/api/v1/snmp/devices/${deviceId}/poll`, { method: 'POST' });
export const reviewSnmpDrift = (id: string, status: 'ACCEPTED' | 'IGNORED') => apiFetch(`/api/v1/snmp/drifts/${id}`, { method: 'PATCH', body: JSON.stringify({ status }) });
export const previewSnmpWrite = (deviceId: string, operation: string, parameters: Record<string, unknown>) => apiFetch<{ id: string; status: string }>(`/api/v1/snmp/devices/${deviceId}/write-requests/preview`, { method: 'POST', body: JSON.stringify({ operation, parameters }) });
export const executeSnmpWrite = (id: string) => apiFetch(`/api/v1/snmp/write-requests/${id}/execute`, { method: 'POST' });
