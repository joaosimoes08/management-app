import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './dashboard-page';

const mocks = vi.hoisted(() => ({
  role: 'READ_ONLY',
  getDashboardSummary: vi.fn(),
  getDashboardWorkspaces: vi.fn(),
  getDashboardLayout: vi.fn(),
  saveDashboardPreference: vi.fn(),
  operational: {} as Record<string, unknown>,
  operationsPanelProps: [] as Array<{ siteId?: string; showAlerts?: boolean; showQuality?: boolean }>,
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
          : mocks.operational,
    refetch: vi.fn(), isPending: false, isError: false,
  }),
}));
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children, actions, toolbar }: { children: React.ReactNode; actions: React.ReactNode; toolbar: React.ReactNode }) => <div><div aria-label="Controlos do dashboard">{toolbar}</div><div aria-label="Ações do dashboard">{actions}</div>{children}</div>,
  ToolbarMore: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/operations/operations-panel', () => ({ OperationsPanel: (props: { siteId?: string; showAlerts?: boolean; showQuality?: boolean }) => { mocks.operationsPanelProps.push(props); return <div />; } }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { username: 'tester' }, profile: null, hasRole: (role: string) => mocks.role === role }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: null }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, _fallback?: string, params?: Record<string, unknown>) => params ? `${key}(${Object.values(params).join(',')})` : key }) }));
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: '' }) }));
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: React.AnchorHTMLAttributes<HTMLAnchorElement> & { href: string }) => <a href={href} {...props}>{children}</a> }));

const baseOperational = { services: [], inventory: {}, processes: [], discovery: 0, drifts: 0, updatedAt: '2026-11-14T10:00:00Z' };
beforeEach(() => {
  mocks.operational = { ...baseOperational };
  mocks.operationsPanelProps = [];
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

  it('shows assets and problems per severity, alerts and quality counted separately and SNOOZED excluded', async () => {
    mocks.operational = {
      ...baseOperational,
      inventory: { sites: 1, devices: 42, vlans: 0, subnets: 0, ips: 0 },
      alerts: { total: 6, groups: [
        { status: 'OPEN', severity: 'CRITICAL', _count: { _all: 2 } },
        { status: 'SNOOZED', severity: 'CRITICAL', _count: { _all: 5 } },
        { status: 'ACKNOWLEDGED', severity: 'HIGH', _count: { _all: 1 } },
      ] },
      quality: { total: 4, groups: [
        { status: 'OPEN', severity: 'CRITICAL', _count: { _all: 1 } },
        { status: 'OPEN', severity: 'INFO', _count: { _all: 3 } },
      ] },
    };
    render(<DashboardPage />);
    const strip = await screen.findByRole('region', { name: 'dashboard.kpis' });
    expect(strip).toHaveTextContent('dashboard.assets');
    expect(strip).toHaveTextContent('42');
    expect(screen.getByLabelText('dashboard.severity.critical: 3 — dashboard.severityDetail(2,1)')).toBeInTheDocument();
    expect(screen.getByLabelText('dashboard.severity.high: 1 — dashboard.severityDetail(1,0)')).toBeInTheDocument();
    expect(screen.getByLabelText('dashboard.severity.warning: 0 — dashboard.severityDetail(0,0)')).toHaveClass('is-zero');
    expect(screen.getByLabelText('dashboard.severity.info: 3 — dashboard.severityDetail(0,3)')).toBeInTheDocument();
  });

  it('makes the dashboard lists keyboard-focusable scroll regions', async () => {
    render(<DashboardPage />);
    for (const name of ['dashboard.servicesList', 'dashboard.activityList']) {
      expect(await screen.findByRole('region', { name })).toHaveAttribute('tabindex', '0');
    }
  });

  it('warns in the layout editor when the visible widgets do not fit one screen', async () => {
    mocks.role = 'ADMIN';
    const ids = ['active-alerts', 'quality-queue', 'service-health', 'recent-changes', 'inventory-summary', 'quick-actions', 'running-processes'];
    mocks.getDashboardLayout.mockResolvedValue({ siteId: 'site-1', role: 'ADMIN', revision: 1, widgets: ids.map((id, index) => ({ id, x: 0, y: index, w: index < 3 ? 12 : 6, h: 4, visible: true })) });
    render(<DashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'dashboard.editLayout' }));
    expect(await screen.findByText('dashboard.fitOverflowWarning')).toBeInTheDocument();
    expect(screen.getByText('dashboard.kpiWidget')).toBeInTheDocument();
  });

  it('scopes the alerts and quality cards to the selected workspace site, not the global site selector', async () => {
    mocks.getDashboardWorkspaces.mockResolvedValueOnce({ items: [
      { id: 'workspace-1', siteId: 'site-1', siteName: 'Site one', role: 'READ_ONLY', selected: true },
      { id: 'workspace-2', siteId: 'site-2', siteName: 'Site two', role: 'READ_ONLY', selected: false },
    ] });
    render(<DashboardPage />);
    const selector = await screen.findByRole('combobox');
    await waitFor(() => expect(mocks.operationsPanelProps.at(-1)?.siteId).toBe('site-1'));
    fireEvent.change(selector, { target: { value: 'workspace-2' } });
    await waitFor(() => {
      const latest = mocks.operationsPanelProps.slice(-2);
      expect(latest.map((props) => props.siteId)).toEqual(['site-2', 'site-2']);
      expect(latest.some((props) => props.showAlerts)).toBe(true);
      expect(latest.some((props) => props.showQuality)).toBe(true);
    });
  });
});
