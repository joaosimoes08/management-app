import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactNode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import { NextFreeIpModal, reserveNextErrorMessage } from './next-free-ip-modal';
import { SubnetsView, type SubnetsViewProps } from './subnets-view';
import { utilizationBadge, formatIpamPercent } from '../utilization';
import { ipStateLabel } from '../ip-state';
import { setFormatLocale } from '@/lib/format/date';
import type { Subnet } from '../types';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
const mockedFetch = vi.mocked(apiFetch);

const subnet: Subnet = { id: 'subnet-1', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1' };
const v6: Subnet = { id: 'subnet-6', cidr: '2001:db8::/64', version: 6, siteId: 'site-1' };
const wrap = (node: ReactNode) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>{node}</QueryClientProvider>);
const nextFree = (extra: Record<string, unknown> = {}) => ({ subnetId: 'subnet-1', cidr: '10.0.0.0/24', supported: true, requested: 1, items: [{ address: '10.0.0.10', ipAddressId: null, tracked: false }], exhausted: false, ...extra });

beforeEach(() => {
  mockedFetch.mockReset();
  window.history.replaceState(null, '', '/ipam');
});
afterEach(cleanup);

describe('Próximo IP livre', () => {
  it('looks up the next free address and sends count/from/to', async () => {
    mockedFetch.mockResolvedValue(nextFree());
    wrap(<NextFreeIpModal subnet={subnet} canReserve={false} close={vi.fn()} reserved={vi.fn()} />);

    expect(await screen.findByText('10.0.0.10')).toBeInTheDocument();
    expect(mockedFetch).toHaveBeenCalledWith('/api/v1/subnets/subnet-1/next-free?count=1');
    // Readers see the lookup but no reservation form.
    expect(screen.queryByRole('form', { name: 'Reservar IPs livres' })).not.toBeInTheDocument();

    mockedFetch.mockResolvedValue(nextFree({ requested: 3, exhausted: true }));
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '3' } });
    fireEvent.change(screen.getByLabelText('A partir de'), { target: { value: '10.0.0.5' } });
    fireEvent.change(screen.getByLabelText('Até'), { target: { value: '10.0.0.20' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Procurar IPs livres' }));
    await waitFor(() => expect(mockedFetch).toHaveBeenCalledWith('/api/v1/subnets/subnet-1/next-free?count=3&from=10.0.0.5&to=10.0.0.20'));
    expect(await screen.findByText(/Encontrados 1 de 3 IPs pedidos/)).toBeInTheDocument();
  });

  it('rejects a count outside 1–32 without calling the API again', async () => {
    mockedFetch.mockResolvedValue(nextFree());
    wrap(<NextFreeIpModal subnet={subnet} canReserve close={vi.fn()} reserved={vi.fn()} />);
    await screen.findByText('10.0.0.10');
    fireEvent.change(screen.getByLabelText('Quantidade'), { target: { value: '33' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Procurar IPs livres' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('entre 1 e 32');
    expect(mockedFetch).toHaveBeenCalledTimes(1);
  });

  it('reserves the next free addresses with reason and duration', async () => {
    const reserved = vi.fn();
    const response = { subnetId: 'subnet-1', count: 1, expiresAt: '2026-11-22T10:00:00.000Z', reservations: [{ id: 'r-1', status: 'ACTIVE', expiresAt: '2026-11-22T10:00:00.000Z', reason: 'Novo servidor', ipAddress: { id: 'ip-10', address: '10.0.0.10' }, createdIpAddress: true }] };
    mockedFetch.mockImplementation(async (path: string) => path.includes('reserve-next') ? response : nextFree());
    wrap(<NextFreeIpModal subnet={subnet} canReserve close={vi.fn()} reserved={reserved} />);
    await screen.findByText('10.0.0.10');

    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Novo servidor' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Reservar IPs livres' }));

    await waitFor(() => expect(reserved).toHaveBeenCalledWith(response));
    const call = mockedFetch.mock.calls.find(([path]) => String(path).includes('reserve-next'))!;
    expect(call[0]).toBe('/api/v1/subnets/subnet-1/reserve-next');
    expect(JSON.parse(String((call[1] as RequestInit).body))).toEqual({ count: 1, durationHours: 24, reason: 'Novo servidor' });
  });

  it('shows how many addresses are left on IP_RANGE_EXHAUSTED and refreshes the list', async () => {
    mockedFetch.mockImplementation(async (path: string) => {
      if (path.includes('reserve-next')) throw new ApiRequestError('Range exhausted', 409, { code: 'IP_RANGE_EXHAUSTED', message: 'Range exhausted', details: { available: 0 } });
      return nextFree();
    });
    wrap(<NextFreeIpModal subnet={subnet} canReserve close={vi.fn()} reserved={vi.fn()} />);
    await screen.findByText('10.0.0.10');
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Teste' } });
    fireEvent.submit(screen.getByRole('form', { name: 'Reservar IPs livres' }));

    expect(await screen.findByRole('alert')).toHaveTextContent('Disponíveis: 0.');
    await waitFor(() => expect(mockedFetch.mock.calls.filter(([path]) => String(path).includes('next-free')).length).toBe(2));
  });

  it('maps conflict codes and falls back to the API message for unknown codes', () => {
    expect(reserveNextErrorMessage(new ApiRequestError('changed', 409, { code: 'IP_RANGE_CHANGED' }))).toMatch(/mudaram entretanto/);
    expect(reserveNextErrorMessage(new ApiRequestError('v6', 400, { code: 'IP_RANGE_UNSUPPORTED' }))).toMatch(/IPv4/);
    expect(reserveNextErrorMessage(new ApiRequestError('Exhausted (no details)', 409, { code: 'IP_RANGE_EXHAUSTED' }))).toBe('Exhausted (no details)');
    expect(reserveNextErrorMessage(new ApiRequestError('Something new from the API', 400, { code: 'SOME_FUTURE_CODE' }))).toBe('Something new from the API');
  });

  it('shows the API message for IPv6 subnets and never offers a reservation', async () => {
    mockedFetch.mockResolvedValue({ subnetId: 'subnet-6', cidr: '2001:db8::/64', supported: false, requested: 1, items: [], exhausted: false, message: 'IPv6 next-free is not supported.' });
    wrap(<NextFreeIpModal subnet={v6} canReserve close={vi.fn()} reserved={vi.fn()} />);
    expect(await screen.findByText('IPv6 next-free is not supported.')).toBeInTheDocument();
    expect(screen.queryByRole('form', { name: 'Reservar IPs livres' })).not.toBeInTheDocument();
    expect(screen.getByRole('note')).toHaveTextContent('IPv4');
  });

  it('shows lookup errors from the API (400 IP_RANGE_INVALID)', async () => {
    mockedFetch.mockRejectedValue(new ApiRequestError('O intervalo não pertence à subnet.', 400, { code: 'IP_RANGE_INVALID', message: 'O intervalo não pertence à subnet.' }));
    wrap(<NextFreeIpModal subnet={subnet} canReserve close={vi.fn()} reserved={vi.fn()} />);
    expect(await screen.findByRole('alert')).toHaveTextContent('O intervalo não pertence à subnet.');
  });
});

