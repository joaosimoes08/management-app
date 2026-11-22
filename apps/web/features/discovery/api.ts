import { apiFetch } from '@/lib/api/client';
import type { BulkReviewResponse } from '@/components/ui/bulk-review-dialog';

export interface DiscoveryJob {
  id: string;
  name: string;
  status: string;
  createdAt: string;
  startedAt?: string | null;
  completedAt?: string | null;
  /** completedAt − startedAt in ms; null while running or never started. */
  durationMs?: number | null;
  scannedCount?: number;
  reachableCount?: number;
  unreachableCount?: number;
  resultCount?: number;
  _count: { results: number };
  subnet: {
    id: string;
    cidr: string;
    vlan?: { vlanId: number; name: string } | null;
    site?: { name: string } | null;
  };
}

export interface DiscoveryResult {
  id: string;
  address: string;
  hostname?: string | null;
  icmpReachable: boolean;
  responseMs?: number | null;
  openPorts?: number[] | null;
  status: string;
  deviceId?: string | null;
  device?: { id: string; name: string; type: string } | null;
  /** Current IPAM record for the address; null when the address is not tracked yet. */
  ipam?: DiscoveryResultIpam | null;
}

export interface DiscoveryResultIpam {
  ipAddressId: string;
  state: string;
  hostId?: string | null;
  hostName?: string | null;
  activeReservation?: { id: string; expiresAt: string } | null;
}

export interface DiscoveryComparisonItem {
  address: string;
  previous: Pick<DiscoveryResult, 'address' | 'hostname' | 'icmpReachable' | 'openPorts'> | null;
  current: Pick<DiscoveryResult, 'address' | 'hostname' | 'icmpReachable' | 'openPorts'> | null;
  changes: string[];
}

export interface DiscoveryComparison {
  previous: { id: string; name: string; completedAt: string | null };
  current: { id: string; name: string; completedAt: string | null };
  newlySeen: DiscoveryComparisonItem[];
  changed: DiscoveryComparisonItem[];
  noLongerReachable: DiscoveryComparisonItem[];
}

export type SnmpOnboardingVersion = 'V2C' | 'V3';
export interface SnmpPreRegistration {
  id: string;
  sourceAddress: string;
  siteId: string;
  site?: { id: string; name: string; code: string };
  version: SnmpOnboardingVersion;
  username?: string | null;
  status: 'WAITING' | 'DISCOVERED';
  expiresAt: string;
  firstSeenAt?: string | null;
  lastSeenAt?: string | null;
  trapCount: number;
  latestTrapOid?: string | null;
  createdAt: string;
}

export interface SnmpPreRegistrationInput {
  sourceAddress: string;
  siteId: string;
  version: SnmpOnboardingVersion;
  username?: string;
  community?: string;
  authKey?: string;
  privKey?: string;
  authProtocol?: string;
  privProtocol?: string;
  compatibilitySha1?: boolean;
}

export interface DiscoverySubnet {
  id: string;
  cidr: string;
  siteId?: string | null;
  vlanId?: string | null;
}

export interface DiscoverySchedule {
  subnetId: string;
  enabled: boolean;
  intervalHours: number;
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
  lastRunAt: string | null;
  nextRunAt: string | null;
  lastStatus: string | null;
  lastError: string | null;
}

export interface DiscoveryScheduleInput {
  enabled: boolean;
  intervalHours: number;
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
}

export function getDiscoverySchedule(subnetId: string): Promise<DiscoverySchedule> {
  return apiFetch<DiscoverySchedule>(`/api/v1/subnets/${encodeURIComponent(subnetId)}/discovery-schedule`);
}

export function updateDiscoverySchedule(subnetId: string, body: DiscoveryScheduleInput): Promise<DiscoverySchedule> {
  return apiFetch<DiscoverySchedule>(`/api/v1/subnets/${encodeURIComponent(subnetId)}/discovery-schedule`, { method: 'PATCH', body: JSON.stringify(body) });
}

export interface DiscoveryDefaults {
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
  profiles: Array<{ id: string; name: string; description: string; methods: string[]; tcpPorts: number[]; reverseDns: boolean }>;
}

export interface DiscoveryJobPayload {
  name: string;
  subnetId: string;
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
  profileId: string;
}

/** `status` is a comma list (e.g. `PENDING,RUNNING`); the API answers 400 with a message for unknown values. */
export function listDiscoveryJobs(status = ''): Promise<{ items: DiscoveryJob[]; total: number }> {
  const suffix = status ? `&status=${encodeURIComponent(status)}` : '';
  return apiFetch<{ items: DiscoveryJob[]; total: number }>(`/api/v1/discovery/jobs?pageSize=100${suffix}`);
}

