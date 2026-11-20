import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
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

    render(<AppHeader section="Infraestrutura" onOpenSidebar={vi.fn()} onOpenGlobalSearch={onOpenGlobalSearch} />);
    expect(await screen.findByRole('button', { name: 'Pesquisar na aplicação ou neste separador' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Operacional' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Pesquisar na aplicação ou neste separador' }));
    expect(onOpenGlobalSearch).toHaveBeenCalledOnce();
  });

  it('keeps the IPAM action at the top of Alerts after Clear All', async () => {
    mocks.hasRole.mockImplementation((role: string) => role === 'ADMIN');
    mocks.apiFetch.mockResolvedValue(state);
    mocks.readAll.mockResolvedValue({ updated: 0 });
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader section="Infraestrutura" onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '1 alerta ativo' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '1 alerta ativo' }));

    const nextSteps = await screen.findByRole('link', { name: /Próximos passos/ });
    expect(nextSteps).toHaveAttribute('href', '/ipam');
    expect(nextSteps.querySelector('time')).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Limpar todos' }));
    expect(screen.getByRole('link', { name: /Próximos passos/ })).toBeInTheDocument();
  });

  it('keeps the reminder behind the same IPAM roles as the former sidebar action', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.apiFetch.mockResolvedValue(state);
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader section="Infraestrutura" onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '0 alertas ativos' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '0 alertas ativos' }));
    expect(screen.queryByRole('link', { name: /Próximos passos/ })).not.toBeInTheDocument();
  });
});

describe('AppHeader missing device config alert', () => {
  const missingAlert = (devices: { id: string; name: string; siteId?: string; missing: string[] }[], count = devices.length) => ({
    id: 'device-missing-config', kind: 'DEVICE_MISSING_CONFIG', severity: 'WARNING', title: 'Configuração de equipamentos em falta',
    detail: `${count} equipamento(s) sem imagem traseira ou alimentação`, href: '/infraestrutura?tab=devices&missingConfig=1', occurredAt: '2026-11-20T00:00:00.000Z', devices, count,
  });

  it('groups the affected devices, links each to its settings tab, and survives Limpar todos', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.readAll.mockResolvedValue({ updated: 0 });
    mocks.apiFetch.mockResolvedValue({ ...state, alerts: [
      missingAlert([{ id: 'd1', name: 'SW-01', siteId: 's1', missing: ['rearImage'] }, { id: 'd2', name: 'FW-02', siteId: 's1', missing: ['powerPlugCount', 'estimatedWatts'] }], 7),
      { id: 'a1', severity: 'CRITICAL', title: 'Link em baixo', detail: 'x', href: '/alertas', occurredAt: '2026-11-20T00:00:00.000Z' },
    ] });
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader section="Infraestrutura" onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '2 alertas ativos' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '2 alertas ativos' }));

    expect(screen.getByRole('link', { name: /Configuração de equipamentos em falta/ })).toHaveAttribute('href', '/infraestrutura?tab=devices&missingConfig=1');
    expect(screen.getByRole('link', { name: /SW-01/ })).toHaveAttribute('href', '/infraestrutura?siteId=s1&focus=device&deviceId=d1&deviceTab=imagens');
    expect(screen.getByRole('link', { name: /FW-02/ })).toHaveAttribute('href', '/infraestrutura?siteId=s1&focus=device&deviceId=d2&deviceTab=energia');
    expect(screen.getByRole('link', { name: /FW-02/ })).toHaveTextContent('fichas, consumo');
    expect(screen.getByRole('link', { name: 'Ver todos (7)' })).toHaveAttribute('href', '/infraestrutura?tab=devices&missingConfig=1');

    fireEvent.click(screen.getByRole('button', { name: 'Limpar todos' }));
    expect(screen.queryByRole('link', { name: /Link em baixo/ })).not.toBeInTheDocument();
    expect(screen.getByRole('link', { name: /Configuração de equipamentos em falta/ })).toBeInTheDocument();
    expect(screen.getByRole('button', { name: '1 alerta ativo' })).toBeInTheDocument();
  });

  it('for a single device the alert opens its settings on the right tab', async () => {
    mocks.hasRole.mockReturnValue(false);
    mocks.apiFetch.mockResolvedValue({ ...state, alerts: [missingAlert([{ id: 'd9', name: 'SW-09', missing: ['estimatedWatts'] }])] });
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader section="Infraestrutura" onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    await waitFor(() => expect(screen.getByRole('button', { name: '1 alerta ativo' })).toBeInTheDocument());
    fireEvent.click(screen.getByRole('button', { name: '1 alerta ativo' }));
    expect(screen.getByRole('link', { name: /Configuração de equipamentos em falta/ })).toHaveAttribute('href', '/infraestrutura?focus=device&deviceId=d9&deviceTab=energia');
    expect(screen.queryByRole('list', { name: 'Equipamentos com configuração em falta' })).not.toBeInTheDocument();
  });
});
