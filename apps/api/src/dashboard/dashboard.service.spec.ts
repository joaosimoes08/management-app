import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DashboardService } from './dashboard.service';

function serviceWith(prisma: Record<string, unknown>, queue: Record<string, unknown> = {}, operations: Record<string, unknown> = { list: async () => ({ items: [] }) }) {
  const service = Object.create(DashboardService.prototype) as DashboardService;
  Object.assign(service as object, {
    prisma,
    discoveryQueue: queue,
    ipamAccess: { whereFor: async () => ({}) },
    infrastructureAccess: { visibleRoomIds: async () => [], visibleUnplacedSiteIds: async () => [] },
    operations,
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

test('topbar state degrades when Redis is unavailable and adapts persisted alerts', async () => {
  const now = new Date();
  const service = serviceWith({
    discoveryJob: {
      findMany: async () => [{ id: 'running-1', name: 'Discovery core', status: 'RUNNING', subnet: { cidr: '10.1.0.0/24' } }],
    },
    systemSettings: { findFirst: async () => ({ setupCompleted: true, setupCompletedAt: now }) },
    roleRequest: { count: async () => 0 }, notification: { findMany: async () => [] },
  }, { getJobCounts: async () => { throw new Error('Redis offline'); } }, { list: async () => ({ items: [{ id: 'alert-1', severity: 'WARNING', title: 'Discovery falhou', detail: 'Timeout', actionHref: '/descoberta', lastOccurredAt: now }] }) });

  const result = await service.topbarState({ id: 'user', externalId: 'external', username: 'admin', roles: ['ADMIN'] });
  assert.equal(result.environment.state, 'DEGRADED');
  assert.equal(result.environment.services.find((item) => item.key === 'redis')?.state, 'UNAVAILABLE');
  assert.ok(result.alerts.some((item) => item.id === 'alert-1'));
  assert.deepEqual(result.processes[0], { id: 'running-1', label: 'Discovery core', detail: '10.1.0.0/24', state: 'RUNNING', href: '/descoberta?jobId=running-1' });
});
