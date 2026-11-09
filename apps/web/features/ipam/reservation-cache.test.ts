import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubnetsView } from './components/subnets-view';
import type { IpAddressRow, IpReservation } from './types';
import { setCachedIpReservation, syncIpReservationCache } from './reservation-cache';

const ip: IpAddressRow = { id: 'ip-1', address: '192.0.2.18', subnetId: 'subnet-1', state: 'FREE' };
const subnet = { id: 'subnet-1', cidr: '192.0.2.0/24', version: 4, siteId: 'site-1' };
const reservation: IpReservation = {
  id: 'reservation-1',
  expiresAt: '2026-11-10T15:00:00.000Z',
  reason: 'Maintenance window',
  status: 'ACTIVE',
};

describe('IP reservation cache updates', () => {
  const clients: QueryClient[] = [];
  afterEach(() => clients.splice(0).forEach((client) => client.clear()));
  afterEach(cleanup);

  it('updates matching IP rows in every visible search cache on reserve and release', () => {
    const queryClient = new QueryClient();
    clients.push(queryClient);
    const allIpsKey = ['ipam', 'ips', 'subnet-1', ''];
    const matchingSearchKey = ['ipam', 'ips', 'subnet-1', '192.0.2'];
    queryClient.setQueryData(allIpsKey, { items: [ip] });
    queryClient.setQueryData(matchingSearchKey, { items: [ip] });

    setCachedIpReservation(queryClient, ip.id, reservation);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0].reservation).toEqual(reservation);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0].state).toBe('RESERVED');
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0].reservations).toEqual([reservation]);

    setCachedIpReservation(queryClient, ip.id, null);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0]).toMatchObject({ state: 'FREE', reservation: null, reservations: [] });
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0]).toMatchObject({ state: 'FREE', reservation: null, reservations: [] });
  });

  it('shows the updated row actions immediately after reserve and release without reloading', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(queryClient);
    const queryKey = ['ipam', 'ips', subnet.id, ''];
    queryClient.setQueryData(queryKey, { items: [ip] });
    let persistedState = 'FREE';
    const createReservation = vi.fn().mockImplementation(async () => { persistedState = 'RESERVED'; return reservation; });
    const releaseReservation = vi.fn().mockImplementation(async () => { persistedState = 'FREE'; return { success: true, released: true }; });

    function InteractionHarness() {
      const { data } = useQuery({ queryKey, queryFn: async () => ({ items: [ip] }) });
      const updateReservation = async (ipRow: IpAddressRow, nextReservation: IpReservation | null) => {
        if (nextReservation) await createReservation();
        else await releaseReservation();
        await syncIpReservationCache(queryClient, ipRow.id, nextReservation, async () => {
          // A refetch can still return an older list snapshot after the mutation persisted.
          queryClient.setQueryData(queryKey, { items: [ip] });
        });
      };
      return createElement(SubnetsView, {
        selected: subnet, items: [subnet], usage: null, ips: data?.items ?? [], search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(),
        canEdit: true, canReserve: true, canReleaseReservations: true, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(),
        editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(),
        reserveIp: (ipRow) => { void updateReservation(ipRow, reservation); },
        releaseReservation: (ipRow) => { void updateReservation(ipRow, null); },
      });
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(InteractionHarness)));
    fireEvent.click(await screen.findByRole('button', { name: 'Reservar 192.0.2.18' }));

    expect(await screen.findByText('RESERVED / —')).toBeInTheDocument();
    expect(persistedState).toBe('RESERVED');
    expect(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reservar 192.0.2.18' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' }));
    expect(await screen.findByText('FREE / —')).toBeInTheDocument();
    expect(persistedState).toBe('FREE');
    expect(screen.getByRole('button', { name: 'Reservar 192.0.2.18' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Libertar reserva de 192.0.2.18' })).not.toBeInTheDocument();
    expect(createReservation).toHaveBeenCalledOnce();
    expect(releaseReservation).toHaveBeenCalledOnce();
  });
});
