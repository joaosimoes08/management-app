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
