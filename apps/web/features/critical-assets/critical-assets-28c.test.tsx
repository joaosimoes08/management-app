import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { CriticalAssetsPage } from './critical-assets-page';
import { buildRows, complianceCells } from './workbench';

vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  AppShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <>
    <div data-testid="toolbar-actions">{actions}</div>
    {children}
  </>,
}));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const network = { id: 'g-1', name: 'Network Team' };
const systems = { id: 'g-2', name: 'Systems Team' };
const att = (id: string, weekStart: string, extra: Record<string, unknown> = {}) => ({ id, weekStart, outcome: null, notes: null, confirmedAt: null, confirmedBy: null, confirmedByName: null, ...extra });
const asset = (id: string, name: string, type: string, owner: typeof network | null, attestations: ReturnType<typeof att>[]) => ({ id, name, type, hostname: null, managementIp: null, serialNumber: null, assetTag: null, status: 'ACTIVE', owner, assignedGroup: owner, attestations });

// Hand-computed fixture. Deadline for a cycle = weekStart + 7 days.
const fixture = {
  timezone: 'Europe/Lisbon',
  mappings: [{ id: 'm1', assetType: 'SWITCH', group: network }, { id: 'm2', assetType: 'ROUTER', group: systems }, { id: 'm3', assetType: 'STORAGE', group: systems }],
  assets: [
    asset('d1', 'Core switch', 'SWITCH', network, [
      att('c5', '2026-11-16T00:00:00.000Z'),
      att('c4', '2026-11-09T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-10T10:00:00.000Z' }),
      att('c3', '2026-11-02T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-03T10:00:00.000Z' }),
    ]),
    asset('d2', 'Edge router', 'ROUTER', systems, [
      att('e2', '2026-11-16T00:00:00.000Z'),
      att('e1', '2026-11-09T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-10T10:00:00.000Z' }),
    ]),
    asset('d3', 'Backup array', 'STORAGE', systems, [
      // Confirmed after its cycle's deadline (2026-11-23): counts as expected but not on time.
      att('s1', '2026-11-16T00:00:00.000Z', { outcome: 'CONFIRMED', confirmedAt: '2026-11-24T10:00:00.000Z' }),
    ]),
  ],
  unassigned: [],
};

const corrections = {
  items: [
    { id: 'k1', status: 'OPEN', description: 'Número de série errado', requestedAt: '2026-11-18T10:00:00.000Z', groupName: 'Network Team', device: { id: 'd1', name: 'Core switch', type: 'SWITCH' } },
    { id: 'k2', status: 'RESOLVED', description: 'Hostname antigo', requestedAt: '2026-11-10T10:00:00.000Z', closedAt: '2026-11-12T10:00:00.000Z', changeReference: 'CHG-42', groupName: 'Systems Team', device: { id: 'd2', name: 'Edge router', type: 'ROUTER' } },
  ],
};

beforeEach(() => {
  window.history.replaceState(null, '', '/attestacao-ativos');
  vi.mocked(apiFetch).mockReset();
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    if (url.includes('/settings/access-groups')) return [network, systems] as never;
    if (url.includes('/critical-assets/corrections')) return corrections as never;
    if (url.includes('/topology/connections')) return { items: [{ id: 'x1', label: 'uplink', sourceDevice: { id: 'd1', name: 'Core switch' }, targetDevice: { id: 'd2', name: 'Edge router' } }] } as never;
    if (url.includes('/resolve')) return { id: 'k1', status: 'RESOLVED' } as never;
    return fixture as never;
  });
});
afterEach(cleanup);

describe('complianceCells', () => {
  it('matches the hand count per group and cycle, newest cycle first', () => {
    const result = complianceCells(buildRows(fixture as never));
    expect(result.weeks).toEqual(['2026-11-16', '2026-11-09', '2026-11-02']);
    expect(result.groups).toEqual(['Network Team', 'Systems Team']);
    const cell = (group: string, week: string) => result.cells.find((item) => item.group === group && item.weekStart === week);
    expect(cell('Network Team', '2026-11-16')).toMatchObject({ expected: 1, onTime: 0, percent: 0 });
    expect(cell('Network Team', '2026-11-09')).toMatchObject({ expected: 1, onTime: 1, percent: 100 });
    // Systems: 16 Nov has the late Backup array review (1 of 2 on time); 9 Nov is on time.
    expect(cell('Systems Team', '2026-11-16')).toMatchObject({ expected: 2, onTime: 0, percent: 0 });
    expect(cell('Systems Team', '2026-11-09')).toMatchObject({ expected: 1, onTime: 1, percent: 100 });
    expect(cell('Systems Team', '2026-11-02')).toMatchObject({ expected: 0, percent: null });
  });
});

describe('critical assets 28c views', () => {
  it('lists open corrections and asks for a change reference before resolving', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CriticalAssetsPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: /^Correções/ }));
    const table = within(await screen.findByRole('region', { name: 'Correções' }));
    expect(await table.findByText('Número de série errado', { exact: false })).toBeTruthy();
    expect(table.queryByText('Hostname antigo')).toBeNull();
    fireEvent.click(screen.getByRole('button', { name: 'Resolver correção de Core switch' }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.submit(dialog.querySelector('form') as HTMLFormElement);
    expect(within(dialog).getByRole('alert').textContent).toContain('Indica a alteração feita');
    expect(apiFetch).not.toHaveBeenCalledWith(expect.stringContaining('/resolve'), expect.anything());
  });

  it('shows compliance and the dependencies of the open asset', async () => {
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><CriticalAssetsPage /></QueryClientProvider>);
    fireEvent.click(await screen.findByRole('button', { name: 'Conformidade' }));
    const compliance = within(await screen.findByRole('region', { name: 'Conformidade' }));
    expect(compliance.getByText('Network Team')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Ativos' }));
    fireEvent.click(await screen.findByRole('button', { name: 'Abrir histórico de Core switch' }));
    const deps = within(await screen.findByRole('region', { name: 'Dependências' }));
    expect(await deps.findByText('Liga a')).toBeTruthy();
    expect(deps.getByText('Edge router')).toBeTruthy();
  });
});
