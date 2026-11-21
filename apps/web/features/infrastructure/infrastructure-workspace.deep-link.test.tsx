import { StrictMode, useSyncExternalStore } from 'react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, cleanup, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { InfrastructureWorkspace } from './infrastructure-workspace';

/**
 * Real load order of a bell / cross-site deep link on a full page load: the Site context starts empty and resolves after
 * mount, every query (devices, locations, racks, the device itself) resolves later from the API, nothing is pre-seeded,
 * and the tree runs under StrictMode like `next dev`. Only the editor itself is stubbed.
 */
const site = { id: '', listeners: new Set<() => void>() };
const setSite = (id: string) => { site.id = id; site.listeners.forEach((listener) => listener()); };
vi.mock('@/lib/site-context', () => ({
  useSiteContext: () => ({ siteId: useSyncExternalStore((listener) => { site.listeners.add(listener); return () => site.listeners.delete(listener); }, () => site.id) }),
}));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { id: 'user-1' }, hasRole: () => true }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <div>{children}</div> }));
vi.mock('./components/rack/rack-workspace', () => ({ RackWorkspace: () => null }));
vi.mock('./components/devices/device-list', () => ({ DeviceList: () => <div data-testid="device-list" /> }));
vi.mock('./components/editors/entity-editor', () => ({
  EntityEditor: ({ modal, deviceTab, form }: { modal: string; deviceTab?: string; form: { device: { name: string } } }) => (modal === 'device' ? <div role="dialog" aria-label="Gerir equipamento" data-tab={deviceTab}>{form.device.name}</div> : null),
}));

const device = { id: 'dev-9', name: 'UCS01', type: 'SERVER', status: 'ACTIVE', siteId: 'site-lx', rackId: 'rack-1', rackUnitStart: 10, rackUnitSize: 1, requiredConfig: { missing: ['power'], missingTabs: ['energia'], complete: false } };
const pending: Array<() => void> = [];
/** Every API answer waits until the test releases it, so nothing is available on the first render. */
const apiFetch = vi.fn((path: string) => new Promise((resolve) => {
  pending.push(() => {
    if (path.startsWith('/api/v1/devices/dev-9')) return resolve(device);
    if (path.startsWith('/api/v1/devices/required-configs')) return resolve({ tabs: [], configs: [] });
    if (path.startsWith('/api/v1/devices?')) return resolve({ items: [device], page: 1, pageSize: 100, total: 1, totalPages: 1 });
    if (path.includes('/access/effective') || path.includes('effective')) return resolve({ tabs: {}, infrastructure: { site: ['READ', 'UPDATE'] } });
    if (path.includes('vlans')) return resolve({ items: [] });
    return resolve([]);
  });
}));
vi.mock('@/lib/api/client', () => ({ apiFetch: (path: string) => apiFetch(path) }));

async function releaseAll() {
  for (let round = 0; round < 6; round += 1) {
    await act(async () => { pending.splice(0).forEach((answer) => answer()); await Promise.resolve(); });
  }
}

afterEach(() => { cleanup(); pending.length = 0; apiFetch.mockClear(); site.id = ''; window.history.replaceState({}, '', '/'); });

describe('InfrastructureWorkspace deep link on a full page load', () => {
  it('opens "Gerir equipamento" on the settingsTab once the Site and the API resolve', async () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-lx&tab=devices&deviceId=dev-9&settingsTab=energia');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<StrictMode><QueryClientProvider client={client}><InfrastructureWorkspace /></QueryClientProvider></StrictMode>);
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();

    act(() => setSite('site-lx'));
    await releaseAll();

    const dialog = await screen.findByRole('dialog', { name: 'Gerir equipamento' });
    expect(dialog).toHaveTextContent('UCS01');
    expect(dialog).toHaveAttribute('data-tab', 'energia');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/devices/dev-9');
    // The link is consumed, so a reload does not reopen it.
    expect(window.location.search).toBe('?siteId=site-lx&tab=devices&deviceId=dev-9');
  });

  it('still opens when the active Site switches while the page loads (cross-site list row)', async () => {
    window.history.replaceState({}, '', '/infraestrutura?siteId=site-lx&tab=devices&deviceId=dev-9&settingsTab=energia');
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(<StrictMode><QueryClientProvider client={client}><InfrastructureWorkspace /></QueryClientProvider></StrictMode>);
    act(() => setSite('site-previous'));
    await act(async () => { await Promise.resolve(); });
    act(() => setSite('site-lx'));
    await releaseAll();
    expect(await screen.findByRole('dialog', { name: 'Gerir equipamento' })).toHaveAttribute('data-tab', 'energia');
    expect(window.location.search).toBe('?siteId=site-lx&tab=devices&deviceId=dev-9');
  });
});
