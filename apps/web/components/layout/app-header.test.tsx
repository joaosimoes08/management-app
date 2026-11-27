import { cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppHeader } from './app-header';

const mocks = vi.hoisted(() => ({ apiFetch: vi.fn(), hasRole: vi.fn(), readAll: vi.fn(), load: vi.fn() }));

vi.mock('@/lib/api/client', () => ({ apiFetch: mocks.apiFetch }));
vi.mock('@/features/operations/api', () => ({ readAllOperationalAlerts: mocks.readAll }));
vi.mock('@/features/operations/use-operational-events', () => ({ useOperationalEvents: mocks.load }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: mocks.hasRole }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => ({ 'shell.nextSteps': 'Próximos passos', 'shell.continueIpam': 'Continue a configurar o inventário IPAM.', 'shell.operational': 'Operacional', 'shell.degraded': 'Degradado', 'shell.unavailable': 'Indisponível' })[key] ?? key }) }));
vi.mock('./site-switcher', () => ({ SiteSwitcher: () => <span>Site</span> }));

const state = { environment: { state: 'OPERATIONAL', setup: { completed: true }, services: [{ key: 'api', label: 'API', state: 'OPERATIONAL' }, { key: 'postgres', label: 'PostgreSQL', state: 'OPERATIONAL' }] }, alerts: [], processes: [], updatedAt: '2026-11-15T00:00:00.000Z' };


function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe('AppHeader persistent Next Steps alert', () => {
  it('keeps global search available and removes the environment status trigger', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.apiFetch.mockResolvedValue(state);
    mocks.load.mockReturnValue(undefined);
    const onOpenGlobalSearch = vi.fn();

    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={onOpenGlobalSearch} />);
    expect(await screen.findByRole('button', { name: 'Pesquisar na aplicação ou neste separador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Operacional' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar na aplicação ou neste separador' }));
    expect(onOpenGlobalSearch).toHaveBeenCalledOnce();
  });

  it('lists the IPAM next step under setup to-dos without counting it as an alert', async () => {
    mocks.hasRole.mockImplementation((role: string) => role === 'ADMIN');
    mocks.apiFetch.mockResolvedValue({ ...state, alerts: [{ id: 'a1', severity: 'CRITICAL', title: 'Link em baixo', detail: 'x', href: '/alertas', occurredAt: '2026-11-20T00:00:00.000Z' }] });
    mocks.readAll.mockResolvedValue({ updated: 0 });
    mocks.load.mockReturnValue(undefined);

    const view = render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    const bell = await screen.findByRole('button', { name: '1 alerta ativo · 1 tarefa de configuração' });
    expect(bell.querySelector('.alert-count')).toHaveTextContent('1');
    fireEvent.click(bell);

    const todos = screen.getByRole('group', { name: 'Tarefas de configuração' });
    const nextSteps = within(todos).getByRole('link', { name: /Próximos passos/ });
    expect(nextSteps).toHaveAttribute('href', '/ipam');
    expect(nextSteps.querySelector('time')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar todos' }));
    expect(screen.queryByRole('link', { name: /Link em baixo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Próximos passos/ })).toBeInTheDocument();
    // With only to-dos left the badge shows no number, just a dot.
    const after = screen.getByRole('button', { name: '0 alertas ativos · 1 tarefa de configuração' });
    expect(after.querySelector('.alert-count')).toBeNull();
    expect(view.container.querySelector('.alert-todo-dot')).not.toBeNull();
  });

  it('keeps the reminder behind the same IPAM roles as the former sidebar action', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.apiFetch.mockResolvedValue(state);
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '0 alertas ativos' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '0 alertas ativos' }));
    expect(screen.queryByRole('link', { name: /Próximos passos/ })).not.toBeInTheDocument();
  });
});

