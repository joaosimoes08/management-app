import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureWorkspace } from './infrastructure-workspace';

const queryKeys: unknown[][] = [];
const registry = { tabs: [], configs: [{ key: 'power', kind: 'FEATURE', tab: 'energia', fields: ['power', 'powerPlugCount'], label: 'Tomadas de energia', missingMessage: '…' }] };
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
  useQueryClient: () => ({ invalidateQueries: vi.fn(), setQueryData: vi.fn() }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, hasRole: () => false }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/components/layout/app-shell', () => ({
  AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div>,
}));
vi.mock('./components/rack/rack-workspace', () => ({ RackWorkspace: () => <div /> }));
vi.mock('./components/devices/deep-link-device-loader', () => ({ DeepLinkDeviceLoader: ({ deviceId }: { deviceId: string | null }) => (deviceId ? <span data-testid="deep-link">{deviceId}</span> : null) }));
vi.mock('./components/devices/device-list', () => ({ DeviceList: () => null }));
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

afterEach(() => {
  cleanup();
  window.localStorage.clear();
  queryKeys.length = 0;
  window.history.replaceState({}, '', '/');
});

describe('InfrastructureWorkspace', () => {
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
});
