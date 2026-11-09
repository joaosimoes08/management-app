import { QueryClient } from '@tanstack/react-query';
import { afterEach, describe, expect, it } from 'vitest';
import type { IpAddressRow, IpReservation } from './types';
import { setCachedIpReservation } from './reservation-cache';

const ip: IpAddressRow = { id: 'ip-1', address: '192.0.2.18', subnetId: 'subnet-1', state: 'FREE' };
const reservation: IpReservation = {
  id: 'reservation-1',
  expiresAt: '2026-11-10T15:00:00.000Z',
  reason: 'Maintenance window',
  status: 'ACTIVE',
};

describe('IP reservation cache updates', () => {
  const clients: QueryClient[] = [];
  afterEach(() => clients.splice(0).forEach((client) => client.clear()));

  it('updates matching IP rows in every visible search cache on reserve and release', () => {
    const queryClient = new QueryClient();
    clients.push(queryClient);
    const allIpsKey = ['ipam', 'ips', 'subnet-1', ''];
    const matchingSearchKey = ['ipam', 'ips', 'subnet-1', '192.0.2'];
    queryClient.setQueryData(allIpsKey, { items: [ip] });
    queryClient.setQueryData(matchingSearchKey, { items: [ip] });

    setCachedIpReservation(queryClient, ip.id, reservation);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0].reservation).toEqual(reservation);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0].reservations).toEqual([reservation]);

    setCachedIpReservation(queryClient, ip.id, null);
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(allIpsKey)?.items[0]).toMatchObject({ reservation: null, reservations: [] });
    expect(queryClient.getQueryData<{ items: IpAddressRow[] }>(matchingSearchKey)?.items[0]).toMatchObject({ reservation: null, reservations: [] });
  });
});
