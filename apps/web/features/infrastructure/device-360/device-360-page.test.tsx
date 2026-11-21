import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, render, screen, within } from '@testing-library/react';
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
    expect(await within(section('Host e serviços')).findByText('Sem host associado.')).toBeInTheDocument();
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
    expect(within(section('Host e serviços')).getByRole('link', { name: /Servidores/ })).toHaveAttribute('href', '/infraestrutura?tab=hosts&hosts-site=s1');
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

  it('renders related data, the tier badge, and the linked Linux host with its services', async () => {
    routeApi({
      '/api/v1/topology/connections': { items: [{ id: 'c1', type: 'PHYSICAL', sourceDeviceId: 'd1', targetDeviceId: 'd2', sourceDevice: device, targetDevice: { id: 'd2', name: 'fw-01' }, sourceInterface: { name: 'Gi1/0/1' } }, { id: 'c2', sourceDeviceId: 'x', targetDeviceId: 'y' }] },
      '/api/v1/change-plans': { items: [{ id: 'p1', title: 'Troca do core', status: 'APPROVED', plannedStartAt: '2026-12-01T10:00:00Z', items: [{ entityType: 'DEVICE', entityId: 'd1' }] }, { id: 'p2', title: 'Fechada', status: 'COMPLETED', plannedStartAt: '2026-10-01T10:00:00Z', items: [{ entityType: 'DEVICE', entityId: 'd1' }] }] },
      '/api/v1/linux-agents/hosts/h1/services': [{ id: 'sv1', name: 'ssh', protocol: 'tcp', port: 22, observedStatus: 'RUNNING' }],
      '/api/v1/linux-agents/hosts': { staleMinutes: 15, items: [{ id: 'h1', name: 'core-host', operatingSystem: 'Debian 12', device: { id: 'd1', name: 'core-sw-01', siteId: 's1' }, agent: { state: 'ONLINE' } }, { id: 'h2', name: 'other-host', device: { id: 'd9' } }] },
    }, { ...device, isCritical: true, criticalityTier: 'T1' });
    renderPage();
    expect(await screen.findByTestId('tier-badge')).toHaveTextContent('T1 · Vital');
    const link = await within(section('Ligações')).findByRole('link', { name: 'fw-01' });
    expect(link).toHaveAttribute('href', '/infraestrutura/equipamentos/d2?siteId=s1');
    expect(within(section('Ligações')).getAllByRole('listitem')).toHaveLength(1);
    expect(await within(section('Alterações')).findByText('Troca do core')).toBeInTheDocument();
    expect(within(section('Alterações')).queryByText('Fechada')).not.toBeInTheDocument();
    const host = section('Host e serviços');
    expect(await within(host).findByText('core-host')).toBeInTheDocument();
    expect(within(host).getByText('ssh:22 (tcp) · RUNNING')).toBeInTheDocument();
    expect(within(host).queryByText('other-host')).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.map(([url]) => String(url))).toContain('/api/v1/linux-agents/hosts?siteId=s1');
  });

  it('shows "Crítico" for a critical device without a tier, and no host section for roles without host access', async () => {
    roles.current = ['STORAGE_OPERATOR'];
    routeApi({}, { ...device, isCritical: true });
    renderPage();
    expect(await screen.findByTestId('tier-badge')).toHaveTextContent('Crítico');
    expect(screen.queryByRole('region', { name: 'Host e serviços' })).not.toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).startsWith('/api/v1/linux-agents'))).toBe(false);
  });

  it('never lists hosts across all Sites when the device has no Site', async () => {
    routeApi({}, { ...device, siteId: null });
    renderPage();
    expect(await within(await screen.findByRole('region', { name: 'Host e serviços' })).findByText('Sem host associado.')).toBeInTheDocument();
    expect(vi.mocked(apiFetch).mock.calls.some(([url]) => String(url).startsWith('/api/v1/linux-agents'))).toBe(false);
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
