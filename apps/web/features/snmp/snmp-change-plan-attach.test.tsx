import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { executeAndAttach, SnmpChangePlanAttach } from './snmp-change-plan-attach';
import SnmpPage from './snmp-page';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1', activeSite: { id: 'site-1', name: 'Lisboa' }, loading: false }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: ReactNode }) => <>{children}</> }));
const mockedFetch = vi.mocked(apiFetch);
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);

const plan = { id: 'plan-1', title: 'Trocar uplink', status: 'IN_PROGRESS', plannedStartAt: '2026-11-21T10:00:00.000Z', plannedEndAt: '2026-11-21T18:00:00.000Z' };
const overview = { config: { enabled: true, port: 161, intervalMinutes: 15, timeoutMs: 5000, retries: 2, compatibilitySha1: false, lastStatus: 'COMPLETED' }, credentials: [], traps: [], drifts: [], latestSnapshot: null, setEnabled: true };
const impactPreview = { knownImpacts: [], coverage: { status: 'NOT_APPLICABLE', reason: 'Sem dependências.' } };

function route(attachable: unknown[]) {
  mockedFetch.mockImplementation(async (path: string, init?: RequestInit) => {
    if (path.startsWith('/api/v1/devices')) return { items: [{ id: 'dev-1', name: 'core-sw-01', type: 'SWITCH', managementIp: '10.0.0.1' }], total: 1 };
    if (path.startsWith('/api/v1/change-plans/attachable')) return attachable;
    if (path.includes('/write-requests/preview')) return { id: 'wr-1', status: 'PREVIEWED', impactPreview };
    if (path.includes('/write-requests/wr-1/execute')) return { id: 'wr-1', status: 'COMPLETED' };
    if (path.includes('/snmp-writes') && init?.method === 'POST') return { changePlanId: 'plan-1', snmpWriteRequestId: 'wr-1' };
    if (path.includes('/metrics')) return { interfaces: [], series: [], selectedInterfaceIndex: null };
    if (path.startsWith('/api/v1/snmp/devices/dev-1')) return overview;
    return {};
  });
}

beforeEach(() => { mockedFetch.mockReset(); window.history.replaceState(null, '', '/snmp?view=device&deviceId=dev-1'); });
afterEach(cleanup);

describe('SNMP SET attach to a change plan (Step 30)', () => {
  it('offers open change plans for the device and links the write after it runs', async () => {
    route([plan]);
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Criar preview' }));
    const select = await screen.findByRole('combobox', { name: /Associar a uma alteração/ });
    expect(screen.getByRole('option', { name: /Trocar uplink · Em curso · até/ })).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/change-plans/attachable?deviceId=dev-1');
    fireEvent.change(select, { target: { value: 'plan-1' } });
    fireEvent.click(screen.getByRole('checkbox', { name: /Li o impacto conhecido/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submeter alteração' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/change-plans/plan-1/snmp-writes', { method: 'POST', body: JSON.stringify({ snmpWriteRequestId: 'wr-1' }) }));
    const calls = mockedFetch.mock.calls.map(([path]) => String(path));
    expect(calls.findIndex((p) => p.includes('/execute'))).toBeLessThan(calls.findIndex((p) => p.includes('/snmp-writes')));
    expect(await screen.findByText('Operação submetida com sucesso.')).toBeInTheDocument();
    // The attachable list is read again after the link, so the dropdown reflects the new state.
    const after = mockedFetch.mock.calls.map(([path]) => String(path));
    const linkAt = after.findIndex((p) => p.includes('/snmp-writes'));
    expect(after.slice(linkAt + 1).some((p) => p.startsWith('/api/v1/change-plans/attachable'))).toBe(true);
  });

  it('shows nothing and never links when no change plan qualifies', async () => {
    route([]);
    wrap(<SnmpPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'Criar preview' }));
    await screen.findByRole('button', { name: 'Submeter alteração' });
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/change-plans/attachable?deviceId=dev-1'));
    expect(screen.queryByRole('combobox', { name: /Associar a uma alteração/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('checkbox', { name: /Li o impacto conhecido/ }));
    fireEvent.click(screen.getByRole('button', { name: 'Submeter alteração' }));
    expect(await screen.findByText('Operação submetida com sucesso.')).toBeInTheDocument();
    expect(mockedFetch.mock.calls.some(([path]) => String(path).includes('/snmp-writes'))).toBe(false);
  });

  it('hides the prompt when the list cannot be read', async () => {
    mockedFetch.mockRejectedValue(new Error('403'));
    const { container } = wrap(<SnmpChangePlanAttach deviceId="dev-1" value="" onChange={() => undefined} />);
    await waitFor(() => expect(mockedFetch).toHaveBeenCalled());
    expect(container).toBeEmptyDOMElement();
  });

  it('reports a failed link without hiding that the SET ran', async () => {
    mockedFetch.mockRejectedValue(new Error('Esta escrita SNMP já está associada a outra alteração.'));
    const execute = vi.fn(async () => ({}));
    await expect(executeAndAttach(execute, 'wr-1', 'plan-1')).rejects.toThrow('Escrita SNMP submetida, mas não foi associada à alteração: Esta escrita SNMP já está associada a outra alteração.');
    expect(execute).toHaveBeenCalledOnce();
    await executeAndAttach(execute, 'wr-1', '');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });
});
