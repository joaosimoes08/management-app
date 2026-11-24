import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { I18nProvider } from '@/lib/i18n/i18n';
import { bodyFromDraft, draftFrom, type DeviceHealthThresholds, type HealthHistoryItem, type Limits, type SiteHealthThresholds } from './thresholds-api';
import { HealthThresholdsEditor } from './thresholds-editor';
import { DeviceHealthThresholdsPanel, SiteHealthThresholdsSettings } from './health-limits-panels';
import { HealthHistoryChart, buildSeries } from './health-history-chart';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), roles: { current: ['ADMIN'] as string[] } }));
vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => mocks.roles.current.includes(role) }) }));
vi.mock('@/components/layout/app-shell', () => ({ PageToolbarPortal: ({ children }: { children: ReactNode }) => <div data-testid="toolbar">{children}</div> }));

beforeEach(() => { mocks.roles.current = ['ADMIN']; });
afterEach(() => { cleanup(); mocks.apiFetch.mockReset(); });

const withQuery = (node: ReactNode) => <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>;
const defaults: Limits = { cpuPercent: 90, cpuSustainMinutes: 5, memoryPercent: 90, temperatureHighCelsius: null, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: 10 };
const allDefault = { cpuPercent: 'DEFAULT', cpuSustainMinutes: 'DEFAULT', memoryPercent: 'DEFAULT', temperatureHighCelsius: 'DEFAULT', temperatureCriticalCelsius: 'DEFAULT', interfaceErrorsPerMinute: 'DEFAULT' } as const;
const siteData = (site: Partial<Limits> | null = null): SiteHealthThresholds => {
  const override = site ? { ...Object.fromEntries(Object.keys(defaults).map((key) => [key, null])) as Limits, ...site, updatedAt: '2026-11-24T09:00:00.000Z', updatedById: 'u1' } : null;
  return { siteId: 's1', defaults, site: override, effective: { ...defaults, ...(site ?? {}) }, sources: { ...allDefault, ...Object.fromEntries(Object.keys(site ?? {}).map((key) => [key, 'SITE'])) } };
};
const deviceData: DeviceHealthThresholds = {
  deviceId: 'd1', siteId: 's1', defaults,
  site: { ...defaults, cpuPercent: 80, cpuSustainMinutes: null, memoryPercent: null, interfaceErrorsPerMinute: null, updatedAt: '2026-11-24T09:00:00.000Z', updatedById: 'u1' },
  device: { cpuPercent: null, cpuSustainMinutes: null, memoryPercent: 95, temperatureHighCelsius: null, temperatureCriticalCelsius: null, interfaceErrorsPerMinute: null, updatedAt: '2026-11-24T09:30:00.000Z', updatedById: 'u1' },
  effective: { ...defaults, cpuPercent: 80, memoryPercent: 95 }, sources: { ...allDefault, cpuPercent: 'SITE', memoryPercent: 'DEVICE' },
};

describe('bodyFromDraft', () => {
  it('sends only the fields set, accepts a decimal comma and leaves empty fields to inherit', () => {
    const draft = { ...draftFrom(null), cpuPercent: '85', interfaceErrorsPerMinute: '2,5' };
    expect(bodyFromDraft(draft)).toEqual({ body: { cpuPercent: 85, interfaceErrorsPerMinute: 2.5 }, errors: [] });
    expect(bodyFromDraft(draftFrom(null))).toEqual({ body: {}, errors: [] });
  });

  it('refuses what the API refuses: ranges, whole minutes, critical below warning', () => {
    const draft = { ...draftFrom(null), cpuPercent: '101', cpuSustainMinutes: '2.5', temperatureHighCelsius: '70', temperatureCriticalCelsius: '60', interfaceErrorsPerMinute: '0' };
    expect(bodyFromDraft(draft).errors).toEqual([
      { field: 'cpuPercent', key: 'range' }, { field: 'cpuSustainMinutes', key: 'integer' }, { field: 'interfaceErrorsPerMinute', key: 'range' }, { field: 'temperatureCriticalCelsius', key: 'temperatureOrder' },
    ]);
  });
});

