import { apiFetch } from '@/lib/api/client';

export interface DiscoveryJob {
  id: string;
  name: string;
  status: string;
  createdAt: string;
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

export interface DiscoveryDefaults {
  methods: string[];
  tcpPorts: number[];
  reverseDns: boolean;
}

export interface DiscoveryJobPayload {
  name: string;
  subnetId: string;
  methods: string[];
  tcpPorts: number[];
}

export function listDiscoveryJobs(): Promise<{ items: DiscoveryJob[]; total: number }> {
  return apiFetch<{ items: DiscoveryJob[]; total: number }>('/api/v1/discovery/jobs?pageSize=100');
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

export function reviewDiscoveryResult(resultId: string, status: 'APPROVED' | 'IGNORED'): Promise<unknown> {
  return apiFetch(`/api/v1/discovery/results/${resultId}/review`, { method: 'POST', body: JSON.stringify({ status }) });
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
