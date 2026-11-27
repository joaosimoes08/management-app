import { apiFetch } from '@/lib/api/client';
import type { SuccessResponse } from '@/lib/api/types';

export interface ApplicationLink {
  id: string;
  name: string;
  url: string;
  icon: string;
  description?: string | null;
  category: string;
  sortOrder: number;
  isActive: boolean;
  checkAvailability: boolean;
  lastCheckedAt?: string | null;
  isAvailable?: boolean | null;
  roles: { role: string }[];
  /** Set by the API for the current user (#85). */
  isFavorite?: boolean;
}

export interface ApplicationLinkPayload {
  name: string;
  url: string;
  icon: string;
  description?: string;
  category: string;
  sortOrder: number;
  isActive: boolean;
  checkAvailability: boolean;
  roles: string[];
}

export function listApplicationLinks(includeInactive: boolean): Promise<ApplicationLink[]> {
  return apiFetch<ApplicationLink[]>(`/api/v1/application-links${includeInactive ? '?includeInactive=true' : ''}`);
}

export function createApplicationLink(payload: ApplicationLinkPayload): Promise<ApplicationLink> {
  return apiFetch<ApplicationLink>('/api/v1/application-links', { method: 'POST', body: JSON.stringify(payload) });
}

export function updateApplicationLink(id: string, payload: ApplicationLinkPayload): Promise<ApplicationLink> {
  return apiFetch<ApplicationLink>(`/api/v1/application-links/${id}`, { method: 'PATCH', body: JSON.stringify(payload) });
}

export function removeApplicationLink(id: string): Promise<SuccessResponse> {
  return apiFetch<SuccessResponse>(`/api/v1/application-links/${id}`, { method: 'DELETE' });
}

export function checkApplicationLink(id: string): Promise<ApplicationLink & Pick<CheckAllItem, 'code'>> {
  return apiFetch<ApplicationLink & Pick<CheckAllItem, 'code'>>(`/api/v1/application-links/${id}/check`, { method: 'POST' });
}

// ── Favourites (UserApplicationFavorite, #85) ──────────────────────────────

export interface FavoriteApplicationLink extends ApplicationLink { isFavorite: true; favoriteSortOrder?: number; favoritedAt?: string }

/** The current user's favourites, in their order. */
export function listFavoriteApplicationLinks(): Promise<{ items: FavoriteApplicationLink[] }> {
  return apiFetch<{ items: FavoriteApplicationLink[] }>('/api/v1/application-links/favorites');
}

/** Idempotent. 404 APPLICATION_LINK_NOT_FOUND when the link is gone or not visible. */
export type FavoriteAdded = { linkId: string; isFavorite: true; sortOrder: number; createdAt: string };
export function addFavoriteApplicationLink(id: string, sortOrder?: number): Promise<FavoriteAdded> {
  return apiFetch<FavoriteAdded>(`/api/v1/application-links/${encodeURIComponent(id)}/favorite`, { method: 'PUT', body: JSON.stringify(sortOrder === undefined ? {} : { sortOrder }) });
}

export function removeFavoriteApplicationLink(id: string): Promise<{ linkId: string; isFavorite: false }> {
  return apiFetch<{ linkId: string; isFavorite: false }>(`/api/v1/application-links/${encodeURIComponent(id)}/favorite`, { method: 'DELETE' });
}

// ── Check all (ADMIN, #85) ─────────────────────────────────────────────────

/**
 * One link's result. `code` is a machine reason such as BLOCKED (private / loopback target refused by the API),
 * INVALID_URL or UNREACHABLE; new codes may appear and are shown as they come.
 */
export interface CheckAllItem { id: string; name: string; available: boolean; httpStatus?: number | null; responseMs?: number | null; checkedAt?: string; code?: string | null; result?: string | null; status?: string | null; message?: string | null }

/**
 * One batch. The API pages with `offset` / `nextOffset` (null when done); `page` / `totalPages` / `hasMore` are
 * accepted too so the loop survives a change of paging style. Unknown fields are ignored.
 */
export interface CheckAllBatch {
  checked?: number; available?: number; unavailable?: number; blocked?: number; scope?: string;
  offset?: number; total?: number; nextOffset?: number | null;
  page?: number; totalPages?: number; hasMore?: boolean; nextPage?: number | null;
  perLinkTimeoutMs?: number;
  items: CheckAllItem[];
}

export interface CheckAllCursor { offset?: number; page?: number }

/** Checks one batch of active links (only those with "Verificar disponibilidade", or every active one with all). */
export function checkAllApplicationLinks(all: boolean, cursor: CheckAllCursor = {}): Promise<CheckAllBatch> {
  const params = new URLSearchParams();
  if (all) params.set('all', 'true');
  if (cursor.offset) params.set('offset', String(cursor.offset));
  if (cursor.page) params.set('page', String(cursor.page));
  const query = params.toString();
  return apiFetch<CheckAllBatch>(`/api/v1/application-links/check-all${query ? `?${query}` : ''}`, { method: 'POST' });
}

/** Where the next batch starts, or null when the API says there is nothing left (or makes no progress). */
export function nextCheckAllCursor(batch: CheckAllBatch, current: CheckAllCursor): CheckAllCursor | null {
  if (typeof batch.nextOffset === 'number') return batch.nextOffset > (current.offset ?? 0) ? { offset: batch.nextOffset } : null;
  if (batch.nextOffset === null) return null;
  const page = batch.page ?? current.page ?? 1;
  if (typeof batch.nextPage === 'number') return batch.nextPage > page ? { page: batch.nextPage } : null;
  if (typeof batch.totalPages === 'number' && page < batch.totalPages) return { page: page + 1 };
  if (batch.hasMore === true && batch.items.length > 0) return { page: page + 1 };
  return null;
}
