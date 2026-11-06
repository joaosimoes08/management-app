import { getPublicRuntimeConfig } from './runtime-config';

export type BookStackContextType = 'asset' | 'service';

/** BookStack search uses the app's persistent entity ID as its lookup key. */
export function buildBookStackSearchUrl(baseUrl: string, type: BookStackContextType, id: string): string | null {
  if (!baseUrl.trim() || !id.trim()) return null;
  try {
    const base = new URL(baseUrl);
    if (!['http:', 'https:'].includes(base.protocol) || base.username || base.password) return null;
    base.pathname = `${base.pathname.replace(/\/$/, '')}/search`;
    base.search = '';
    base.hash = '';
    base.searchParams.set('term', `management-app:${type}:${id}`);
    return base.toString();
  } catch {
    return null;
  }
}

export function getBookStackLink(type: BookStackContextType, id: string): string | null {
  return buildBookStackSearchUrl(getPublicRuntimeConfig().bookstackUrl, type, id);
}
