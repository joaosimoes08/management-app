import { afterEach, describe, expect, it, vi } from 'vitest';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { apiFetch, setApiTokenProvider } from './client';

describe('API client runtime configuration', () => {
  afterEach(() => {
    delete window.__COCIBER_CONFIG__;
    setApiTokenProvider(null);
    vi.restoreAllMocks();
  });

  it('uses a runtime API URL assigned after the client module was imported', async () => {
    expect(getPublicRuntimeConfig().apiUrl).toBe('http://localhost:3001');

    window.__COCIBER_CONFIG__ = { apiUrl: 'https://api.example.com' };
    setApiTokenProvider(async () => 'test-token');
    const fetchMock = vi.fn().mockResolvedValue(new Response('{"ok":true}', { status: 200 }));
    vi.stubGlobal('fetch', fetchMock);

    await expect(apiFetch('/api/v1/setup/status')).resolves.toEqual({ ok: true });

    expect(fetchMock).toHaveBeenCalledWith('https://api.example.com/api/v1/setup/status', expect.objectContaining({
      headers: expect.objectContaining({ Authorization: 'Bearer test-token' }),
    }));
  });
});
