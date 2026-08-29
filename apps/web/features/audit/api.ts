import { apiFetch } from '@/lib/api/client';

export interface AuditEvent {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  user?: { username: string; displayName?: string | null } | null;
}

export function listAuditEvents(): Promise<AuditEvent[]> {
  return apiFetch<AuditEvent[]>('/api/v1/audit/events?limit=100');
}
