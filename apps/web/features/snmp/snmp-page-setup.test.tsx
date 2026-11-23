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
    // An admin opted out with SNMP_ALLOW_V2C=false: only v3 is offered, and the form says why.
    const version = screen.getByRole('group', { name: 'Versão' });
    expect(within(version).getByRole('radio', { name: /SNMPv3 \(authPriv\)/ })).toBeChecked();
    expect(within(version).queryByRole('radio', { name: /SNMPv2c/ })).not.toBeInTheDocument();
    expect(await within(version).findByText(/SNMP_ALLOW_V2C=false/)).toBeInTheDocument();

    // P0-3: the stored status is in words, never the raw enum.
    expect(screen.getByText(/netops · ainda não testada/)).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Testar' }));
    expect(await screen.findByText('Sem resposta (timeout)')).toBeInTheDocument();
    expect(screen.getByText(/5004 ms/)).toBeInTheDocument();
    expect(screen.queryByText('Operação submetida com sucesso.')).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Configurar SNMP/ }));
    expect(await screen.findByRole('dialog', { name: 'Configurar SNMP' })).toBeInTheDocument();
  });

  it('offers v2c next to the recommended v3 by default, with the trade-off note and the 8-character community check', async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
      if (url === '/api/v1/settings/snmp-listeners') return { ...receiver, v2cAllowed: true };
      if (url === '/api/v1/snmp/devices/d1') return overview();
      if (url.startsWith('/api/v1/snmp/devices/d1/metrics')) return { days: 7, expectedIntervalMinutes: null, selectedInterfaceIndex: null, interfaces: [], availability: [], interfacesHistory: [] };
      return {};
    });
    wrap(<SnmpPage />);
    const version = await screen.findByRole('group', { name: 'Versão' });
    const radios = within(version).getAllByRole('radio');
    expect(radios.map((radio) => radio.getAttribute('value'))).toEqual(['V3', 'V2C']);
    expect(radios[0]).toBeChecked();
    expect(within(version).getByText('Recomendado')).toBeInTheDocument();
    expect(screen.queryByText(/laborat/i)).not.toBeInTheDocument();
    fireEvent.click(within(version).getByRole('radio', { name: 'SNMPv2c' }));
    expect(within(version).getByRole('note')).toHaveTextContent('SNMPv2c envia a community em texto simples e não cifra os dados.');
    const community = screen.getByLabelText(/^Community/);
    fireEvent.change(community, { target: { value: 'short' } });
    expect(community).toHaveAttribute('aria-invalid', 'true');
    expect(screen.getByText('A community deve ter pelo menos 8 caracteres.')).toBeInTheDocument();
    fireEvent.change(community, { target: { value: 'longenough' } });
    expect(screen.queryByText('A community deve ter pelo menos 8 caracteres.')).not.toBeInTheDocument();
  });

  it('shows unknown-trap sources to admins; other roles get the tab with an explanation and no data request', async () => {
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
    fireEvent.click(screen.getByRole('button', { name: /Traps desconhecidas/ }));
    expect(await screen.findByText('Só administradores veem as traps de equipamentos desconhecidos.')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/settings/snmp-listeners');
    expect(mockedFetch).not.toHaveBeenCalledWith('/api/v1/snmp/traps/unmatched/sources');
  });

  it('offers the SNMP views as an in-page select for narrow screens, keeping the active view selected (N-A)', async () => {
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
      if (url === '/api/v1/snmp/traps/unmatched/sources') return { items: [] };
      if (url.startsWith('/api/v1/snmp/fleet')) return { devices: { total: 0, configured: 0, enabled: 0, disabled: 0, notConfigured: 0 }, polling: { byStatus: {}, stale: 0 }, drift: { pending: 0, devicesWithPending: 0 }, attention: [] };
      return {};
    });
    window.history.replaceState(null, '', '/snmp');
    wrap(<SnmpPage />);
    const select = screen.getByRole('combobox', { name: 'Vista SNMP' });
    expect(select.closest('.narrow-view-switch')).not.toBeNull();
    expect([...(select as HTMLSelectElement).options].map((option) => option.textContent)).toEqual(expect.arrayContaining(['Frota', 'Traps desconhecidas']));
    fireEvent.change(select, { target: { value: 'unknown' } });
    expect(await screen.findByText('Nenhuma trap de origem desconhecida.')).toBeInTheDocument();
    expect(screen.getByRole('combobox', { name: 'Vista SNMP' })).toHaveValue('unknown');
    expect(screen.getByRole('button', { name: /Traps desconhecidas/ })).toHaveAttribute('aria-pressed', 'true');
  });

  it('explains the unknown-traps view to non-admins instead of showing an empty page', async () => {
    roles.current = ['READ_ONLY'];
    window.history.replaceState(null, '', '/snmp?view=unknown');
    mockedFetch.mockImplementation(async (url: string) => url.startsWith('/api/v1/devices') ? { items: [device], total: 1, page: 1, totalPages: 1 } : {});
    wrap(<SnmpPage />);
    expect(await screen.findByText('Só administradores veem as traps de equipamentos desconhecidos.')).toBeInTheDocument();
    expect(screen.getByText(/Pede a um administrador/)).toBeInTheDocument();
  });

  it('shows trap kind and status in words in Traps recentes, never the raw VENDOR or PROCESSED codes', async () => {
    const traps = [
      { id: 't1', receivedAt: '2026-11-23T10:00:00.000Z', category: 'VENDOR', severity: 'INFO', trapOid: '1.3.6.1.4.1.9.9.999', label: null, summary: null, sourceAddress: '10.1.1.1', status: 'PROCESSED' },
      { id: 't2', receivedAt: '2026-11-23T10:01:00.000Z', category: 'LINK_DOWN', severity: 'WARNING', trapOid: '1.3.6.1.6.3.1.1.5.3', label: null, summary: null, sourceAddress: '10.1.1.1', status: 'PENDING' },
    ];
    mockedFetch.mockImplementation(async (url: string) => {
      if (url.startsWith('/api/v1/devices')) return { items: [device], total: 1, page: 1, totalPages: 1 };
      if (url === '/api/v1/settings/snmp-listeners') return receiver;
      if (url === '/api/v1/snmp/devices/d1') return overview({ traps });
      if (url.startsWith('/api/v1/snmp/devices/d1/metrics')) return { days: 7, expectedIntervalMinutes: null, selectedInterfaceIndex: null, interfaces: [], availability: [], interfacesHistory: [] };
      return {};
    });
    wrap(<SnmpPage />);
    expect(await screen.findByText('Trap de fabricante')).toBeInTheDocument();
    expect(screen.getByText('Processada')).toHaveAttribute('data-status', 'PROCESSED');
    expect(screen.getByText('Interface em baixo')).toBeInTheDocument();
    expect(screen.getByText('Pendente')).toBeInTheDocument();
    expect(screen.queryByText('VENDOR')).not.toBeInTheDocument();
    expect(screen.queryByText('PROCESSED')).not.toBeInTheDocument();
  });
});
