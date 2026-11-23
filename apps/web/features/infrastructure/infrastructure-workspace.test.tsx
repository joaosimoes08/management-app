import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureWorkspace } from './infrastructure-workspace';

const queryKeys: unknown[][] = [];
const auth = vi.hoisted(() => ({ hasRole: vi.fn<(role: string) => boolean>(() => false) }));
const completeRegistry = { tabs: [], configs: [{ key: 'power', kind: 'FEATURE', tab: 'energia', fields: ['power', 'powerPlugCount'], label: 'Tomadas de energia', missingMessage: '…' }] };
let registry: { tabs: unknown[]; configs?: typeof completeRegistry.configs } = completeRegistry;
vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => (queryKeys.push(queryKey), {
    data: queryKey[1] === 'device-required-configs' ? registry : queryKey[1] === 'effective'
      ? { tabs: {}, infrastructure: { site: ['READ'] } }
      : queryKey[1] === 'devices'
        ? { items: [] }
        : [],
    error: null,
    isFetching: false,
  }),
  // Filter chip counts: left unknown here (the chips show "…").
  useQueries: ({ queries }: { queries: unknown[] }) => queries.map(() => ({ data: undefined })),
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, hasRole: auth.hasRole }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children, moduleTabs, helpTopic }: { children: React.ReactNode; moduleTabs?: React.ReactNode; helpTopic?: string }) => <div data-testid="shell" data-help-topic={helpTopic}>{moduleTabs}{children}</div>,
}));
vi.mock('./components/rack/rack-workspace', () => ({ RackWorkspace: () => <div /> }));
vi.mock('./components/devices/deep-link-device-loader', () => ({ DeepLinkDeviceLoader: ({ deviceId }: { deviceId: string | null }) => (deviceId ? <span data-testid="deep-link">{deviceId}</span> : null) }));
vi.mock('./components/devices/device-list', () => ({ DeviceList: ({ filterChips }: { filterChips?: React.ReactNode }) => <div data-testid="site-device-list">{filterChips}</div> }));
vi.mock('./components/devices/cross-site-missing-config-list', () => ({ CrossSiteMissingConfigList: ({ config }: { config: string }) => <div data-testid="cross-site-list">{config}</div> }));
vi.mock('./components/devices/retirement-review-modal', () => ({ RetirementReviewModal: () => null }));
vi.mock('./components/models/model-list', () => ({ ModelList: () => null }));
vi.mock('./components/models/interface-workspace', () => ({ InterfaceWorkspace: () => null }));
vi.mock('./components/models/interface-editor', () => ({ InterfaceEditor: () => null }));
vi.mock('./components/models/port-layout-editor', () => ({ PortLayoutEditor: () => null }));
vi.mock('./components/assets/asset-list', () => ({ AssetList: () => null }));
vi.mock('./components/assets/asset-upload-modal', () => ({ AssetUploadModal: () => null }));
vi.mock('./components/editors/entity-editor', () => ({ EntityEditor: () => null }));
vi.mock('./components/sites/building-modal', () => ({ BuildingModal: () => null }));
vi.mock('./components/sites/room-modal', () => ({ RoomModal: () => null }));
vi.mock('./components/infrastructure-permissions', () => ({ InfrastructurePermissions: () => null }));
vi.mock('./components/lifecycle-dates', () => ({ LifecycleDates: () => null }));
vi.mock('./components/linux-hosts', () => ({ LinuxHosts: ({ canManage }: { canManage: boolean }) => <div data-testid="server-inventory">{canManage ? 'admin' : 'read-only'}</div> }));

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryKeys.length = 0;
  registry = completeRegistry;
  auth.hasRole.mockImplementation(() => false);
  window.history.replaceState({}, '', '/');
});

