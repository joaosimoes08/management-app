import type { QueryClient } from '@tanstack/react-query';
import type { IpAddressRow, IpReservation } from './types';

type IpAddressPage = { items: IpAddressRow[] };
export type IpReservationOverrides = Record<string, IpReservation | null>;

export function applyIpReservationOverride(ip: IpAddressRow, reservation: IpReservation | null): IpAddressRow {
  return { ...ip, state: reservation ? 'RESERVED' : 'FREE', reservation, reservations: reservation ? [reservation] : [] };
}

export function applyIpReservationOverrides(ips: IpAddressRow[], overrides: IpReservationOverrides): IpAddressRow[] {
  return ips.map((ip) => Object.prototype.hasOwnProperty.call(overrides, ip.id)
    ? applyIpReservationOverride(ip, overrides[ip.id])
    : ip);
}

export function serverRowMatchesReservation(ip: IpAddressRow, reservation: IpReservation | null): boolean {
  const activeReservation = ip.reservation ?? ip.reservations?.find((item) => item.status === 'ACTIVE') ?? null;
  return reservation
    ? activeReservation?.id === reservation.id
    : !activeReservation && ip.state === 'FREE';
}

/** Update every cached search result containing this IP before the background refetch. */
export function setCachedIpReservation(queryClient: QueryClient, ipAddressId: string, reservation: IpReservation | null): void {
  queryClient.setQueriesData<IpAddressPage>({ queryKey: ['ipam', 'ips'] }, (page) => {
    if (!page) return page;
    return {
      ...page,
      items: page.items.map((ip) => ip.id === ipAddressId
        ? applyIpReservationOverride(ip, reservation)
        : ip),
    };
  });
}

/** Keep the mutation result authoritative if the invalidation refetch returns an older row. */
export async function syncIpReservationCache(
  queryClient: QueryClient,
  ipAddressId: string,
  reservation: IpReservation | null,
  refresh: () => Promise<unknown>,
): Promise<void> {
  // A list request that started before the mutation can finish with a stale row.
  // Cancel it before writing the mutation result so it cannot replace the cache.
  await queryClient.cancelQueries({ queryKey: ['ipam', 'ips'] });
  setCachedIpReservation(queryClient, ipAddressId, reservation);
  await refresh();
  setCachedIpReservation(queryClient, ipAddressId, reservation);
}
