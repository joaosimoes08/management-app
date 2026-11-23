import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TableUrlState } from '@/components/data-table';
import { AlertList, type AlertListUrlFilters } from './alerts-overview';
import { alertNextStep, alertSourceLabel, alertTargetHref, DEFAULT_NEXT_STEP } from './alert-meta';
import { alertOutcome, isAlertActionable, outcomeText } from './alert-actions';

const mocks = vi.hoisted(() => ({
  roles: ['NETWORK_OPERATOR'] as string[],
  listAlerts: vi.fn(),
  bulkOperationalAlerts: vi.fn(),
  getOperationalAlert: vi.fn(),
}));

vi.mock('./api', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./api')>()),
  listAlerts: mocks.listAlerts,
  bulkOperationalAlerts: mocks.bulkOperationalAlerts,
  getOperationalAlert: mocks.getOperationalAlert,
}));
vi.mock('./use-live-alert-refresh', () => ({ useLiveAlertRefresh: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => mocks.roles.includes(role) }) }));

const trap = {
  id: 'a1', title: 'Link down Gi0/1', detail: 'ifIndex 3', severity: 'CRITICAL', status: 'OPEN', source: 'SNMP_TRAP', siteId: 's1', site: { id: 's1', name: 'Lisboa' },
  relatedDeviceId: 'd1', actionHref: '/snmp', device: { id: 'd1', name: 'core-sw-01', managementIp: '10.0.0.1' }, lastOccurredAt: '2026-11-23T10:00:00Z', occurrenceCount: 3,
};
const drift = {
  id: 'a2', title: 'Config drift', severity: 'WARNING', status: 'ACKNOWLEDGED', source: 'SNMP_DRIFT', siteId: 's1', site: { id: 's1', name: 'Lisboa' },
  relatedDeviceId: null, actionHref: '/snmp/drift/1', device: null, lastOccurredAt: '2026-11-23T09:00:00Z', occurrenceCount: 1,
};
const globalAlert = { ...drift, id: 'a3', title: 'Backup falhou', source: 'SYSTEM_HEALTH', siteId: null, site: null, status: 'OPEN' };

const table = (filters: Partial<AlertListUrlFilters> = {}) => ({
  filters: { severity: '', status: '', source: '', scope: '', ...filters }, search: '', sort: null, setFilter: vi.fn(), setSort: vi.fn(), clearFilters: vi.fn(), filtering: false, defaultSort: null,
}) as unknown as TableUrlState<AlertListUrlFilters>;

function renderList(filters?: Partial<AlertListUrlFilters>) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><AlertList siteId="s1" table={table(filters)} /></QueryClientProvider>);
}

