import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { listDiscoveryJobs, type DiscoveryJob } from './api';
import { DiscoveryFlowHeader, DiscoveryRunRow } from './discovery-run-parts';
import { describeDiscoveryError, discoveryFailureReason, discoveryProgressPercent, discoveryStatusLabel, formatResultCount, isActiveDiscoveryJob } from './discovery-status';
import { parseLimitField } from './discovery-schedule-panel';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);
beforeEach(() => { mockedFetch.mockReset(); mockedFetch.mockResolvedValue({ items: [], total: 0 }); });
afterEach(cleanup);

const job = (extra: Partial<DiscoveryJob> = {}): DiscoveryJob => ({
  id: 'job-1', name: 'Scan LAN', status: 'COMPLETED', createdAt: '2026-11-23T10:00:00.000Z', startedAt: '2026-11-23T10:00:00.000Z', completedAt: '2026-11-23T10:01:00.000Z', durationMs: 60_000,
  totalCount: 254, processedCount: 254, _count: { results: 1 }, subnet: { id: 'subnet-1', cidr: '10.0.0.0/24', site: { name: 'Lisboa' } }, ...extra,
});

describe('Discovery P0: runs list only for the active site', () => {
  it('sends the active site to the API and leaves it out when there is none', async () => {
    await listDiscoveryJobs('', 'site-a');
    await listDiscoveryJobs('PENDING,RUNNING', 'site-a');
    await listDiscoveryJobs();
    expect(mockedFetch).toHaveBeenNthCalledWith(1, '/api/v1/discovery/jobs?pageSize=100&siteId=site-a');
    expect(mockedFetch).toHaveBeenNthCalledWith(2, '/api/v1/discovery/jobs?pageSize=100&status=PENDING%2CRUNNING&siteId=site-a');
    expect(mockedFetch).toHaveBeenNthCalledWith(3, '/api/v1/discovery/jobs?pageSize=100');
  });
});

describe('Discovery P0: statuses, plural and failure reason', () => {
  it('translates every status and never shows the raw enum', () => {
    expect(['PENDING', 'RUNNING', 'COMPLETED', 'FAILED', 'CANCELLED', 'QUEUED'].map(discoveryStatusLabel)).toEqual(['Pendente', 'Em execução', 'Concluída', 'Falhada', 'Cancelada', 'Na fila']);
    expect(discoveryStatusLabel('completed')).toBe('Concluída');
    expect(discoveryStatusLabel(null)).toBe('—');
  });

  it('uses the singular for exactly one result', () => {
    expect(formatResultCount(0)).toBe('0 resultados');
    expect(formatResultCount(1)).toBe('1 resultado');
    expect(formatResultCount(2)).toBe('2 resultados');
  });

  it('explains known failure codes, keeps unknown ones visible and says nothing for runs that did not fail', () => {
    expect(discoveryFailureReason({ status: 'FAILED', errorMessage: 'DISCOVERY_TARGET_NOT_ALLOWED' })).toMatch(/redes autorizadas/);
    expect(discoveryFailureReason({ status: 'FAILED', errorMessage: 'DISCOVERY_QUEUE_UNAVAILABLE' })).toMatch(/worker e o Redis/);
    expect(discoveryFailureReason({ status: 'FAILED', errorMessage: 'EHOSTDOWN' })).toBe('EHOSTDOWN');
    expect(discoveryFailureReason({ status: 'FAILED', errorMessage: null })).toBe('A execução falhou sem indicar o motivo.');
    expect(discoveryFailureReason({ status: 'COMPLETED', errorMessage: 'DISCOVERY_EXECUTION_FAILED' })).toBeNull();
    expect(describeDiscoveryError('LIMIT_PROBES')).toBe('A execução parou no limite de sondas.');
  });

  it('renders a completed run with translated status and singular count', () => {
    render(<DiscoveryRunRow job={job()} onSelect={() => undefined} />);
    const row = screen.getByRole('button');
    expect(row.textContent).toContain('1 resultado ·');
    expect(row.textContent).toContain('Concluída');
    expect(row.textContent).not.toContain('COMPLETED');
    expect(row.textContent).not.toContain('resultados');
    expect(screen.queryByRole('progressbar')).toBeNull();
  });

  it('shows why a failed run failed', () => {
    render(<DiscoveryRunRow job={job({ status: 'FAILED', errorMessage: 'DISCOVERY_IPV6_UNSUPPORTED', _count: { results: 0 } })} onSelect={() => undefined} />);
    expect(screen.getByRole('note').textContent).toContain('Motivo: A descoberta ainda não suporta subnets IPv6.');
    expect(screen.getByRole('button').textContent).toContain('Falhada');
  });
});

