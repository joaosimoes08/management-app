import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { addFavoriteApplicationLink, checkAllApplicationLinks, listFavoriteApplicationLinks, nextCheckAllCursor, removeFavoriteApplicationLink } from './api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

describe('Portal API contract (#85)', () => {
  beforeEach(() => vi.clearAllMocks());

  it('reads, adds and removes favourites', () => {
    listFavoriteApplicationLinks();
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/favorites');
    addFavoriteApplicationLink('link 1');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/link%201/favorite', { method: 'PUT', body: '{}' });
    addFavoriteApplicationLink('link-1', 3);
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/link-1/favorite', { method: 'PUT', body: '{"sortOrder":3}' });
    removeFavoriteApplicationLink('link-1');
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/link-1/favorite', { method: 'DELETE' });
  });

  it('posts check-all with scope and cursor', () => {
    checkAllApplicationLinks(false);
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/check-all', { method: 'POST' });
    checkAllApplicationLinks(true, { offset: 100 });
    expect(apiFetch).toHaveBeenLastCalledWith('/api/v1/application-links/check-all?all=true&offset=100', { method: 'POST' });
  });

  it('derives the next batch from nextOffset, page fields or nothing', () => {
    expect(nextCheckAllCursor({ items: [], nextOffset: 100 }, {})).toEqual({ offset: 100 });
    expect(nextCheckAllCursor({ items: [], nextOffset: null }, { offset: 100 })).toBeNull();
    expect(nextCheckAllCursor({ items: [], nextOffset: 100 }, { offset: 100 })).toBeNull();
    expect(nextCheckAllCursor({ items: [], page: 1, totalPages: 3 }, {})).toEqual({ page: 2 });
    expect(nextCheckAllCursor({ items: [], page: 3, totalPages: 3 }, { page: 3 })).toBeNull();
    expect(nextCheckAllCursor({ items: [{ id: 'a', name: 'A', available: true }], hasMore: true }, {})).toEqual({ page: 2 });
    expect(nextCheckAllCursor({ items: [], hasMore: true }, {})).toBeNull();
    // The unpaged response (no cursor fields at all) is a single batch.
    expect(nextCheckAllCursor({ items: [{ id: 'a', name: 'A', available: true }], checked: 1 }, {})).toBeNull();
  });
});
