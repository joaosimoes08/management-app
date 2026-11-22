import { act, cleanup, fireEvent, render as rtlRender, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import { SubnetPlanningView, plannedListRows, shortfallMessage, subnetOptionLabel } from './subnet-planning-view';

let client: QueryClient;
function render(element: ReactElement) {
  client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  const result = rtlRender(<QueryClientProvider client={client}>{element}</QueryClientProvider>);
  return { ...result, rerender: (next: ReactElement) => result.rerender(<QueryClientProvider client={client}>{next}</QueryClientProvider>) };
}
import type { Subnet } from '../types';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const parent: Subnet = { id: 'p1', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1' };
const basePlan = {
  subnet: parent, version: 4, network: '10.0.0.0', broadcast: '10.0.0.255', prefix: 24, size: 256,
  usableRange: { start: '10.0.0.1', end: '10.0.0.254' }, usableTotal: 254, unavailable: 33, free: 221, utilizationPercent: 12.99,
  usableGaps: [], unavailableAddresses: ['10.0.0.1'], scope: { vrfId: null, vrfName: null }, childSubnets: 1,
  addressSpace: { total: 256, taken: 33, reserved: 2, planned: 0, freeAfterPlan: 221 }, planned: [], shortfalls: [], segmentsTruncated: false,
  segments: [
    { status: 'RESERVED', start: '10.0.0.0', end: '10.0.0.0', count: 1, cidrs: [], label: 'Endereço de rede' },
    { status: 'TAKEN', start: '10.0.0.1', end: '10.0.0.1', count: 1, cidrs: ['10.0.0.1/32'], kinds: ['GATEWAY'], label: '10.0.0.1' },
    { status: 'FREE', start: '10.0.0.2', end: '10.0.0.31', count: 30, cidrs: ['10.0.0.2/31', '10.0.0.4/30'] },
    { status: 'TAKEN', start: '10.0.0.32', end: '10.0.0.63', count: 32, cidrs: ['10.0.0.32/27'], kinds: ['SUBNET'], label: '10.0.0.32/27 · Servidores' },
  ],
};

beforeEach(() => { mockedFetch.mockReset(); });
afterEach(cleanup);

describe('Planeamento de endereços', () => {
  it('drops the section kicker and shows the parent map with child subnets as taken', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    expect(screen.queryByText('PLANEAMENTO DE ENDEREÇOS')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    const map = await screen.findByRole('region', { name: 'Mapa da subnet' });
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/p1/planning', { signal: expect.any(AbortSignal) });
    expect(within(map).getByText('Subnet existente: 10.0.0.32/27 · Servidores')).toBeInTheDocument();
    expect(within(map).getByText('Gateway: 10.0.0.1')).toBeInTheDocument();
  });

  it('sends prefix and count and lists planned blocks and what does not fit', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    await screen.findByRole('region', { name: 'Mapa da subnet' });
    mockedFetch.mockResolvedValue({ ...basePlan, planned: [{ cidr: '10.0.0.64/27', prefix: 27, start: '10.0.0.64', end: '10.0.0.95', size: 32, usable: 30 }], shortfalls: [{ prefix: 27, requested: 8, planned: 1, missing: 7, reason: 'NOT_ENOUGH_FREE_SPACE' }] });
    fireEvent.change(screen.getByLabelText('Tamanho dos blocos'), { target: { value: '27' } });
    fireEvent.change(await screen.findByLabelText('Quantidade'), { target: { value: '8' } });
    expect(await screen.findByText('10.0.0.64/27')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/p1/planning?prefix=27&count=8', { signal: expect.any(AbortSignal) });
    expect(screen.getByText('Só cabem 1 de 8 blocos /27; faltam 7.')).toBeInTheDocument();
  });

  it('styles the controls with the shared IPAM form classes (same as the new-subnet form)', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} canCreate />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Tamanho dos blocos'), { target: { value: '27' } });
    for (const label of ['Subnet', 'Tamanho dos blocos', 'Quantidade']) expect(screen.getByLabelText(label).closest('label')?.parentElement).toHaveClass('modal-form');
    await screen.findByRole('region', { name: 'Mapa da subnet' });
  });

  it('marks the network address as reserved in the map, not free', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    const map = await screen.findByRole('region', { name: 'Mapa da subnet' });
    const row = within(map).getByText('Endereço de rede').closest('tr')!;
    expect(within(row).getByText('Reservado').closest('.state-badge')).toHaveClass('reserved');
    expect(within(map).queryByText('10.0.0.0/32')).not.toBeInTheDocument();
  });

  it('lists skipped aligned blocks with their conflict next to the planned ones, and shows them in the map', async () => {
    const skippedPlan = {
      ...basePlan,
      addressSpace: { total: 256, taken: 1, reserved: 1, planned: 224, freeAfterPlan: 30 },
      planned: [32, 64, 96, 128, 160, 192, 224].map((start) => ({ cidr: `10.0.0.${start}/27`, prefix: 27, start: `10.0.0.${start}`, end: `10.0.0.${start + 31}`, size: 32, usable: 30 })),
      skipped: [{ cidr: '10.0.0.0/27', prefix: 27, start: '10.0.0.0', end: '10.0.0.31', size: 32, blocks: 1, insideExisting: false, conflicts: [{ kind: 'GATEWAY', start: '10.0.0.1', end: '10.0.0.1', count: 1, label: 'Gateway 10.0.0.1' }] }],
      segments: [
        { status: 'CONFLICT', start: '10.0.0.0', end: '10.0.0.31', count: 32, cidrs: ['10.0.0.0/27'], label: 'Gateway 10.0.0.1', breakdown: { taken: 1, reserved: 1, free: 30 } },
        ...[32, 64, 96, 128, 160, 192, 224].map((start) => ({ status: 'PLANNED', start: `10.0.0.${start}`, end: `10.0.0.${start + 31}`, count: 32, cidrs: [`10.0.0.${start}/27`] })),
      ],
    };
    mockedFetch.mockResolvedValue(skippedPlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    fireEvent.change(screen.getByLabelText('Tamanho dos blocos'), { target: { value: '27' } });
    const map = await screen.findByRole('region', { name: 'Mapa da subnet' });
    // Planned list: all 8 /27s in address order, the first flagged with the gateway.
    const heading = screen.getByRole('heading', { name: 'Blocos planeados' });
    const rows = Array.from(heading.parentElement!.querySelectorAll(':scope > .activity-row')).filter((row) => row.querySelector('strong')?.textContent?.endsWith('/27'));
    expect(rows.map((row) => row.querySelector('strong')!.textContent)).toEqual([0, 32, 64, 96, 128, 160, 192, 224].map((start) => `10.0.0.${start}/27`));
    expect(within(rows[0] as HTMLElement).getByText('Conflito').closest('.state-badge')).toHaveClass('excluded');
    expect(within(rows[0] as HTMLElement).getByText('10.0.0.0 – 10.0.0.31 · Gateway 10.0.0.1')).toBeInTheDocument();
    expect(within(rows[1] as HTMLElement).getByText('Planeado')).toBeInTheDocument();
    // Map: the conflict row explains the skip and how many addresses stay free.
    expect(within(map).getByText('10.0.0.0/27 não planeado: Gateway 10.0.0.1 · 30 livres')).toBeInTheDocument();
    expect(screen.getByText('1 ocupados · 1 reservados (rede e broadcast) · 224 planeados · 30 livres de 256')).toBeInTheDocument();
  });

  it('orders planned and skipped rows by address', () => {
    const rows = plannedListRows(
      [{ cidr: '10.0.0.10/31', prefix: 31, start: '10.0.0.10', end: '10.0.0.11', size: 2, usable: 2 }],
      [{ cidr: '10.0.0.8/31', prefix: 31, start: '10.0.0.8', end: '10.0.0.9', size: 2, blocks: 1, insideExisting: false, conflicts: [] }, { cidr: '10.0.0.128/25', prefix: 31, start: '10.0.0.128', end: '10.0.0.255', size: 128, blocks: 64, insideExisting: true, conflicts: [] }],
    );
    expect(rows.map((row) => [row.type, row.block.cidr])).toEqual([['skipped', '10.0.0.8/31'], ['planned', '10.0.0.10/31'], ['skipped', '10.0.0.128/25']]);
  });

  it('offers only prefixes from the parent length down to /32', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    const options = within(screen.getByLabelText('Tamanho dos blocos')).getAllByRole('option').map((option) => option.getAttribute('value'));
    expect(options).toEqual(['', ...Array.from({ length: 9 }, (_, i) => String(24 + i))]);
    await screen.findByRole('region', { name: 'Mapa da subnet' });
  });

  it('falls back to the flat gap list when the API predates the parent map', async () => {
    const legacy: Record<string, unknown> = { ...basePlan };
    delete legacy.segments; delete legacy.planned; delete legacy.shortfalls;
    mockedFetch.mockResolvedValue({ ...legacy, usableGaps: [{ start: '10.0.0.2', end: '10.0.0.31', count: 30 }] });
    render(<SubnetPlanningView subnets={[parent]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    expect(await screen.findByText('10.0.0.2 – 10.0.0.31')).toBeInTheDocument();
    expect(screen.queryByText('Não existem gaps utilizáveis nesta subnet.')).not.toBeInTheDocument();
  });

  it('explains a prefix larger than the parent', () => {
    expect(shortfallMessage({ prefix: 23, requested: 1, planned: 0, missing: 1, reason: 'PREFIX_SHORTER_THAN_PARENT' })).toBe('Um bloco /23 é maior do que a subnet selecionada.');
  });

  const withPlan = {
    ...basePlan,
    planned: [{ cidr: '10.0.0.64/27', prefix: 27, start: '10.0.0.64', end: '10.0.0.95', size: 32, usable: 30 }],
    split: { total: 8, truncated: false, rows: [
      { cidr: '10.0.0.0/27', start: '10.0.0.0', end: '10.0.0.31', size: 32, usable: 30, used: 1, free: 31, available: false, planned: false, conflicts: [{ kind: 'GATEWAY', start: '10.0.0.1', end: '10.0.0.1', count: 1, label: 'Gateway 10.0.0.1' }] },
      { cidr: '10.0.0.32/27', start: '10.0.0.32', end: '10.0.0.63', size: 32, usable: 30, used: 32, free: 0, available: false, planned: false, conflicts: [{ kind: 'SUBNET', start: '10.0.0.32', end: '10.0.0.63', count: 32, label: 'Subnet 10.0.0.32/27 · Servidores', subnetId: 'c1' }] },
      { cidr: '10.0.0.64/27', start: '10.0.0.64', end: '10.0.0.95', size: 32, usable: 30, used: 0, free: 32, available: true, planned: true, conflicts: [] },
    ] },
  };
  async function pickPrefix(canCreate = true) {
    mockedFetch.mockResolvedValue(withPlan);
    render(<SubnetPlanningView subnets={[parent]} canCreate={canCreate} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    await screen.findByRole('region', { name: 'Mapa da subnet' });
    fireEvent.change(screen.getByLabelText('Tamanho dos blocos'), { target: { value: '27' } });
    await screen.findByRole('region', { name: 'Divisão em /27' });
    await waitFor(() => expect(screen.queryByText('A calcular…')).not.toBeInTheDocument());
  }

  it('row 3/5: the split table shows used and free per child and names what occupies each block', async () => {
    await pickPrefix();
    const table = screen.getByRole('region', { name: 'Divisão em /27' });
    const rows = within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell').map((cell) => cell.textContent));
    expect(rows).toEqual([
      ['10.0.0.0/27', 'Ocupado', '1', '31', 'Gateway 10.0.0.1'],
      ['10.0.0.32/27', 'Ocupado', '32', '0', 'Subnet 10.0.0.32/27 · Servidores'],
      ['10.0.0.64/27', 'Planeado', '0', '32', '—'],
    ]);
  });

  it('row 4: nothing is created until the user confirms; Confirm posts the planned blocks and refreshes', async () => {
    await pickPrefix();
    const confirmButton = screen.getByRole('button', { name: 'Rever e confirmar' });
    expect(confirmButton).toHaveClass('primary-button');
    expect(confirmButton.parentElement).toHaveClass('modal-actions');
    fireEvent.change(screen.getByLabelText('Finalidade das novas subnets'), { target: { value: 'LAN A' } });
    fireEvent.click(screen.getByRole('button', { name: 'Rever e confirmar' }));
    const dialog = await screen.findByRole('alertdialog');
    expect(within(dialog).getByText(/10\.0\.0\.64\/27 \(10\.0\.0\.64 – 10\.0\.0\.95\)/)).toBeInTheDocument();
    expect(mockedFetch.mock.calls.some(([path]) => String(path).endsWith('/commit'))).toBe(false);
    fireEvent.click(within(dialog).getByRole('button', { name: 'Cancelar' }));
    expect(mockedFetch.mock.calls.some(([path]) => String(path).endsWith('/commit'))).toBe(false);

    const callsBefore = mockedFetch.mock.calls.length;
    mockedFetch.mockImplementation(async (path) => (String(path).endsWith('/commit') ? { parentId: 'p1', created: [{ id: 'n1', cidr: '10.0.0.64/27', purpose: 'LAN A' }] } : withPlan));
    fireEvent.click(screen.getByRole('button', { name: 'Rever e confirmar' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar e criar' }));
    expect(await screen.findByText('Subnets criadas: 10.0.0.64/27.')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/subnets/p1/planning/commit', { method: 'POST', body: JSON.stringify({ blocks: [{ cidr: '10.0.0.64/27', purpose: 'LAN A' }] }) });
    // The plan (and every other IPAM query) is refetched after the children were created.
    await waitFor(() => expect(mockedFetch.mock.calls.slice(callsBefore).filter(([path]) => String(path).includes('/planning?')).length).toBe(1));
  });

  it('row 4/5: a rejected commit lists each conflict and creates nothing', async () => {
    await pickPrefix();
    mockedFetch.mockImplementation(async (path) => {
      if (String(path).endsWith('/commit')) throw new ApiRequestError('conflict', 409, { code: 'PLANNING_CONFLICT', conflicts: [{ cidr: '10.0.0.64/27', reason: 'OVERLAPS_EXISTING', message: '10.0.0.64/27 já não está livre: Host 10.0.0.70.', conflicts: [] }] } as never);
      return withPlan;
    });
    fireEvent.click(screen.getByRole('button', { name: 'Rever e confirmar' }));
    fireEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Confirmar e criar' }));
    expect(await screen.findByText('10.0.0.64/27 já não está livre: Host 10.0.0.70.')).toBeInTheDocument();
    expect(screen.getByRole('alert')).toHaveTextContent('Nada foi criado: um bloco já não está disponível');
    expect(screen.queryByText(/Subnets criadas/)).not.toBeInTheDocument();
  });

  it('row 4: users without IPAM create permission only see the preview', async () => {
    await pickPrefix(false);
    expect(screen.queryByRole('button', { name: 'Rever e confirmar' })).not.toBeInTheDocument();
  });

  it('row 6: options show VRF and Site and the page search filters them, keeping the selected subnet', () => {
    const subnets: Subnet[] = [
      { ...parent, purpose: 'Servidores', vrf: { id: 'v1', name: 'MGMT' }, vrfId: 'v1', site: { id: 'site-1', name: 'LX' } as never },
      { id: 'p2', cidr: '10.0.0.0/24', version: 4, purpose: 'Voz', site: { id: 'site-2', name: 'Porto' } as never },
    ];
    expect(subnetOptionLabel(subnets[0])).toBe('10.0.0.0/24 · Servidores · VRF MGMT · LX');
    expect(subnetOptionLabel(subnets[1])).toBe('10.0.0.0/24 · Voz · Global · Porto');
    mockedFetch.mockReturnValue(new Promise(() => undefined));
    const view = render(<SubnetPlanningView subnets={subnets} />);
    const optionsText = () => within(screen.getByLabelText('Subnet')).getAllByRole('option').map((option) => option.textContent);
    expect(optionsText()).toEqual(['Seleciona uma subnet', '10.0.0.0/24 · Servidores · VRF MGMT · LX', '10.0.0.0/24 · Voz · Global · Porto']);
    view.rerender(<SubnetPlanningView subnets={subnets} search="porto" />);
    expect(optionsText()).toEqual(['Seleciona uma subnet', '10.0.0.0/24 · Voz · Global · Porto']);
    view.rerender(<SubnetPlanningView subnets={subnets} search="mgmt" />);
    expect(optionsText()).toEqual(['Seleciona uma subnet', '10.0.0.0/24 · Servidores · VRF MGMT · LX']);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    view.rerender(<SubnetPlanningView subnets={subnets} search="xyz" />);
    expect(optionsText()).toEqual(['Seleciona uma subnet', '10.0.0.0/24 · Servidores · VRF MGMT · LX']);
    expect(screen.getByLabelText('Subnet')).toHaveValue('p1');
    view.rerender(<SubnetPlanningView subnets={[subnets[1]]} search="xyz" />);
    expect(optionsText()).toEqual(['Nenhuma subnet corresponde à pesquisa']);
  });

  it('row 8: shows a loading state, aborts the stale request and refreshes when IPAM data is invalidated', async () => {
    const pending: Array<{ resolve: (value: unknown) => void; signal?: AbortSignal }> = [];
    mockedFetch.mockImplementation((_path, init) => new Promise((resolve) => { pending.push({ resolve, signal: (init as RequestInit | undefined)?.signal ?? undefined }); }));
    const other: Subnet = { id: 'p2', cidr: '10.0.1.0/24', version: 4 };
    render(<SubnetPlanningView subnets={[parent, other]} />);
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    expect(screen.getByText('A calcular…')).toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p2' } });
    expect(pending[0].signal?.aborted).toBe(true);
    await act(async () => { pending[0].resolve(basePlan); });
    expect(screen.queryByRole('region', { name: 'Mapa da subnet' })).not.toBeInTheDocument();
    await act(async () => { pending[pending.length - 1].resolve({ ...basePlan, subnet: other, broadcast: '10.0.1.255' }); });
    expect(await screen.findByText('10.0.1.255')).toBeInTheDocument();
    expect(screen.queryByText('A calcular…')).not.toBeInTheDocument();
    const before = pending.length;
    // The page's Atualizar button invalidates ['ipam'].
    await act(async () => { void client.invalidateQueries({ queryKey: ['ipam'] }); });
    expect(pending.length).toBe(before + 1);
    expect(await screen.findByText('A calcular…')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/p2/planning', { signal: expect.any(AbortSignal) });
  });
});
