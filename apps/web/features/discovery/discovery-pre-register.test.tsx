import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import DiscoveryPage, { EnrollmentModal } from './discovery-page';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const receiver = (v2cAllowed: boolean) => ({ listenAll: true, selectedInterfaceIds: [], interfaces: [{ id: 'eth0', instanceId: 'h', name: 'eth0', address: '10.0.0.5', internal: false, lastSeenAt: '2026-11-23T10:00:00.000Z' }], engineId: null, engineIdSource: null, trapPort: 162, v2cAllowed, refreshSeconds: 30 });
const form = { sourceAddress: '10.9.9.9', siteId: 'site-1', version: 'V3' as const, username: 'netops', community: '', authKey: '', privKey: '', authProtocol: 'SHA256', privProtocol: 'AES128', compatibilitySha1: false };

beforeEach(() => { mockedFetch.mockReset(); window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('SNMP pre-registration dialog (SNMP Phase 1 step 3)', () => {
  it('embeds the switch setup lines for the expected IP and hides v2c while the lab flag is off', async () => {
    mockedFetch.mockResolvedValue(receiver(false));
    wrap(<EnrollmentModal form={form} setForm={() => undefined} close={() => undefined} submit={async () => undefined} admin />);
    const dialog = screen.getByRole('dialog');
    expect(within(dialog).getByText('Configuração do switch (linhas IOS-XE)')).toBeInTheDocument();
    expect(await within(dialog).findByText(/snmp-server host 10\.0\.0\.5 version 3 priv netops/)).toBeInTheDocument();
    expect(within(dialog).getByText(/O trap-source tem de ser o IP de gestão \(10\.9\.9\.9\)/)).toBeInTheDocument();
    expect(within(dialog).queryByRole('option', { name: /SNMPv2c/ })).not.toBeInTheDocument();
  });

  it('offers v2c only when the receiver allows it', async () => {
    mockedFetch.mockResolvedValue(receiver(true));
    wrap(<EnrollmentModal form={form} setForm={() => undefined} close={() => undefined} submit={async () => undefined} admin />);
    expect(await screen.findByRole('option', { name: 'SNMPv2c (só laboratório)' })).toBeInTheDocument();
  });

  it('opens prefilled from the unknown-traps link (?preRegister=)', async () => {
    mockedFetch.mockImplementation(async (url: string) => url === '/api/v1/settings/snmp-listeners' ? receiver(false) : url.startsWith('/api/v1/snmp/discovery/enrollments') || url.includes('/results') ? [] : url === '/api/v1/settings/discovery' ? { methods: ['ICMP'], tcpPorts: [], reverseDns: false, intervalHours: 24, allowedCidrs: [] } : { items: [], total: 0, page: 1, totalPages: 1 });
    window.history.replaceState(null, '', '/descoberta?tab=snmp&preRegister=10.9.9.9');
    wrap(<DiscoveryPage />);
    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByText('Pré-registar equipamento SNMP')).toBeInTheDocument();
    expect(within(dialog).getByDisplayValue('10.9.9.9')).toBeInTheDocument();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
  });
});
