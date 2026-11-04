import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import NetAppPage from './netapp-page';
import { configureNetAppIntegration, getNetAppIntegration, refreshNetAppSnapshot } from './api';

vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-a', activeSite: { id: 'site-a', name: 'Lisboa', code: 'LIS' }, loading: false }) }));
vi.mock('./api', () => ({ getNetAppIntegration: vi.fn(), configureNetAppIntegration: vi.fn(), refreshNetAppSnapshot: vi.fn() }));

const knownIntegration = {
  id: 'integration-1', siteId: 'site-a', endpointUrl: 'https://ontap.example.local', username: 'readonly', configured: true as const,
  snapshot: {
    systems: [{ name: 'cluster-lis', version: '9.14.1', serialNumber: 'serial-a' }], nodes: [{ name: 'node-a', health: 'healthy' }],
    aggregates: [{ name: 'aggr0', state: 'online', sizeBytes: 1_000_000, usedBytes: 300_000 }],
    volumes: [{ name: 'vol-apps', svm: 'svm-apps', state: 'online', sizeBytes: 500_000, usedBytes: 125_000 }],
    capacity: { sizeBytes: 1_000_000, usedBytes: 300_000, availableBytes: 700_000, usedPercent: 30 }, health: 'healthy' as const, observedAt: '2026-11-01T12:00:00.000Z',
  }, lastAttemptAt: '2026-11-01T12:01:00.000Z', lastSuccessAt: '2026-11-01T12:00:00.000Z', lastErrorCode: null, updatedAt: '2026-11-01T12:00:00.000Z',
};

function renderPage() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return render(<QueryClientProvider client={queryClient}><NetAppPage /></QueryClientProvider>);
}

describe('NetApp site workspace', () => {
  beforeEach(() => { cleanup(); vi.clearAllMocks(); });

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
    expect(await screen.findByText('vol-apps')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Atualizar snapshot' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('A consulta ao ONTAP falhou. Os últimos dados conhecidos foram mantidos.');
    expect(await screen.findByText('cluster-lis')).toBeInTheDocument();
    expect(screen.getByText('vol-apps')).toBeInTheDocument();
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
