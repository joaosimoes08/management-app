import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import SnmpPage from './snmp-page';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const roles = { current: ['ADMIN'] as string[] };
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.current.includes(role) }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children, moduleTabs, actions }: { children: ReactNode; moduleTabs?: ReactNode; actions?: ReactNode }) => <>{moduleTabs}{actions}{children}</> }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const device = { id: 'd1', name: 'core-sw-01', type: 'SWITCH', managementIp: '10.1.1.1' };
const receiver = { listenAll: true, selectedInterfaceIds: [], interfaces: [{ id: 'eth0', instanceId: 'h', name: 'eth0', address: '10.0.0.5', internal: false, lastSeenAt: '2026-11-23T10:00:00.000Z' }], engineId: '800000090300AABBCCDDEEFF', engineIdSource: 'STORED', trapPort: 162, v2cAllowed: false, refreshSeconds: 30 };
const overview = (patch: Record<string, unknown> = {}) => ({ config: null, credentials: [{ id: 'c1', purpose: 'READ', version: 'V3', username: 'netops', authProtocol: 'SHA256', privProtocol: 'AES128', configured: true }], latestSnapshot: null, jobs: [], drifts: [], traps: [], lastTrapReceivedAt: null, setEnabled: false, ...patch });

beforeEach(() => { mockedFetch.mockReset(); roles.current = ['ADMIN']; window.history.replaceState(null, '', '/snmp?deviceId=d1'); });
afterEach(cleanup);

describe('SNMP device view: Phase 1 setup', () => {
  it('shows the switch setup panel, a Configurar SNMP button and the real credential test result inline', async () => {
    let jobs: unknown[] = [];
    mockedFetch.mockImplementation(async (url: string, init?: RequestInit) => {
      if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
      if (url === '/api/v1/settings/snmp-listeners') return receiver;
      if (url.endsWith('/credentials/READ/test') && init?.method === 'POST') { jobs = [{ id: 't1', type: 'CREDENTIAL_TEST', status: 'FAILED', errorCode: 'SNMP_TIMEOUT', createdAt: '2026-11-23T10:00:00.000Z', result: { reachable: false, durationMs: 5004 } }]; return { id: 't1', type: 'CREDENTIAL_TEST', status: 'PENDING', createdAt: '2026-11-23T10:00:00.000Z' }; }
      if (url === '/api/v1/snmp/devices/d1') return overview({ jobs });
      if (url.startsWith('/api/v1/snmp/devices/d1/metrics')) return { days: 7, expectedIntervalMinutes: null, selectedInterfaceIndex: null, interfaces: [], availability: [], interfacesHistory: [] };
      return {};
    });
    wrap(<SnmpPage />);
    expect(await screen.findByRole('heading', { name: 'Configurar o switch' })).toBeInTheDocument();
    expect(await screen.findByText('A aguardar a primeira trap deste equipamento.')).toBeInTheDocument();
    expect(await screen.findByText('800000090300AABBCCDDEEFF')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Configurar SNMP/ })).toBeInTheDocument();
    // The lab-only v2c option is hidden while SNMP_ALLOW_V2C is off.
    expect(within(screen.getByRole('combobox', { name: 'Versão' })).queryByRole('option', { name: 'V2C' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Testar' }));
    expect(await screen.findByText('Sem resposta (timeout)')).toBeInTheDocument();
    expect(screen.getByText(/5004 ms/)).toBeInTheDocument();
    expect(screen.queryByText('Operação submetida com sucesso.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Configurar SNMP/ }));
    expect(await screen.findByRole('dialog', { name: 'Configurar SNMP' })).toBeInTheDocument();
  });

  it('offers the unknown-traps view to admins only', async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
      if (url === '/api/v1/snmp/traps/unmatched/sources') return { items: [{ sourceAddress: '10.9.9.9', count: 3, firstSeenAt: null, lastSeenAt: null }] };
      if (url.startsWith('/api/v1/snmp/fleet')) return { devices: { total: 0, configured: 0, enabled: 0, disabled: 0, notConfigured: 0 }, polling: { byStatus: {}, stale: 0 }, drift: { pending: 0, devicesWithPending: 0 }, attention: [] };
      return {};
    });
    window.history.replaceState(null, '', '/snmp?view=unknown');
    wrap(<SnmpPage />);
    expect(screen.getByRole('button', { name: /Traps desconhecidas/ })).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByText('10.9.9.9')).toBeInTheDocument();
    cleanup();
    mockedFetch.mockClear();

    roles.current = ['READ_ONLY'];
    window.history.replaceState(null, '', '/snmp');
    wrap(<SnmpPage />);
    await waitFor(() => expect(screen.getByRole('button', { name: /Frota/ })).toBeInTheDocument());
    expect(screen.queryByRole('button', { name: /Traps desconhecidas/ })).not.toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/settings/snmp-listeners');
  });
});
