import { cleanup, fireEvent, render, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { CriticalAssetsPage } from './critical-assets-page';

vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

afterEach(cleanup);
const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CriticalAssetsPage /></QueryClientProvider>);
beforeEach(() => {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url.includes('/settings/access-groups')) return [{ id: 'group-1', name: 'Network Team' }] as never;
    return { timezone: 'Europe/Lisbon', mappings: [], unassigned: [{ id: 'device-1', name: 'Unassigned switch', type: 'SWITCH', attestations: [] }], assets: [{ id: 'device-2', name: 'Core switch', type: 'SWITCH', hostname: 'core-01', managementIp: '192.0.2.1', serialNumber: 'SN-1', assetTag: 'AT-1', status: 'ACTIVE', assignedGroup: { id: 'group-1', name: 'Network Team' }, attestations: [{ id: 'attest-1', weekStart: '2026-11-09T00:00:00.000Z' }] }] } as never;
  });
});

describe('CriticalAssetsPage', () => {
  it('shows the unassigned queue and the fields reviewers are asked to verify', async () => {
    const { findByText, findByRole } = renderPage();
    expect(await findByRole('heading', { name: /Fila sem grupo atribuído/ })).toBeInTheDocument();
    expect(await findByText('Unassigned switch')).toBeInTheDocument();
    expect(await findByText(/Hostname: core-01 · IP: 192.0.2.1/)).toBeInTheDocument();
    expect(await findByText(/Série: SN-1 · Etiqueta: AT-1 · Estado: ACTIVE/)).toBeInTheDocument();
  });

  it('records a confirmation against the weekly attestation', async () => {
    const { findByRole } = renderPage();
    fireEvent.click(await findByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/critical-assets/attest-1/confirm', expect.objectContaining({ method: 'POST', body: JSON.stringify({ outcome: 'CONFIRMED', notes: undefined }) })));
  });
});
