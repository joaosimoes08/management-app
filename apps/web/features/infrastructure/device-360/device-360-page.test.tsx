import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { entityHref } from '@/components/data-table/entity-link';
import { Device360Page } from './device-360-page';

vi.mock('@/components/layout/app-shell', () => ({ AppShell: ({ children }: { children: React.ReactNode }) => <>{children}</> }));
const roles = vi.hoisted(() => ({ current: ['ADMIN'] as string[] }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => roles.current.includes(role), user: { id: 'u1' } }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/runtime-config', () => ({ getPublicRuntimeConfig: () => ({ apiUrl: '' }) }));

const device = { id: 'd1', name: 'core-sw-01', type: 'SWITCH', status: 'ACTIVE', siteId: 's1', isCritical: false, rack: null, model: null };

function routeApi(overrides: Record<string, unknown> = {}, deviceBody: Record<string, unknown> = device) {
  vi.mocked(apiFetch).mockImplementation(async (url: string) => {
    for (const [prefix, body] of Object.entries(overrides)) if (url.startsWith(prefix)) return body;
    if (url === '/api/v1/devices/d1') return deviceBody;
    if (url.startsWith('/api/v1/interfaces')) return [];
    if (url.startsWith('/api/v1/snmp/devices/')) return { config: null, drifts: [], traps: [] };
    return { items: [] };
  });
}

const renderPage = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><Device360Page deviceId="d1" /></QueryClientProvider>);
const section = (name: string) => screen.getByRole('region', { name });

beforeEach(() => { roles.current = ['ADMIN']; vi.mocked(apiFetch).mockReset(); });
afterEach(cleanup);

