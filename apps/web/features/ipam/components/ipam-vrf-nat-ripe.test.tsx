import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VrfsView } from './vrfs-view';
import { NatView } from './nat-view';
import { RipeView, classifyRipePrefixes } from './ripe-view';
import { cidrsOverlap, sameCidr } from '../utils';
import type { NatRule, RipeImportRecord, Subnet, Vrf, VrfDetail } from '../types';

const api = vi.hoisted(() => ({
  listVrfs: vi.fn(), getVrf: vi.fn(), createVrf: vi.fn(), updateVrf: vi.fn(), deleteVrf: vi.fn(),
  listNatRules: vi.fn(), createNatRule: vi.fn(), updateNatRule: vi.fn(), deleteNatRule: vi.fn(),
  previewRipe: vi.fn(), importRipe: vi.fn(), listRipeImports: vi.fn(), getRipeImport: vi.fn(),
}));
vi.mock('../api', () => api);

const vrf: Vrf = { id: 'vrf-1', name: 'CORE', routeDistinguisher: '65000:100', description: 'Core routing', status: 'ACTIVE', siteId: 'site-1', _count: { subnets: 1, natRules: 2 } };
const guestVrf: Vrf = { id: 'vrf-2', name: 'GUEST', routeDistinguisher: null, status: 'INACTIVE', siteId: 'site-1', _count: { subnets: 0, natRules: 0 } };
const subnet: Subnet = { id: 'subnet-1', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1', vrfId: 'vrf-1' };
const natRule: NatRule = { id: 'nat-1', name: 'web-dnat', type: 'DNAT', protocol: 'TCP', sourceAddress: '10.0.0.10', sourcePort: 443, translatedAddress: '203.0.113.10', translatedPort: 8443, enabled: true, vrfId: 'vrf-1', vrf: { id: 'vrf-1', name: 'CORE' }, siteId: 'site-1' };

function renderWithQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(createElement(QueryClientProvider, { client }, element));
}

const callbacks = () => ({ success: vi.fn(), toastError: vi.fn() });

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listVrfs.mockResolvedValue([vrf, guestVrf]);
  api.listNatRules.mockResolvedValue([natRule]);
  api.listRipeImports.mockResolvedValue([]);
  vi.spyOn(window, 'confirm').mockReturnValue(true);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

describe('CIDR helpers used by the RIPE diff', () => {
  it('detects IPv4 and IPv6 overlaps and canonical equality', () => {
    expect(cidrsOverlap('10.0.0.0/16', '10.0.5.0/24')).toBe(true);
    expect(cidrsOverlap('10.0.0.0/24', '10.0.1.0/24')).toBe(false);
    expect(cidrsOverlap('2001:db8::/32', '2001:db8:1234::/48')).toBe(true);
    expect(cidrsOverlap('2001:db8::/32', '10.0.0.0/8')).toBe(false);
    expect(sameCidr('10.0.0.1/24', '10.0.0.0/24')).toBe(true);
  });

  it('classifies prefixes as new, existing or conflicting within the selected VRF', () => {
    const rows = classifyRipePrefixes(['10.0.0.0/24', '10.0.0.0/16', '192.0.2.0/24'], [subnet], 'vrf-1');
    expect(rows.map((row) => row.kind)).toEqual(['exists', 'conflict', 'new']);
    // Overlap in a different VRF is allowed by the API, so it is not a conflict.
    expect(classifyRipePrefixes(['10.0.0.0/16'], [subnet], '')[0].kind).toBe('new');
  });
});

