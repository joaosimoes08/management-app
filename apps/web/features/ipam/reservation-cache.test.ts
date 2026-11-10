import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { createElement, useEffect, useState } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubnetsView } from './components/subnets-view';
import { IpReservationModal } from './components/ip-reservation-modal';
import type { IpAddressRow, IpReservation } from './types';
import { applyIpReservationOverrides, reconcileIpReservationOverrides, setCachedIpReservation, syncIpReservationCache, type IpReservationOverrideState } from './reservation-cache';

const ip: IpAddressRow = { id: 'ip-1', address: '192.0.2.18', subnetId: 'subnet-1', state: 'FREE', observedState: 'UNKNOWN' };
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

  it('renders reserve and release from the mutation cache write while background refresh is pending', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(queryClient);
    const queryKey = ['ipam', 'ips', subnet.id, ''];
    queryClient.setQueryData(queryKey, { items: [ip] });
    const finishRefreshes: Array<() => void> = [];
    const pendingRefresh = () => new Promise<void>((resolve) => { finishRefreshes.push(resolve); });

    function CacheDrivenRows() {
      const { data } = useQuery({ queryKey, queryFn: () => new Promise<{ items: IpAddressRow[] }>(() => undefined) });
      const rows = data?.items ?? [];
      const table = createElement(SubnetsView, {
        selected: subnet, items: [subnet], usage: null, capacityHistory: null, ips: rows, search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(),
        canEdit: true, canReserve: true, canReleaseReservations: true, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(),
        editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(),
        reserveIp: () => { void syncIpReservationCache(queryClient, ip.id, reservation, pendingRefresh); },
        releaseReservation: () => { void syncIpReservationCache(queryClient, ip.id, null, pendingRefresh); },
      });
      return table;
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(CacheDrivenRows)));
    fireEvent.click(await screen.findByRole('button', { name: 'Reservar 192.0.2.18' }));
    expect(await screen.findByText('RESERVED / UNKNOWN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' })).toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' }));
    expect(await screen.findByText('FREE / UNKNOWN')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Reservar 192.0.2.18' })).toBeInTheDocument();
    finishRefreshes.forEach((finish) => finish());
  });

  it('cancels overlapping stale list refetches before applying reserve and release results', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(queryClient);
    const allIpsKey = ['ipam', 'ips', 'subnet-1', ''];
    const matchingSearchKey = ['ipam', 'ips', 'subnet-1', '192.0.2'];
    queryClient.setQueryData(allIpsKey, { items: [ip] });
    queryClient.setQueryData(matchingSearchKey, { items: [ip] });

    let resolveAll!: (page: { items: IpAddressRow[] }) => void;
    let resolveSearch!: (page: { items: IpAddressRow[] }) => void;
    const staleAll = new Promise<{ items: IpAddressRow[] }>((resolve) => { resolveAll = resolve; });
    const staleSearch = new Promise<{ items: IpAddressRow[] }>((resolve) => { resolveSearch = resolve; });
    const fetchAll = vi.fn(() => staleAll);
    const fetchSearch = vi.fn(() => staleSearch);
    const pendingAll = queryClient.fetchQuery({ queryKey: allIpsKey, queryFn: fetchAll });
    const pendingSearch = queryClient.fetchQuery({ queryKey: matchingSearchKey, queryFn: fetchSearch });
    expect(fetchAll).toHaveBeenCalledOnce();
    expect(fetchSearch).toHaveBeenCalledOnce();

    await syncIpReservationCache(queryClient, ip.id, reservation, async () => undefined);
    resolveAll({ items: [ip] });
    resolveSearch({ items: [ip] });
    await Promise.allSettled([pendingAll, pendingSearch]);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0]).toMatchObject({ state: 'RESERVED', reservation });
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0]).toMatchObject({ state: 'RESERVED', reservation });

    let resolveReservedAll!: (page: { items: IpAddressRow[] }) => void;
    let resolveReservedSearch!: (page: { items: IpAddressRow[] }) => void;
    const staleReservedAll = new Promise<{ items: IpAddressRow[] }>((resolve) => { resolveReservedAll = resolve; });
    const staleReservedSearch = new Promise<{ items: IpAddressRow[] }>((resolve) => { resolveReservedSearch = resolve; });
    const fetchReservedAll = vi.fn(() => staleReservedAll);
    const fetchReservedSearch = vi.fn(() => staleReservedSearch);
    const pendingReservedAll = queryClient.fetchQuery({ queryKey: allIpsKey, queryFn: fetchReservedAll });
    const pendingReservedSearch = queryClient.fetchQuery({ queryKey: matchingSearchKey, queryFn: fetchReservedSearch });
    expect(fetchReservedAll).toHaveBeenCalledOnce();
    expect(fetchReservedSearch).toHaveBeenCalledOnce();

    await syncIpReservationCache(queryClient, ip.id, null, async () => undefined);
    resolveReservedAll({ items: [{ ...ip, state: 'RESERVED', reservation, reservations: [reservation] }] });
    resolveReservedSearch({ items: [{ ...ip, state: 'RESERVED', reservation, reservations: [reservation] }] });
    await Promise.allSettled([pendingReservedAll, pendingReservedSearch]);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0]).toMatchObject({ state: 'FREE', reservation: null, reservations: [] });
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0]).toMatchObject({ state: 'FREE', reservation: null, reservations: [] });
  });

  it('does not clear an override from a matching response that started before the mutation', () => {
    const state: IpReservationOverrideState = { values: { [ip.id]: reservation }, epochs: { [ip.id]: 4 } };
    const staleRequestThatHappenedToMatch = { ...ip, state: 'RESERVED' as const, reservation, reservations: [reservation] };

    expect(reconcileIpReservationOverrides([staleRequestThatHappenedToMatch], state, 3)).toBe(state);
    expect(reconcileIpReservationOverrides([staleRequestThatHappenedToMatch], state, 4)).toEqual({ values: {}, epochs: {} });
  });

  it('shows the updated row actions immediately after reserve and release without reloading', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    clients.push(queryClient);
    const queryKey = ['ipam', 'ips', subnet.id, ''];
    queryClient.setQueryData(queryKey, { items: [ip] });
    let persistedState = 'FREE';
    let requestEpoch = 0;
    const apiReservation = { ...reservation, ipAddress: { id: ip.id, address: ip.address } };
    const createReservation = vi.fn().mockImplementation(async () => { persistedState = 'RESERVED'; return apiReservation; });
    const releaseReservation = vi.fn().mockImplementation(async () => { persistedState = 'FREE'; return { success: true, released: true }; });

    function InteractionHarness() {
      const { data } = useQuery({ queryKey, queryFn: async () => ({ items: [ip], reservationRequestEpoch: requestEpoch }) });
      const [overrideState, setOverrideState] = useState<IpReservationOverrideState>({ values: {}, epochs: {} });
      const [reservationTarget, setReservationTarget] = useState<IpAddressRow | null>(null);
      useEffect(() => {
        if (data?.items) setOverrideState((current) => reconcileIpReservationOverrides(data.items, current, data.reservationRequestEpoch));
      }, [data?.items, data?.reservationRequestEpoch]);
      const updateReservation = async (ipRow: IpAddressRow, nextReservation: IpReservation | null) => {
        if (nextReservation) {
          const response = await createReservation();
          expect(response).toMatchObject({ ...reservation, ipAddress: { id: ip.id, address: ip.address } });
        } else {
          const apiResponse = await releaseReservation();
          expect(apiResponse).toMatchObject({ success: true, released: true });
        }
        const mutationEpoch = ++requestEpoch;
        setOverrideState((current) => ({
          values: { ...current.values, [ipRow.id]: nextReservation },
          epochs: { ...current.epochs, [ipRow.id]: mutationEpoch },
        }));
        void syncIpReservationCache(queryClient, ipRow.id, nextReservation, async () => undefined);
        // An older request can return an apparently matching row before a still-older stale row lands.
        // Neither response may clear the mutation override because both began before the mutation.
        const matchingStaleRow = nextReservation
          ? { ...ip, state: 'RESERVED' as const, reservation, reservations: [reservation] }
          : ip;
        queryClient.setQueryData(queryKey, { items: [matchingStaleRow], reservationRequestEpoch: mutationEpoch - 1 });
        const staleRow = nextReservation
          ? ip
          : { ...ip, state: 'RESERVED', reservation, reservations: [reservation] };
        queryClient.setQueryData(queryKey, { items: [staleRow], reservationRequestEpoch: mutationEpoch - 1 });
      };
      const visibleIps = applyIpReservationOverrides(data?.items ?? [], overrideState.values);
      const table = createElement(SubnetsView, {
        selected: subnet, items: [subnet], usage: null, capacityHistory: null, ips: visibleIps, search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(),
        canEdit: true, canReserve: true, canReleaseReservations: true, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(),
        editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(),
        reserveIp: (ipRow) => setReservationTarget(ipRow),
        releaseReservation: (ipRow) => { void updateReservation(ipRow, null); },
      });
      return createElement('div', null,
        table,
        reservationTarget && createElement(IpReservationModal, {
          ip: reservationTarget,
          close: () => setReservationTarget(null),
          submit: async () => { await updateReservation(reservationTarget, apiReservation); setReservationTarget(null); },
        }),
      );
    }

    render(createElement(QueryClientProvider, { client: queryClient }, createElement(InteractionHarness)));
    fireEvent.click(await screen.findByRole('button', { name: 'Reservar 192.0.2.18' }));
    fireEvent.change(screen.getByLabelText('Motivo'), { target: { value: 'Maintenance window' } });
    fireEvent.click(screen.getByRole('button', { name: 'Reservar IP' }));

    expect(await screen.findByText('RESERVED / UNKNOWN')).toBeInTheDocument();
    expect(persistedState).toBe('RESERVED');
    expect(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Reservar 192.0.2.18' })).not.toBeInTheDocument();

    fireEvent.click(screen.getByRole('button', { name: 'Libertar reserva de 192.0.2.18' }));
    expect(await screen.findByText('FREE / UNKNOWN')).toBeInTheDocument();
    expect(persistedState).toBe('FREE');
    expect(screen.getByRole('button', { name: 'Reservar 192.0.2.18' })).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Libertar reserva de 192.0.2.18' })).not.toBeInTheDocument();
    expect(createReservation).toHaveBeenCalledOnce();
    expect(releaseReservation).toHaveBeenCalledOnce();
  });
});
