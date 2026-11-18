import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './dashboard-page';

const mocks = vi.hoisted(() => ({
  role: 'READ_ONLY',
  getDashboardSummary: vi.fn(),
  getDashboardWorkspaces: vi.fn(),
  getDashboardLayout: vi.fn(),
  saveDashboardPreference: vi.fn(),
  environment: { state: 'OPERATIONAL', services: [{ key: 'api', label: 'API', state: 'OPERATIONAL' }, { key: 'postgres', label: 'PostgreSQL', state: 'OPERATIONAL' }, { key: 'redis', label: 'Redis / BullMQ', state: 'OPERATIONAL' }], updatedAt: '2026-11-14T10:00:00Z' },
}));

vi.mock('./api', () => ({
  getDashboardSummary: mocks.getDashboardSummary,
  getDashboardEnvironment: vi.fn(),
  getDashboardWorkspaces: mocks.getDashboardWorkspaces,
  getDashboardLayout: mocks.getDashboardLayout,
  getOperationalSummary: vi.fn(),
  saveDashboardLayout: vi.fn(),
  saveDashboardPreference: mocks.saveDashboardPreference,
}));
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === 'summary'
      ? { counts: { sites: 1, devices: 2, vlans: 3, subnets: 4, ips: 5, occupiedIps: 0, freeIps: 5, applications: 0 }, recentAudit: [] }
      : queryKey[1] === 'health'
        ? true
        : queryKey[1] === 'environment'
          ? { environment: mocks.environment, updatedAt: mocks.environment.updatedAt }
          : { services: [], inventory: {}, processes: [], discovery: 0, drifts: 0, updatedAt: '2026-11-14T10:00:00Z' },
    refetch: vi.fn(), isPending: false, isError: false,
  }),
}));
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children, actions, toolbar }: { children: React.ReactNode; actions: React.ReactNode; toolbar: React.ReactNode }) => <div><div aria-label="Controlos do dashboard">{toolbar}</div><div aria-label="Ações do dashboard">{actions}</div>{children}</div>,
  ToolbarMore: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/operations/operations-panel', () => ({ OperationsPanel: () => <div /> }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { username: 'tester' }, profile: null, hasRole: (role: string) => mocks.role === role }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: null }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: '' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

beforeEach(() => {
  mocks.environment = { state: 'OPERATIONAL', services: [{ key: 'api', label: 'API', state: 'OPERATIONAL' }, { key: 'postgres', label: 'PostgreSQL', state: 'OPERATIONAL' }, { key: 'redis', label: 'Redis / BullMQ', state: 'OPERATIONAL' }], updatedAt: '2026-11-14T10:00:00Z' };
  mocks.getDashboardSummary.mockResolvedValue({ counts: {}, recentAudit: [] });
  mocks.getDashboardWorkspaces.mockResolvedValue({ items: [{ id: 'workspace-1', siteId: 'site-1', siteName: 'Site', role: mocks.role, selected: true }] });
  mocks.getDashboardLayout.mockResolvedValue(null);
  mocks.saveDashboardPreference.mockResolvedValue(undefined);
});
afterEach(() => { cleanup(); vi.clearAllMocks(); });

describe('DashboardPage role-gated toolbar action', () => {
  it('keeps the interactive workspace selector in the toolbar control slot outside overflowing actions', async () => {
    render(<DashboardPage />);
    const selector = await screen.findByRole('combobox');
    expect(screen.getByLabelText('Controlos do dashboard')).toContainElement(selector);
    expect(screen.getByLabelText('Ações do dashboard')).not.toContainElement(selector);
    expect(selector).toHaveClass('context-toolbar-selector');
  });

  it('changes the selected Dashboard workspace through the native selector', async () => {
    mocks.getDashboardWorkspaces.mockResolvedValueOnce({ items: [
      { id: 'workspace-1', siteId: 'site-1', siteName: 'Site one', role: 'ADMIN', selected: true },
      { id: 'workspace-2', siteId: 'site-2', siteName: 'Site two', role: 'NETWORK_OPERATOR', selected: false },
    ] });
    render(<DashboardPage />);
    const selector = await screen.findByRole('combobox');
    fireEvent.change(selector, { target: { value: 'workspace-2' } });
    expect(selector).toHaveValue('workspace-2');
  });

  it('shows environment state and per-service status in the service health widget', async () => {
    mocks.environment = { state: 'DEGRADED', services: [{ key: 'api', label: 'API', state: 'OPERATIONAL' }, { key: 'redis', label: 'Redis / BullMQ', state: 'UNAVAILABLE' }], updatedAt: '2026-11-14T10:00:00Z' };
    render(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Saúde dos serviços' })).toBeInTheDocument();
    expect(screen.getByRole('status', { name: 'Estado do ambiente: Degradado' })).toBeInTheDocument();
    expect(screen.getByText('Redis / BullMQ')).toBeInTheDocument();
    expect(screen.getByText('UNAVAILABLE')).toBeInTheDocument();
  });

  it.each(['READ_ONLY', 'AUDITOR', 'SYSTEMS_OPERATOR'])('does not expose Add equipment for %s', async (role) => {
    mocks.role = role;
    render(<DashboardPage />);
    await screen.findByRole('heading', { name: 'Acesso rápido' });
    expect(screen.queryByRole('link', { name: /Adicionar equipamento/ })).not.toBeInTheDocument();
  });

  it.each(['ADMIN', 'NETWORK_OPERATOR'])('exposes Add equipment for %s', async (role) => {
    mocks.role = role;
    render(<DashboardPage />);
    expect(await screen.findByRole('link', { name: /Adicionar equipamento/ })).toHaveAttribute('href', '/infraestrutura?action=new');
  });

  it('shows useful cross-module shortcuts according to the current role', async () => {
    mocks.role = 'READ_ONLY';
    render(<DashboardPage />);
    expect(await screen.findByRole('link', { name: /Qualidade do inventário/ })).toHaveAttribute('href', '/qualidade-inventario');
    expect(screen.queryByRole('link', { name: /Regras de alertas/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Iniciar descoberta/ })).not.toBeInTheDocument();
    cleanup();
    mocks.role = 'ADMIN';
    render(<DashboardPage />);
    expect(await screen.findByRole('link', { name: /Regras de alertas/ })).toHaveAttribute('href', '/alertas');
    expect(screen.getByRole('link', { name: /Iniciar descoberta/ })).toHaveAttribute('href', '/descoberta?action=new');
  });
});
