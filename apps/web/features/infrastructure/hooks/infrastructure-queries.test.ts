import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { DeviceInterface } from '../types';
import { emptyDeviceUrlFilters } from '../device-filters';

vi.mock('../api', () => ({
  getEffectiveAccess: vi.fn(), getSiteLocations: vi.fn(), getSiteRacks: vi.fn(), listAssets: vi.fn(), listDeviceModels: vi.fn(),
  listDevices: vi.fn(), listInterfaces: vi.fn(), listVlansForSite: vi.fn(),
}));

const api = await import('../api');
const q = await import('./infrastructure-queries');

beforeEach(() => vi.clearAllMocks());

describe('infrastructure query definitions', () => {
  it('keep the cache keys the workspace and its invalidations use', () => {
    expect(q.effectiveAccessQuery('s1').queryKey).toEqual(['access', 'effective', 's1']);
    expect(q.siteLocationsQuery('s1').queryKey).toEqual(['infrastructure', 'locations', 's1']);
    expect(q.siteRacksQuery('s1').queryKey).toEqual(['infrastructure', 'racks', 's1']);
    expect(q.deviceModelsQuery('s1', true).queryKey).toEqual(['infrastructure', 'device-models']);
    expect(q.assetsQuery('s1', true).queryKey).toEqual(['infrastructure', 'assets']);
    expect(q.siteVlansQuery('s1', true).queryKey).toEqual(['infrastructure', 'vlans', 's1']);
    expect(q.deviceInterfacesQuery('d1').queryKey).toEqual(['infrastructure', 'interfaces', 'd1']);
    const filters = { ...emptyDeviceUrlFilters, status: 'ACTIVE' };
    expect(q.devicesQuery({ siteId: 's1', search: 'core', missingConfig: 'owner', filters }).queryKey)
      .toEqual(['infrastructure', 'devices', 's1', 'core', 'owner', filters]);
  });

  it('wait for a Site, and for the matching access tab where one is needed', () => {
    for (const build of [q.effectiveAccessQuery, q.siteLocationsQuery, q.siteRacksQuery]) {
      expect(build('s1').enabled).toBe(true);
      expect(build('').enabled).toBe(false);
    }
    for (const build of [q.deviceModelsQuery, q.assetsQuery, q.siteVlansQuery]) {
      expect(build('s1', true).enabled).toBe(true);
      expect(build('s1', false).enabled).toBe(false);
      expect(build('', true).enabled).toBe(false);
    }
    expect(q.devicesQuery({ siteId: '', search: '', missingConfig: '', filters: null }).enabled).toBe(false);
    expect(q.deviceInterfacesQuery('').enabled).toBe(false);
  });

  it('pass search, page 1 and the merged filters to listDevices', async () => {
    const filters = { ...emptyDeviceUrlFilters, type: 'SWITCH' };
    await (q.devicesQuery({ siteId: 's1', search: 'core', missingConfig: 'owner', filters }).queryFn as () => Promise<unknown>)();
    expect(api.listDevices).toHaveBeenCalledWith('s1', 'core', 1, { ...filters, missingConfig: 'owner' });
    await (q.devicesQuery({ siteId: 's1', search: '', missingConfig: '', filters: null }).queryFn as () => Promise<unknown>)();
    expect(api.listDevices).toHaveBeenLastCalledWith('s1', '', 1, { missingConfig: '' });
  });

  it('sort interfaces in natural port order without mutating the cached array', () => {
    const data = [{ id: 'b', name: 'Gi1/0/10' }, { id: 'a', name: 'Gi1/0/2' }] as DeviceInterface[];
    const select = q.deviceInterfacesQuery('d1').select as (rows: DeviceInterface[]) => DeviceInterface[];
    expect(select(data).map((row) => row.id)).toEqual(['a', 'b']);
    expect(data.map((row) => row.id)).toEqual(['b', 'a']);
  });
});
