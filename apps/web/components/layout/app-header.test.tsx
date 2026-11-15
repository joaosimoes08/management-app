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
  it.each(['Dashboard', 'Infraestrutura'])('keeps global service availability available on %s', async (section) => {
    mocks.hasRole.mockReturnValue(false);
    mocks.apiFetch.mockResolvedValue(state);
    mocks.load.mockReturnValue(undefined);

    render(<AppHeader section={section} onOpenSidebar={vi.fn()} onOpenGlobalSearch={vi.fn()} />);
    const statusButton = await screen.findByRole('button', { name: 'Operacional' });
    fireEvent.click(statusButton);
    const status = screen.getByRole('dialog', { name: 'Estado do ambiente' });
    expect(status).toHaveTextContent('API');
    expect(status).toHaveTextContent('PostgreSQL');

    fireEvent.click(screen.getByRole('button', { name: '0 alertas ativos' }));
    expect(screen.queryByRole('dialog', { name: 'Estado do ambiente' })).not.toBeInTheDocument();
    expect(screen.getByRole('dialog', { name: 'Centro de alertas' })).toBeInTheDocument();
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
