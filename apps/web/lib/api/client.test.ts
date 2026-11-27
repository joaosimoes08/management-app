import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { apiBlob, apiEventStream, apiFetch, setApiTokenProvider, setApiUnauthorizedHandler } from './client';
import { ApiRequestError } from './errors';

describe('API client runtime configuration', () => {
  afterEach(() => {
    delete window.__CIVERNODE_CONFIG__;
    setApiTokenProvider(null);
    vi.restoreAllMocks();
  });

  it('uses a runtime API URL assigned after the client module was imported', async () => {
    expect(getPublicRuntimeConfig().apiUrl).toBe('http://localhost:3001');

    window.__CIVERNODE_CONFIG__ = { apiUrl: 'https://api.example.com' };
    setApiTokenProvider(async () => 'test-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/v1/setup/status')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/v1/setup/status', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
  });
});

describe('apiBlob', () => {
  afterEach(() => { setApiTokenProvider(null); vi.unstubAllGlobals(); vi.restoreAllMocks(); });

  it('sends the provider token and resolves with the body as a Blob', async () => {
    setApiTokenProvider(async () => 'blob-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('png', { status: 200, headers: { 'Content-Type': 'image/png' } }));
    vi.stubGlobal('fetch', fetchMock);
    const blob = await apiBlob('/api/v1/assets/a1/file');
    expect(blob).toBeInstanceOf(Blob);
    expect(await blob.text()).toBe('png');
    expect(fetchMock).toHaveBeenCalledWith('http://localhost:3001/api/v1/assets/a1/file', expect.objectContaining({ headers: expect.objectContaining({ Authorization: 'Bearer blob-token' }) }));
  });

  it('rejects with an ApiRequestError carrying the HTTP status', async () => {
    setApiTokenProvider(async () => 'blob-token');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('nope', { status: 403 })));
    const error = await apiBlob('/api/v1/assets/a1/file').catch((reason: unknown) => reason);
    expect(error).toBeInstanceOf(ApiRequestError);
    expect((error as ApiRequestError).status).toBe(403);
  });

  it('refuses to run before a token provider is registered', async () => {
    const fetchMock = vi.fn(); vi.stubGlobal('fetch', fetchMock);
    await expect(apiBlob('/api/v1/assets/a1/file')).rejects.toThrow();
    expect(fetchMock).not.toHaveBeenCalled();
  });
});

describe('apiEventStream', () => {
  afterEach(() => { setApiTokenProvider(null); vi.unstubAllGlobals(); });

  it('asks the provider for a token on every connect', async () => {
    let current = 'A';
    setApiTokenProvider(async () => current);
    const fetchMock = vi.fn().mockImplementation(async () => new Response(new ReadableStream(), { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);
    await apiEventStream('/api/v1/operations/events');
    current = 'B';
    await apiEventStream('/api/v1/operations/events');
    expect(fetchMock.mock.calls.map((call) => (call[1] as RequestInit & { headers: Record<string, string> }).headers.Authorization)).toEqual(['Bearer A', 'Bearer B']);
    expect(fetchMock.mock.calls[0][1]).toMatchObject({ cache: 'no-store', headers: { Accept: 'text/event-stream' } });
  });

  it('rejects with the status when the stream cannot be opened', async () => {
    setApiTokenProvider(async () => 'A');
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('', { status: 503 })));
    await expect(apiEventStream('/api/v1/operations/events')).rejects.toMatchObject({ status: 503 });
  });
});

describe('apiFetch redirectOnUnauthorized', () => {
  afterEach(() => { setApiTokenProvider(null); setApiUnauthorizedHandler(null); vi.unstubAllGlobals(); });

  it('rejects a 401 with status 401 without calling the unauthorized handler when asked', async () => {
    setApiTokenProvider(async () => 'A');
    const handler = vi.fn(); setApiUnauthorizedHandler(handler);
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(new Response('{}', { status: 401 })));
    await expect(apiFetch('/api/v1/auth/me', { redirectOnUnauthorized: false })).rejects.toMatchObject({ status: 401 });
    expect(handler).not.toHaveBeenCalled();
    await expect(apiFetch('/api/v1/auth/me')).rejects.toThrow();
    expect(handler).toHaveBeenCalledTimes(1);
  });
});
