import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ReactNode } from 'react';
import { getDiscoverySchedule, type DiscoverySchedule } from './api';
import { DiscoverySchedulesOverview, scheduleOverviewCounts, scheduleOverviewFailed, scheduleOverviewState } from './discovery-schedules-overview';
import { DiscoverySchedulePanel } from './discovery-schedule-panel';

const locale = vi.hoisted(() => ({ current: 'pt-PT' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/i18n')>('@/lib/i18n/i18n');
  return { ...real, useOptionalI18n: () => ({ locale: locale.current, t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage(locale.current, key, fallback, params) }) };
});
vi.mock('./api', async () => ({ ...(await vi.importActual<typeof import('./api')>('./api')), getDiscoverySchedule: vi.fn(), updateDiscoverySchedule: vi.fn() }));
const mockedSchedule = vi.mocked(getDiscoverySchedule);

const subnets = [{ id: 'sn-a', cidr: '10.0.0.0/24' }, { id: 'sn-b', cidr: '10.0.1.0/24' }, { id: 'sn-c', cidr: '192.168.5.0/24' }];
const base = (extra: Partial<DiscoverySchedule>): DiscoverySchedule => ({
  subnetId: 'sn-a', enabled: false, intervalHours: 12, methods: ['ICMP'], tcpPorts: [], reverseDns: true, lastRunAt: null, nextRunAt: null, lastStatus: null, lastError: null,
  limits: { probesPerSecond: null, maxSockets: null, effective: { probesPerSecond: 100, maxSockets: 64 } }, ...extra,
});
const schedules: Record<string, DiscoverySchedule> = {
  'sn-a': base({ id: 's1', subnetId: 'sn-a', enabled: true, intervalHours: 6, nextRunAt: '2026-11-24T18:00:00.000Z', lastRunAt: '2026-11-24T12:00:00.000Z', lastStatus: 'COMPLETED', limits: { probesPerSecond: 50, maxSockets: 16, effective: { probesPerSecond: 50, maxSockets: 16 } } }),
  'sn-b': base({ id: 's2', subnetId: 'sn-b', enabled: true, intervalHours: 48, nextRunAt: '2026-11-25T09:00:00.000Z', lastRunAt: '2026-11-23T09:00:00.000Z', lastStatus: 'FAILED', lastError: 'DISCOVERY_TARGET_NOT_ALLOWED' }),
  'sn-c': base({ subnetId: 'sn-c' }),
};

function wrap(children: ReactNode) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
}
const rowFor = (cidr: string) => screen.getByText(cidr).closest('li') as HTMLElement;

beforeEach(() => {
  locale.current = 'pt-PT';
  mockedSchedule.mockReset();
  mockedSchedule.mockImplementation(async (id: string) => schedules[id]);
});
afterEach(cleanup);

describe('D-P2c schedule overview helpers', () => {
  it('tells a saved schedule (active or paused) from one never saved', () => {
    expect(scheduleOverviewState(schedules['sn-a'])).toBe('active');
    expect(scheduleOverviewState({ id: 'x', enabled: false })).toBe('paused');
    expect(scheduleOverviewState(schedules['sn-c'])).toBe('none');
    expect(scheduleOverviewFailed({ lastStatus: 'failed' })).toBe(true);
    expect(scheduleOverviewFailed({ lastStatus: null })).toBe(false);
  });

  it('counts active, paused and failed schedules', () => {
    expect(scheduleOverviewCounts(Object.values(schedules))).toEqual({ active: 2, paused: 1, failed: 1 });
  });
});

