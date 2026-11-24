import { cleanup, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { useSnmpHealthMap } from './health-api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
let roles: string[] = [];
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.includes(role) }) }));
const mockedFetch = vi.mocked(apiFetch);
afterEach(() => { cleanup(); mockedFetch.mockReset(); });

function Probe({ onMap }: { onMap: (map: ReturnType<typeof useSnmpHealthMap>) => void }) {
  onMap(useSnmpHealthMap('site-1'));
  return null;
}
const renderProbe = () => {
  const seen: Array<ReturnType<typeof useSnmpHealthMap>> = [];
  render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Probe onMap={(map) => seen.push(map)} /></QueryClientProvider>);
  return seen;
};

describe('useSnmpHealthMap and roles (Guita review on #172)', () => {
  it('gives no map and sends no request to users without the SNMP read role, so no "Sem dados" badge is drawn', async () => {
    roles = ['SYSTEMS_OPERATOR'];
    const seen = renderProbe();
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(seen.every((map) => map === undefined)).toBe(true);
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('gives SNMP readers the Site map', async () => {
    roles = ['READ_ONLY'];
    mockedFetch.mockResolvedValue({ siteId: 'site-1', items: [{ deviceId: 'sw', status: 'OK', issueCount: 0, observedAt: null, rebootDetectedAt: null, stale: false }] });
    const seen = renderProbe();
    await waitFor(() => expect(seen.at(-1)?.get('sw')?.status).toBe('OK'));
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/snmp/health?siteId=site-1');
  });
});
