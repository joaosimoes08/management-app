import { describe, expect, it, vi } from 'vitest';
import { emptySubnetUrlFilters } from '../subnet-filters';

vi.mock('../api', () => ({ getHost: vi.fn(), getNetworkMap: vi.fn(), getSubnet: vi.fn(), listSubnets: vi.fn(), listVrfs: vi.fn() }));

const api = await import('../api');
const q = await import('./ipam-queries');

describe('IPAM query definitions', () => {
  it('keep the cache keys the page and its invalidations use', () => {
    const filters = { ...emptySubnetUrlFilters, band: 'high' };
    expect(q.networkMapQuery('s1').queryKey).toEqual(['ipam', 'network-map', 's1']);
    expect(q.subnetsQuery('s1').queryKey).toEqual(['ipam', 'subnets', 's1']);
    expect(q.filteredSubnetsQuery('s1', filters).queryKey).toEqual(['ipam', 'subnets', 's1', 'filtered', filters]);
    expect(q.vrfsQuery('s1').queryKey).toEqual(['ipam', 'vrfs', 's1']);
    expect(q.subnetQuery('n1').queryKey).toEqual(['ipam', 'subnet', 'n1']);
    expect(q.hostQuery('h1').queryKey).toEqual(['ipam', 'host', 'h1']);
  });

  it('stay off without their id, and the filtered list also without filters and with no retry', async () => {
    for (const build of [q.networkMapQuery, q.subnetsQuery, q.vrfsQuery, q.subnetQuery, q.hostQuery]) {
      expect(build('x').enabled).toBe(true);
      expect(build('').enabled).toBe(false);
    }
    const filters = { ...emptySubnetUrlFilters, band: 'high' };
    expect(q.filteredSubnetsQuery('s1', filters).enabled).toBe(true);
    expect(q.filteredSubnetsQuery('s1', null).enabled).toBe(false);
    expect(q.filteredSubnetsQuery('', filters).enabled).toBe(false);
    expect(q.filteredSubnetsQuery('s1', filters).retry).toBe(false);
    await (q.filteredSubnetsQuery('s1', null).queryFn as () => Promise<unknown>)();
    expect(api.listSubnets).toHaveBeenLastCalledWith('s1', undefined);
  });
});
