import { cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureWorkspace } from './infrastructure-workspace';

vi.mock('@tanstack/react-query', () => ({
  useQuery: ({ queryKey }: { queryKey: string[] }) => ({
    data: queryKey[1] === 'effective'
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
vi.mock('./components/devices/deep-link-device-loader', () => ({ DeepLinkDeviceLoader: () => null }));
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
});

describe('InfrastructureWorkspace', () => {
  it('does not add a recent items panel to the regular workspace view', () => {
    render(<InfrastructureWorkspace />);
    expect(screen.queryByRole('heading', { name: 'Vistos recentemente' })).not.toBeInTheDocument();
  });
});
