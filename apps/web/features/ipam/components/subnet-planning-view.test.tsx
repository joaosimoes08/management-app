import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { SubnetPlanningView, shortfallMessage } from './subnet-planning-view';
import type { Subnet } from '../types';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const parent: Subnet = { id: 'p1', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1' };
const basePlan = {
  subnet: parent, version: 4, network: '10.0.0.0', broadcast: '10.0.0.255', prefix: 24, size: 256,
  usableRange: { start: '10.0.0.1', end: '10.0.0.254' }, usableTotal: 254, unavailable: 33, free: 221, utilizationPercent: 12.99,
  usableGaps: [], unavailableAddresses: ['10.0.0.1'], scope: { vrfId: null, vrfName: null }, childSubnets: 1,
  addressSpace: { total: 256, taken: 33, planned: 0, freeAfterPlan: 223 }, planned: [], shortfalls: [], segmentsTruncated: false,
  segments: [
    { status: 'FREE', start: '10.0.0.0', end: '10.0.0.0', count: 1, cidrs: ['10.0.0.0/32'] },
    { status: 'TAKEN', start: '10.0.0.1', end: '10.0.0.1', count: 1, cidrs: ['10.0.0.1/32'], kinds: ['GATEWAY'], label: '10.0.0.1' },
    { status: 'FREE', start: '10.0.0.2', end: '10.0.0.31', count: 30, cidrs: ['10.0.0.2/31', '10.0.0.4/30'] },
    { status: 'TAKEN', start: '10.0.0.32', end: '10.0.0.63', count: 32, cidrs: ['10.0.0.32/27'], kinds: ['SUBNET'], label: '10.0.0.32/27 · Servidores' },
  ],
};

beforeEach(() => mockedFetch.mockReset());
afterEach(cleanup);

describe('Planeamento de endereços', () => {
  it('drops the section kicker and shows the parent map with child subnets as taken', async () => {
    mockedFetch.mockResolvedValue(basePlan);
    render(<SubnetPlanningView subnets={[parent]} />);
    expect(screen.queryByText('PLANEAMENTO DE ENDEREÇOS')).not.toBeInTheDocument();
    fireEvent.change(screen.getByLabelText('Subnet'), { target: { value: 'p1' } });
    const map = await screen.findByRole('region', { name: 'Mapa da subnet' });
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/p1/planning');
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
    expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/p1/planning?prefix=27&count=8');
    expect(screen.getByText('Só cabem 1 de 8 blocos /27; faltam 7.')).toBeInTheDocument();
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
});