describe('AppHeader missing device config alert', () => {
  // GET /dashboard/topbar-state alert shape (docs/device-required-config.md).
  const missingAlert = (config: string, count: number, href: string, title: string) => ({
    id: `device-missing-config-${config}`, kind: 'DEVICE_MISSING_CONFIG', config, count, persistent: true, severity: 'WARNING', title,
    detail: 'A carga das PDUs não inclui estes equipamentos.', href, occurredAt: '2026-11-20T00:00:00.000Z',
  });

  it('shows one alert per missing config, linking to the filtered list, and survives Limpar todos', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.readAll.mockResolvedValue({ updated: 0 });
    mocks.apiFetch.mockResolvedValue({ ...state, alerts: [
      missingAlert('power', 3, '/infraestrutura?tab=devices&missingConfig=power', '3 dispositivos sem tomadas de energia configuradas'),
      { id: 'a1', severity: 'CRITICAL', title: 'Link em baixo', detail: 'x', href: '/alertas', occurredAt: '2026-11-20T00:00:00.000Z' },
    ] });
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '1 alerta ativo · 1 tarefa de configuração' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '1 alerta ativo · 1 tarefa de configuração' }));
    const link = within(screen.getByRole('group', { name: 'Tarefas de configuração' })).getByRole('link', { name: /3 dispositivos sem tomadas de energia/ });
    expect(link).toHaveAttribute('href', '/infraestrutura?tab=devices&missingConfig=power');
    expect(link).toHaveClass('missing-config');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar todos' }));
    expect(screen.queryByRole('link', { name: /Link em baixo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /3 dispositivos sem tomadas de energia/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '0 alertas ativos · 1 tarefa de configuração' })).toBeInTheDocument();
  });

  it('stays persistent even if the API omits the flag; a single device links to its settings tab', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.readAll.mockResolvedValue({ updated: 0 });
    const single = { ...missingAlert('rearImage', 1, '/infraestrutura?siteId=s1&tab=devices&deviceId=d9&settingsTab=imagens', '1 dispositivo sem imagem traseira'), persistent: undefined };
    mocks.apiFetch.mockResolvedValue({ ...state, alerts: [single] });
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '0 alertas ativos · 1 tarefa de configuração' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '0 alertas ativos · 1 tarefa de configuração' }));
    expect(screen.getByRole('link', { name: /1 dispositivo sem imagem traseira/ })).toHaveAttribute('href', '/infraestrutura?siteId=s1&tab=devices&deviceId=d9&settingsTab=imagens');
    // No real alerts: nothing to clear, and the empty state says so above the to-dos.
    expect(screen.queryByRole('button', { name: 'Limpar todos' })).not.toBeInTheDocument();
    expect(screen.getByText('Sem alertas ativos')).toBeInTheDocument();
  });
});

it('refreshes the badge immediately when a notification read state changes', async () => {
  mocks.hasRole.mockReturnValue(false);
  mocks.apiFetch.mockResolvedValueOnce({
    ...state,
    notificationUnreadCount: 2,
    alerts: [{ id: 'notification-a', severity: 'INFO', title: 'Review', detail: 'Pending', href: '/perfil?tab=notifications', occurredAt: state.updatedAt }],
  }).mockResolvedValueOnce({ ...state, notificationUnreadCount: 1 });
  render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
  expect(await screen.findByRole('button', { name: '2 alertas ativos' })).toBeInTheDocument();
  window.dispatchEvent(new Event('civernode:notifications-changed'));
  expect(await screen.findByRole('button', { name: '1 alerta ativo' })).toBeInTheDocument();
});

describe('AppHeader topbar state requests', () => {
  type Options = { fallback?: () => Promise<unknown>; onEvent?: (event: { data: unknown }) => void };
  const topbarCalls = () => mocks.apiFetch.mock.calls.filter(([path]) => path === '/api/v1/dashboard/topbar-state').length;

  it('shares one request when the events fallback poll and the first load ask together', async () => {
    let options: Options = {};
    mocks.hasRole.mockReturnValue(false);
    mocks.load.mockImplementation((value: Options) => { options = value; });
    let release!: (value: unknown) => void;
    mocks.apiFetch.mockReturnValue(new Promise((resolve) => { release = resolve; }));
    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    const polled = options.fallback?.();
    expect(topbarCalls()).toBe(1);
    release(state);
    await expect(polled).resolves.toEqual(state);
    // Once it has answered, the next load is a new request.
    mocks.apiFetch.mockResolvedValue(state);
    await options.fallback?.();
    expect(topbarCalls()).toBe(2);
  });

  it('still asks again after an operational event while an older request is in flight', async () => {
    let options: Options = {};
    mocks.hasRole.mockReturnValue(false);
    mocks.load.mockImplementation((value: Options) => { options = value; });
    mocks.apiFetch.mockReturnValueOnce(new Promise(() => undefined)).mockResolvedValue(state);
    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    options.onEvent?.({ data: { alertId: 'a1' } });
    await waitFor(() => expect(topbarCalls()).toBe(2));
  });

  it('shares a request in flight on focus, then lets an event replace it so its late answer never shows', async () => {
    let options: Options = {};
    mocks.hasRole.mockReturnValue(false);
    mocks.load.mockImplementation((value: Options) => { options = value; });
    let releaseFocus!: (value: unknown) => void;
    mocks.apiFetch.mockResolvedValueOnce({ ...state, notificationUnreadCount: 1 })
      .mockReturnValueOnce(new Promise((resolve) => { releaseFocus = resolve; }))
      .mockResolvedValueOnce({ ...state, notificationUnreadCount: 3 });
    render(<AppHeader onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    expect(await screen.findByRole('button', { name: '1 alerta ativo' })).toBeInTheDocument();
    window.dispatchEvent(new Event('focus'));
    window.dispatchEvent(new Event('focus'));
    await waitFor(() => expect(topbarCalls()).toBe(2));
    options.onEvent?.({ data: {} });
    expect(await screen.findByRole('button', { name: '3 alertas ativos' })).toBeInTheDocument();
    expect(topbarCalls()).toBe(3);
    releaseFocus({ ...state, notificationUnreadCount: 5 });
    await new Promise((resolve) => setTimeout(resolve, 20));
    expect(screen.getByRole('button', { name: '3 alertas ativos' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: '5 alertas ativos' })).not.toBeInTheDocument();
  });
});
