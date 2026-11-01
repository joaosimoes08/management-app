import { apiFetch } from '@/lib/api/client';

export interface AuditEvent {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  user?: { username: string; displayName?: string | null } | null;
}

export type AuditFilters = { search?: string; action?: string; entityType?: string; user?: string; from?: string; to?: string };
export function listAuditEvents(filters: AuditFilters = {}): Promise<AuditEvent[]> {
  const query = new URLSearchParams({ limit: '200' });
  for (const [key, value] of Object.entries(filters)) if (value?.trim()) query.set(key, value.trim());
  return apiFetch<AuditEvent[]>(`/api/v1/audit/events?${query.toString()}`);
}
