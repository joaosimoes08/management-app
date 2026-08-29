import { apiFetch } from '@/lib/api/client';

export interface DashboardSummary {
  counts: { sites: number; devices: number; vlans: number; subnets: number; ips: number; occupiedIps: number; freeIps: number; applications: number };
  recentAudit: { id: string; action: string; entityType?: string | null; username: string; createdAt: string }[];
}

export function getDashboardSummary(): Promise<DashboardSummary> {
  return apiFetch<DashboardSummary>('/api/v1/dashboard/summary');
}
