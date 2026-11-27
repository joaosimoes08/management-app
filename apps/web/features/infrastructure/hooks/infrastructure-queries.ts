import { useQuery } from '@tanstack/react-query';
import {
  getEffectiveAccess,
  getSiteLocations,
  getSiteRacks,
  listAssets,
  listDeviceModels,
  listDevices,
  listInterfaces,
  listVlansForSite,
} from '../api';
import type { DeviceUrlFilters } from '../device-filters';
import type { DeviceInterface } from '../types';
import { naturalInterfaceCompare } from '../utils';

/*
 * Server-state queries of the Infrastructure workspace. Keys, enabled rules and select logic are
 * the ones the workspace used inline, so the cache entries and every invalidateQueries call that
 * targets them are unchanged. The *Query builders return plain option objects (not queryOptions(),
 * so tests that mock @tanstack/react-query keep working); they are pure and unit-tested, and the
 * hooks wrap them.
 */

/** Effective access for a Site. IPAM uses the same key, so both pages share one cache entry. */
export const effectiveAccessQuery = (siteId: string) => ({
  queryKey: ['access', 'effective', siteId],
  queryFn: () => getEffectiveAccess(siteId),
  enabled: Boolean(siteId),
});

export const siteLocationsQuery = (siteId: string) => ({
  queryKey: ['infrastructure', 'locations', siteId],
  queryFn: () => getSiteLocations(siteId),
  enabled: Boolean(siteId),
});

export const siteRacksQuery = (siteId: string) => ({
  queryKey: ['infrastructure', 'racks', siteId],
  queryFn: () => getSiteRacks(siteId),
  enabled: Boolean(siteId),
});

/** Device models are global; they load once a Site is open and the user may see Models or Assets. */
export const deviceModelsQuery = (siteId: string, canUseCatalog: boolean) => ({
  queryKey: ['infrastructure', 'device-models'],
  queryFn: listDeviceModels,
  enabled: Boolean(siteId) && canUseCatalog,
});

export const assetsQuery = (siteId: string, canUseCatalog: boolean) => ({
  queryKey: ['infrastructure', 'assets'],
  queryFn: listAssets,
  enabled: Boolean(siteId) && canUseCatalog,
});

export const siteVlansQuery = (siteId: string, canUseInterfaces: boolean) => ({
  queryKey: ['infrastructure', 'vlans', siteId],
  queryFn: () => listVlansForSite(siteId),
  enabled: Boolean(siteId) && canUseInterfaces,
});

export type DevicesQueryParams = {
  siteId: string;
  /** Search text; the workspace passes '' outside the Equipamentos tab. */
  search: string;
  /** Missing-configuration filter; '' when it spans all Sites. */
  missingConfig: string;
  /** Drill-through filters, or null when none apply. */
  filters: DeviceUrlFilters | null;
};

export const devicesQuery = ({ siteId, search, missingConfig, filters }: DevicesQueryParams) => ({
  queryKey: ['infrastructure', 'devices', siteId, search, missingConfig, filters],
  queryFn: () => listDevices(siteId, search, 1, { ...(filters ?? {}), missingConfig }),
  enabled: Boolean(siteId),
});

/** Interfaces of one device, in natural port order. */
export const deviceInterfacesQuery = (deviceId: string) => ({
  queryKey: ['infrastructure', 'interfaces', deviceId],
  queryFn: () => listInterfaces(deviceId),
  enabled: Boolean(deviceId),
  select: (data: DeviceInterface[]) => [...data].sort(naturalInterfaceCompare),
});

export const useEffectiveAccess = (siteId: string) => useQuery(effectiveAccessQuery(siteId));
export const useSiteLocations = (siteId: string) => useQuery(siteLocationsQuery(siteId));
export const useSiteRacks = (siteId: string) => useQuery(siteRacksQuery(siteId));
export const useDeviceModels = (siteId: string, canUseCatalog: boolean) => useQuery(deviceModelsQuery(siteId, canUseCatalog));
export const useAssets = (siteId: string, canUseCatalog: boolean) => useQuery(assetsQuery(siteId, canUseCatalog));
export const useSiteVlans = (siteId: string, canUseInterfaces: boolean) => useQuery(siteVlansQuery(siteId, canUseInterfaces));
export const useDevices = (params: DevicesQueryParams) => useQuery(devicesQuery(params));
export const useDeviceInterfaces = (deviceId: string) => useQuery(deviceInterfacesQuery(deviceId));
