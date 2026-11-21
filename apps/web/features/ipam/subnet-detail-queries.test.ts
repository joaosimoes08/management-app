import { QueryClient } from '@tanstack/react-query';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { prefetchSubnetDetail, subnetDetailQueries } from './subnet-detail-queries';

const api = vi.hoisted(() => ({ getSubnetUsage: vi.fn(), getSubnetCapacityHistory: vi.fn(), listIpAddresses: vi.fn() }));
vi.mock('./api', () => api);

beforeEach(() => {
  api.getSubnetUsage.mockReset().mockReturnValue(new Promise(() => undefined));
  api.getSubnetCapacityHistory.mockReset().mockReturnValue(new Promise(() => undefined));
  api.listIpAddresses.mockReset().mockReturnValue(new Promise(() => undefined));
});

describe('subnet detail prefetch', () => {
  it('starts usage, capacity history and the IP list at once, without waiting for anything', () => {
    const client = new QueryClient();
    prefetchSubnetDetail(client, 'subnet-1', '', { current: 0 });
    expect(api.getSubnetUsage).toHaveBeenCalledWith('subnet-1');
    expect(api.getSubnetCapacityHistory).toHaveBeenCalledWith('subnet-1');
    expect(api.listIpAddresses).toHaveBeenCalledWith('subnet-1', '');
  });

  it('fills the same cache entries the subnet panels read', async () => {
    api.getSubnetUsage.mockResolvedValue({ used: 3 });
    api.getSubnetCapacityHistory.mockResolvedValue({ points: [] });
    api.listIpAddresses.mockResolvedValue({ items: [{ id: 'ip-1' }] });
    const client = new QueryClient();
    const epoch = { current: 4 };
    prefetchSubnetDetail(client, 'subnet-1', '10.0', epoch);
    const queries = subnetDetailQueries('subnet-1', '10.0', epoch);
    await vi.waitFor(() => expect(client.getQueryData(queries.ips.queryKey)).toBeDefined());
    expect(queries.usage.queryKey).toEqual(['ipam', 'usage', 'subnet-1']);
    expect(queries.capacityHistory.queryKey).toEqual(['ipam', 'capacity-history', 'subnet-1']);
    expect(queries.ips.queryKey).toEqual(['ipam', 'ips', 'subnet-1', '10.0']);
    expect(client.getQueryData(queries.usage.queryKey)).toEqual({ used: 3 });
    expect(client.getQueryData(queries.capacityHistory.queryKey)).toEqual({ points: [] });
    // The reservation epoch is captured when the request starts, as the page hook always did.
    expect(client.getQueryData(queries.ips.queryKey)).toEqual({ items: [{ id: 'ip-1' }], reservationRequestEpoch: 4 });
  });

  it('keeps a failed prefetch inside the query cache', async () => {
    api.getSubnetUsage.mockRejectedValue(new Error('403'));
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    expect(() => prefetchSubnetDetail(client, 'subnet-x', '', { current: 0 })).not.toThrow();
    await vi.waitFor(() => expect(client.getQueryState(['ipam', 'usage', 'subnet-x'])?.status).toBe('error'));
  });
});
