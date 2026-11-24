import { StrictMode, useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureWorkspace } from './infrastructure-workspace';

/** D-P1b: the discovery "Promover a equipamento" link opens the create form prefilled, once, on a full page load. */
const site = { id: '', listeners: new Set<() => void>() };
const setSite = (id: string) => { site.id = id; site.listeners.forEach((listener) => listener()); };
vi.mock('@/lib/site-context', () => ({
  useSiteContext: () => ({ siteId: useSyncExternalStore((listener) => { site.listeners.add(listener); return () => site.listeners.delete(listener); }, () => site.id) }),
}));
const roles = vi.hoisted(() => ({ current: ['NETWORK_OPERATOR'] as string[] }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, hasRole: (role: string) => roles.current.includes(role) }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('./components/rack/rack-workspace', () => ({ RackWorkspace: () => null }));
vi.mock('./components/devices/device-list', () => ({ DeviceList: () => <div data-testid="device-list" /> }));
vi.mock('./components/editors/entity-editor', () => ({
  EntityEditor: ({ modal, form }: { modal: string; form: { device: { name: string; managementIp: string; modelId: string; serialNumber?: string } } }) => (modal === 'device'
    ? <div role="dialog" aria-label="Gerir equipamento">{`${form.device.name}|${form.device.managementIp}|${form.device.modelId}|${form.device.serialNumber ?? ''}`}</div>
    : null),
}));

const access = vi.hoisted(() => ({ site: ['READ', 'UPDATE'] as string[] }));
const pending: Array<() => void> = [];
const apiFetch = vi.fn((path: string) => new Promise((resolve) => {
  pending.push(() => {
    if (path.startsWith('/api/v1/devices?')) return resolve({ items: [], page: 1, pageSize: 100, total: 0, totalPages: 0 });
    if (path.includes('effective')) return resolve({ tabs: { models: true }, infrastructure: { site: access.site } });
    if (path.includes('vlans')) return resolve({ items: [] });
    if (path.includes('models')) return resolve([{ id: 'm1', manufacturer: 'Cisco', model: 'C9300-48P', type: 'SWITCH' }]);
    return resolve([]);
  });
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: (path: string) => apiFetch(path) }));

async function releaseAll() {
  for (let round = 0; round < 8; round += 1) {
    await act(async () => { pending.splice(0).forEach((answer) => answer()); await Promise.resolve(); });
  }
}
function mount() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(<StrictMode><QueryClientProvider client={client}><InfrastructureWorkspace /></QueryClientProvider></StrictMode>);
}

afterEach(() => { cleanup(); pending.length = 0; apiFetch.mockClear(); site.id = ''; roles.current = ['NETWORK_OPERATOR']; access.site = ['READ', 'UPDATE']; window.history.replaceState({}, '', '/'); });

describe('InfrastructureWorkspace discovery promotion link', () => {
  it('opens the new-device form prefilled and consumes the link', async () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-lx&tab=devices&promote=discovery&ip=10.0.0.5&name=sw-a&model=C9300-48P&serial=FOC1');
    mount();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    act(() => setSite('site-lx'));
    await releaseAll();
    expect(await screen.findByRole('dialog', { name: 'Gerir equipamento' })).toHaveTextContent('sw-a|10.0.0.5|m1|FOC1');
    expect(window.location.search).toBe('?siteId=site-lx&tab=devices');
  });

  it('does not open the form for a Site the user can only read', async () => {
    roles.current = ['READ_ONLY'];
    access.site = ['READ'];
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-lx&tab=devices&promote=discovery&ip=10.0.0.5');
    mount();
    act(() => setSite('site-lx'));
    await releaseAll();
    expect(screen.queryByRole('dialog', { name: 'Gerir equipamento' })).not.toBeInTheDocument();
    expect(await screen.findByText('discoveryPromote.forbidden')).toBeInTheDocument();
    expect(window.location.search).toBe('?siteId=site-lx&tab=devices');
  });
});