describe('Discovery P0: live progress', () => {
  it('computes the share of scanned addresses', () => {
    expect(discoveryProgressPercent({ totalCount: 62, processedCount: 32 })).toBe(51);
    expect(discoveryProgressPercent({ totalCount: 62, processedCount: 99 })).toBe(100);
    expect(discoveryProgressPercent({ totalCount: 0, processedCount: 0 })).toBeNull();
    expect(isActiveDiscoveryJob({ status: 'RUNNING' })).toBe(true);
    expect(isActiveDiscoveryJob({ status: 'PENDING' })).toBe(true);
    expect(isActiveDiscoveryJob({ status: 'COMPLETED' })).toBe(false);
  });

  it('draws a progress bar on a running scan', () => {
    const onSelect = vi.fn();
    render(<DiscoveryRunRow job={job({ status: 'RUNNING', completedAt: null, durationMs: null, totalCount: 62, processedCount: 32 })} onSelect={onSelect} />);
    const bar = screen.getByRole('progressbar');
    expect(bar.getAttribute('aria-valuenow')).toBe('51');
    expect(bar.textContent).toContain('51%');
    expect((bar.querySelector('.discovery-progress-fill') as HTMLElement).style.width).toBe('51%');
    expect(screen.getByRole('button').textContent).toContain('32/62 endereços');
    fireEvent.click(screen.getByRole('button'));
    expect(onSelect).toHaveBeenCalledWith('job-1');
  });

  it('says a queued scan is waiting', () => {
    render(<DiscoveryRunRow job={job({ status: 'PENDING', startedAt: null, completedAt: null, durationMs: null, totalCount: 0, processedCount: 0 })} onSelect={() => undefined} />);
    expect(screen.getByRole('progressbar').getAttribute('aria-valuetext')).toBe('Na fila');
  });
});

describe('Step 5.5: discovery flow header', () => {
  it('shows Descobrir → Rever → Aceitar and explains pre-registration and unknown traps', () => {
    render(<DiscoveryFlowHeader />);
    const region = screen.getByRole('region', { name: 'Como funciona a descoberta' });
    const steps = within(region).getAllByRole('listitem').map((item) => item.querySelector('strong')?.textContent?.replace(/^\d\s*/, ''));
    expect(steps).toEqual(['Descobrir', 'Rever', 'Aceitar']);
    expect(region.textContent).toMatch(/pré-registo por trap/);
    expect(region.textContent).toMatch(/24 horas/);
    expect(region.textContent).toMatch(/traps não reconhecidas/);
  });
});

describe('Discovery P0: per-subnet load limit fields', () => {
  it('accepts empty (default) or whole numbers in range', () => {
    expect(parseLimitField('', 1, 2000)).toBeNull();
    expect(parseLimitField('  ', 1, 2000)).toBeNull();
    expect(parseLimitField('50', 1, 2000)).toBe(50);
    expect(parseLimitField('0', 1, 2000)).toBeUndefined();
    expect(parseLimitField('2001', 1, 2000)).toBeUndefined();
    expect(parseLimitField('2.5', 1, 1024)).toBeUndefined();
    expect(parseLimitField('abc', 1, 1024)).toBeUndefined();
  });
});

describe('Discovery P0: schedule panel saves the per-subnet limits', () => {
  it('shows the defaults as placeholders and sends typed limits, or null to reset', async () => {
    const { QueryClient, QueryClientProvider } = await import('@tanstack/react-query');
    const { DiscoverySchedulePanel } = await import('./discovery-schedule-panel');
    const schedule = { subnetId: 'subnet-1', enabled: false, intervalHours: 12, methods: ['ICMP'], tcpPorts: [], reverseDns: true, lastRunAt: null, nextRunAt: null, lastStatus: 'COMPLETED', lastError: 'LIMIT_DURATION', limits: { probesPerSecond: null, maxSockets: 16, effective: { probesPerSecond: 100, maxSockets: 16 } } };
    mockedFetch.mockImplementation(async (_path: string, init?: RequestInit) => (init?.method === 'PATCH' ? { ...schedule, ...JSON.parse(String(init.body)) } : schedule) as never);
    const onError = vi.fn();
    render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DiscoverySchedulePanel subnets={[{ id: 'subnet-1', cidr: '10.0.0.0/24' }]} canEdit onError={onError} /></QueryClientProvider>);
    const rate = await screen.findByLabelText('Sondas por segundo') as HTMLInputElement;
    const sockets = screen.getByLabelText('Ligações simultâneas') as HTMLInputElement;
    expect(rate.value).toBe(''); expect(rate.placeholder).toBe('100');
    expect(sockets.value).toBe('16');
    expect(screen.getByText('Concluída')).toBeTruthy();
    expect(screen.getByText('A execução parou no limite de duração.')).toBeTruthy();

    fireEvent.change(rate, { target: { value: '0' } });
    fireEvent.submit(rate.closest('form')!);
    expect(onError).toHaveBeenLastCalledWith(expect.stringMatching(/sondas por segundo/));
    expect(mockedFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(false);

    fireEvent.change(rate, { target: { value: '25' } });
    fireEvent.change(sockets, { target: { value: '' } });
    fireEvent.submit(rate.closest('form')!);
    await vi.waitFor(() => expect(mockedFetch.mock.calls.some(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')).toBe(true));
    const patch = mockedFetch.mock.calls.find(([, init]) => (init as RequestInit | undefined)?.method === 'PATCH')!;
    expect(patch[0]).toBe('/api/v1/subnets/subnet-1/discovery-schedule');
    expect(JSON.parse(String((patch[1] as RequestInit).body))).toMatchObject({ probesPerSecond: 25, maxSockets: null });
  });
});
