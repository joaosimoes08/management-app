import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetAppPage from './netapp-page';
import { configureNetAppIntegration, getNetAppIntegration, getNetAppTrend, listNetAppTrendObjects, refreshNetAppSnapshot, type NetAppTrend } from './api';
import { ApiRequestError } from '@/lib/api/errors';

vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <div>{actions}{children}</div> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-a', activeSite: { id: 'site-a', name: 'Lisboa', code: 'LIS' }, loading: false }) }));
vi.mock('./api', () => ({ getNetAppIntegration: vi.fn(), configureNetAppIntegration: vi.fn(), refreshNetAppSnapshot: vi.fn(), getNetAppTrend: vi.fn(), listNetAppTrendObjects: vi.fn() }));

const knownIntegration = {
  id: 'integration-1', siteId: 'site-a', endpointUrl: 'https://ontap.example.local', username: 'readonly', configured: true as const,
  snapshot: {
    systems: [{ name: 'cluster-lis', version: '9.14.1', serialNumber: 'serial-a' }], nodes: [{ name: 'node-a', health: 'healthy' }],
    aggregates: [{ name: 'aggr0', state: 'online', sizeBytes: 1_000_000, usedBytes: 300_000 }],
    volumes: [{ name: 'vol-apps', svm: 'svm-apps', state: 'online', sizeBytes: 500_000, usedBytes: 125_000 }],
    capacity: { sizeBytes: 1_000_000, usedBytes: 300_000, availableBytes: 700_000, usedPercent: 30 }, health: 'healthy' as const, observedAt: '2026-11-01T12:00:00.000Z',
  }, lastAttemptAt: '2026-11-01T12:01:00.000Z', lastSuccessAt: '2026-11-01T12:00:00.000Z', lastErrorCode: null, updatedAt: '2026-11-01T12:00:00.000Z',
};

const clusterTrend: NetAppTrend = {
  siteId: 'site-a', kind: 'CLUSTER', key: null, name: 'cluster-lis', days: 90, retentionDays: 400,
  points: [
    { date: '2026-10-01', observedAt: '2026-10-01T12:00:00.000Z', sizeBytes: 1_000_000, usedBytes: 200_000, usedPercent: 20, state: 'online' },
    { date: '2026-11-01', observedAt: '2026-11-01T12:00:00.000Z', sizeBytes: 1_000_000, usedBytes: 300_000, usedPercent: 30, state: 'online' },
  ],
  summary: { days: 31, firstUsedBytes: 200_000, lastUsedBytes: 300_000, changeBytes: 100_000, growthBytesPerDay: 3_225, latestUsedPercent: 30, projectedFullAt: '2027-04-15T00:00:00.000Z' },
};

const fullSnapshot = {
  ...knownIntegration,
  snapshot: {
    ...knownIntegration.snapshot,
    aggregates: [{ name: 'aggr0', uuid: 'ag-0', state: 'online', sizeBytes: 1_000, usedBytes: 500 }, { name: 'aggr1', uuid: 'ag-1', state: 'online', sizeBytes: 1_000, usedBytes: 950 }],
    volumes: Array.from({ length: 11 }, (_, index) => ({ name: `vol-${String(index).padStart(2, '0')}`, uuid: `v-${index}`, svm: 'svm-a', state: 'online', sizeBytes: 100, usedBytes: index * 8 })),
  },
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><NetAppPage /></QueryClientProvider>);
}