describe('Device360Page', () => {
  it('remembers the device page in recently viewed items', async () => {
    window.localStorage.clear();
    routeApi();
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'core-sw-01' });
    const recent = JSON.parse(window.localStorage.getItem('management-app:recent-items:u1') ?? '[]');
    expect(recent[0]).toMatchObject({ id: 'device:d1', kind: 'Equipamento', label: 'core-sw-01', href: '/infraestrutura/equipamentos/d1?siteId=s1' });
  });

  it('shows an explicit empty state in every section, never a blank', async () => {
    routeApi();
    renderPage();
    expect(await screen.findByRole('heading', { level: 1, name: 'core-sw-01' })).toBeInTheDocument();
    expect(await within(section('Interfaces e IPs')).findByText('Sem interfaces registadas.')).toBeInTheDocument();
    expect(await within(section('Interfaces e IPs')).findByText('Sem IPs atribuídos.')).toBeInTheDocument();
    expect(await within(section('Ligações')).findByText('Sem ligações registadas.')).toBeInTheDocument();
    expect(within(section('Energia')).getByText('Sem tomadas de PDU ligadas.')).toBeInTheDocument();
    expect(await within(section('SNMP')).findByText('Sem SNMP configurado.')).toBeInTheDocument();
    expect(within(section('Host e serviços')).getByText(/Ainda não disponível/)).toBeInTheDocument();
    expect(await within(section('Ciclo de vida')).findByText('Sem datas de ciclo de vida.')).toBeInTheDocument();
    expect(within(section('Atestação')).getByText('Não é um ativo crítico.')).toBeInTheDocument();
    expect(await within(section('Alterações')).findByText('Sem alterações abertas ou agendadas.')).toBeInTheDocument();
    expect(await within(section('Histórico')).findByText('Sem eventos de auditoria.')).toBeInTheDocument();
    expect(screen.queryByTestId('tier-badge')).not.toBeInTheDocument();
  });

  it('links every section to its full page filtered to this device', async () => {
    routeApi();
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'core-sw-01' });
    expect(within(section('Interfaces e IPs')).getByRole('link', { name: /Ver no IPAM/ })).toHaveAttribute('href', '/ipam?siteId=s1&q=core-sw-01');
    expect(within(section('Ligações')).getByRole('link', { name: /Topologia/ })).toHaveAttribute('href', '/topology?siteId=s1&deviceId=d1');
    expect(within(section('SNMP')).getByRole('link', { name: /SNMP/ })).toHaveAttribute('href', '/snmp?deviceId=d1');
    expect(within(section('Histórico')).getByRole('link', { name: /Auditoria/ })).toHaveAttribute('href', '/auditoria?entityType=Device&entityId=d1&q=d1');
  });

  it('"Impacto" shows what goes down for this device and links the path view (Step 34)', async () => {
    routeApi({ '/api/v1/topology/impact': { origin: { kind: 'DEVICE', id: 'd1', name: 'core-sw-01' }, siteId: 's1', maxDepth: 12, includeLogical: false, truncated: true, anchorMode: 'explicit', anchorDeviceIds: ['fw'], down: [], affected: [], powerDegraded: [], hosts: [], applications: [], critical: { T1: [], T2: [], T3: [], untiered: [] }, counts: { down: 0, affected: 0, powerDegraded: 0, hosts: 0, services: 0, applications: 0, tier1: 0 }, hiddenCount: 0, elapsedMs: 1 } });
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'core-sw-01' });
    expect(screen.getByRole('link', { name: /Caminho até/ })).toHaveAttribute('href', '/topology?siteId=s1&pathFrom=d1');
    const button = screen.getByRole('button', { name: 'Impacto' });
    expect(button).toHaveAttribute('aria-expanded', 'false');
    fireEvent.click(button);
    expect(button).toHaveAttribute('aria-expanded', 'true');
    expect(await screen.findByTestId('impact-truncated')).toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => String(url))).toContain('/api/v1/topology/impact?deviceId=d1');
  });

  it('"Editar" opens today\'s edit form unchanged', async () => {
    routeApi();
    renderPage();
    expect(await screen.findByRole('link', { name: 'Editar' })).toHaveAttribute('href', '/infraestrutura?siteId=s1&tab=devices&deviceId=d1&focus=device');
  });

  it('hides sections and actions the role cannot access, without calling their endpoints', async () => {
    roles.current = ['READ_ONLY'];
    routeApi();
    renderPage();
    await screen.findByRole('heading', { level: 1, name: 'core-sw-01' });
    expect(screen.queryByRole('region', { name: 'Histórico' })).not.toBeInTheDocument();
    expect(screen.queryByRole('region', { name: 'Atestação' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: 'Editar' })).not.toBeInTheDocument();
    expect(screen.queryByRole('link', { name: /Criar alteração/ })).not.toBeInTheDocument();
    expect(section('SNMP')).toBeInTheDocument();
    const urls = vi.mocked(apiFetch).mock.calls.map(([url]) => String(url));
    expect(urls.some((url) => url.startsWith('/api/v1/audit'))).toBe(false);
    expect(urls.some((url) => url.startsWith('/api/v1/interfaces'))).toBe(false);
    expect(urls.some((url) => url.startsWith('/api/v1/critical-assets'))).toBe(false);
  });

  it('renders related data, the critical badge, and feature-detected tier and host once present', async () => {
    routeApi({
      '/api/v1/topology/connections': { items: [{ id: 'c1', type: 'PHYSICAL', sourceDeviceId: 'd1', targetDeviceId: 'd2', sourceDevice: device, targetDevice: { id: 'd2', name: 'fw-01' }, sourceInterface: { name: 'Gi1/0/1' } }, { id: 'c2', sourceDeviceId: 'x', targetDeviceId: 'y' }] },
      '/api/v1/change-plans': { items: [{ id: 'p1', title: 'Troca do core', status: 'APPROVED', plannedStartAt: '2026-12-01T10:00:00Z', items: [{ entityType: 'DEVICE', entityId: 'd1' }] }, { id: 'p2', title: 'Fechada', status: 'COMPLETED', plannedStartAt: '2026-10-01T10:00:00Z', items: [{ entityType: 'DEVICE', entityId: 'd1' }] }] },
    }, { ...device, isCritical: true, criticalityTier: 1, host: { id: 'h1', name: 'core', services: [{ id: 's1', name: 'ssh', port: 22 }] } });
    renderPage();
    expect(await screen.findByTestId('tier-badge')).toHaveTextContent('Tier 1');
    const link = await within(section('Ligações')).findByRole('link', { name: 'fw-01' });
    expect(link).toHaveAttribute('href', '/infraestrutura/equipamentos/d2?siteId=s1');
    expect(within(section('Ligações')).getAllByRole('listitem')).toHaveLength(1);
    expect(await within(section('Alterações')).findByText('Troca do core')).toBeInTheDocument();
    expect(within(section('Alterações')).queryByText('Fechada')).not.toBeInTheDocument();
    expect(within(section('Host e serviços')).getByText('ssh:22')).toBeInTheDocument();
  });

  it('shows a clear message instead of a blank page when the device cannot load', async () => {
    vi.mocked(apiFetch).mockRejectedValue(new Error('404'));
    renderPage();
    expect(await screen.findByRole('alert')).toHaveTextContent('Equipamento não encontrado');
  });

  it('EntityLink for a device points to the Device 360 page', () => {
    expect(entityHref({ kind: 'device', id: 'd1', siteId: 's1' })).toBe('/infraestrutura/equipamentos/d1?siteId=s1');
  });
});