describe('HealthThresholdsEditor', () => {
  it('shows the default next to every field and saves only the overridden fields', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HealthThresholdsEditor data={siteData()} canEdit onSave={onSave} />);
    const cpu = screen.getByLabelText(/^CPU acima de/);
    expect(cpu).toHaveAttribute('placeholder', 'Herdar (90%)');
    expect(cpu).toHaveAccessibleDescription(/Predefinição: 90%.*Em vigor: 90% \(predefinição\)/);
    expect(screen.getByLabelText(/^Temperatura crítica/)).toHaveAccessibleDescription(/Predefinição: Desligado/);
    expect(screen.getByRole('button', { name: /Guardar limites/ })).toBeDisabled();
    fireEvent.change(cpu, { target: { value: '80' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar limites/ }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({ cpuPercent: 80 }));
  });

  it('marks an invalid field next to it and does not save', () => {
    const onSave = vi.fn();
    render(<HealthThresholdsEditor data={siteData()} canEdit onSave={onSave} />);
    const memory = screen.getByLabelText(/^Memória acima de/);
    fireEvent.change(memory, { target: { value: '150' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar limites/ }));
    expect(memory).toHaveAttribute('aria-invalid', 'true');
    expect(memory).toHaveAccessibleDescription(/Indique um valor entre 1 e 100/);
    expect(screen.getByRole('alert')).toHaveTextContent('Corrija os campos assinalados.');
    expect(onSave).not.toHaveBeenCalled();
  });

  it('"Repor predefinição" clears one field; resetting all asks first, then sends an empty override', async () => {
    const onSave = vi.fn().mockResolvedValue(undefined);
    render(<HealthThresholdsEditor data={siteData({ cpuPercent: 80 })} canEdit onSave={onSave} />);
    const cpu = screen.getByLabelText(/^CPU acima de/);
    expect(cpu).toHaveValue(80);
    fireEvent.click(screen.getByRole('button', { name: 'Repor predefinição de CPU acima de' }));
    expect(cpu).toHaveValue(null);
    fireEvent.click(screen.getByRole('button', { name: /Repor todas as predefinições/ }));
    const dialog = await screen.findByRole('alertdialog');
    expect(dialog).toHaveTextContent('Apagar os limites deste Site?');
    fireEvent.click(within(dialog).getByRole('button', { name: 'Repor todas as predefinições' }));
    await waitFor(() => expect(onSave).toHaveBeenCalledWith({}));
  });

  it('device scope: an empty field inherits the Site value, which is shown beside the default', () => {
    render(<HealthThresholdsEditor data={deviceData} canEdit onSave={vi.fn()} />);
    const cpu = screen.getByLabelText(/^CPU acima de/);
    expect(cpu).toHaveAttribute('placeholder', 'Herdar (80%)');
    expect(cpu).toHaveAccessibleDescription(/Predefinição: 90% · Site: 80% · Em vigor: 80% \(Site\)/);
    expect(screen.getByLabelText(/^Memória acima de/)).toHaveValue(95);
  });

  it('read-only roles get the values as a table and the read-only note, no inputs', () => {
    render(<HealthThresholdsEditor data={deviceData} canEdit={false} onSave={vi.fn()} />);
    expect(screen.getByRole('note')).toHaveTextContent('só de leitura');
    expect(screen.queryByRole('spinbutton')).not.toBeInTheDocument();
    const memory = screen.getByRole('rowheader', { name: 'Memória acima de' }).closest('tr')!;
    expect(within(memory).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['95%', 'equipamento', '90%']);
  });

  it('follows the English locale', () => {
    window.localStorage.setItem('cociber.locale', 'en-US');
    render(<I18nProvider><HealthThresholdsEditor data={siteData()} canEdit={false} onSave={vi.fn()} /></I18nProvider>);
    expect(screen.getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(expect.arrayContaining(['Limit', 'In effect', 'Source', 'Default']));
    expect(screen.getByRole('note')).toHaveTextContent('read-only access');
    window.localStorage.removeItem('cociber.locale');
  });
});

describe('limits panels', () => {
  it('Settings: loads the first Site, PUTs the override and puts Save in the utility bar', async () => {
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'PUT' ? siteData(JSON.parse(String(init.body))) : siteData()));
    render(withQuery(<SiteHealthThresholdsSettings sites={[{ id: 's1', name: 'Lisboa' }, { id: 's2', name: 'Porto' }]} />));
    const cpu = await screen.findByLabelText(/^CPU acima de/);
    expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/snmp/sites/s1/health-thresholds');
    fireEvent.change(cpu, { target: { value: '70' } });
    const save = within(screen.getByTestId('toolbar')).getByRole('button', { name: /Guardar limites/ });
    expect(save).toHaveAttribute('form', 'settings-health-form');
    fireEvent.click(save);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/snmp/sites/s1/health-thresholds', { method: 'PUT', body: JSON.stringify({ cpuPercent: 70 }) }));
    await waitFor(() => expect(screen.getByLabelText(/^CPU acima de/)).toHaveAccessibleDescription(/Em vigor: 70% \(Site\)/));
  });

  it('Settings: READ_ONLY sees the Site limits read-only', async () => {
    mocks.roles.current = ['READ_ONLY'];
    mocks.apiFetch.mockResolvedValue(siteData({ cpuPercent: 75 }));
    render(withQuery(<SiteHealthThresholdsSettings sites={[{ id: 's1', name: 'Lisboa' }]} />));
    expect(await screen.findByRole('note')).toHaveTextContent('ADMIN ou NETWORK_OPERATOR');
    expect(screen.queryByTestId('toolbar')).not.toBeInTheDocument();
  });

  it('Device 360: NETWORK_OPERATOR edits the device override', async () => {
    mocks.roles.current = ['NETWORK_OPERATOR'];
    mocks.apiFetch.mockImplementation(async (url: string, init?: RequestInit) => (init?.method === 'PUT' ? { ...deviceData, device: null } : deviceData));
    render(withQuery(<DeviceHealthThresholdsPanel deviceId="d1" />));
    fireEvent.change(await screen.findByLabelText(/^Memória acima de/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Guardar limites/ }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/snmp/devices/d1/health-thresholds', { method: 'PUT', body: '{}' }));
  });
});

