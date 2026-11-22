import { beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subnet } from './types';

const apiFetch = vi.hoisted(() => vi.fn());
vi.mock('@/lib/api/client', () => ({ apiFetch, apiDownload: vi.fn() }));

import { IP_LIST_PAGE_SIZE, listIpAddresses, listSubnets } from './api';

const subnets = (from: number, count: number): Subnet[] => Array.from({ length: count }, (_, index) => ({ id: `s-${from + index}`, cidr: `10.${Math.floor((from + index) / 256)}.${(from + index) % 256}.0/24`, version: 4, siteId: 'site-1' }));

describe('listSubnets', () => {
  beforeEach(() => apiFetch.mockReset());

  it('pages through the API (max 100 per page) and returns every subnet of the Site', async () => {
    apiFetch.mockImplementation(async (path: string) => {
      const page = Number(new URL(path, 'http://x').searchParams.get('page'));
      const items = page === 3 ? subnets(200, 50) : subnets((page - 1) * 100, 100);
      return { items, page, pageSize: 100, total: 250, totalPages: 3 };
    });
    const result = await listSubnets('site-1');
    expect(result.items).toHaveLength(250);
    expect(new Set(result.items.map((item) => item.id)).size).toBe(250);
    expect(result.total).toBe(250);
    expect(apiFetch).toHaveBeenCalledTimes(3);
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/subnets?siteId=site-1&page=1&pageSize=100');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/subnets?siteId=site-1&page=3&pageSize=100');
  });

  it('makes a single request when everything fits in one page', async () => {
    apiFetch.mockResolvedValue({ items: subnets(0, 12), page: 1, pageSize: 100, total: 12, totalPages: 1 });
    expect((await listSubnets('site-1')).items).toHaveLength(12);
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('listIpAddresses', () => {
  beforeEach(() => apiFetch.mockReset());

  it('asks for one page at the size the API allows (it caps pageSize at 200)', async () => {
    apiFetch.mockResolvedValue({ items: [], page: 2, pageSize: 200, total: 812, totalPages: 5 });
    await listIpAddresses('subnet-1', '10.0.1', 2);
    expect(IP_LIST_PAGE_SIZE).toBe(200);
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/ip-addresses?subnetId=subnet-1&page=2&pageSize=200&search=10.0.1');
  });

  it('starts at page 1', async () => {
    apiFetch.mockResolvedValue({ items: [], page: 1, pageSize: 200, total: 0, totalPages: 0 });
    await listIpAddresses('subnet-1', '');
    expect(apiFetch).toHaveBeenCalledWith('/api/v1/ip-addresses?subnetId=subnet-1&page=1&pageSize=200&search=');
  });
});
