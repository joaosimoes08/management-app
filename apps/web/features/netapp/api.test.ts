import { beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { configureNetAppIntegration, getNetAppIntegration, refreshNetAppSnapshot } from './api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

describe('NetApp site API contract', () => {
  beforeEach(() => vi.clearAllMocks());
  it('reads the snapshot for the selected site', () => {
    getNetAppIntegration('site / west');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/netapp/sites/site%20%2F%20west');
  });

  it('writes configuration with PUT to the selected site integration', () => {
    const body = { endpointUrl: 'https://ontap.example.local', username: 'readonly', password: 'test-only' };
    configureNetAppIntegration('site-a', body);
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/netapp/sites/site-a/integration', { method: 'PUT', body: JSON.stringify(body) });
  });

  it('requests a manual snapshot refresh with POST for the selected site', () => {
    refreshNetAppSnapshot('site-a');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/netapp/sites/site-a/refresh', { method: 'POST' });
  });
});
