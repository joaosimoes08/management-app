import type { ReactNode } from 'react';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import AlertConfigurationPage from './alert-configuration-page';

const mocks = vi.hoisted(() => ({
  admin: true,
  apiFetch: vi.fn(),
}));

vi.mock('@/lib/api/client', () => ({ apiFetch: (...args: unknown[]) => mocks.apiFetch(...args) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => mocks.admin && role === 'ADMIN' }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/features/infrastructure/api', () => ({ listSites: vi.fn(async () => ({ items: [{ id: 'site-1', name: 'Lisboa' }] })) }));
vi.mock('./use-operational-events', () => ({ useOperationalEvents: () => ({ data: undefined, connected: false, error: null }) }));
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children, actions }: { children: ReactNode; actions?: ReactNode }) => <div><div>{actions}</div>{children}</div>,
  PageToolbarPortal: ({ children }: { children: ReactNode }) => <div aria-label="Filtros">{children}</div>,
}));

const rule = { id: 'r1', name: 'Drifts', source: 'SNMP_DRIFT', siteId: null, minSeverity: 'WARNING', enabled: true, site: null, activeAlerts: { matching: 4, governed: 3, shown: 2, belowThreshold: 1, inMaintenance: 0 } };
const windowItem = { id: 'w1', name: 'Upgrade core', reason: null, siteId: 'site-1', startsAt: '2026-11-22T10:00:00.000Z', endsAt: '2026-11-22T12:00:00.000Z', site: { id: 'site-1', name: 'Lisboa' } };
const maintenance = { generatedAt: '2026-11-21T10:00:00Z', horizonDays: 7, counts: { active: 1, upcoming: 1 }, nextStartsAt: windowItem.startsAt, active: [{ ...windowItem, id: 'w0', name: 'Troca de UPS' }], upcoming: [windowItem], criticalAlertsUnaffected: true };
const alertItem = { id: 'a1', source: 'SNMP_DRIFT', siteId: 'site-1', site: { id: 'site-1', name: 'Lisboa' }, status: 'OPEN', severity: 'CRITICAL', title: 'Porta desligada', detail: 'sw-core-01 Gi1/0/1', actionHref: '/snmp', lastOccurredAt: '2026-11-21T09:00:00Z', occurrenceCount: 3 };

function route(path: string, init?: RequestInit) {
  if (path.startsWith('/api/v1/operations/alerts?')) return Promise.resolve({ items: [alertItem], total: 1, page: 1, pageSize: 100 });
  if (path.startsWith('/api/v1/operations/maintenance/summary')) return Promise.resolve(maintenance);
  if (path === '/api/v1/operations/alerts/sources') return Promise.resolve({ items: ['SNMP_DRIFT', 'SNMP_TRAP', 'SNMP_TRAP_SOURCE', 'SNMP_POLL', 'CUSTOM_HOOK'] });
  if (path === '/api/v1/operations/configuration') return Promise.resolve({ rules: [rule], windows: [windowItem] });
  if (init?.method === 'PATCH') return Promise.resolve({});
  return Promise.reject(new Error(`unexpected ${path}`));
}

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><AlertConfigurationPage /></QueryClientProvider>);
const calls = () => mocks.apiFetch.mock.calls.map(([path, init]) => ({ path: path as string, init: init as RequestInit | undefined }));

