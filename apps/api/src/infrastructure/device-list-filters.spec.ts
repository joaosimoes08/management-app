import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { deviceListFilterWhere } from './device-list-filters';

const now = new Date('2026-11-21T15:30:00Z');

test('device drill-through filters are additive and empty input changes nothing', () => {
  assert.deepEqual(deviceListFilterWhere({}, now), []);
  assert.deepEqual(deviceListFilterWhere({ status: 'active, maintenance', critical: 'true' }, now), [{ status: { in: ['ACTIVE', 'MAINTENANCE'] } }, { isCritical: true }]);
});

test('lifecycle filters use UTC day boundaries and optional kind', () => {
  assert.deepEqual(deviceListFilterWhere({ lifecycle: 'overdue' }, now), [{ lifecycleDates: { some: { dueDate: { lt: new Date('2026-11-21T00:00:00Z') } } } }]);
  assert.deepEqual(deviceListFilterWhere({ lifecycle: 'due:30', lifecycleKind: 'SUPPORT' }, now), [{ lifecycleDates: { some: { dueDate: { gte: new Date('2026-11-21T00:00:00Z'), lte: new Date('2026-12-21T00:00:00Z') }, kind: 'SUPPORT' } } }]);
  assert.deepEqual(deviceListFilterWhere({ lifecycleKind: 'WARRANTY' }, now), [{ lifecycleDates: { some: { kind: 'WARRANTY' } } }]);
});

test('invalid drill-through filters are rejected with a code', () => {
  for (const input of [{ status: 'BROKEN' }, { critical: 'yes' }, { lifecycle: 'due:0' }, { lifecycle: 'soon' }]) {
    assert.throws(() => deviceListFilterWhere(input, now), (error: { getStatus(): number; getResponse(): { code: string } }) => error.getStatus() === 400 && /^DEVICE_/.test(error.getResponse().code));
  }
});
