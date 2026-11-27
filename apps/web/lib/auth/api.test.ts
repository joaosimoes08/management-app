import { afterEach, describe, expect, it, vi } from 'vitest';
import { setApiTokenProvider, setApiUnauthorizedHandler } from '@/lib/api/client';
import { fetchCurrentUser, parseApiUser } from './api';

const user = { id: 'u1', externalId: 'kc-1', username: 'joao', roles: ['ADMIN'] };

describe('parseApiUser', () => {
  it('accepts an ApiUser and keeps only its fields', () => {
    expect(parseApiUser({ ...user, extra: true })).toEqual(user);
  });
  it.each([null, 'joao', { ...user, roles: 'ADMIN' }, { ...user, roles: [1] }, { ...user, id: 1 }, { username: 'joao', roles: [] }])('rejects %j', (body) => {
    expect(() => parseApiUser(body)).toThrow();
  });
});

describe('fetchCurrentUser', () => {
  afterEach(() => { setApiTokenProvider(null); setApiUnauthorizedHandler(null); vi.unstubAllGlobals(); });

  it('loads /auth/me through the API client with the provider token', async () => {
    setApiTokenProvider(async () => 'me-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response(JSON.stringify(user), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await expect(fetchCurrentUser()).resolves.toEqual(user);
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/v1/auth/me', expect.objectContaining({ cache: 'no-store', headers: expect.objectContaining({ Authorization: 'Bearer me-token' }) }));
    expect(fetchMock.mock.calls[0][1]).not.toHaveProperty('redirectOnUnauthorized');
  });

  it('rejects a 401 without restarting the login', async () => {
    setApiTokenProvider(async () => 'me-token');
    const handler = vi.fn(); setApiUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(fetchCurrentUser()).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
  });

  it('rejects a body that is not an ApiUser', async () => {
    setApiTokenProvider(async () => 'me-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response(JSON.stringify({ username: 'joao' }), { status: 200 })));
    await expect(fetchCurrentUser()).rejects.toThrow('Identidade inválida');
  });
});