const sample = (minutesAgo: number, extra: Partial<HealthHistoryItem> = {}): HealthHistoryItem => ({
  observedAt: new Date(Date.parse('2026-11-24T10:00:00.000Z') - minutesAgo * 60_000).toISOString(), status: 'OK',
  cpu5sPercent: 10, cpu1mPercent: null, cpu5mPercent: null, memoryUsedPercent: 40, maxTemperatureCelsius: 35, issueCount: 0, rebooted: false, ...extra,
});

describe('buildSeries', () => {
  it('keeps the peak of each group when it downsamples', () => {
    const items = Array.from({ length: 10 }, (_, index) => sample(50 - index * 5, { cpu5sPercent: index === 3 ? 97 : 10 }));
    const { segments, stats } = buildSeries(items, (item) => item.cpu5sPercent, 5);
    expect(segments).toHaveLength(1);
    expect(segments[0].map((point) => point.value)).toEqual([10, 97, 10, 10, 10]);
    expect(stats).toEqual({ min: 10, max: 97, avg: 18.7, latest: 10 });
  });

  it('breaks the line on a missing value and on a polling gap', () => {
    const items = [sample(60), sample(55), sample(50, { memoryUsedPercent: null }), sample(45), sample(40), sample(5), sample(0)];
    expect(buildSeries(items, (item) => item.memoryUsedPercent).segments.map((segment) => segment.length)).toEqual([2, 2, 2]);
    expect(buildSeries([sample(0, { maxTemperatureCelsius: null })], (item) => item.maxTemperatureCelsius).stats).toBeNull();
  });
});

describe('HealthHistoryChart', () => {
  const history = (hours: number) => ({ deviceId: 'd1', from: new Date(Date.parse('2026-11-24T10:00:00.000Z') - hours * 3_600_000).toISOString(), to: '2026-11-24T10:00:00.000Z', retentionDays: 30,
    items: [sample(10, { cpu5mPercent: 20 }), sample(5, { cpu5mPercent: 95, rebooted: true }), sample(0, { cpu5mPercent: 30, maxTemperatureCelsius: null })] });

  it('draws CPU, memory and temperature with the limit in effect, and switches the period', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => (url.includes('/health/history') ? history(Number(new URL(url, 'http://x').searchParams.get('hours'))) : deviceData));
    const { container } = render(withQuery(<HealthHistoryChart deviceId="d1" />));
    const cpu = await screen.findByRole('img', { name: /^CPU, 24 h: mínimo 20%, máximo 95%, último 30%\. Limite em vigor: 80%\./ });
    expect(cpu).toBeInTheDocument();
    expect(screen.getByRole('img', { name: /^Temperatura máx\., 24 h: .*último 35 °C\.$/ })).toBeInTheDocument();
    expect(container.querySelectorAll('.health-history-chart .reboot')).toHaveLength(3);
    expect(screen.getByText('1 reinício no período (linha vertical).')).toBeInTheDocument();
    const memoryRow = screen.getByRole('rowheader', { name: 'Memória' }).closest('tr')!;
    expect(within(memoryRow).getAllByRole('cell').map((cell) => cell.textContent)).toEqual(['40%', '40%', '40%', '40%']);

    const week = screen.getByRole('button', { name: '7 dias' });
    expect(week).toHaveAttribute('aria-pressed', 'false');
    fireEvent.click(week);
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/snmp/devices/d1/health/history?hours=168'));
    expect(week).toHaveAttribute('aria-pressed', 'true');
    expect(await screen.findByRole('img', { name: /^CPU, 7 dias:/ })).toBeInTheDocument();
  });

  it('says so when the period has no readings, and offers a retry on error', async () => {
    mocks.apiFetch.mockImplementation(async (url: string) => (url.includes('/health/history') ? { ...history(24), items: [] } : deviceData));
    render(withQuery(<HealthHistoryChart deviceId="d1" />));
    expect(await screen.findByText('Sem leituras neste período.')).toBeInTheDocument();
    cleanup();
    mocks.apiFetch.mockImplementation(async (url: string) => { if (url.includes('/health/history')) throw new Error('boom'); return deviceData; });
    render(withQuery(<HealthHistoryChart deviceId="d1" />));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível carregar o histórico.');
  });
});
