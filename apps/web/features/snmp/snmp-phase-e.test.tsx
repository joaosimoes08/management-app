import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import { SnmpFleetSummaryView } from './snmp-fleet';
import { formatDriftValue, SnmpDriftsView } from './snmp-drifts';
import { snmpConfigError, snmpCredentialError } from './snmp-bounds';
import SnmpPage from './snmp-page';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const roles = { current: ['READ_ONLY'] as string[] };
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.current.includes(role) }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children, moduleTabs, actions }: { children: ReactNode; moduleTabs?: ReactNode; actions?: ReactNode }) => <>{moduleTabs}{actions}{children}</> }));
const mockedFetch = vi.mocked(apiFetch);

const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const fleet = {
  siteId: 'site-1', generatedAt: '2026-11-21T10:00:00.000Z',
  devices: { total: 12, configured: 9, enabled: 8, disabled: 1, notConfigured: 3 },
  polling: { byStatus: { PENDING: 0, RUNNING: 1, COMPLETED: 5, FAILED: 2, BLOCKED: 1, NEVER_POLLED: 1 }, stale: 2, lastPollAt: '2026-11-21T09:55:00.000Z', oldestPollAt: null },
  drift: { pending: 4, devicesWithPending: 2 },
  attention: [
    { deviceId: 'd-1', name: 'core-sw-01', siteId: 'site-1', reason: 'FAILED', lastStatus: 'FAILED', lastPollAt: '2026-11-21T09:00:00.000Z', lastErrorCode: 'SNMP_TIMEOUT', pendingDrifts: 3 },
    { deviceId: 'd-2', name: 'edge-fw-02', siteId: 'site-1', reason: 'SOME_NEW_REASON', lastStatus: null, lastPollAt: null, lastErrorCode: null, pendingDrifts: 0, extra: true },
  ],
  attentionTotal: 14,
  futureField: { anything: 1 },
};

const drift = (id: string, status = 'PENDING', extra: Record<string, unknown> = {}) => ({ id, field: 'ifAlias', documentedValue: 'Uplink', observedValue: { text: 'uplink-2' }, status, reviewedAt: null, createdAt: '2026-11-20T08:00:00.000Z', device: { id: 'd-1', name: 'core-sw-01', type: 'SWITCH', siteId: 'site-1' }, interface: { id: 'if-1', name: 'Gi1/0/1' }, ...extra });
const driftPage = (items: unknown[], extra: Record<string, unknown> = {}) => ({ items, page: 1, pageSize: 100, total: items.length, totalPages: 1, ...extra });

beforeEach(() => {
  mockedFetch.mockReset();
  roles.current = ['READ_ONLY'];
  window.history.replaceState(null, '', '/snmp');
});
afterEach(cleanup);

