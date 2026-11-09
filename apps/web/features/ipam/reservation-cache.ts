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
