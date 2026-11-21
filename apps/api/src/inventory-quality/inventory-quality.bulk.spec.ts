import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { BadRequestException, ForbiddenException, NotFoundException } from '@nestjs/common';
import { InventoryQualityService, resolveSnoozeUntil } from './inventory-quality.service';

const now = new Date('2026-11-21T10:00:00Z');
const H = 3_600_000;

test('resolveSnoozeUntil accepts exactly one bounded input', () => {
  assert.equal(resolveSnoozeUntil({ durationHours: 1 }, now).getTime(), now.getTime() + H);
  assert.equal(resolveSnoozeUntil({ durationHours: 720 }, now).getTime(), now.getTime() + 720 * H);
  assert.equal(resolveSnoozeUntil({ until: new Date(now.getTime() + 24 * H).toISOString() }, now).getTime(), now.getTime() + 24 * H);
  for (const input of [{}, { durationHours: 0 }, { durationHours: 721 }, { durationHours: 1.5 }, { until: new Date(now.getTime() + 24 * H).toISOString(), durationHours: 24 }, { until: new Date(now.getTime() - 1).toISOString() }, { until: new Date(now.getTime() + 10 * 60_000).toISOString() }, { until: new Date(now.getTime() + 31 * 24 * H).toISOString() }, { until: 'soon' }]) {
    assert.throws(() => resolveSnoozeUntil(input as never, now), BadRequestException, JSON.stringify(input));
  }
});

test('bulk applies each item independently and reports per-item failures', async () => {
  const service = new InventoryQualityService({} as any, {} as any, {} as any, {} as any, {} as any);
  const calls: string[] = [];
  (service as any).acknowledge = async (_user: unknown, id: string) => {
    calls.push(id);
    if (id === 'missing') throw new NotFoundException('Finding não encontrado');
    if (id === 'other-site') throw new ForbiddenException('Não tens permissão operacional neste Site');
    return { id, status: 'ACKNOWLEDGED' };
  };
  const result = await service.bulk({ id: 'u', roles: ['NETWORK_OPERATOR'] } as any, { action: 'ACKNOWLEDGE', ids: ['ok', 'missing', 'other-site'] });
  assert.deepEqual(calls, ['ok', 'missing', 'other-site']);
  assert.equal(result.succeeded, 1); assert.equal(result.failed, 2);
  assert.deepEqual(result.results.map((item) => item.code ?? 'OK'), ['OK', 'NOT_FOUND', 'FORBIDDEN']);
});

test('bulk snooze validates once and uses the same end time for every item', async () => {
  const service = new InventoryQualityService({} as any, {} as any, {} as any, {} as any, {} as any);
  const seen: Date[] = [];
  (service as any).applySnooze = async (_user: unknown, id: string, until: Date) => { seen.push(until); return { id, status: 'SNOOZED' }; };
  const result = await service.bulk({ id: 'u', roles: ['ADMIN'] } as any, { action: 'SNOOZE', ids: ['a', 'b'], durationHours: 72 });
  assert.equal(seen.length, 2); assert.equal(seen[0], seen[1]);
  assert.equal(result.snoozedUntil, seen[0].toISOString());
  await assert.rejects(service.bulk({ id: 'u', roles: ['ADMIN'] } as any, { action: 'SNOOZE', ids: ['a'] }), BadRequestException);
  await assert.rejects(service.bulk({ id: 'u', roles: ['ADMIN'] } as any, { action: 'ACKNOWLEDGE', ids: ['a'], durationHours: 2 }), BadRequestException);
  await assert.rejects(service.bulk({ id: 'u', roles: ['ADMIN'] } as any, { action: 'SNOOZE', ids: ['a'], durationHours: 2, userId: null }), BadRequestException);
});

test('bulk turns an unexpected error into a per-item ERROR and keeps going', async () => {
  const service = new InventoryQualityService({} as any, {} as any, {} as any, {} as any, {} as any);
  const calls: string[] = [];
  (service as any).acknowledge = async (_user: unknown, id: string) => {
    calls.push(id);
    if (id === 'boom') throw new Error('connection terminated: secret-host:5432');
    return { id, status: 'ACKNOWLEDGED' };
  };
  const result = await service.bulk({ id: 'u', roles: ['ADMIN'] } as any, { action: 'ACKNOWLEDGE', ids: ['a', 'boom', 'b'] });
  assert.deepEqual(calls, ['a', 'boom', 'b']);
  assert.equal(result.succeeded, 2); assert.equal(result.failed, 1);
  const failed = result.results[1];
  assert.equal(failed.code, 'ERROR'); assert.equal(failed.ok, false);
  assert.doesNotMatch(failed.message ?? '', /secret-host/);
});
