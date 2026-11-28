import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { VrfsView } from './vrfs-view';
import { NatView } from './nat-view';
import { RipeView, ripeDiffDetail } from './ripe-view';
import { ApiRequestError, apiErrorMessage } from '@/lib/api/errors';
import { translateSourceText } from '@/lib/i18n/source-text-messages';
import type { NatRule, RipeDiffItem, RipeImportRecord, RipePreview, Subnet, Vrf, VrfDetail } from '../types';

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

/** Accepts the in-app confirm dialog that replaced window.confirm. */
async function acceptConfirm(label: string) {
  const dialog = await screen.findByRole('alertdialog');
  fireEvent.click(within(dialog).getByRole('button', { name: label }));
  return dialog;
}

beforeEach(() => {
  Object.values(api).forEach((mock) => mock.mockReset());
  api.listVrfs.mockResolvedValue([vrf, guestVrf]);
  api.listNatRules.mockResolvedValue([natRule]);
  api.listRipeImports.mockResolvedValue([]);
});
afterEach(() => { cleanup(); vi.restoreAllMocks(); });

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

  it('keeps the current subnet and VRF of a rule when they are not in the Site lists', async () => {
    const linked: NatRule = { ...natRule, id: 'nat-2', name: 'far-snat', sourceSubnetId: 'subnet-150', sourceSubnet: { id: 'subnet-150', cidr: '10.150.0.0/24' }, vrfId: 'vrf-9', vrf: { id: 'vrf-9', name: 'LEGACY' } };
    api.listNatRules.mockResolvedValue([linked]);
    api.updateNatRule.mockResolvedValue(linked);
    renderWithQuery(createElement(NatView, props()));
    fireEvent.click(await screen.findByRole('button', { name: 'Editar regra NAT far-snat' }));
    expect(screen.getByLabelText('Subnet interna')).toHaveValue('subnet-150');
    expect(within(screen.getByLabelText('Subnet interna')).getByRole('option', { name: '10.150.0.0/24' })).toBeInTheDocument();
    expect(screen.getByLabelText('VRF')).toHaveValue('vrf-9');
    fireEvent.click(screen.getByRole('button', { name: 'Guardar alterações' }));
    await waitFor(() => expect(api.updateNatRule).toHaveBeenCalledWith('nat-2', expect.objectContaining({ sourceSubnetId: 'subnet-150', vrfId: 'vrf-9' })));
  });

  it('hides write actions for read-only users', async () => {
    renderWithQuery(createElement(NatView, props({ canCreate: false, canUpdate: false, canDelete: false })));
    await screen.findByText('web-dnat');
    expect(screen.queryByRole('button', { name: /Nova regra NAT/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Eliminar regra NAT web-dnat' })).not.toBeInTheDocument();
  });
});

const diffItem = (prefix: string, overrides: Partial<RipeDiffItem> = {}): RipeDiffItem => ({ prefix, input: prefix, version: 4, status: 'new', reason: 'NEW', message: 'Prefixo novo.', importable: true, ...overrides });
const ripePreview = (overrides: Partial<RipePreview> = {}): RipePreview => {
  const diff = overrides.diff ?? [
    diffItem('192.0.2.0/24'),
    diffItem('10.0.0.0/24', { status: 'exists', reason: 'EXISTS_SAME', importable: false, existing: { id: 'subnet-1', cidr: '10.0.0.0/24', siteId: 'site-1', vrfId: null, purpose: null, environment: null } }),
    diffItem('10.0.0.0/16', { status: 'conflict', reason: 'OVERLAP', importable: false, overlaps: [{ relation: 'contains', sameScope: true, subnet: { id: 'subnet-1', cidr: '10.0.0.0/24', siteId: 'site-1', vrfId: null, purpose: null, environment: null } }] }),
  ];
  const count = (status: string) => diff.filter((item) => item.status === status).length;
  return {
    id: 'imp-1', query: 'AS64500', queryType: 'asn', source: 'RIPESTAT', status: 'PREVIEW', prefixes: diff.map((item) => item.prefix),
    target: { siteId: 'site-1', vrfId: null, purpose: null, environment: null },
    summary: { total: diff.length, new: count('new'), changed: count('changed'), exists: count('exists'), conflict: count('conflict'), importable: diff.filter((item) => item.importable).length, invalid: overrides.invalid?.length ?? 0, duplicates: overrides.duplicates?.length ?? 0 },
    invalid: [], duplicates: [], ...overrides, diff,
  };
};

describe('RipeView', () => {
  const props = (overrides = {}) => ({ siteId: 'site-1', search: '', vlans: [], canPreview: true, canImport: true, ...callbacks(), ...overrides });

  it('sends the Site to RIPEstat, renders the server diff and imports only importable prefixes', async () => {
    api.previewRipe.mockResolvedValue(ripePreview());
    api.importRipe.mockResolvedValue({ status: 'IMPORTED', created: [{ id: 'new', cidr: '192.0.2.0/24', version: 4 }], skipped: [] });
    const view = props();
    renderWithQuery(createElement(RipeView, view));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: 'AS64500' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));

    expect(await screen.findByText('1 importáveis')).toBeInTheDocument();
    expect(api.previewRipe).toHaveBeenCalledWith({ siteId: 'site-1', query: 'AS64500' });
    expect(screen.getByText('1 novos · 0 alterados · 1 já existem · 1 em conflito')).toBeInTheDocument();
    expect(screen.getByLabelText('Importar 10.0.0.0/24')).toBeDisabled();
    expect(screen.getByLabelText('Importar 10.0.0.0/16')).toBeDisabled();
    expect(screen.getByText('Contém 10.0.0.0/24')).toBeInTheDocument();

    fireEvent.change(screen.getByLabelText('Finalidade'), { target: { value: 'Public' } });
    fireEvent.click(screen.getByRole('button', { name: /Importar 1 prefixo/ }));
    const dialog = await screen.findByRole('alertdialog', { name: 'Importar prefixos RIPE' });
    expect(dialog).toHaveTextContent('Importar 1 prefixo(s) como subnets deste Site?');
    expect(api.importRipe).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Importar' }));
    await waitFor(() => expect(api.importRipe).toHaveBeenCalledWith({ importId: 'imp-1', prefixes: ['192.0.2.0/24'], siteId: 'site-1', vrfId: undefined, vlanId: undefined, purpose: 'Public', environment: undefined }));
    expect(view.success).toHaveBeenCalledWith('Importação RIPE', '1 subnet(s) criada(s).');
  });

  it('shows a CIDR that exists in another Site as a conflict without revealing a hidden subnet', async () => {
    api.previewRipe.mockResolvedValue(ripePreview({ diff: [diffItem('10.250.2.0/24', { status: 'conflict', reason: 'EXISTS_OUTSIDE_SITE', importable: false, existing: { id: null, cidr: null, hidden: true } })] }));
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: '10.250.2.0/24' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    const row = (await screen.findByText('10.250.2.0/24', { selector: 'td' })).closest('tr')!;
    expect(within(row).getByText('Conflito')).toBeInTheDocument();
    expect(within(row).getByText('Já existe noutro Site ou sem Site; os CIDR são únicos na aplicação.')).toBeInTheDocument();
    expect(within(row).getByText('Subnet existente: uma subnet sem acesso de leitura')).toBeInTheDocument();
    expect(within(row).getByRole('checkbox')).toBeDisabled();
    expect(screen.getByRole('button', { name: /Importar 0 prefixo/ })).toBeDisabled();
  });

  it('previews a pasted list and an uploaded file, with invalid and duplicate entries, then imports normalised prefixes', async () => {
    api.previewRipe.mockResolvedValue(ripePreview({
      id: 'imp-2', query: 'Ficheiro prefixos.txt', queryType: 'paste', source: 'PASTE', target: { siteId: 'site-1', vrfId: 'vrf-1', purpose: null, environment: null },
      diff: [diffItem('10.251.20.0/24', { input: '10.251.20.1/24' }), diffItem('2001:db8:251::/48', { version: 6 }), diffItem('10.251.2.0/24', { status: 'changed', reason: 'EXISTS_DIFFERENT_ATTRIBUTES', importable: false, changes: [{ field: 'vrfId', current: 'vrf-2', proposed: 'vrf-1' }] })],
      invalid: [{ input: 'nope', reason: 'INVALID_CIDR', message: 'x' }], duplicates: ['10.251.20.0/24'],
    }));
    api.importRipe.mockResolvedValue({ status: 'IMPORTED', created: [{ id: 'a' }, { id: 'b' }], skipped: [] });
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.click(screen.getByRole('button', { name: /Colar ou carregar lista/ }));
    const dialog = await screen.findByRole('dialog');
    await within(dialog).findByRole('option', { name: 'CORE' });
    fireEvent.change(within(dialog).getByLabelText(/VRF de destino/), { target: { value: 'vrf-1' } });
    fireEvent.change(within(dialog).getByLabelText(/Prefixos/), { target: { value: 'typed' } });
    const file = new File(['10.251.20.1/24\n2001:db8:251::/48, nope\n10.251.2.0/24'], 'prefixos.txt', { type: 'text/plain' });
    fireEvent.change(within(dialog).getByLabelText(/Ficheiro/), { target: { files: [file] } });
    expect(await within(dialog).findByText('Carregado: prefixos.txt')).toBeInTheDocument();
    expect(within(dialog).getByLabelText(/Prefixos/)).toHaveValue('10.251.20.1/24\n2001:db8:251::/48, nope\n10.251.2.0/24');
    fireEvent.click(within(dialog).getByRole('button', { name: /Pré-visualizar/ }));

    await waitFor(() => expect(api.previewRipe).toHaveBeenCalledWith({ siteId: 'site-1', vrfId: 'vrf-1', prefixes: ['10.251.20.1/24\n2001:db8:251::/48, nope\n10.251.2.0/24'], query: 'Ficheiro prefixos.txt' }));
    expect(await screen.findByText('2 importáveis')).toBeInTheDocument();
    expect(screen.queryByRole('dialog')).not.toBeInTheDocument();
    expect(screen.getByText('Introduzido: 10.251.20.1/24')).toBeInTheDocument();
    expect(screen.getByText('VRF: GUEST → CORE')).toBeInTheDocument();
    expect(screen.getByText('Inválido')).toBeInTheDocument();
    expect(screen.getByText('Duplicados ignorados: 10.251.20.0/24')).toBeInTheDocument();
    expect(screen.getByLabelText('Importar 10.251.2.0/24')).toBeDisabled();

    fireEvent.click(screen.getByRole('button', { name: /Importar 2 prefixo/ }));
    await acceptConfirm('Importar');
    await waitFor(() => expect(api.importRipe).toHaveBeenCalledWith(expect.objectContaining({ importId: 'imp-2', prefixes: ['10.251.20.0/24', '2001:db8:251::/48'], siteId: 'site-1', vrfId: 'vrf-1' })));
  });

  it('asks to preview again when the target VRF changes after a preview', async () => {
    api.previewRipe.mockResolvedValue(ripePreview());
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: 'AS64500' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    await screen.findByText('1 importáveis');
    await screen.findByRole('option', { name: 'CORE' });
    fireEvent.change(screen.getByLabelText(/VRF de destino/), { target: { value: 'vrf-1' } });
    expect(screen.getByText(/O Site ou o VRF de destino mudou depois da pré-visualização/)).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Importar 1 prefixo/ })).not.toBeInTheDocument();
    expect(api.importRipe).not.toHaveBeenCalled();
  });

  it('explains 400 errors for pasted lists inside the modal', async () => {
    api.previewRipe.mockRejectedValue(new ApiRequestError(apiErrorMessage({ code: 'RIPE_PASTE_TOO_MANY', message: 'No máximo 500 prefixos' }, 'pt-PT'), 400, { code: 'RIPE_PASTE_TOO_MANY' }));
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.click(screen.getByRole('button', { name: /Colar ou carregar lista/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Prefixos/), { target: { value: '10.0.0.0/24' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Pré-visualizar/ }));
    expect(await within(dialog).findByRole('alert')).toHaveTextContent('o máximo é 500 por pré-visualização');
  });

  it('drops a stale preview when the import answers RIPE_PREVIEW_TARGET_MISMATCH', async () => {
    api.previewRipe.mockResolvedValue(ripePreview());
    api.importRipe.mockRejectedValue(new ApiRequestError(apiErrorMessage({ code: 'RIPE_PREVIEW_TARGET_MISMATCH' }, 'pt-PT'), 400, { code: 'RIPE_PREVIEW_TARGET_MISMATCH' }));
    const view = props();
    renderWithQuery(createElement(RipeView, view));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: 'AS64500' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    fireEvent.click(await screen.findByRole('button', { name: /Importar 1 prefixo/ }));
    await acceptConfirm('Importar');
    expect(await screen.findByRole('alert')).toHaveTextContent('Pré-visualiza novamente antes de importar');
    expect(screen.queryByText('1 importáveis')).not.toBeInTheDocument();
    expect(view.toastError).toHaveBeenCalledWith('Importação RIPE', expect.stringContaining('O Site ou VRF mudou'));
  });

  it('translates the RIPE paste error codes in Portuguese and English', () => {
    for (const code of ['RIPE_PASTE_NO_VALID_PREFIX', 'RIPE_PASTE_TOO_MANY', 'RIPE_PREVIEW_TARGET_MISMATCH']) {
      const pt = apiErrorMessage({ code, message: 'raw' }, 'pt-PT');
      const en = apiErrorMessage({ code, message: 'raw' }, 'en-US');
      expect(pt).not.toBe('raw');
      expect(en).not.toBe('raw');
      expect(en).not.toBe(pt);
    }
    expect(apiErrorMessage({ code: 'RIPE_PASTE_NO_VALID_PREFIX' }, 'en-US')).toContain('no valid prefix');
  });

  it('describes changes and overlaps of a diff row', () => {
    const lines = ripeDiffDetail(diffItem('10.0.0.0/24', { status: 'changed', reason: 'EXISTS_DIFFERENT_ATTRIBUTES', importable: false, existing: { id: 's', cidr: '10.0.0.0/24', siteId: 'site-1', vrfId: 'vrf-1', purpose: 'Users', environment: null }, changes: [{ field: 'purpose', current: 'Users', proposed: 'Public' }, { field: 'vrfId', current: 'vrf-1', proposed: null }] }), [vrf]);
    expect(lines).toEqual(['Subnet existente: 10.0.0.0/24', 'Finalidade: Users → Public', 'VRF: CORE → sem VRF']);
  });

  it('renders an overlap inside the same paste: the first prefix is new and importable, the later one is a conflict', async () => {
    api.previewRipe.mockResolvedValue(ripePreview({
      id: 'imp-3', query: 'Lista colada (2 prefixos)', queryType: 'paste', source: 'PASTE',
      diff: [
        diffItem('10.9.0.0/16'),
        diffItem('10.9.1.0/24', { status: 'conflict', reason: 'OVERLAP', importable: false, message: 'Sobrepõe outro prefixo desta lista.', overlaps: [{ source: 'paste', relation: 'within', sameScope: true, prefix: '10.9.0.0/16' }] }),
      ],
    }));
    api.importRipe.mockResolvedValue({ status: 'IMPORTED', created: [{ id: 'a' }], skipped: [] });
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.click(screen.getByRole('button', { name: /Colar ou carregar lista/ }));
    const dialog = await screen.findByRole('dialog');
    fireEvent.change(within(dialog).getByLabelText(/Prefixos/), { target: { value: '10.9.0.0/16\n10.9.1.0/24' } });
    fireEvent.click(within(dialog).getByRole('button', { name: /Pré-visualizar/ }));

    expect(await screen.findByText('1 importáveis')).toBeInTheDocument();
    const first = screen.getByText('10.9.0.0/16', { selector: 'td' }).closest('tr')!;
    expect(within(first).getByText('Novo')).toBeInTheDocument();
    expect(within(first).getByRole('checkbox')).toBeEnabled();
    const second = screen.getByText('10.9.1.0/24', { selector: 'td' }).closest('tr')!;
    expect(within(second).getByText('Conflito')).toBeInTheDocument();
    expect(within(second).getByRole('checkbox')).toBeDisabled();
    expect(within(second).getByText('Sobrepõe-se a 10.9.0.0/16 (nesta lista)')).toBeInTheDocument();
    expect(within(second).getByText('Sobrepõe um prefixo anterior desta lista no mesmo Site/VRF; só o primeiro é importado.')).toBeInTheDocument();
    expect(within(second).queryByText(/sem acesso de leitura/)).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: /Importar 1 prefixo/ }));
    await acceptConfirm('Importar');
    await waitFor(() => expect(api.importRipe).toHaveBeenCalledWith(expect.objectContaining({ importId: 'imp-3', prefixes: ['10.9.0.0/16'] })));
    expect(translateSourceText('en-US', 'Sobrepõe-se a 10.9.0.0/16 (nesta lista)')).toBe('Overlaps 10.9.0.0/16 (in this list)');
    expect(translateSourceText('en-US', 'Sobrepõe um prefixo anterior desta lista no mesmo Site/VRF; só o primeiro é importado.')).toBe('Overlaps an earlier prefix of this list in the same Site/VRF; only the first one is imported.');
  });

  it('renders a changed row for a hidden subnet that has no changes array', async () => {
    api.previewRipe.mockResolvedValue(ripePreview({ diff: [
      diffItem('10.77.0.0/24', { status: 'changed', reason: 'EXISTS_DIFFERENT_ATTRIBUTES', importable: false, existing: { id: null, cidr: null, hidden: true } }),
      diffItem('10.78.0.0/16', { status: 'conflict', reason: 'OVERLAP', importable: false, overlaps: [{ relation: 'contains', sameScope: true, subnet: { id: null, cidr: null, hidden: true } }] }),
    ] }));
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: '10.77.0.0/24' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    const row = (await screen.findByText('10.77.0.0/24', { selector: 'td' })).closest('tr')!;
    expect(within(row).getByText('Alterado')).toBeInTheDocument();
    expect(within(row).getByRole('checkbox')).toBeDisabled();
    expect(within(row).getByText('Subnet existente: uma subnet sem acesso de leitura')).toBeInTheDocument();
    expect(within(row).getByText('Os valores atuais estão ocultos: sem acesso de leitura a esta subnet.')).toBeInTheDocument();
    const overlapRow = screen.getByText('10.78.0.0/16', { selector: 'td' }).closest('tr')!;
    expect(within(overlapRow).getByText('Contém uma subnet sem acesso de leitura')).toBeInTheDocument();
    expect(ripeDiffDetail(diffItem('10.77.0.0/24', { status: 'changed', reason: 'EXISTS_DIFFERENT_ATTRIBUTES', importable: false, existing: { id: null, cidr: null, hidden: true } }))).toEqual(['Subnet existente: uma subnet sem acesso de leitura', 'Os valores atuais estão ocultos: sem acesso de leitura a esta subnet.']);
    expect(translateSourceText('en-US', 'Contém uma subnet sem acesso de leitura')).toBe('Contains a subnet you cannot read');
    expect(translateSourceText('en-US', 'Os valores atuais estão ocultos: sem acesso de leitura a esta subnet.')).toBe('The current values are hidden: you cannot read this subnet.');
  });

  it('shows the error returned by a RIPEstat lookup', async () => {
    api.previewRipe.mockRejectedValue(new Error('Consulta RIPE falhou: RIPEstat respondeu 503'));
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.change(screen.getByLabelText('Consulta RIPEstat'), { target: { value: 'AS1' } });
    fireEvent.click(screen.getByRole('button', { name: /Pré-visualizar/ }));
    expect(await screen.findByRole('alert')).toHaveTextContent('RIPEstat respondeu 503');
  });

  it('opens import history detail with skipped reasons and the stored diff', async () => {
    const record: RipeImportRecord = { id: 'imp-9', query: 'AS3243', queryType: 'asn', source: 'RIPESTAT', status: 'PARTIAL', createdAt: '2026-11-20T10:00:00Z', result: { prefixes: ['192.0.2.0/24', '198.51.100.0/24'], selected: ['192.0.2.0/24', '198.51.100.0/24'], created: ['s1'], skipped: [{ cidr: '198.51.100.0/24', reason: 'A subnet sobrepõe uma subnet existente no mesmo Site/VRF' }], diff: [diffItem('192.0.2.0/24'), diffItem('198.51.100.0/24')] } };
    api.listRipeImports.mockResolvedValue([record]);
    api.getRipeImport.mockResolvedValue(record);
    renderWithQuery(createElement(RipeView, props()));
    fireEvent.click(await screen.findByRole('button', { name: 'Ver importação AS3243' }));
    const panel = await screen.findByRole('complementary', { name: 'Detalhe da importação RIPE' });
    expect(await within(panel).findByText('A subnet sobrepõe uma subnet existente no mesmo Site/VRF')).toBeInTheDocument();
    expect(within(panel).getAllByText('Novo')).toHaveLength(2);
  });

  it('shows a role notice and calls nothing for users without ADMIN / NETWORK_OPERATOR', () => {
    renderWithQuery(createElement(RipeView, props({ canPreview: false, canImport: false })));
    expect(screen.getByText('A pré-visualização e importação RIPE estão disponíveis apenas para ADMIN e NETWORK_OPERATOR.')).toBeInTheDocument();
    expect(api.listRipeImports).not.toHaveBeenCalled();
    expect(api.listVrfs).not.toHaveBeenCalled();
  });
});

