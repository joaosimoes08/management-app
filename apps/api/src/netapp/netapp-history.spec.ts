import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptCredential } from '@simoes/snmp-core';
import { buildTrend, capacitySamples, historyRetentionDays } from './netapp-history';
import { NetAppService } from './netapp.service';

const snapshot = {
  systems: [{ name: 'cluster-a' }], nodes: [],
  aggregates: [{ name: 'aggr1', uuid: 'a-1', state: 'online', sizeBytes: 1000, usedBytes: 400 }],
  volumes: [{ name: 'vol1', uuid: 'v-1', svm: 'svm1', state: 'online', sizeBytes: 100, usedBytes: 10 }, { name: 'vol-no-uuid', state: 'online' }],
  capacity: { sizeBytes: 1000, usedBytes: 400, availableBytes: 600, usedPercent: 40 }, health: 'healthy' as const, observedAt: '2026-11-21T10:00:00.000Z',
};

test('capacitySamples writes one row for the cluster total and one per aggregate and volume', () => {
  const rows = capacitySamples('int-1', snapshot);
  assert.deepEqual(rows.map((row) => [row.kind, row.objectKey]), [['CLUSTER', 'cluster'], ['AGGREGATE', 'a-1'], ['VOLUME', 'v-1'], ['VOLUME', 'vol-no-uuid']]);
  assert.equal(rows[0].usedBytes, 400n);
  assert.equal(rows[2].svm, 'svm1');
  assert.equal(rows[3].sizeBytes, null);
  assert.equal(rows[0].observedAt.toISOString(), snapshot.observedAt);
});

test('historyRetentionDays defaults to 400 and is bounded', () => {
  assert.equal(historyRetentionDays(undefined), 400);
  assert.equal(historyRetentionDays('abc'), 400);
  assert.equal(historyRetentionDays('7'), 30);
  assert.equal(historyRetentionDays('99999'), 3650);
  assert.equal(historyRetentionDays('180'), 180);
});

test('buildTrend computes growth per day and a projected full date', () => {
  const day = (n: number) => new Date(Date.UTC(2026, 10, 1 + n, 12));
  const rows = [0, 1, 2, 3].map((n) => ({ day: new Date(Date.UTC(2026, 10, 1 + n)), observedAt: day(n), name: 'aggr1', svm: null, state: 'online', sizeBytes: 1000n, usedBytes: BigInt(400 + n * 100) }));
  const trend = buildTrend(rows);
  assert.equal(trend.points.length, 4);
  assert.equal(trend.points[3].usedPercent, 70);
  assert.equal(trend.summary.growthBytesPerDay, 100);
  assert.equal(trend.summary.changeBytes, 300);
  // 300 bytes of headroom at 100/day → 3 days after the last reading.
  assert.equal(trend.summary.projectedFullAt, new Date(day(3).getTime() + 3 * 86_400_000).toISOString());
});

test('buildTrend gives no growth or projection for a single day or a shrinking volume', () => {
  const one = buildTrend([{ day: new Date('2026-11-01'), observedAt: new Date('2026-11-01T10:00:00Z'), name: 'v', svm: null, state: null, sizeBytes: 10n, usedBytes: 5n }]);
  assert.equal(one.summary.growthBytesPerDay, null);
  assert.equal(one.summary.projectedFullAt, null);
  const shrinking = buildTrend([0, 1].map((n) => ({ day: new Date(Date.UTC(2026, 10, 1 + n)), observedAt: new Date(Date.UTC(2026, 10, 1 + n, 9)), name: 'v', svm: null, state: null, sizeBytes: 100n, usedBytes: BigInt(50 - n * 10) })));
  assert.equal(shrinking.summary.growthBytesPerDay, -10);
  assert.equal(shrinking.summary.projectedFullAt, null);
  assert.deepEqual(buildTrend([]).summary.lastUsedBytes, null);
});

test('a successful refresh keeps overwriting the current snapshot and also appends history and prunes past retention', async () => {
  const keyring = { activeKeyId: 'active', keys: { active: new Uint8Array(32).fill(7) } };
  const record: any = { id: 'integration', siteId: 'site', endpointUrl: 'https://ontap.example', username: 'reader', ...encryptCredential({ password: 'pw' }, keyring), snapshot: null };
  const ops: any[] = [];
  const service = Object.create(NetAppService.prototype) as any;
  service.prisma = {
    netAppIntegration: { findUnique: async () => record, update: (args: any) => { ops.push(['update', args]); return { ...record, ...args.data }; } },
    netAppCapacitySample: { createMany: (args: any) => { ops.push(['createMany', args]); return { count: args.data.length }; }, deleteMany: (args: any) => { ops.push(['deleteMany', args]); return { count: 0 }; } },
    $transaction: async (items: any[]) => items,
  };
  service.access = { assertSite: async () => ({ id: 'site' }) };
  service.audit = { record: async () => undefined };
  service.keyring = () => keyring;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async (url: URL) => new Response(JSON.stringify(String(url).includes('/api/cluster?') ? { name: 'cluster-a' } : String(url).includes('aggregates') ? { records: [{ name: 'aggr1', uuid: 'a-1', state: 'online', space: { block_storage: { size: 1000, used: 400 } } }] } : { records: [] }), { status: 200 })) as typeof fetch;
  try { await service.refresh('site', { id: 'user', roles: ['ADMIN'] }); } finally { globalThis.fetch = originalFetch; }
  assert.deepEqual(ops.map(([name]) => name), ['update', 'createMany', 'deleteMany']);
  assert.ok(ops[0][1].data.snapshot);
  assert.deepEqual(ops[1][1].data.map((row: any) => row.kind), ['CLUSTER', 'AGGREGATE']);
  const cutoff = ops[2][1].where.observedAt.lt.getTime();
  assert.ok(Math.abs(Date.now() - 400 * 86_400_000 - cutoff) < 5_000);
});