describe('SNMP fleet summary', () => {
  it('shows the fleet totals and the attention list, tolerating unknown reasons and extra fields', async () => {
    mockedFetch.mockResolvedValue(fleet);
    const openDevice = vi.fn();
    wrap(<SnmpFleetSummaryView siteId="site-1" openDevice={openDevice} openDrifts={vi.fn()} />);

    const stats = await screen.findByRole('group', { name: 'Resumo da frota SNMP' });
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/snmp/fleet/summary?siteId=site-1');
    expect(stats).toHaveTextContent('9 / 12');
    expect(stats).toHaveTextContent('Divergências pendentes em 2 equipamentos');
    expect(screen.getByText('A mostrar 2 de 14 equipamentos.')).toBeInTheDocument();

    const table = screen.getByRole('region', { name: 'Equipamentos que precisam de atenção' });
    expect(within(table).getByText('Polling falhou')).toBeInTheDocument();
    expect(within(table).getByText('SOME_NEW_REASON')).toBeInTheDocument();
    expect(within(table).getByText('SNMP_TIMEOUT')).toBeInTheDocument();
    fireEvent.click(within(table).getByRole('button', { name: 'Abrir core-sw-01' }));
    expect(openDevice).toHaveBeenCalledWith('d-1');
  });

  it('explains SITE_NOT_FOUND and shows the API message for other errors', async () => {
    mockedFetch.mockRejectedValueOnce(new ApiRequestError('Site não encontrado.', 404, { code: 'SITE_NOT_FOUND', message: 'Site não encontrado.' }));
    wrap(<SnmpFleetSummaryView siteId="site-x" openDevice={vi.fn()} openDrifts={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('não tens acesso');
    cleanup();

    mockedFetch.mockRejectedValueOnce(new ApiRequestError('Something new', 500, { code: 'FUTURE_CODE', message: 'Something new' }));
    wrap(<SnmpFleetSummaryView siteId="site-1" openDevice={vi.fn()} openDrifts={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Something new');
  });
});

describe('SNMP drifts', () => {
  it('lists pending drifts and bulk-accepts the selection with a per-item result list', async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path === '/api/v1/snmp/drifts/bulk-review') return { status: 'ACCEPTED', total: 2, succeeded: 1, failed: 1, items: [{ id: 'dr-1', ok: true, status: 'ACCEPTED' }, { id: 'dr-2', ok: false, error: { statusCode: 409, code: 'SNMP_DRIFT_ALREADY_REVIEWED', message: 'Divergência já revista.' } }] };
      return driftPage([drift('dr-1'), drift('dr-2', 'PENDING', { field: 'sysName', documentedValue: null }), drift('dr-3', 'ACCEPTED')]);
    });
    wrap(<SnmpDriftsView siteId="site-1" canReview openDevice={vi.fn()} />);

    const table = await screen.findByRole('region', { name: 'Divergências SNMP' });
    await within(table).findByText('sysName');
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/snmp/drifts?siteId=site-1&status=PENDING&page=1&pageSize=100');
    expect(within(table).getByText('— → {"text":"uplink-2"}')).toBeInTheDocument();
    // Reviewed rows cannot be selected.
    expect(within(table).getByRole('checkbox', { name: /já revista/ })).toBeDisabled();

    fireEvent.click(within(table).getByRole('checkbox', { name: 'Selecionar todas as divergências pendentes' }));
    fireEvent.click(screen.getByRole('button', { name: /Aceitar selecionadas/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Aceitar 2' }));

    expect(await screen.findByRole('status')).toHaveTextContent('1 de 2 aplicados.');
    expect(screen.getByText('Divergência já revista.')).toBeInTheDocument();
    const call = mockedFetch.mock.calls.find(([path]) => path === '/api/v1/snmp/drifts/bulk-review')!;
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ ids: ['dr-1', 'dr-2'], status: 'ACCEPTED' });
  });

  it('is read-only for readers and filters by status', async () => {
    mockedFetch.mockResolvedValue(driftPage([drift('dr-1')]));
    wrap(<SnmpDriftsView siteId="site-1" canReview={false} openDevice={vi.fn()} />);
    await screen.findByText('ifAlias');
    expect(screen.queryByRole('toolbar', { name: 'Revisão em massa' })).not.toBeInTheDocument();
    expect(screen.queryByRole('checkbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Aceitar/ })).not.toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Filtrar divergências por estado'), { target: { value: 'ALL' } });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/snmp/drifts?siteId=site-1&status=PENDING%2CACCEPTED%2CIGNORED&page=1&pageSize=100'));
  });

  it('shows the API message when the drift list fails (SNMP_DRIFT_STATUS_INVALID)', async () => {
    mockedFetch.mockRejectedValue(new ApiRequestError('Estado inválido.', 400, { code: 'SNMP_DRIFT_STATUS_INVALID', message: 'Estado inválido.' }));
    wrap(<SnmpDriftsView siteId="site-1" canReview openDevice={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('Estado inválido.');
  });

  it('formats JSON drift values', () => {
    expect(formatDriftValue(null)).toBe('—');
    expect(formatDriftValue('up')).toBe('up');
    expect(formatDriftValue(1000)).toBe('1000');
    expect(formatDriftValue({ a: 1 })).toBe('{"a":1}');
  });
});

describe('SNMP input bounds', () => {
  const valid = { port: 161, intervalMinutes: 15, timeoutMs: 5000, retries: 2 };
  it('validates polling config bounds', () => {
    expect(snmpConfigError(valid)).toBe('');
    expect(snmpConfigError({ ...valid, port: 0 })).toMatch(/Porta.*1 e 65535/);
    expect(snmpConfigError({ ...valid, intervalMinutes: 1441 })).toMatch(/5 e 1440/);
    expect(snmpConfigError({ ...valid, timeoutMs: 499 })).toMatch(/500 e 30000/);
    expect(snmpConfigError({ ...valid, retries: 6 })).toMatch(/0 e 5/);
    expect(snmpConfigError({ ...valid, port: 161.5 })).toMatch(/Porta/);
  });
  it('validates credential lengths', () => {
    expect(snmpCredentialError({ version: 'V2C', community: 'short' })).toMatch(/8 e 255/);
    expect(snmpCredentialError({ version: 'V2C', community: 'longenough' })).toBe('');
    expect(snmpCredentialError({ version: 'V3', username: '', authKey: '12345678', privKey: '12345678' })).toMatch(/username/);
    expect(snmpCredentialError({ version: 'V3', username: 'u'.repeat(65), authKey: '12345678', privKey: '12345678' })).toMatch(/64/);
    expect(snmpCredentialError({ version: 'V3', username: 'ops', authKey: '1234', privKey: '12345678' })).toMatch(/auth key/);
    expect(snmpCredentialError({ version: 'V3', username: 'ops', authKey: '12345678', privKey: '12345678' })).toBe('');
  });
});

describe('SNMP page', () => {
  const route = async (path: string) => {
    if (path.startsWith('/api/v1/snmp/fleet/summary')) return fleet;
    if (path.startsWith('/api/v1/snmp/drifts')) return driftPage([drift('dr-1')]);
    if (path.startsWith('/api/v1/devices')) return { items: [], total: 0 };
    return {};
  };

  it('opens on the fleet summary for readers and keeps drift review read-only', async () => {
    mockedFetch.mockImplementation(route);
    wrap(<SnmpPage />);
    expect(await screen.findByRole('group', { name: 'Resumo da frota SNMP' })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: /Frota/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.queryByRole('button', { name: /Sincronizar/ })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Rever divergências/ }));
    expect(await screen.findByRole('region', { name: 'Divergências SNMP' })).toBeInTheDocument();
    expect(screen.queryByRole('toolbar', { name: 'Revisão em massa' })).not.toBeInTheDocument();
  });

  it('offers bulk review to network operators', async () => {
    roles.current = ['NETWORK_OPERATOR'];
    mockedFetch.mockImplementation(route);
    window.history.replaceState(null, '', '/snmp?view=drifts');
    wrap(<SnmpPage />);
    expect(await screen.findByRole('toolbar', { name: 'Revisão em massa' })).toBeInTheDocument();
  });

  it('blocks roles without SNMP read access', () => {
    roles.current = ['SYSTEMS_OPERATOR'];
    wrap(<SnmpPage />);
    expect(screen.getByText('Sem acesso ao SNMP')).toBeInTheDocument();
    expect(mockedFetch).not.toHaveBeenCalledWith(expect.stringContaining('/api/v1/snmp/'));
  });
});