beforeEach(() => {
  mocks.admin = true;
  mocks.apiFetch.mockImplementation(route);
  window.history.replaceState(null, '', '/alertas');
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('Alertas list (drill-through target)', () => {
  it('applies the URL filters to GET /operations/alerts and lists the alerts', async () => {
    window.history.replaceState(null, '', '/alertas?siteId=site-1&severity=CRITICAL&status=OPEN');
    renderPage();
    expect(await screen.findByRole('link', { name: 'Porta desligada' })).toHaveAttribute('href', '/snmp');
    const listCall = calls().find((call) => call.path.startsWith('/api/v1/operations/alerts?') && call.path.includes('pageSize=100'))!;
    const params = new URLSearchParams(listCall.path.split('?')[1]);
    expect(Object.fromEntries(params)).toMatchObject({ siteId: 'site-1', severity: 'CRITICAL', status: 'OPEN', pageSize: '100' });
    expect(within(screen.getByRole('group', { name: 'Severidade' })).getByRole('button', { name: /Crítico/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('button', { name: /Limpar filtros/ })).toBeInTheDocument();
  });

  it('lists every Site with scope=all and keeps an event-type filter removable', async () => {
    window.history.replaceState(null, '', '/alertas?source=SNMP_DRIFT&scope=all');
    renderPage();
    await screen.findByText('Porta desligada');
    const listCall = calls().find((call) => call.path.startsWith('/api/v1/operations/alerts?') && call.path.includes('pageSize=100'))!;
    expect(listCall.path).not.toContain('siteId=');
    expect(listCall.path).toContain('source=SNMP_DRIFT');
    fireEvent.click(screen.getByRole('button', { name: /Remover/ }));
    expect(window.location.search).toBe('?scope=all');
  });

  it('shows the API message when a filter is rejected, without crashing', async () => {
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => path.startsWith('/api/v1/operations/alerts?')
      ? Promise.reject(Object.assign(new Error('severity must be one of CRITICAL, HIGH, WARNING, INFO'), { status: 400 }))
      : route(path, init));
    window.history.replaceState(null, '', '/alertas?severity=BOGUS');
    renderPage();
    expect(await screen.findByText('severity must be one of CRITICAL, HIGH, WARNING, INFO')).toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Regras de alerta' })).toBeInTheDocument();
  });

  it('shows active and upcoming maintenance windows to every role, and hides the rules from non-admins', async () => {
    mocks.admin = false;
    renderPage();
    const summary = (await screen.findByRole('heading', { name: 'Janelas ativas e próximas' })).closest('section')!;
    expect(await within(summary).findByText('Troca de UPS')).toBeInTheDocument();
    expect(within(summary).getByText('Upgrade core')).toBeInTheDocument();
    expect(within(summary).getByText('Em curso')).toBeInTheDocument();
    expect(within(summary).getByText('1 ativas · 1 nos próximos 7 dias')).toBeInTheDocument();
    expect(screen.queryByRole('heading', { name: 'Regras de alerta' })).not.toBeInTheDocument();
    expect(calls().some((call) => call.path === '/api/v1/operations/configuration')).toBe(false);
  });
});

describe('Alert rules and maintenance windows (ADMIN)', () => {
  it('shows the active alert count per rule linked to the filtered list', async () => {
    renderPage();
    const link = await screen.findByRole('link', { name: 'Ver 4 alertas ativos de Drifts' });
    expect(link).toHaveAttribute('href', '/alertas?source=SNMP_DRIFT&scope=all');
    expect(link.closest('small')).toHaveTextContent('2 visíveis · 1 abaixo do mínimo · 0 em manutenção');
  });

  it('offers the event types from the API with plain labels and Portuguese severity names', async () => {
    renderPage();
    const source = await screen.findByRole('combobox', { name: 'Tipo de evento' });
    await waitFor(() => expect(within(source).getByRole('option', { name: 'Trap SNMP recebido (SNMP_TRAP)' })).toBeTruthy());
    expect(within(source).getByRole('option', { name: 'CUSTOM_HOOK' })).toBeTruthy();
    expect(within(source).getByRole('option', { name: 'Traps SNMP não aceites (SNMP_TRAP_SOURCE)' })).toBeTruthy();
    expect(within(source).getByRole('option', { name: 'Recolha SNMP e equipamento inacessível (SNMP_POLL)' })).toBeTruthy();
    const severity = screen.getByRole('combobox', { name: 'Severidade mínima' });
    expect(within(severity).getAllByRole('option').map((option) => option.textContent)).toEqual(['Crítico', 'Alto', 'Aviso', 'Info']);
    expect(severity.getAttribute('aria-describedby')).toBeTruthy();
  });

  it('switches a rule off with PATCH { enabled: false }', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'Desativar regra Drifts' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/operations/configuration/rules/r1', { method: 'PATCH', body: JSON.stringify({ enabled: false }) }));
  });

  it('edits a rule inline and sends only the changed fields', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar regra Drifts' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar regra Drifts' });
    fireEvent.change(within(dialog).getByRole('combobox', { name: 'Severidade mínima' }), { target: { value: 'HIGH' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar regra' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/operations/configuration/rules/r1', { method: 'PATCH', body: JSON.stringify({ minSeverity: 'HIGH' }) }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Editar regra Drifts' })).not.toBeInTheDocument());
  });

  it('keeps the dialog open with the API message when the rule PATCH fails', async () => {
    mocks.apiFetch.mockImplementation((path: string, init?: RequestInit) => init?.method === 'PATCH' ? Promise.reject(new Error('Já existe uma regra igual.')) : route(path, init));
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar regra Drifts' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar regra Drifts' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Nome' }), { target: { value: 'Drifts 2' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar regra' }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('Já existe uma regra igual.');
  });

  it('edits a maintenance window with PATCH', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Editar janela Upgrade core' }));
    const dialog = screen.getByRole('dialog', { name: 'Editar janela Upgrade core' });
    fireEvent.change(within(dialog).getByRole('textbox', { name: 'Motivo' }), { target: { value: 'Firmware' } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'Guardar janela' }));
    await waitFor(() => expect(mocks.apiFetch).toHaveBeenCalledWith('/api/v1/operations/configuration/maintenance-windows/w1', { method: 'PATCH', body: JSON.stringify({ reason: 'Firmware' }) }));
  });

  it('asks for confirmation before deleting a rule', async () => {
    renderPage();
    fireEvent.click(await screen.findByRole('button', { name: 'Eliminar' }));
    expect(await screen.findByText(/Eliminar a regra "Drifts"\?/)).toBeInTheDocument();
    expect(calls().some((call) => call.init?.method === 'DELETE')).toBe(false);
  });
});
