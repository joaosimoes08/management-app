import { act, cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import DashboardPage from './dashboard-page';

const mocks = vi.hoisted(() => ({
  role: 'READ_ONLY',
  getDashboardSummary: vi.fn(),
  getDashboardWorkspaces: vi.fn(),
  getDashboardLayout: vi.fn(),
  saveDashboardPreference: vi.fn(),
  saveDashboardLayout: vi.fn(),
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
  saveDashboardLayout: mocks.saveDashboardLayout,
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
  PageShell: ({ children, actions, toolbar }: { children: React.ReactNode; actions: React.ReactNode; toolbar: React.ReactNode }) => <div><div aria-label="Controlos do dashboard">{toolbar}</div><div aria-label="Ações do dashboard">{actions}</div>{children}</div>,
  ToolbarMore: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('@/features/operations/operations-panel', () => ({ OperationsPanel: (props: { siteId?: string; showAlerts?: boolean; showQuality?: boolean }) => { mocks.operationsPanelProps.push(props); return <div />; } }));
const liveRefresh = vi.hoisted(() => vi.fn());
vi.mock('@/features/operations/use-live-alert-refresh', () => ({ useLiveAlertRefresh: liveRefresh }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { username: 'tester' }, profile: null, hasRole: (role: string) => mocks.role === role }) }));
const siteContext = vi.hoisted(() => ({ value: { siteId: null as string | null, resolved: true } }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => siteContext.value }));
// Portuguese copy for the keys the dashboard moved from hard-coded strings to t(); other keys echo back.
const ptMessages = vi.hoisted((): Record<string, string> => ({ "dashboard.userFallback": "Utilizador", "dashboard.env.operational": "Operacional", "dashboard.env.degraded": "Degradado", "dashboard.env.unavailable": "Indisponível", "dashboard.env.loading": "A carregar", "dashboard.inventory.devices": "Equipamentos", "dashboard.drill.criticalDevices": "Equipamentos críticos", "dashboard.drill.lifecycleOverdue": "Ciclo de vida expirado", "dashboard.drill.lifecycleDue90": "Ciclo de vida nos próximos 90 dias", "dashboard.drill.subnetsAbove80": "Subnets acima de 80%", "dashboard.drill.openCriticalAlerts": "Alertas críticos abertos", "dashboard.drill.criticalQuality": "Findings de qualidade críticos", "dashboard.drill.changesInReview": "Alterações em revisão", "dashboard.drill.failedDiscoveries": "Descobertas com falha", "dashboard.settings": "Definições", "dashboard.newDiscovery": "Nova descoberta", "dashboard.addDevice": "Adicionar equipamento", "dashboard.layout.title": "Widgets do dashboard", "dashboard.layout.description": "Escolhe o que aparece e quais cartões ocupam a largura completa.", "dashboard.layout.width": "Largura", "dashboard.layout.half": "Metade", "dashboard.layout.full": "Completa", "dashboard.layout.save": "Guardar layout", "dashboard.greeting": "Bom dia, {name}", "dashboard.heroSubtitle": "Aqui está o estado atual da sua infraestrutura.", "dashboard.serviceHealth": "Saúde dos serviços", "dashboard.servicesRing": "{operational} de {total} serviços operacionais ({percent}%)", "dashboard.environmentState": "Estado do ambiente", "dashboard.environmentStateLabel": "Estado do ambiente: {state}", "dashboard.environmentLoadError": "Não foi possível carregar o estado dos serviços.", "dashboard.environmentEmpty": "Sem estado dos serviços disponível.", "dashboard.servicesListError": "Não foi possível carregar os serviços. Tenta atualizar.", "dashboard.servicesEmpty": "Sem serviços para apresentar.", "dashboard.inventoryTitle": "Distribuição atual", "dashboard.liveData": "dados reais", "dashboard.activityTitle": "Atividade recente", "dashboard.viewAudit": "Ver auditoria", "dashboard.activityLoading": "A carregar atividade recente…", "dashboard.activityError": "Não foi possível carregar a atividade. Tenta atualizar o dashboard.", "dashboard.activityOperation": "Operação", "dashboard.openInAudit": "Abrir na auditoria: {action}", "dashboard.activityEmpty": "Ainda não existem ações registadas.", "dashboard.quickTitle": "Acesso rápido", "dashboard.quickHint": "Aceda às próximas áreas de operação.", "dashboard.quickNav": "Atalhos para outras áreas", "dashboard.quick.alertRules": "Regras de alertas", "dashboard.quick.inventoryQuality": "Qualidade do inventário", "dashboard.quick.startDiscovery": "Iniciar descoberta", "common.cancel": "Cancelar", "common.refresh": "Atualizar", "dashboard.widget.active-alerts": "Alertas ativos", "dashboard.widget.quality-queue": "Qualidade dos dados", "dashboard.widget.service-health": "Saúde dos serviços", "dashboard.widget.recent-changes": "Atividade recente", "dashboard.widget.inventory-summary": "Distribuição atual", "dashboard.widget.quick-actions": "Acesso rápido", "dashboard.widget.running-processes": "Processos em execução", "dashboard.widget.discovery-review": "Discovery a rever ou falhado", "dashboard.widget.snmp-drifts": "Divergências SNMP" }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, _fallback?: string, params?: Record<string, unknown>) => {
  const template = ptMessages[key];
  if (template) return Object.entries(params ?? {}).reduce((text, [name, value]) => text.replaceAll(`{${name}}`, String(value)), template);
  return params ? `${key}(${Object.values(params).join(',')})` : key;
} }) }));
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

  it('renders widgets without section kickers, the Sparkles icon or the footer', async () => {
    mocks.role = 'ADMIN';
    const { container } = render(<DashboardPage />);
    await screen.findByRole('link', { name: /Iniciar descoberta/ });
    expect(container.querySelector('.section-kicker')).toBeNull();
    expect(container.querySelector('.lucide-sparkles')).toBeNull();
    expect(container.querySelector('.dashboard-footer')).toBeNull();
    expect(screen.queryByText(/Civernode Management Platform/)).not.toBeInTheDocument();
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
  it('does not render the alerts and quality cards until the workspace is known', async () => {
    let resolveWorkspaces!: (value: unknown) => void;
    mocks.getDashboardWorkspaces.mockReturnValueOnce(new Promise((resolve) => { resolveWorkspaces = resolve; }));
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.getDashboardWorkspaces).toHaveBeenCalled());
    expect(mocks.operationsPanelProps).toHaveLength(0);
    resolveWorkspaces({ items: [{ id: 'workspace-1', siteId: 'site-1', siteName: 'Site one', role: 'READ_ONLY', selected: true }] });
    await waitFor(() => expect(mocks.operationsPanelProps.length).toBeGreaterThan(0));
    expect(mocks.operationsPanelProps.every((props) => props.siteId === 'site-1')).toBe(true);
  });

  it('shows a visible error instead of endless loading when the workspaces request fails, and retries', async () => {
    mocks.getDashboardWorkspaces.mockRejectedValueOnce(new Error('workspaces down'));
    mocks.operational = undefined as unknown as Record<string, unknown>;
    render(<DashboardPage />);
    expect(await screen.findByRole('alert')).toHaveTextContent('dashboard.workspacesError');
    expect(screen.getAllByText('dashboard.error').length).toBeGreaterThan(0);
    expect(screen.queryByText('…')).not.toBeInTheDocument();
    expect(mocks.operationsPanelProps).toHaveLength(0);
    fireEvent.click(screen.getByRole('button', { name: 'dashboard.retry' }));
    await waitFor(() => expect(mocks.getDashboardWorkspaces).toHaveBeenCalledTimes(2));
    await waitFor(() => expect(screen.queryByRole('alert')).not.toBeInTheDocument());
    await waitFor(() => expect(mocks.operationsPanelProps.at(-1)?.siteId).toBe('site-1'));
  });
});