describe('VrfsView', () => {
  const props = (overrides = {}) => ({ siteId: 'site-1', siteName: 'Lisboa', search: '', canCreate: true, canUpdate: true, canDelete: true, openSubnet: vi.fn(), ...callbacks(), ...overrides });

  it('lists VRFs with RD, site and linked subnet count, and filters by search', async () => {
    const { rerender } = renderWithQuery(createElement(VrfsView, props()));
    const row = (await screen.findByRole('button', { name: 'Ver subnets do VRF CORE' })).closest('tr')!;
    expect(within(row).getByText('65000:100')).toBeInTheDocument();
    expect(within(row).getByText('Lisboa')).toBeInTheDocument();
    expect(within(row).getByText('1')).toBeInTheDocument();
    rerender(createElement(QueryClientProvider, { client: new QueryClient() }, createElement(VrfsView, props({ search: '65000' }))));
    expect(await screen.findByText('CORE')).toBeInTheDocument();
    expect(screen.queryByText('GUEST')).not.toBeInTheDocument();
  });

  it('hides write actions for read-only users', async () => {
    renderWithQuery(createElement(VrfsView, props({ canCreate: false, canUpdate: false, canDelete: false })));
    await screen.findByText('CORE');
    expect(screen.queryByRole('button', { name: /Novo VRF/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Editar VRF CORE' })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar VRF CORE' })).not.toBeInTheDocument();
  });

  it('creates a VRF in the active Site and shows API errors inside the modal', async () => {
    api.createVrf.mockRejectedValueOnce(new Error('Já existe um VRF com este nome neste Site'));
    const view = props();
    renderWithQuery(createElement(VrfsView, view));
    fireEvent.click(await screen.findByRole('button', { name: /Novo VRF/ }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'DMZ' } });
    fireEvent.change(screen.getByLabelText(/Route distinguisher/), { target: { value: '65000:200' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar VRF' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Já existe um VRF com este nome neste Site');
    expect(api.createVrf).toHaveBeenCalledWith({ name: 'DMZ', siteId: 'site-1', status: 'ACTIVE', routeDistinguisher: '65000:200', description: undefined });
    expect(view.toastError).toHaveBeenCalledWith('Criar VRF', 'Já existe um VRF com este nome neste Site');
  });

  it('edits with the full body the API requires and null to clear optional fields', async () => {
    api.updateVrf.mockResolvedValue(vrf);
    renderWithQuery(createElement(VrfsView, props()));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar VRF CORE' }));
    fireEvent.change(screen.getByLabelText(/Route distinguisher/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    await waitFor(() => expect(api.updateVrf).toHaveBeenCalledWith('vrf-1', { name: 'CORE', siteId: 'site-1', status: 'ACTIVE', routeDistinguisher: null, description: 'Core routing' }));
  });

  it('drills down into the subnets of a VRF and opens a subnet', async () => {
    const detail: VrfDetail = { ...vrf, site: { id: 'site-1', name: 'Lisboa' } as VrfDetail['site'], subnets: [subnet], natRules: [] };
    api.getVrf.mockResolvedValue(detail);
    const view = props();
    renderWithQuery(createElement(VrfsView, view));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver subnets do VRF CORE' }));
    const panel = await screen.findByRole('complementary', { name: 'Subnets do VRF' });
    fireEvent.click(await within(panel).findByRole('button', { name: 'Abrir subnet 10.0.0.0/24' }));
    expect(view.openSubnet).toHaveBeenCalledWith('subnet-1');
  });
});

describe('NatView', () => {
  const props = (overrides = {}) => ({ siteId: 'site-1', siteName: 'Lisboa', search: '', subnets: [subnet], canCreate: true, canUpdate: true, canDelete: true, ...callbacks(), ...overrides });

  it('shows inside ↔ outside, type and VRF, and filters by type on the API', async () => {
    renderWithQuery(createElement(NatView, props()));
    expect(await screen.findByText('10.0.0.10:443 ↔ 203.0.113.10:8443')).toBeInTheDocument();
    expect(screen.getByText('DNAT (destino)', { selector: 'td' })).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Filtrar por tipo de NAT'), { target: { value: 'SNAT' } });
    await waitFor(() => expect(api.listNatRules).toHaveBeenLastCalledWith('site-1', { type: 'SNAT', vrfId: '' }));
  });

  it('surfaces API validation messages in the modal', async () => {
    api.createNatRule.mockRejectedValueOnce(new Error('sourcePort must not be greater than 65535'));
    renderWithQuery(createElement(NatView, props()));
    fireEvent.click(await screen.findByRole('button', { name: /Nova regra NAT/ }));
    fireEvent.change(screen.getByLabelText('Nome'), { target: { value: 'bad-port' } });
    fireEvent.change(screen.getByLabelText('Porta interna'), { target: { value: '70000' } });
    fireEvent.click(screen.getByRole('button', { name: 'Criar regra NAT' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('sourcePort must not be greater than 65535');
    expect(api.createNatRule).toHaveBeenCalledWith(expect.objectContaining({ name: 'bad-port', type: 'SNAT', siteId: 'site-1', sourcePort: 70000, enabled: true }));
  });

  it('edits with the full body and null for cleared fields', async () => {
    api.updateNatRule.mockResolvedValue(natRule);
    renderWithQuery(createElement(NatView, props()));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar regra NAT web-dnat' }));
    fireEvent.change(screen.getByLabelText('Porta externa'), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    await waitFor(() => expect(api.updateNatRule).toHaveBeenCalledWith('nat-1', expect.objectContaining({ name: 'web-dnat', type: 'DNAT', siteId: 'site-1', translatedPort: null, sourcePort: 443, vrfId: 'vrf-1' })));
  });

  it('hides write actions for read-only users', async () => {
    renderWithQuery(createElement(NatView, props({ canCreate: false, canUpdate: false, canDelete: false })));
    await screen.findByText('web-dnat');
    expect(screen.queryByRole('button', { name: /Nova regra NAT/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar regra NAT web-dnat' })).not.toBeInTheDocument();
  });
});

describe('RipeView', () => {
  const props = (overrides = {}) => ({ siteId: 'site-1', search: '', subnets: [subnet], vlans: [], canPreview: true, canImport: true, ...callbacks(), ...overrides });

  it('previews a query as a diff and imports only the new prefixes after confirmation', async () => {
    api.previewRipe.mockResolvedValue({ id: 'imp-1', query: 'AS64500', queryType: 'asn', prefixes: ['10.0.0.0/24', '10.0.0.0/16', '192.0.2.0/24'], status: 'PREVIEW' });
    api.importRipe.mockResolvedValue({ status: 'IMPORTED', created: [{ id: 'new', cidr: '192.0.2.0/24', version: 4 }], skipped: [] });
    const view = props();
    renderWithQuery(createElement(RipeView, view));
    fireEvent.change(screen.getByLabelText('Consulta'), { target: { value: 'AS64500' } });
    fireEvent.change(screen.getByLabelText(/VRF de destino/), { target: { value: '' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));

    expect(await screen.findByText('2 novos')).toBeInTheDocument();
    expect(screen.getByText('1 já existem · 0 em conflito')).toBeInTheDocument();
    expect(screen.getByLabelText('Importar 10.0.0.0/24')).toBeDisabled();

    fireEvent.click(screen.getByLabelText('Importar 10.0.0.0/16'));
    fireEvent.click(screen.getByRole('button', { name: /Importar 1 prefixo/ }));
    await waitFor(() => expect(api.importRipe).toHaveBeenCalledWith({ importId: 'imp-1', prefixes: ['192.0.2.0/24'], siteId: 'site-1', vrfId: undefined, vlanId: undefined, purpose: undefined, environment: undefined }));
    expect(window.confirm).toHaveBeenCalledWith('Importar 1 prefixo(s) como subnets deste Site?');
    expect(view.success).toHaveBeenCalledWith('Importação RIPE', '1 subnet(s) criada(s).');
  });

  it('shows the RIPE preview error returned by the API', async () => {
    api.previewRipe.mockRejectedValue(new Error('Consulta RIPE falhou: RIPEstat respondeu 503'));
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.change(screen.getByLabelText('Consulta'), { target: { value: 'AS1' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('RIPEstat respondeu 503');
  });

  it('opens import history detail with skipped reasons', async () => {
    const record: RipeImportRecord = { id: 'imp-9', query: 'AS3243', queryType: 'asn', source: 'RIPESTAT', status: 'PARTIAL', createdAt: '2026-11-20T10:00:00Z', result: { prefixes: ['192.0.2.0/24', '198.51.100.0/24'], selected: ['192.0.2.0/24', '198.51.100.0/24'], created: ['s1'], skipped: [{ cidr: '198.51.100.0/24', reason: 'A subnet sobrepõe uma subnet existente no mesmo Site/VRF' }] } };
    api.listRipeImports.mockResolvedValue([record]);
    api.getRipeImport.mockResolvedValue(record);
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver importação AS3243' }));
    const panel = await screen.findByRole('complementary', { name: 'Detalhe da importação RIPE' });
    expect(await within(panel).findByText('A subnet sobrepõe uma subnet existente no mesmo Site/VRF')).toBeInTheDocument();
  });

  it('shows a role notice and calls nothing for users without ADMIN / NETWORK_OPERATOR', () => {
    renderWithQuery(createElement(RipeView, props({ canPreview: false, canImport: false })));
    expect(screen.getByText('A pré-visualização e importação RIPE estão disponíveis apenas para ADMIN e NETWORK_OPERATOR.')).toBeInTheDocument();
    expect(api.listRipeImports).not.toHaveBeenCalled();
    expect(api.listVrfs).not.toHaveBeenCalled();
  });
});
