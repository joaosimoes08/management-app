import { apiDownload, apiFetch } from '@/lib/api/client';

/** Legacy list shape (`GET /audit/events`), kept for the free-text helper in `search.ts`. */
export interface AuditEvent {
  id: string;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  createdAt: string;
  user?: { username: string; displayName?: string | null } | null;
}

export type AuditActor = { id: string; username: string; displayName?: string | null };
export type AuditDiffEntry = { field: string; before: unknown; after: unknown };

/** One event of `GET /audit/events/page`. `diff` is null when the event stored no previous values. */
export interface AuditPageEvent extends AuditEvent {
  ipAddress?: string | null;
  userId?: string | null;
  metadata?: Record<string, unknown> | null;
  user?: AuditActor | null;
  diff: AuditDiffEntry[] | null;
  hasDiff: boolean;
}

export type AuditPage = { items: AuditPageEvent[]; nextCursor: string | null; hasMore: boolean; limit: number };
export type AuditFacetValue = { value: string; count: number };
export type AuditFacets = { actions: AuditFacetValue[]; entityTypes: AuditFacetValue[]; actors: Array<AuditActor & { count: number }>; truncated: boolean };

/** Server-side filters shared by `/page` and `/export`. Empty values are left out. */
export type AuditQuery = { q?: string; action?: string; entityType?: string; entityId?: string; actorId?: string; from?: string; to?: string; excludeHttp?: boolean };

export function auditQueryString(query: AuditQuery, extra: Record<string, string | undefined> = {}): string {
  const params = new URLSearchParams();
  for (const [key, value] of Object.entries({ ...query, ...extra })) {
    if (value === true) params.set(key, 'true');
    else if (typeof value === 'string' && value.trim()) params.set(key, value.trim());
  }
  return params.toString();
}

export const AUDIT_PAGE_SIZE = 50;

export const getAuditPage = (query: AuditQuery, cursor?: string | null) =>
  apiFetch<AuditPage>(`/api/v1/audit/events/page?${auditQueryString(query, { limit: String(AUDIT_PAGE_SIZE), cursor: cursor ?? undefined })}`);

export const getAuditFacets = (range: { from?: string; to?: string } = {}) => {
  const query = auditQueryString(range);
  return apiFetch<AuditFacets>(`/api/v1/audit/facets${query ? `?${query}` : ''}`);
};

/** Server CSV (max 10 000 rows) with the same filters as the list. */
export async function exportAuditCsv(query: AuditQuery, fileName: string): Promise<{ rows: number | null; truncated: boolean }> {
  const queryText = auditQueryString(query);
  const headers = await apiDownload(`/api/v1/audit/events/export${queryText ? `?${queryText}` : ''}`, fileName);
  const rows = Number(headers.get('X-Export-Row-Count'));
  return { rows: Number.isFinite(rows) && headers.get('X-Export-Row-Count') !== null ? rows : null, truncated: headers.get('X-Export-Truncated') === 'true' };
}