describe('Subnet utilisation column', () => {
  const items: Subnet[] = [
    { ...subnet, id: 's-ok', cidr: '10.0.1.0/24', utilization: { utilizationPercent: 12.5, band: 'OK', usableCapacity: 254, allocated: 32, free: 222 } },
    { ...subnet, id: 's-crit', cidr: '10.0.2.0/24', utilization: { utilizationPercent: 95, band: 'CRITICAL' } },
    { ...v6, id: 's-v6', utilization: { utilizationPercent: null, band: 'UNTRACKED' } },
    { ...subnet, id: 's-warn', cidr: '10.0.3.0/24', utilization: { utilizationPercent: 81, band: 'WARNING', extraFieldFromApi: true } as never },
  ];
  const props = (extra: Partial<SubnetsViewProps> = {}): SubnetsViewProps => ({ selected: null, items, usage: null, capacityHistory: null, ips: [], search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(), canEdit: false, canReserve: false, canReleaseReservations: false, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(), editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(), reserveIp: vi.fn(), releaseReservation: vi.fn(), ...extra });
  const cidrs = (table: HTMLElement) => within(table).getAllByRole('row').slice(1).map((row) => within(row).getAllByRole('cell')[0].textContent?.trim());

  it('maps bands to badges and keeps IPv6 untracked', () => {
    expect(utilizationBadge(items[0].utilization)).toMatchObject({ tone: 'occupied', label: '12,5%' });
    expect(utilizationBadge(items[1].utilization)).toMatchObject({ tone: 'excluded', label: '95% · Crítica' });
    expect(utilizationBadge(items[2].utilization)).toMatchObject({ tone: '', label: 'Não contabilizada' });
    expect(utilizationBadge({ utilizationPercent: 50, band: 'NEW_BAND' })).toMatchObject({ tone: '', label: '50% · NEW_BAND' });
    expect(utilizationBadge(undefined)).toBeNull();
  });

  it('sorts by utilisation with IPv6 last and filters by band', () => {
    wrap(<SubnetsView {...props()} />);
    const table = screen.getByRole('region', { name: 'Subnets do Site' });
    fireEvent.click(within(table).getByRole('button', { name: /Utilização/ }));
    expect(cidrs(table)).toEqual(['10.0.1.0/24', '10.0.3.0/24', '10.0.2.0/24', '2001:db8::/64']);
    fireEvent.click(within(table).getByRole('button', { name: /Utilização/ }));
    expect(cidrs(table)).toEqual(['10.0.2.0/24', '10.0.3.0/24', '10.0.1.0/24', '2001:db8::/64']);
    expect(window.location.search).toContain('subnetssort');

    fireEvent.change(screen.getByLabelText('Filtrar subnets por utilização'), { target: { value: 'CRITICAL' } });
    expect(cidrs(screen.getByRole('region', { name: 'Subnets do Site' }))).toEqual(['10.0.2.0/24']);
  });

  it('opens the subnet from the table and hides edit actions for readers', () => {
    const openSubnet = vi.fn();
    wrap(<SubnetsView {...props({ openSubnet })} />);
    fireEvent.click(screen.getByRole('button', { name: '10.0.2.0/24' }));
    expect(openSubnet).toHaveBeenCalledWith('s-crit');
    expect(screen.queryByRole('button', { name: /Editar subnet/ })).not.toBeInTheDocument();
  });

  it('offers "Próximo IP livre" on the selected subnet', async () => {
    mockedFetch.mockResolvedValue(nextFree());
    wrap(<SubnetsView {...props({ selected: subnet, canReserve: true })} />);
    fireEvent.click(screen.getByRole('button', { name: /Próximo IP livre/ }));
    expect(await screen.findByText('10.0.0.10')).toBeInTheDocument();
    expect(screen.getByRole('form', { name: 'Reservar IPs livres' })).toBeInTheDocument();
  });
});

describe('IPAM display labels', () => {
  it('keeps two decimal digits and uses the active locale', () => {
    expect(formatIpamPercent(0.39)).toBe('0,39%');
    setFormatLocale('en-US');
    try {
      expect(formatIpamPercent(0.39)).toBe('0.39%');
    } finally {
      setFormatLocale('pt-PT');
    }
  });

  it('labels managed and observed states and handles missing and unknown values', () => {
    expect(ipStateLabel('FREE')).toBe('Livre');
    expect(ipStateLabel('RESERVED')).toBe('Reservado');
    expect(ipStateLabel('UNREACHABLE')).toBe('Inacessível');
    expect(ipStateLabel('UNRECOGNIZED')).toBe('Desconhecido');
    expect(ipStateLabel(null)).toBe('—');
  });
});
