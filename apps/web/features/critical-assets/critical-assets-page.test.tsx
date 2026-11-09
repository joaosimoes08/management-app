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
const pageData = () => ({ timezone: 'Europe/Lisbon', mappings: [], unassigned: [{ id: 'device-1', name: 'Unassigned switch', type: 'SWITCH', attestations: [] }], assets: [{ id: 'device-2', name: 'Core switch', type: 'SWITCH', hostname: 'core-01', managementIp: '192.0.2.1', serialNumber: 'SN-1', assetTag: 'AT-1', status: 'ACTIVE', assignedGroup: { id: 'group-1', name: 'Network Team' }, attestations: [{ id: 'attest-1', weekStart: '2026-11-09T00:00:00.000Z', outcome: undefined as string | undefined, confirmedBy: undefined as string | undefined }] }] });
const renderPage = (queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })) => ({ ...render(<QueryClientProvider client={queryClient}><CriticalAssetsPage /></QueryClientProvider>), queryClient });
beforeEach(() => {
  let confirmed = false;
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url.includes('/settings/access-groups')) return [{ id: 'group-1', name: 'Network Team' }] as never;
    if (url.endsWith('/attest-1/confirm')) { confirmed = true; return { id: 'attest-1', weekStart: '2026-11-09T00:00:00.000Z', outcome: 'CONFIRMED', notes: null, confirmedAt: '2026-11-09T10:00:00.000Z', confirmedBy: 'reviewer-1' } as never; }
    const data = pageData();
    if (confirmed) data.assets[0].attestations[0] = { ...data.assets[0].attestations[0], outcome: 'CONFIRMED', confirmedBy: 'reviewer-1' };
    return data as never;
  });
});

describe('CriticalAssetsPage', () => {
  it('shows the unassigned queue and the fields reviewers are asked to verify', async () => {
    const { findByText, findByRole } = renderPage();
    expect(await findByRole('heading', { name: /Fila sem grupo atribuído/ })).toBeInTheDocument();
    expect(await findByRole('heading', { name: '1 ativos atribuídos' })).toBeInTheDocument();
    expect(await findByText('Unassigned switch')).toBeInTheDocument();
    expect(await findByText(/Hostname: core-01 · IP: 192.0.2.1/)).toBeInTheDocument();
    expect(await findByText(/Série: SN-1 · Etiqueta: AT-1 · Estado: ACTIVE/)).toBeInTheDocument();
  });

  it('updates the review outcome immediately in the page and all cached site queries', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    queryClient.setQueryData(['critical-assets', 'site-2'], pageData());
    const { findByRole, findByText } = renderPage(queryClient);
    fireEvent.click(await findByRole('button', { name: 'Confirmar' }));
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/critical-assets/attest-1/confirm', expect.objectContaining({ method: 'POST', body: JSON.stringify({ outcome: 'CONFIRMED', notes: undefined }) })));
    expect(await findByText(/CONFIRMED/)).toBeInTheDocument();
    const otherSite = queryClient.getQueryData<ReturnType<typeof pageData>>(['critical-assets', 'site-2']);
    expect(otherSite?.assets[0].attestations[0]).toMatchObject({ outcome: 'CONFIRMED', confirmedBy: 'reviewer-1' });
  });
});