describe('InfrastructureWorkspace', () => {
  it('redirects the old Servidores tab to Equipamentos filtered to servers, keeping its host filters', () => {
    auth.hasRole.mockImplementation((role) => role === 'READ_ONLY');
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=hosts&hosts-state=STALE');
    render(<InfrastructureWorkspace />);
    expect(window.location.search).toBe('?siteId=site-1&tab=devices&hosts-state=STALE&type=SERVER');
    expect(screen.getByTestId('site-device-list')).toBeInTheDocument();
    expect(screen.getByTestId('server-inventory')).toHaveTextContent('read-only');
    expect(screen.getByRole('button', { name: 'Equipamentos' })).toHaveAttribute('aria-current', 'page');
    expect(screen.queryByRole('button', { name: 'linuxHosts.title' })).toBeNull();
    expect(within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', { name: /Servidores/ })).toHaveAttribute('aria-pressed', 'true');
    expect(screen.getByRole('status')).toHaveTextContent('Tipo: Servidores');
  });

  it('shows the Linux hosts panel only while the Tipo filter is Servidores', () => {
    auth.hasRole.mockImplementation((role) => role === 'READ_ONLY');
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=devices&type=SERVER&hosts-site=site-1');
    render(<InfrastructureWorkspace />);
    const type = screen.getByRole('group', { name: 'Tipo' });
    expect(screen.getByTestId('server-inventory')).toBeInTheDocument();
    fireEvent.click(within(type).getByRole('button', { name: /Switches/ }));
    expect(screen.queryByTestId('server-inventory')).toBeNull();
    const params = new URLSearchParams(window.location.search);
    expect(params.get('type')).toBe('SWITCH');
    expect(params.get('hosts-site')).toBeNull();
    fireEvent.click(within(screen.getByRole('group', { name: 'Tipo' })).getByRole('button', { name: /Servidores/ }));
    expect(screen.getByTestId('server-inventory')).toBeInTheDocument();
    expect(new URLSearchParams(window.location.search).get('type')).toBe('SERVER');
  });

  it('uses the filter key when the registry response omits configs', () => {
    registry = { tabs: [] };
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=devices&missingConfig=power');
    render(<InfrastructureWorkspace />);
    expect(screen.getByText(/Configuração em falta: power/)).toBeInTheDocument();
  });

  it('does not add a recent items panel to the regular workspace view', () => {
    render(<InfrastructureWorkspace />);
    expect(screen.queryByRole('heading', { name: 'Vistos recentemente' })).not.toBeInTheDocument();
  });

  it('?missingConfig= filters the device list through the API and shows a removable chip', () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=devices&missingConfig=power');
    render(<InfrastructureWorkspace />);
    expect(screen.getByText(/Configuração em falta: Tomadas de energia/)).toBeInTheDocument();
    expect(queryKeys.some((key) => key[1] === 'devices' && key[4] === 'power')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro de configuração em falta' }));
    expect(screen.queryByText(/Configuração em falta/)).not.toBeInTheDocument();
    expect(window.location.search).toBe('?siteId=site-1&tab=devices');
    expect(queryKeys.at(-1)).toBeDefined();
    expect(queryKeys.filter((key) => key[1] === 'devices').at(-1)?.[4]).toBe('');
  });

  it.each([
    ['allSites=1 (alert spanning several Sites)', '/infraestrutura?tab=devices&missingConfig=power&allSites=1'],
    ['an older alert link without siteId', '/infraestrutura?tab=devices&missingConfig=power'],
  ])('%s shows the cross-site list instead of narrowing to the active Site', (_label, url) => {
    window.history.replaceState({}, '', url);
    render(<InfrastructureWorkspace />);
    expect(screen.getByTestId('cross-site-list')).toHaveTextContent('power');
    expect(screen.queryByTestId('site-device-list')).not.toBeInTheDocument();
    expect(screen.getByText(/Configuração em falta: Tomadas de energia · todos os Sites/)).toBeInTheDocument();
    // The site-scoped device query is not filtered: the count comes from the cross-site endpoint only.
    expect(queryKeys.filter((key) => key[1] === 'devices').every((key) => key[4] === '')).toBe(true);
    fireEvent.click(screen.getByRole('button', { name: 'Remover filtro de configuração em falta' }));
    expect(screen.queryByTestId('cross-site-list')).not.toBeInTheDocument();
    expect(screen.getByTestId('site-device-list')).toBeInTheDocument();
    expect(window.location.search).toBe('?tab=devices&siteId=site-1');
  });

  it('the alert deep link ?tab=devices&deviceId=…&settingsTab=… loads that device for its settings', () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=devices&deviceId=dev-9&settingsTab=energia');
    render(<InfrastructureWorkspace />);
    expect(screen.getByTestId('deep-link')).toHaveTextContent('dev-9');
  });

  it('a plain ?deviceId= link (no settingsTab) does not open the settings', () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=devices&deviceId=dev-9');
    render(<InfrastructureWorkspace />);
    expect(screen.queryByTestId('deep-link')).not.toBeInTheDocument();
  });

  it('keeps every tab in ?tab= and names its Help topic, so returning from Help restores the tab (item 8)', () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1');
    render(<InfrastructureWorkspace />);
    fireEvent.click(screen.getByRole('button', { name: 'Ciclo de vida' }));
    expect(window.location.search).toBe('?siteId=site-1&tab=lifecycle');
    expect(screen.getByTestId('shell')).toHaveAttribute('data-help-topic', 'equipamentos');
    fireEvent.click(screen.getByRole('button', { name: 'Equipamentos' }));
    expect(window.location.search).toBe('?siteId=site-1&tab=devices');
    fireEvent.click(screen.getByRole('button', { name: 'Bastidores' }));
    expect(window.location.search).toBe('?siteId=site-1');
    cleanup();
    // Back from /ajuda remounts the page on the URL it left: the tab comes back from ?tab=.
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=lifecycle');
    render(<InfrastructureWorkspace />);
    expect(screen.getByRole('button', { name: 'Ciclo de vida' })).toHaveAttribute('aria-current', 'page');
  });

  it('points Help at Servidores Linux when Equipamentos is filtered to servers (and for old Servidores links)', () => {
    auth.hasRole.mockImplementation((role) => role === 'READ_ONLY');
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-1&tab=hosts');
    render(<InfrastructureWorkspace />);
    expect(screen.getByTestId('shell')).toHaveAttribute('data-help-topic', 'servidores');
  });
});