describe('NetApp site workspace', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(getNetAppTrend).mockResolvedValue(clusterTrend);
    vi.mocked(listNetAppTrendObjects).mockResolvedValue({ siteId: 'site-a', kind: 'VOLUME', days: 90, retentionDays: 400, items: [], truncated: false });
  });

  it('shows an explicit missing-configuration state for the selected Site', async () => {
    vi.mocked(getNetAppIntegration).mockRejectedValue(new Error('NETAPP_INTEGRATION_NOT_CONFIGURED'));
    renderPage();
    expect(await screen.findByText('Este Site ainda não tem integração NetApp')).toBeInTheDocument();
    expect(getNetAppIntegration).toHaveBeenCalledWith('site-a');
    expect(screen.getByRole('heading', { name: 'Configurar integração' })).toBeInTheDocument();
  });

  it('retains and displays the last-known snapshot after a failed manual refresh', async () => {
    vi.mocked(getNetAppIntegration).mockResolvedValue({ ...knownIntegration, lastErrorCode: null });
    vi.mocked(refreshNetAppSnapshot).mockRejectedValue(new Error('A consulta ao ONTAP falhou. Os últimos dados conhecidos foram mantidos.'));
    renderPage();
    expect((await screen.findAllByText('vol-apps')).length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar snapshot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A consulta ao ONTAP falhou. Os últimos dados conhecidos foram mantidos.');
    expect(await screen.findByText('cluster-lis')).toBeInTheDocument();
    expect(screen.getAllByText('vol-apps').length).toBeGreaterThan(0);
    await waitFor(() => expect(getNetAppIntegration).toHaveBeenCalledTimes(2));
  });

  it('sends configuration only for the selected Site and clears the password after save', async () => {
    vi.mocked(getNetAppIntegration).mockRejectedValue(new Error('NETAPP_INTEGRATION_NOT_CONFIGURED'));
    vi.mocked(configureNetAppIntegration).mockResolvedValue(knownIntegration);
    renderPage();
    await screen.findByText('Este Site ainda não tem integração NetApp');
    fireEvent.change(screen.getByLabelText('Endpoint HTTPS (origem)'), { target: { value: 'https://ontap.example.local' } });
    fireEvent.change(screen.getByLabelText('Username ONTAP'), { target: { value: 'readonly' } });
    fireEvent.change(screen.getByLabelText('Palavra-passe'), { target: { value: 'secret-test-only' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar configuração' }));
    await waitFor(() => expect(configureNetAppIntegration).toHaveBeenCalledWith('site-a', { endpointUrl: 'https://ontap.example.local', username: 'readonly', password: 'secret-test-only' }));
    await waitFor(() => expect(screen.getByLabelText('Nova palavra-passe')).toHaveValue(''));
  });
});

describe('NetApp capacity: tables, top 10 and trend', () => {
  beforeEach(() => {
    cleanup();
    vi.clearAllMocks();
    vi.mocked(getNetAppIntegration).mockResolvedValue(fullSnapshot);
    vi.mocked(getNetAppTrend).mockResolvedValue(clusterTrend);
    vi.mocked(listNetAppTrendObjects).mockResolvedValue({
      siteId: 'site-a', kind: 'VOLUME', days: 90, retentionDays: 400, truncated: false,
      items: [{ key: 'v-3', name: 'vol-03', svm: 'svm-a', usedPercent: 24 }, { key: 'v-10', name: 'vol-10', svm: 'svm-a', usedPercent: 80 }],
    });
  });

  it('sorts the volumes table by % used (fullest first) and toggles the order from the header', async () => {
    renderPage();
    const table = await screen.findByRole('region', { name: 'Volumes' });
    const names = () => within(table).getAllByRole('row').slice(1).map((row) => row.querySelector('td strong')?.textContent);
    expect(names()[0]).toBe('vol-10');
    expect(within(table).getAllByRole('row')[1].querySelector('.bar-track i')).toHaveClass('orange');
    fireEvent.click(within(table).getByRole('button', { name: /^Volume/ }));
    expect(names().slice(0, 2)).toEqual(['vol-00', 'vol-01']);
    fireEvent.click(within(table).getByRole('button', { name: /% utilizado/ }));
    expect(names()[0]).toBe('vol-00');
    fireEvent.click(within(table).getByRole('button', { name: /% utilizado/ }));
    expect(names()[0]).toBe('vol-10');
  });

  it('lists the ten fullest objects with red / amber bars', async () => {
    renderPage();
    const top = await screen.findByTestId('netapp-top-fullest');
    const bars = top.querySelectorAll('.inventory-bar');
    expect(bars).toHaveLength(10);
    expect(bars[0]).toHaveTextContent('aggr1');
    expect(bars[0]).toHaveTextContent('95%');
    expect(bars[0].querySelector('.bar-track i')).toHaveClass('red');
    expect(bars[1]).toHaveTextContent('vol-10');
    expect(top).not.toHaveTextContent('vol-00');
  });

  it('draws the cluster trend and switches to a volume from a table row', async () => {
    renderPage();
    const chart = await screen.findByTestId('netapp-trend-chart');
    expect(chart.querySelector('polyline')?.getAttribute('points')).toBe('8,37.2 92,33.8');
    expect(getNetAppTrend).toHaveBeenCalledWith('site-a', { kind: 'CLUSTER', key: null, days: undefined });
    expect(screen.getByText(/ficará cheio por volta de/)).toBeInTheDocument();

    vi.mocked(getNetAppTrend).mockResolvedValue({ ...clusterTrend, kind: 'VOLUME', key: 'v-10', name: 'vol-10', points: [clusterTrend.points[1]], summary: { ...clusterTrend.summary, projectedFullAt: null, growthBytesPerDay: 0 } });
    fireEvent.click(screen.getByRole('button', { name: 'Ver tendência de vol-10' }));
    await waitFor(() => expect(getNetAppTrend).toHaveBeenCalledWith('site-a', { kind: 'VOLUME', key: 'v-10', days: undefined }));
    expect(await screen.findByText('Sem crescimento no período observado.')).toBeInTheDocument();
    expect(listNetAppTrendObjects).toHaveBeenCalledWith('site-a', { kind: 'VOLUME', days: undefined });
    expect((await screen.findByRole('option', { name: 'vol-10 (svm-a)' }) as HTMLOptionElement).selected).toBe(true);
  });

  it('shows the API message when the trend request is rejected', async () => {
    vi.mocked(getNetAppTrend).mockRejectedValue(new ApiRequestError('days must be between 1 and 30', 400, { code: 'NETAPP_TREND_INVALID', message: 'days must be between 1 and 30' }));
    renderPage();
    expect(await screen.findByText('days must be between 1 and 30')).toBeInTheDocument();
  });
});
