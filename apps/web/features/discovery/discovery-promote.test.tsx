import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import type { DiscoveryResult } from './api';
import { DiscoveryPromoteAction, discoveryPromoteHref, discoveryPromotion, findDeviceByManagementIp } from './discovery-promote';

const locale = vi.hoisted(() => ({ current: 'pt-PT' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/i18n')>('@/lib/i18n/i18n');
  return { ...real, useOptionalI18n: () => ({ locale: locale.current, t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage(locale.current, key, fallback, params) }) };
});
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const result = (extra: Partial<DiscoveryResult> & Record<string, unknown> = {}): DiscoveryResult => ({
  id: 'r1', address: '10.0.0.1', hostname: 'sw-core.lab.local', icmpReachable: true, responseMs: 2, openPorts: [161], status: 'APPROVED',
  ipam: { ipAddressId: 'ip-1', state: 'FREE' }, jobId: 'job-1', ...extra,
} as DiscoveryResult);
const snmpMeta = { credentialId: 'cred-1', observedAt: '2026-11-20T10:00:00.000Z', durationMs: 120 };
const withSnmp = (fields: Record<string, { value: string }>) => result({ snmp: { status: 'OK', ...snmpMeta, fields: Object.fromEntries(Object.entries(fields).map(([name, { value }]) => [name, { value, oid: '1.3.6.1', source: 'SNMP' as const, credentialId: 'cred-1', observedAt: snmpMeta.observedAt }])) } });

function renderAction(row: DiscoveryResult, roles: string[], navigate = vi.fn()) {
  const auth = { hasRole: (role: string) => roles.includes(role) } as unknown as AuthContextValue;
  render(<AuthContext.Provider value={auth}><DiscoveryPromoteAction result={row} navigate={navigate} /></AuthContext.Provider>);
  return navigate;
}

const answer = (devices: Array<{ id: string; name: string; managementIp: string | null }>) => mockedFetch.mockImplementation(async (path: string) => {
  if (path.startsWith('/api/v1/discovery/jobs/job-1')) return { subnet: { siteId: 'site-lx' } } as never;
  if (path.startsWith('/api/v1/devices?')) return { items: devices } as never;
  throw new Error(`unexpected ${path}`);
});

beforeEach(() => { mockedFetch.mockReset(); locale.current = 'pt-PT'; });
afterEach(cleanup);

describe('discovery promotion data', () => {
  it('prefills from the result, and from the SNMP fields when #179 sends them', () => {
    expect(discoveryPromotion(result())).toEqual({ ip: '10.0.0.1', hostname: 'sw-core.lab.local', name: 'sw-core', ipAddressId: 'ip-1', model: '', serial: '' });
    expect(discoveryPromotion(result({ hostname: null, ipam: null }))).toMatchObject({ name: '10.0.0.1', hostname: '', ipAddressId: '' });
    expect(discoveryPromotion(withSnmp({ sysName: { value: ' SW-CORE-01 ' }, entityModel: { value: 'C9300-48P' }, entitySerial: { value: 'FOC1234X' } })))
      .toMatchObject({ name: 'SW-CORE-01', model: 'C9300-48P', serial: 'FOC1234X' });
    // Partial or malformed enrichment is ignored, never thrown on.
    expect(discoveryPromotion(result({ snmp: { status: 'TIMEOUT', ...snmpMeta, fields: {} } }))).toMatchObject({ model: '', serial: '' });
    expect(discoveryPromotion(result({ snmp: null }))).toMatchObject({ model: '', serial: '' });
  });

  it('links to the device tab with only the filled keys', () => {
    const href = discoveryPromoteHref('site-lx', { ip: '10.0.0.1', hostname: '', name: 'sw', ipAddressId: '', model: 'C9300', serial: '' });
    expect(href.startsWith('/infraestrutura?')).toBe(true);
    const query = new URLSearchParams(href.split('?')[1]);
    expect(Object.fromEntries(query)).toEqual({ siteId: 'site-lx', tab: 'devices', promote: 'discovery', ip: '10.0.0.1', name: 'sw', model: 'C9300' });
  });

  it('matches an existing device on the exact management IP only', async () => {
    answer([{ id: 'd10', name: 'other', managementIp: '10.0.0.10' }, { id: 'd1', name: 'sw', managementIp: '10.0.0.1' }]);
    await expect(findDeviceByManagementIp('site-lx', '10.0.0.1')).resolves.toMatchObject({ id: 'd1' });
    answer([{ id: 'd10', name: 'other', managementIp: '10.0.0.10' }]);
    await expect(findDeviceByManagementIp('site-lx', '10.0.0.1')).resolves.toBeNull();
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/devices?siteId=site-lx&search=10.0.0.1&page=1&pageSize=100');
  });
});

describe('Promover a equipamento', () => {
  it('is only on approved rows, for roles that can create devices', () => {
    renderAction(result({ status: 'PENDING' }), ['ADMIN']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    cleanup();
    renderAction(result(), ['READ_ONLY']);
    expect(screen.queryByRole('button')).not.toBeInTheDocument();
    cleanup();
    for (const role of ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR']) {
      renderAction(result(), [role]);
      expect(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' })).toHaveTextContent('Promover a equipamento');
      cleanup();
    }
  });

  it('opens the prefilled create form when no device uses the address', async () => {
    answer([{ id: 'd10', name: 'other', managementIp: '10.0.0.10' }]);
    const navigate = renderAction(result(), ['NETWORK_OPERATOR']);
    fireEvent.click(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' }));
    await vi.waitFor(() => expect(navigate).toHaveBeenCalledTimes(1));
    expect(navigate).toHaveBeenCalledWith('/infraestrutura?siteId=site-lx&tab=devices&promote=discovery&ip=10.0.0.1&hostname=sw-core.lab.local&name=sw-core&ipAddressId=ip-1');
  });

  it('links to the existing device instead of creating a duplicate', async () => {
    answer([{ id: 'd1', name: 'SW-CORE', managementIp: '10.0.0.1' }]);
    const navigate = renderAction(result(), ['ADMIN']);
    fireEvent.click(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' }));
    const link = await screen.findByRole('link', { name: 'Abrir o equipamento SW-CORE (10.0.0.1)' });
    expect(link).toHaveAttribute('href', '/infraestrutura?siteId=site-lx&tab=devices&focus=device&deviceId=d1');
    expect(screen.getByRole('status')).toHaveTextContent('Já existe um equipamento com este IP de gestão: SW-CORE.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('opens an already linked device straight away', () => {
    renderAction(result({ deviceId: 'd7', device: { id: 'd7', name: 'fw-01', type: 'FIREWALL' } }), ['ADMIN']);
    expect(screen.getByRole('link', { name: 'Abrir o equipamento fw-01 (10.0.0.1)' })).toHaveAttribute('href', '/infraestrutura?tab=devices&focus=device&deviceId=d7');
    expect(mockedFetch).not.toHaveBeenCalled();
  });

  it('says so when the run has no Site, or the check fails', async () => {
    const navigate = renderAction(result({ jobId: undefined }), ['ADMIN']);
    fireEvent.click(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível saber o Site desta execução de discovery.');
    cleanup();
    mockedFetch.mockRejectedValue(new Error(''));
    renderAction(result(), ['ADMIN'], navigate);
    fireEvent.click(screen.getByRole('button', { name: 'Promover 10.0.0.1 a equipamento' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Não foi possível verificar os equipamentos existentes.');
    expect(navigate).not.toHaveBeenCalled();
  });

  it('speaks English in en-US', async () => {
    locale.current = 'en-US';
    answer([{ id: 'd1', name: 'SW-CORE', managementIp: '10.0.0.1' }]);
    renderAction(result(), ['ADMIN']);
    fireEvent.click(screen.getByRole('button', { name: 'Promote 10.0.0.1 to a device' }));
    expect(await screen.findByRole('link', { name: 'Open device SW-CORE (10.0.0.1)' })).toHaveTextContent('Open device');
    expect(screen.getByRole('status')).toHaveTextContent('A device with this management IP already exists: SW-CORE.');
  });
});