describe('shared DataTable markup (VRFs, NAT, RIPE history)', () => {
  const base = { siteId: 'site-1', siteName: 'Lisboa', search: '', vlans: [], canCreate: true, canUpdate: true, canDelete: true, canPreview: true, canImport: true, openSubnet: vi.fn(), success: vi.fn(), toastError: vi.fn() };
  const cases = [
    { name: 'VRFs', view: VrfsView, region: 'VRFs do Site', list: api.listVrfs, headers: ['Nome', 'Route distinguisher', 'Site', 'Subnets', 'Regras NAT', 'Estado', 'Ações'], empty: 'Este Site ainda não tem VRFs' },
    { name: 'NAT', view: NatView, region: 'Regras NAT do Site', list: api.listNatRules, headers: ['Nome', 'Tipo', 'Interno ↔ Externo', 'Protocolo', 'VRF', 'Site', 'Estado', 'Ações'], empty: 'Este Site ainda não tem regras NAT' },
    { name: 'RIPE history', view: RipeView, region: 'Histórico de importações RIPE', list: api.listRipeImports, headers: ['Data', 'Consulta', 'Tipo', 'Estado', 'Prefixos', 'Criadas / ignoradas', 'Ações'], empty: 'Ainda não existem importações RIPE' },
  ] as const;

  for (const item of cases) {
    it(`${item.name}: keeps the headers and the three skeleton rows, then the empty state`, async () => {
      let resolve: (value: unknown[]) => void = () => {};
      item.list.mockReturnValue(new Promise((done) => { resolve = done; }));
      renderWithQuery(createElement(item.view as never, base as never));
      const region = screen.getByRole('region', { name: item.region });
      expect(region).toHaveClass('ip-table-wrap');
      expect(region).toHaveAttribute('aria-busy', 'true');
      expect(within(region).getAllByRole('columnheader').map((cell) => cell.textContent)).toEqual(item.headers);
      const skeletons = region.querySelectorAll('tr.ip-table-skeleton-row');
      expect(skeletons).toHaveLength(3);
      expect(skeletons[0].querySelector('td')).toHaveAttribute('colspan', String(item.headers.length));
      resolve([]);
      expect(await screen.findByText(item.empty)).toBeInTheDocument();
      expect(region).toHaveAttribute('aria-busy', 'false');
      expect(region.querySelectorAll('tbody tr')).toHaveLength(0);
    });

    it(`${item.name}: shows the API error without the empty state`, async () => {
      item.list.mockRejectedValue(new Error('Falha na API'));
      renderWithQuery(createElement(item.view as never, base as never));
      expect(await screen.findByText('Falha na API')).toBeInTheDocument();
      expect(screen.queryByText(item.empty)).not.toBeInTheDocument();
    });
  }
});