export function listDiscoverySubnets(siteId: string): Promise<{ items: DiscoverySubnet[] }> {
  const suffix = siteId ? `&siteId=${encodeURIComponent(siteId)}` : '';
  return apiFetch<{ items: DiscoverySubnet[] }>(`/api/v1/subnets?pageSize=100${suffix}`);
}

export function getDiscoveryDefaults(): Promise<DiscoveryDefaults> {
  return apiFetch<DiscoveryDefaults>('/api/v1/settings/discovery');
}

export function createDiscoveryJob(payload: DiscoveryJobPayload): Promise<DiscoveryJob> {
  return apiFetch<DiscoveryJob>('/api/v1/discovery/jobs', { method: 'POST', body: JSON.stringify(payload) });
}

export function listDiscoveryResults(jobId: string): Promise<DiscoveryResult[]> {
  return apiFetch<DiscoveryResult[]>(`/api/v1/discovery/jobs/${jobId}/results`);
}

export function compareDiscoveryJobs(currentId: string, previousId: string): Promise<DiscoveryComparison> {
  return apiFetch<DiscoveryComparison>(`/api/v1/discovery/jobs/${currentId}/compare?with=${encodeURIComponent(previousId)}`);
}

export function reviewDiscoveryResult(resultId: string, status: 'APPROVED' | 'IGNORED'): Promise<unknown> {
  return apiFetch(`/api/v1/discovery/results/${resultId}/review`, { method: 'POST', body: JSON.stringify({ status }) });
}

/** Approves or ignores up to 200 results; each item succeeds or fails on its own. */
export function bulkReviewDiscoveryResults(ids: string[], status: 'APPROVED' | 'IGNORED'): Promise<BulkReviewResponse> {
  return apiFetch<BulkReviewResponse>('/api/v1/discovery/results/bulk-review', { method: 'POST', body: JSON.stringify({ ids, status }) });
}

export interface DiscoveryAcceptInput { name: string; type: string; hostname?: string; modelId?: string; frontAssetId?: string }
/** Credentials entered before a discovered host becomes a device. Secrets are write-only. */
export function listSnmpPreRegistrations(siteId: string): Promise<{ items: SnmpPreRegistration[] }> {
  return apiFetch<SnmpPreRegistration[]>(`/api/v1/snmp/discovery/enrollments?siteId=${encodeURIComponent(siteId)}`).then((items) => ({ items }));
}

export function createSnmpPreRegistration(body: SnmpPreRegistrationInput): Promise<SnmpPreRegistration> {
  return apiFetch<SnmpPreRegistration>('/api/v1/snmp/discovery/enrollments', { method: 'POST', body: JSON.stringify(body) });
}

export function rotateSnmpPreRegistration(id: string): Promise<SnmpPreRegistration> {
  return apiFetch<SnmpPreRegistration>(`/api/v1/snmp/discovery/enrollments/${id}/renew`, { method: 'POST' });
}

export function cancelSnmpPreRegistration(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/snmp/discovery/enrollments/${id}`, { method: 'DELETE' });
}

export function acceptSnmpPreRegistration(id: string, body: DiscoveryAcceptInput): Promise<{ id: string }> {
  return apiFetch<{ id: string }>(`/api/v1/snmp/discovery/enrollments/${id}/accept`, { method: 'POST', body: JSON.stringify(body) });
}

/** Round 2 #14: OCCUPIED addresses that answered in none of the completed scans of their subnet in the last 30 days. */
export interface MissingIp {
  ipId: string;
  address: string;
  subnetId: string;
  cidr: string;
  siteId: string | null;
  hostname: string | null;
  lastSeenAt: string | null;
  lastScanAt: string;
  scanCount: number;
}
export interface MissingIpsResponse { windowDays: number; total: number; items: MissingIp[] }
export interface MarkFreeResult { ipId: string; ok: boolean; code?: string; message?: string; address?: string }

export function listMissingIps(siteId = ''): Promise<MissingIpsResponse> {
  return apiFetch<MissingIpsResponse>(`/api/v1/discovery/missing${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`);
}

export function markMissingIpsFree(ipIds: string[]): Promise<{ results: MarkFreeResult[]; succeeded: number; failed: number }> {
  return apiFetch('/api/v1/discovery/missing/mark-free', { method: 'POST', body: JSON.stringify({ ipIds }) });
}
