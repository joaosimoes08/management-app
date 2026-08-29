import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DashboardService } from './dashboard.service';

function serviceWith(prisma: Record<string, unknown>, queue: Record<string, unknown> = {}) {
  const service = Object.create(DashboardService.prototype) as DashboardService;
  Object.assign(service as object, {
    prisma,
    discoveryQueue: queue,
    ipamAccess: { whereFor: async () => ({}) },
    infrastructureAccess: { visibleRoomIds: async () => [], visibleUnplacedSiteIds: async () => [] },
  });
  return service;
}

test('global search ignores queries shorter than two characters', async () => {
  const service = serviceWith({});
  const result = await service.search(' a ', '8', { id: 'user', externalId: 'external', username: 'reader', roles: ['READ_ONLY'] });
  assert.deepEqual(result, { items: [] });
});

test('global search caps the limit and applies application roles', async () => {
  let applicationWhere: unknown;
  let applicationTake = 0;
  const empty = { findMany: async () => [] };
  const service = serviceWith({
    site: empty,
    device: empty,
    vlan: empty,
    subnet: empty,
    ipAddress: empty,
    applicationLink: {
      findMany: async (args: { where: unknown; take: number }) => {
        applicationWhere = args.where;
        applicationTake = args.take;
        return [{ id: 'app-1', name: 'Monitorização', category: 'Operações', url: 'https://monitor.example' }];
      },
    },
  });

  const result = await service.search('monitor', '200', { id: 'user', externalId: 'external', username: 'operator', roles: ['NETWORK_OPERATOR'] });
  assert.equal(applicationTake, 20);
  assert.match(JSON.stringify(applicationWhere), /NETWORK_OPERATOR/);
  assert.deepEqual(result.items[0], { id: 'app-1', type: 'APPLICATION', title: 'Monitorização', detail: 'Aplicação · Operações', href: 'https://monitor.example' });
});

test('topbar state degrades when Redis is unavailable and derives current alerts', async () => {
  let failedCutoff: Date | undefined;
  const now = new Date();
  const service = serviceWith({
    discoveryJob: {
      findMany: async (args: { where: { status: unknown; createdAt?: { gte: Date } } }) => {
        if (args.where.createdAt) {
          failedCutoff = args.where.createdAt.gte;
          return [{ id: 'failed-1', status: 'FAILED', createdAt: now, completedAt: now, errorMessage: 'Timeout', subnet: { cidr: '10.0.0.0/24', site: { name: 'Lisboa' } } }];
        }
        return [{ id: 'running-1', name: 'Discovery core', status: 'RUNNING', subnet: { cidr: '10.1.0.0/24' } }];
      },
    },
    discoveryResult: { count: async () => 3 },
    systemSettings: { findFirst: async () => ({ setupCompleted: true, setupCompletedAt: now }) },
  }, { getJobCounts: async () => { throw new Error('Redis offline'); } });

  const result = await service.topbarState();
  assert.equal(result.environment.state, 'DEGRADED');
  assert.equal(result.environment.services.find((item) => item.key === 'redis')?.state, 'UNAVAILABLE');
  assert.ok(result.alerts.some((item) => item.id === 'redis-unavailable'));
  assert.ok(result.alerts.some((item) => item.id === 'discovery-failed-failed-1'));
  assert.ok(result.alerts.some((item) => item.id === 'discovery-pending-review'));
  assert.deepEqual(result.processes[0], { id: 'running-1', label: 'Discovery core', detail: '10.1.0.0/24', state: 'RUNNING', href: '/descoberta?jobId=running-1' });
  assert.ok(failedCutoff && failedCutoff.getTime() <= Date.now() - 23 * 60 * 60 * 1000);
});
