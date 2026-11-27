import { useQuery } from '@tanstack/react-query';
import { getHost, getNetworkMap, getSubnet, listSubnets, listVrfs } from '../api';
import type { SubnetUrlFilters } from '../subnet-filters';
import { subnetDetailQueries } from '../subnet-detail-queries';

/*
 * Server-state queries of the IPAM page. Keys, enabled rules and retry are the ones the page used
 * inline, so the cache entries and every invalidateQueries call that targets them are unchanged.
 * Effective access is shared with Infrastructure: use useEffectiveAccess from
 * features/infrastructure/hooks (same ['access', 'effective', siteId] key).
 */

export const networkMapQuery = (siteId: string) => ({
  queryKey: ['ipam', 'network-map', siteId],
  queryFn: () => getNetworkMap(siteId),
  enabled: Boolean(siteId),
});

export const subnetsQuery = (siteId: string) => ({
  queryKey: ['ipam', 'subnets', siteId],
  queryFn: () => listSubnets(siteId),
  enabled: Boolean(siteId),
});

/** The drill-through subnet list; off until filters apply, and a failure is shown, not retried. */
export const filteredSubnetsQuery = (siteId: string, filters: SubnetUrlFilters | null) => ({
  queryKey: ['ipam', 'subnets', siteId, 'filtered', filters],
  queryFn: () => listSubnets(siteId, filters ?? undefined),
  enabled: Boolean(siteId && filters),
  retry: false,
});

export const vrfsQuery = (siteId: string) => ({
  queryKey: ['ipam', 'vrfs', siteId],
  queryFn: () => listVrfs(siteId),
  enabled: Boolean(siteId),
});

export const subnetQuery = (subnetId: string) => ({
  queryKey: ['ipam', 'subnet', subnetId],
  queryFn: () => getSubnet(subnetId),
  enabled: Boolean(subnetId),
});

export const hostQuery = (hostId: string) => ({
  queryKey: ['ipam', 'host', hostId],
  queryFn: () => getHost(hostId),
  enabled: Boolean(hostId),
});

export const useNetworkMap = (siteId: string) => useQuery(networkMapQuery(siteId));
export const useSubnets = (siteId: string) => useQuery(subnetsQuery(siteId));
export const useFilteredSubnets = (siteId: string, filters: SubnetUrlFilters | null) => useQuery(filteredSubnetsQuery(siteId, filters));
export const useVrfs = (siteId: string) => useQuery(vrfsQuery(siteId));
export const useSubnet = (subnetId: string) => useQuery(subnetQuery(subnetId));
export const useHost = (hostId: string) => useQuery(hostQuery(hostId));

/**
 * The open subnet's panels (usage, capacity history, IP page). They use the same definitions as
 * prefetchSubnetDetail, so a prefetched result lands in the entry each panel reads.
 */
export function useSubnetPanels(subnetId: string, search: string, reservationEpoch: { readonly current: number }, page: number) {
  const queries = subnetDetailQueries(subnetId, search, reservationEpoch, page);
  const enabled = Boolean(subnetId);
  const usage = useQuery({ ...queries.usage, enabled });
  const capacityHistory = useQuery({ ...queries.capacityHistory, enabled });
  const ips = useQuery({ ...queries.ips, enabled });
  return { usage, capacityHistory, ips };
}
