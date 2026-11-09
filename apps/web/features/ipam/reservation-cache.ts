import type { QueryClient } from '@tanstack/react-query';
import type { IpAddressRow, IpReservation } from './types';

type IpAddressPage = { items: IpAddressRow[] };

/** Update every cached search result containing this IP before the background refetch. */
export function setCachedIpReservation(queryClient: QueryClient, ipAddressId: string, reservation: IpReservation | null): void {
  queryClient.setQueriesData<IpAddressPage>({ queryKey: ['ipam', 'ips'] }, (page) => {
    if (!page) return page;
    return {
      ...page,
      items: page.items.map((ip) => ip.id === ipAddressId
        ? { ...ip, state: reservation ? 'RESERVED' : 'FREE', reservation, reservations: reservation ? [reservation] : [] }
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
