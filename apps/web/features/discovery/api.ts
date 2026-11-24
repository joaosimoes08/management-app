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
  /** Round 2 #10/#11: saved progress, limits and how the scan ended. */
  totalCount?: number;
  processedCount?: number;
  probeCount?: number;
  attemptCount?: number;
  maxDurationSeconds?: number | null;
  maxProbes?: number | null;
  cancelRequestedAt?: string | null;
  stopReason?: 'CANCELLED' | 'LIMIT_DURATION' | 'LIMIT_PROBES' | null;
  errorMessage?: string | null;
  /** D-P1a: SNMP enrichment for this run (credential fixed when the run first started). */
  snmpCredentialId?: string | null;
  snmpEnrichedCount?: number;
  snmpFailedCount?: number;
  snmpSkippedReason?: string | null;
  /** D-P2a: per-run host counts by outcome (tcp* count probed ports); null for runs saved before D-P2a. */
  outcomeCounts?: DiscoveryOutcomeCounts | null;
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
  /** D-P1a: values read over SNMP from this host, each with its provenance; null when enrichment was off. */
  snmp?: DiscoverySnmpEnrichment | null;
  /** D-P2a: what each probe method saw for this host; null for runs saved before D-P2a. */
  outcome?: DiscoveryHostOutcome | null;
}

/** D-P2a: structured per-host outcome, read-only. */
export interface DiscoveryHostOutcome {
  v: 1;
  result: 'RESPONDED';
  icmp: 'REPLY' | 'NO_REPLY' | 'ERROR' | 'NOT_PROBED';
  tcp: Array<{ port: number; state: 'OPEN' | 'REFUSED' | 'TIMEOUT' | 'ERROR' }> | null;
  dns: 'PTR' | 'NO_PTR' | 'LOOKUP_FAILED' | 'NOT_REQUESTED';
  dnsError?: string;
  snmp: 'OK' | 'PARTIAL' | 'AUTH_FAILED' | 'TIMEOUT' | 'ERROR' | 'SKIPPED_POLICY' | 'NOT_ENABLED';
  snmpSkipReason?: string;
}
export interface DiscoveryOutcomeCounts {
  v: 1;
  responded: number; noResponse: number;
  icmpReply: number; icmpNoReply: number; icmpError: number;
  tcpOpen: number; tcpRefused: number; tcpTimeout: number; tcpError: number;
  dnsPtr: number; dnsNoPtr: number; dnsLookupFailed: number;
  snmpOk: number; snmpPartial: number; snmpAuthFailed: number; snmpTimeout: number; snmpError: number; snmpSkippedPolicy: number;
}

export const DISCOVERY_SNMP_FIELDS = ['sysName', 'sysObjectId', 'entityModel', 'entitySerial', 'sysDescr'] as const;
export type DiscoverySnmpFieldName = (typeof DISCOVERY_SNMP_FIELDS)[number];
export interface DiscoverySnmpField { value: string; oid: string; source: 'SNMP'; credentialId: string; observedAt: string }
export interface DiscoverySnmpEnrichment {
  status: 'OK' | 'PARTIAL' | 'AUTH_FAILED' | 'TIMEOUT' | 'ERROR';
  errorCode?: string;
  credentialId: string;
  observedAt: string;
  durationMs: number;
  fields: Partial<Record<DiscoverySnmpFieldName, DiscoverySnmpField>>;
}

export interface DiscoverySnmpCredentialOption {
  id: string;
  deviceId: string;
  deviceName: string;
  managementIp?: string | null;
  version: 'V1' | 'V2C' | 'V3';
  label?: string | null;
  username?: string | null;
}
export interface DiscoverySnmpSetting {
  subnetId: string;
  enabled: boolean;
  credentialId: string | null;
  credential: DiscoverySnmpCredentialOption | null;
  candidates: DiscoverySnmpCredentialOption[];
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
  previous: Pick<DiscoveryResult, 'address' | 'hostname' | 'icmpReachable' | 'openPorts' | 'snmp'> | null;
  current: Pick<DiscoveryResult, 'address' | 'hostname' | 'icmpReachable' | 'openPorts' | 'snmp'> | null;
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
  /** Absent while the subnet has no saved schedule: the API then answers with the defaults. */
  id?: string;
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
  /** Discovery P0: this subnet's scan load limits. null = the default, shown in `effective`. */
  limits?: DiscoveryLimits;
}

export interface DiscoveryLimits {
  probesPerSecond: number | null;
  maxSockets: number | null;
  effective: { probesPerSecond: number; maxSockets: number };
}

export interface DiscoveryScheduleInput {
  enabled: boolean;
  intervalHours: number;
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
  /** null resets to the default; omitted keeps the stored value. */
  probesPerSecond?: number | null;
  maxSockets?: number | null;
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

/**
 * `status` is a comma list (e.g. `PENDING,RUNNING`); the API answers 400 with a message for unknown values.
 * `siteId` (discovery P0) limits the list to runs on that Site's subnets; empty means every Site the user can read.
 */
export function getDiscoverySnmp(subnetId: string): Promise<DiscoverySnmpSetting> {
  return apiFetch<DiscoverySnmpSetting>(`/api/v1/subnets/${encodeURIComponent(subnetId)}/discovery-snmp`);
}

export function updateDiscoverySnmp(subnetId: string, credentialId: string | null): Promise<DiscoverySnmpSetting> {
  return apiFetch<DiscoverySnmpSetting>(`/api/v1/subnets/${encodeURIComponent(subnetId)}/discovery-snmp`, { method: 'PATCH', body: JSON.stringify({ credentialId }) });
}

export function listDiscoveryJobs(status = '', siteId = ''): Promise<{ items: DiscoveryJob[]; total: number }> {
  const suffix = `${status ? `&status=${encodeURIComponent(status)}` : ''}${siteId ? `&siteId=${encodeURIComponent(siteId)}` : ''}`;
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

export function cancelDiscoveryJob(id: string): Promise<DiscoveryJob> {
  return apiFetch<DiscoveryJob>(`/api/v1/discovery/jobs/${encodeURIComponent(id)}/cancel`, { method: 'POST' });
}

export function retryDiscoveryJob(id: string): Promise<DiscoveryJob> {
  return apiFetch<DiscoveryJob>(`/api/v1/discovery/jobs/${encodeURIComponent(id)}/retry`, { method: 'POST' });
}

/** Progress and end state shown next to a scan: `32/62 endereços`, `parado no limite de duração`, `cancelamento pedido`. */
export function discoveryJobProgress(job: Pick<DiscoveryJob, 'status' | 'totalCount' | 'processedCount' | 'stopReason' | 'cancelRequestedAt'>): string {
  const parts: string[] = [];
  if (job.totalCount && (job.status === 'RUNNING' || job.status === 'PENDING' || job.stopReason || job.status === 'FAILED')) parts.push(`${job.processedCount ?? 0}/${job.totalCount} endereços`);
  if (job.stopReason === 'LIMIT_DURATION') parts.push('parado no limite de duração');
  else if (job.stopReason === 'LIMIT_PROBES') parts.push('parado no limite de sondas');
  else if (job.status === 'CANCELLED') parts.push('cancelada');
  else if (job.cancelRequestedAt && job.status === 'RUNNING') parts.push('cancelamento pedido');
  return parts.join(' · ');
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