describe('DashboardPage drill-through (Phase D)', () => {
  it('refreshes the severity tiles live on alert events', () => {
    mocks.role = 'ADMIN';
    render(<DashboardPage />);
    expect(liveRefresh).toHaveBeenCalledWith([['dashboard', 'operational']]);
  });

  it('links the KPI tiles to the matching filtered lists', async () => {
    mocks.role = 'ADMIN';
    mocks.operational = {
      ...baseOperational,
      inventory: { sites: 1, devices: 42, vlans: 0, subnets: 0, ips: 0 },
      alerts: { total: 2, groups: [{ status: 'OPEN', severity: 'CRITICAL', _count: { _all: 2 } }] },
      quality: { total: 3, groups: [{ status: 'OPEN', severity: 'INFO', _count: { _all: 3 } }] },
    };
    render(<DashboardPage />);
    const critical = await screen.findByLabelText('dashboard.severity.critical: 2 — dashboard.severityDetail(2,0)');
    expect(critical.tagName).toBe('A');
    await waitFor(() => expect(critical).toHaveAttribute('href', '/alertas?siteId=site-1&severity=CRITICAL'));
    // Only quality findings have INFO severity, so that tile opens the quality queue.
    expect(screen.getByLabelText('dashboard.severity.info: 3 — dashboard.severityDetail(0,3)')).toHaveAttribute('href', '/qualidade-inventario?siteId=site-1&severity=INFO');
    expect(screen.getByRole('link', { name: /Ciclo de vida expirado/ })).toHaveAttribute('href', '/infraestrutura?siteId=site-1&tab=devices&lifecycle=overdue');
    expect(screen.getByRole('link', { name: /Subnets acima de 80%/ })).toHaveAttribute('href', '/ipam?siteId=site-1&tab=subnets&band=WARNING%2CCRITICAL&sort=utilization');
    expect(screen.getByRole('link', { name: /Descobertas com falha/ })).toHaveAttribute('href', '/descoberta?status=FAILED');
  });

  it('hides the discovery drill-through from roles that cannot open Descoberta', async () => {
    mocks.role = 'READ_ONLY';
    render(<DashboardPage />);
    await screen.findByRole('link', { name: /Qualidade do inventário/ });
    expect(await screen.findByRole('link', { name: /Equipamentos críticos/ })).toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Descobertas com falha/ })).not.toBeInTheDocument();
  });

  it('shows readable widget names in the layout editor', async () => {
    mocks.role = 'ADMIN';
    mocks.getDashboardLayout.mockResolvedValue({ siteId: 'site-1', role: 'ADMIN', revision: 1, widgets: [{ id: 'snmp-drifts', x: 0, y: 0, w: 6, h: 4, visible: true }, { id: 'future-widget', x: 0, y: 1, w: 6, h: 4, visible: true }] });
    render(<DashboardPage />);
    fireEvent.click(await screen.findByRole('button', { name: 'dashboard.editLayout' }));
    expect(await screen.findByText('Divergências SNMP')).toBeInTheDocument();
    expect(screen.getByText('future-widget')).toBeInTheDocument();
  });
});