describe('D-P2c DiscoverySchedulesOverview', () => {
  it('lists every subnet with its schedule, last run, failure reason and limits (pt-PT)', async () => {
    render(wrap(<DiscoverySchedulesOverview subnets={subnets} onOpen={vi.fn()} />));
    expect(await screen.findByText('A cada 6 horas')).toBeTruthy();
    expect(mockedSchedule.mock.calls.map(([id]) => id).sort()).toEqual(['sn-a', 'sn-b', 'sn-c']);
    expect(screen.getByText(/2 ativos · 1 pausados · 1 com falha/)).toBeTruthy();

    const a = rowFor('10.0.0.0/24');
    expect(within(a).getByText('Ativo')).toBeTruthy();
    expect(within(a).getByText(/^Concluída · /)).toBeTruthy();
    expect(within(a).getByText('50 sondas/s')).toBeTruthy();
    expect(within(a).getByText('16 ligações')).toBeTruthy();

    const b = rowFor('10.0.1.0/24');
    await within(b).findByText('A cada 2 dias');
    expect(within(b).getByText('Última execução falhou')).toBeTruthy();
    expect(within(b).getByText(/^Falhada · /).className).toContain('schedule-error-text');
    expect(within(b).getByText(/redes autorizadas para Discovery/)).toBeTruthy();
    expect(within(b).getByText('100 sondas/s (predefinido)')).toBeTruthy();

    const c = rowFor('192.168.5.0/24');
    await within(c).findByText('Sem schedule');
    expect(within(c).getByText('Não agendada')).toBeTruthy();
    expect(within(c).getByText('Sem execuções')).toBeTruthy();
    expect(within(c).getByText('64 ligações (predefinido)')).toBeTruthy();
  });

  it('renders in en-US', async () => {
    locale.current = 'en-US';
    render(wrap(<DiscoverySchedulesOverview subnets={subnets} onOpen={vi.fn()} />));
    expect(await screen.findByText('Every 6 hours')).toBeTruthy();
    expect(screen.getByRole('heading', { name: 'Schedules for all subnets' })).toBeTruthy();
    await within(rowFor('10.0.1.0/24')).findByText('Every 2 days');
    expect(screen.getByText('Last run failed')).toBeTruthy();
    expect(screen.getByText('No schedule')).toBeTruthy();
    expect(within(rowFor('10.0.1.0/24')).getByText('100 probes/s (default)')).toBeTruthy();
  });

  it('opens the subnet from its row action', async () => {
    const onOpen = vi.fn();
    render(wrap(<DiscoverySchedulesOverview subnets={subnets} onOpen={onOpen} />));
    fireEvent.click(screen.getByRole('button', { name: 'Abrir o schedule de 10.0.1.0/24' }));
    expect(onOpen).toHaveBeenCalledWith('sn-b');
  });

  it('filters by the page search and says when nothing matches', async () => {
    const { rerender } = render(wrap(<DiscoverySchedulesOverview subnets={subnets} search="192.168" onOpen={vi.fn()} />));
    expect(screen.getByText('192.168.5.0/24')).toBeTruthy();
    expect(screen.queryByText('10.0.0.0/24')).toBeNull();
    rerender(wrap(<DiscoverySchedulesOverview subnets={subnets} search="172.16" onOpen={vi.fn()} />));
    expect(screen.getByText('Nenhuma subnet corresponde à pesquisa.')).toBeTruthy();
  });

  it('shows a per-row error without hiding the other subnets', async () => {
    mockedSchedule.mockImplementation(async (id: string) => { if (id === 'sn-b') throw new Error('boom'); return schedules[id]; });
    render(wrap(<DiscoverySchedulesOverview subnets={subnets} onOpen={vi.fn()} />));
    expect(await within(rowFor('10.0.1.0/24')).findByRole('alert')).toBeTruthy();
    expect(await within(rowFor('10.0.0.0/24')).findByText('A cada 6 horas')).toBeTruthy();
  });

  it('says when the Site has no subnets', () => {
    render(wrap(<DiscoverySchedulesOverview subnets={[]} onOpen={vi.fn()} />));
    expect(screen.getByText('Este Site ainda não tem subnets.')).toBeTruthy();
  });
});

describe('D-P2c DiscoverySchedulePanel follows the chosen subnet', () => {
  it('loads the subnet the page selects', async () => {
    const { rerender } = render(wrap(<DiscoverySchedulePanel subnets={subnets} canEdit={false} onError={vi.fn()} subnetId="sn-a" onSubnetChange={vi.fn()} />));
    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledWith('sn-a'));
    rerender(wrap(<DiscoverySchedulePanel subnets={subnets} canEdit={false} onError={vi.fn()} subnetId="sn-b" onSubnetChange={vi.fn()} />));
    await waitFor(() => expect(mockedSchedule).toHaveBeenCalledWith('sn-b'));
    expect((screen.getByLabelText('Subnet') as HTMLSelectElement).value).toBe('sn-b');
  });

  it('picks the first subnet when the chosen one is not in the list (e.g. after a Site change)', async () => {
    const onSubnetChange = vi.fn();
    render(wrap(<DiscoverySchedulePanel subnets={subnets} canEdit={false} onError={vi.fn()} subnetId="other-site-subnet" onSubnetChange={onSubnetChange} />));
    await waitFor(() => expect(onSubnetChange).toHaveBeenCalledWith('sn-a'));
  });
});
