import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { CriticalAssetsPage } from './critical-assets-page';
import { buildRows, complianceCells } from './workbench';

vi.mock('@/components/layout/app-shell', async (importOriginal) => ({
  ...await importOriginal<typeof import('@/components/layout/app-shell')>(),
  PageShell: ({ children, actions }: { children: React.ReactNode; actions?: React.ReactNode }) => <>
    <div data-testid="toolbar-actions">{actions}</div>
    {children}
  </>,
}));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const network = { id: 'g-1', name: 'Network Team' };
const systems = { id: 'g-2', name: 'Systems Team' };
// Weekly (T1) cycle due next Monday 09:00 Europe/Lisbon, which is UTC+0 in November.
const weeklyDue = (weekStart: string) => new Date(Date.parse(`${weekStart.slice(0, 10)}T09:00:00.000Z`) + 7 * 86_400_000).toISOString();
const att = (id: string, weekStart: string, extra: Record<string, unknown> = {}) => ({ id, weekStart, dueAt: weeklyDue(weekStart), outcome: null, notes: null, confirmedAt: null, confirmedBy: null, confirmedByName: null, ...extra });
const asset = (id: string, name: string, type: string, owner: typeof network | null, attestations: ReturnType<typeof att>[]) => ({ id, name, type, hostname: null, managementIp: null, serialNumber: null, assetTag: null, status: 'ACTIVE', owner, assignedGroup: owner, attestations });

// Hand-computed fixture. Deadline for a weekly cycle = the following Monday 09:00 Europe/Lisbon.
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
    if (url.includes('/critical-assets/assets')) return { timezone: fixture.timezone, total: fixture.assets.length, page: 1, pageSize: 50, items: fixture.assets } as never;
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
    // Systems, 16 Nov: 0 of 2 on time. Edge router is still pending; Backup array was confirmed 24 Nov, after the 23 Nov 09:00 deadline.
    // Systems, 9 Nov: 1 of 1 on time.
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

describe('complianceCells deadlines', () => {
  const row = (owner: string, attestations: unknown[]) => ({ id: owner, name: owner, type: 'SWITCH', hostname: null, managementIp: null, serialNumber: null, assetTag: null, status: 'ACTIVE', owner: { id: owner, name: owner }, assignedGroup: { id: owner, name: owner }, attestations });
  const confirmed = (id: string, weekStart: string, dueAt: string, confirmedAt: string) => ({ id, weekStart, dueAt, outcome: 'CONFIRMED', notes: null, confirmedAt, confirmedBy: null, confirmedByName: null });

  it('uses the due time the API gives for each cycle, so a 2-week (T2) review is on time after one week', () => {
    // Opened Mon 2 Nov, T2 cadence: due Mon 16 Nov 09:00 Lisbon. Confirmed Thu 12 Nov, past one week but before its deadline.
    const rows = [row('Network Team', [confirmed('t2', '2026-11-02T00:00:00.000Z', '2026-11-16T09:00:00.000Z', '2026-11-12T10:00:00.000Z')])];
    const result = complianceCells(rows as never);
    expect(result.cells.find((item) => item.weekStart === '2026-11-02')).toMatchObject({ expected: 1, onTime: 1, percent: 100 });
  });

  it('counts a review as on time up to 09:00 Lisbon on the due day and late from 09:00', () => {
    const due = '2026-11-23T09:00:00.000Z';
    const onTime = [row('Network Team', [confirmed('a', '2026-11-16T00:00:00.000Z', due, '2026-11-23T08:59:00.000Z')])];
    const late = [row('Network Team', [confirmed('b', '2026-11-16T00:00:00.000Z', due, '2026-11-23T09:01:00.000Z')])];
    expect(complianceCells(onTime as never).cells[0]).toMatchObject({ onTime: 1, percent: 100 });
    expect(complianceCells(late as never).cells[0]).toMatchObject({ onTime: 0, percent: 0 });
  });
});
