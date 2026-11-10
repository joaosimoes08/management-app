import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { IpamAccessService } from './ipam-access.service';
import { SubnetCapacityService } from './subnet-capacity.service';

function serviceFor(subnet: { id: string; cidr: string; version: number; gateway: string | null }, addresses: Array<{ address: string; state: string }>) {
  const snapshots: Array<Record<string, unknown>> = [];
  let subnetReads = 0;
  const prisma = {
    subnet: { findUnique: async () => subnet, findMany: async () => { subnetReads++; return [subnet]; } },
    ipAddress: {
      groupBy: async () => [{ state: 'OCCUPIED', _count: { _all: addresses.length } }],
      findMany: async () => addresses.map((item) => ({ ...item, subnetId: subnet.id })),
    },
    subnetCapacitySnapshot: {
      upsert: async ({ create }: { create: Record<string, unknown> }) => { snapshots.push(create); return create; },
      findMany: async () => snapshots,
    },
  } as unknown as PrismaClient;
  const access = { assertSubnet: async () => undefined } as unknown as IpamAccessService;
  return { service: new SubnetCapacityService(prisma, access), snapshots, getSubnetReads: () => subnetReads };
}

test('usage returns usable IPv4 capacity and excludes out-of-capacity addresses', async () => {
  const { service } = serviceFor(
    { id: 'subnet-1', cidr: '192.0.2.0/29', version: 4, gateway: '192.0.2.1' },
    [{ address: '192.0.2.2', state: 'OCCUPIED' }, { address: '192.0.2.7', state: 'OCCUPIED' }],
  );
  const usage = await service.usage('subnet-1', { id: 'user-1' } as AuthenticatedUser);
  assert.equal(usage.usableCapacity, 5);
  assert.equal(usage.known, 1);
  assert.equal(usage.occupied, 1);
  assert.equal(usage.free, 4);
});

test('history captures one daily point and avoids IPv6 free-capacity estimates', async () => {
  const { service, snapshots, getSubnetReads } = serviceFor(
    { id: 'subnet-v6', cidr: '2001:db8::/64', version: 6, gateway: '2001:db8::1' },
    [{ address: '2001:db8::1', state: 'OCCUPIED' }],
  );
  const history = await service.history('subnet-v6', { id: 'user-1' } as AuthenticatedUser);
  assert.equal(snapshots.length, 1);
  assert.equal((snapshots[0] as { freeAddresses: number | null }).freeAddresses, null);
  assert.equal(history.forecast.status, 'TRACKING_ONLY');
  assert.equal(getSubnetReads(), 1);
});