beforeEach(() => {
  mocks.roles = ['NETWORK_OPERATOR'];
  mocks.listAlerts.mockResolvedValue({ items: [trap, drift, globalAlert], total: 3 });
  mocks.bulkOperationalAlerts.mockImplementation(async ({ action, ids }: { action: string; ids: string[] }) => ({
    action, succeeded: ids.length, failed: 0, results: ids.map((id) => ({ id, ok: true })), ...(action === 'SNOOZE' ? { snoozedUntil: '2026-11-23T14:00:00Z' } : {}),
  }));
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('alert meta', () => {
  it('links trap alerts and alerts without a link to the device, keeps specific links otherwise', () => {
    expect(alertTargetHref(trap)).toContain('d1');
    expect(alertTargetHref(trap)).not.toBe('/snmp');
    expect(alertTargetHref(drift)).toBe('/snmp/drift/1');
    expect(alertTargetHref({ ...drift, actionHref: null, relatedDeviceId: 'd9' })).toContain('d9');
    expect(alertTargetHref({ ...trap, relatedDeviceId: null })).toBe('/snmp');
  });

  it('gives each source a plain label and a next step, with a fallback', () => {
    expect(alertSourceLabel('SNMP_TRAP')).toBe('Trap SNMP recebido');
    expect(alertSourceLabel('CUSTOM_X')).toBe('CUSTOM_X');
    expect(alertNextStep('SNMP_INTERFACE')).toMatch(/interface/);
    expect(alertNextStep('UNKNOWN')).toBe(DEFAULT_NEXT_STEP);
    expect(alertNextStep(null)).toBe(DEFAULT_NEXT_STEP);
  });

  it('only lets ADMIN act on global alerts and nobody on resolved ones', () => {
    expect(isAlertActionable(globalAlert, false)).toBe(false);
    expect(isAlertActionable(globalAlert, true)).toBe(true);
    expect(isAlertActionable({ ...trap, status: 'RESOLVED' }, true)).toBe(false);
  });

  it('reports partial bulk failures with the alert titles', () => {
    const outcome = alertOutcome({ action: 'RESOLVE', succeeded: 1, failed: 1, results: [{ id: 'a1', ok: true }, { id: 'a2', ok: false, code: 'FORBIDDEN' }] } as never, new Map([['a1', 'A'], ['a2', 'B']]));
    expect(outcomeText(outcome)).toBe('1 alerta resolvido. 1 falhou: B (Sem permissão para alterar este alerta.)');
  });
});

describe('AlertList', () => {
  it('shows device name and IP, a plain source label with the code, and the next step', async () => {
    renderList();
    const row = (await screen.findByText('Link down Gi0/1')).closest('tr')!;
    expect(within(row).getByRole('link', { name: 'core-sw-01' })).toBeTruthy();
    expect(within(row).getByText('10.0.0.1')).toBeTruthy();
    expect(within(row).getByText('Trap SNMP recebido')).toBeTruthy();
    expect(within(row).getByText('SNMP_TRAP')).toBeTruthy();
    expect(within(row).getByText(alertNextStep('SNMP_TRAP'))).toBeTruthy();
    expect(within(row).getByRole('link', { name: 'Link down Gi0/1' }).getAttribute('href')).toContain('d1');
    expect(screen.getByText('O que significa cada severidade?')).toBeTruthy();
  });

  it('acknowledges and snoozes one alert from the row', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Reconhecer Link down Gi0/1' }));
    await waitFor(() => expect(mocks.bulkOperationalAlerts).toHaveBeenCalledWith({ action: 'ACKNOWLEDGE', ids: ['a1'] }));
    expect(await screen.findByText('1 alerta reconhecido.')).toBeTruthy();
    fireEvent.change(screen.getByRole('combobox', { name: 'Adiar Config drift' }), { target: { value: '4' } });
    await waitFor(() => expect(mocks.bulkOperationalAlerts).toHaveBeenCalledWith({ action: 'SNOOZE', ids: ['a2'], durationHours: 4 }));
  });

  it('asks before resolving and does nothing on cancel', async () => {
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Resolver Link down Gi0/1' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/Resolver o alerta "Link down Gi0\/1"\?/)).toBeTruthy();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull());
    expect(mocks.bulkOperationalAlerts).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole('button', { name: 'Resolver Link down Gi0/1' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Resolver' }));
    await waitFor(() => expect(mocks.bulkOperationalAlerts).toHaveBeenCalledWith({ action: 'RESOLVE', ids: ['a1'] }));
  });

  it('acts on the selection from the bulk bar; global alerts are not selectable for operators', async () => {
    renderList();
    await screen.findByText('Link down Gi0/1');
    expect(screen.queryByRole('button', { name: 'Reconhecer Backup falhou' })).toBeNull();
    fireEvent.click(screen.getByRole('checkbox', { name: 'Selecionar todos os alertas visíveis' }));
    const bar = await screen.findByRole('region', { name: 'Ações sobre os alertas selecionados' });
    expect(within(bar).getByText('2 alertas selecionados')).toBeTruthy();
    fireEvent.click(within(bar).getByRole('button', { name: 'Reconhecer' }));
    await waitFor(() => expect(mocks.bulkOperationalAlerts).toHaveBeenCalledWith({ action: 'ACKNOWLEDGE', ids: ['a1', 'a2'] }));
    await waitFor(() => expect(screen.queryByRole('region', { name: 'Ações sobre os alertas selecionados' })).toBeNull());
  });

  it('opens the detail panel with counts, source and history', async () => {
    mocks.getOperationalAlert.mockResolvedValue({
      ...trap, firstOccurredAt: '2026-11-22T08:00:00Z', canAct: true,
      history: [{ id: 'h1', action: 'OPERATIONAL_ALERT_ACKNOWLEDGED', createdAt: '2026-11-23T10:05:00Z', user: { id: 'u', username: 'ana', displayName: 'Ana' }, metadata: {} }],
    });
    renderList();
    fireEvent.click(await screen.findByRole('button', { name: 'Ver detalhe de Link down Gi0/1' }));
    const dialog = await screen.findByRole('dialog');
    expect(await within(dialog).findByText('Ocorrências')).toBeTruthy();
    expect(within(dialog).getByText('3')).toBeTruthy();
    expect(within(dialog).getByText('Primeira ocorrência')).toBeTruthy();
    expect(within(dialog).getByText('Histórico')).toBeTruthy();
    expect(within(dialog).getByText(/Ana/)).toBeTruthy();
    expect(within(dialog).getByRole('button', { name: 'Resolver Link down Gi0/1' })).toBeTruthy();
    expect(mocks.getOperationalAlert).toHaveBeenCalledWith('a1');
  });

  it('explains to read-only users why there are no actions', async () => {
    mocks.roles = ['VIEWER'];
    renderList();
    await screen.findByText('Link down Gi0/1');
    expect(screen.getByRole('note').textContent).toContain('Tens acesso só de leitura');
    expect(screen.queryByRole('button', { name: /^Reconhecer/ })).toBeNull();
    expect(screen.queryByRole('checkbox')).toBeNull();
  });
});
