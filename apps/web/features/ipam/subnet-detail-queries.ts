import type { QueryClient } from '@tanstack/react-query';
import { getSubnetCapacityHistory, getSubnetUsage, listIpAddresses } from './api';

type EpochRef = { readonly current: number };

/**
 * Query definitions for the panels of an open subnet (usage, capacity history, IP list).
 * The page's useQuery hooks and the prefetch in openSubnet share them, so a prefetched result
 * lands in exactly the cache entry the panel reads.
 */
export function subnetDetailQueries(subnetId: string, search: string, reservationEpoch: EpochRef, page = 1) {
  return {
    usage: { queryKey: ['ipam', 'usage', subnetId] as const, queryFn: () => getSubnetUsage(subnetId) },
    capacityHistory: { queryKey: ['ipam', 'capacity-history', subnetId] as const, queryFn: () => getSubnetCapacityHistory(subnetId) },
    ips: {
      queryKey: ['ipam', 'ips', subnetId, search, page] as const,
      queryFn: async () => {
        const requestEpoch = reservationEpoch.current;
        return { ...await listIpAddresses(subnetId, search, page), reservationRequestEpoch: requestEpoch };
      },
    },
  };
}

/**
 * Start the subnet panels' requests without waiting for the subnet detail. They only need the
 * subnet id, so opening a subnet (or a subnet deep link) no longer waits detail → panels.
 * Errors stay inside the query cache, exactly as when the hooks fetch them.
 */
export function prefetchSubnetDetail(queryClient: QueryClient, subnetId: string, search: string, reservationEpoch: EpochRef): void {
  const queries = subnetDetailQueries(subnetId, search, reservationEpoch);
  void queryClient.prefetchQuery(queries.usage);
  void queryClient.prefetchQuery(queries.capacityHistory);
  void queryClient.prefetchQuery(queries.ips);
}