describe('DashboardPage workspace loading', () => {
  it('waits for the active site before loading workspaces, then loads them once for that site', async () => {
    siteContext.value = { siteId: '', resolved: false };
    const { rerender } = render(<DashboardPage />);
    await act(async () => undefined);
    expect(mocks.getDashboardWorkspaces).not.toHaveBeenCalled();
    siteContext.value = { siteId: 'site-1', resolved: true };
    rerender(<DashboardPage />);
    await waitFor(() => expect(mocks.getDashboardWorkspaces).toHaveBeenCalledTimes(1));
    expect(mocks.getDashboardWorkspaces).toHaveBeenCalledWith('site-1');
    siteContext.value = { siteId: null, resolved: true };
  });

  it('loads all-site workspaces when the resolved scope is all sites', async () => {
    siteContext.value = { siteId: '', resolved: true };
    render(<DashboardPage />);
    await waitFor(() => expect(mocks.getDashboardWorkspaces).toHaveBeenCalledWith(undefined));
    siteContext.value = { siteId: null, resolved: true };
  });
});

describe('DashboardPage accessibility and layout editor fixes', () => {
  it('names the service score ring as an image with the operational count', async () => {
    mocks.operational = { ...baseOperational, services: [{ key: 'a', state: 'OPERATIONAL' }, { key: 'b', state: 'OPERATIONAL' }, { key: 'c', state: 'DOWN' }] };
    render(<DashboardPage />);
    expect(await screen.findByRole('img', { name: '2 de 3 serviços operacionais (67%)' })).toHaveClass('score-ring');
  });

  it('does not announce the whole activity list as a live region', async () => {
    render(<DashboardPage />);
    expect(await screen.findByRole('region', { name: 'dashboard.activityList' })).not.toHaveAttribute('aria-live');
  });

  it('links "Ver auditoria" straight to the audit page for roles that can view it', async () => {
    mocks.role = 'AUDITOR';
    render(<DashboardPage />);
    expect(await screen.findByRole('link', { name: /Ver auditoria/ })).toHaveAttribute('href', '/auditoria');
    expect(screen.queryByRole('button', { name: /Ver auditoria/ })).not.toBeInTheDocument();
  });

  it('Cancel in the layout editor restores the previous layout without saving', async () => {
    mocks.role = 'ADMIN';
    mocks.saveDashboardLayout.mockReset();
    mocks.getDashboardLayout.mockResolvedValue({ siteId: 'site-1', role: 'ADMIN', revision: 1, widgets: [{ id: 'quick-actions', x: 0, y: 0, w: 6, h: 4, visible: true }] });
    render(<DashboardPage />);
    expect(await screen.findByRole('heading', { name: 'Acesso rápido' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('button', { name: 'dashboard.editLayout' }));
    fireEvent.click(await screen.findByRole('checkbox', { name: /Acesso rápido/ }));
    expect(screen.queryByRole('heading', { name: 'Acesso rápido' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Cancelar' }));
    expect(screen.queryByRole('heading', { name: 'Widgets do dashboard' })).not.toBeInTheDocument();
    expect(screen.getByRole('heading', { name: 'Acesso rápido' })).toBeInTheDocument();
    expect(mocks.saveDashboardLayout).not.toHaveBeenCalled();
  });
});
