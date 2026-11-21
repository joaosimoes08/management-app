import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DAY_MS, estimateCapacity } from './estimate-capacity';

const origin = Date.parse('2026-11-01T00:00:00Z');
const sample = (day: number, used: number, total: number) => ({ sampledAt: new Date(origin + day * DAY_MS), used, total });

test('subnet: 50, 60, 70 of 100 over three weekly readings reaches 90% two weeks later', () => {
  const latest = sample(14, 70, 100);
  const result = estimateCapacity([sample(0, 50, 100), sample(7, 60, 100)], latest, 90);
  assert.equal(result.currentPercent, 70);
  assert.ok(Math.abs(result.trendPer30Days! - 300 / 7) < 1e-8);
  assert.equal(result.estimatedAt, '2026-11-29T00:00:00.000Z');
  assert.equal(result.sampleCount, 3);
  assert.equal(result.status, 'PROJECTED');
});

test('PDU: 1000, 1300, 1600 W at 10-day intervals reaches custom 85% of 2000 W in 3⅓ days', () => {
  const result = estimateCapacity([sample(0, 1000, 2000), sample(10, 1300, 2000)], sample(20, 1600, 2000), 85);
  assert.equal(result.currentPercent, 80);
  assert.equal(result.trendPer30Days, 45);
  assert.equal(result.estimatedAt, '2026-11-24T08:00:00.000Z');
  assert.equal(result.status, 'PROJECTED');
});

test('requires three comparable UTC days even when already above threshold', () => {
  for (const history of [
    [sample(0, 60, 100), sample(0.3, 70, 100)],
    [sample(0, 60, 100), sample(1, 70, 150), sample(2, 80, 100)],
  ]) {
    const result = estimateCapacity(history, sample(3, 95, 100), 90);
    assert.equal(result.status, 'INSUFFICIENT');
    assert.equal(result.estimatedAt, null);
    assert.equal(result.trendPer30Days, null);
    assert.equal(result.currentPercent, 95);
    assert.equal(result.sampleCount, 2);
  }
});

test('flags measured threshold, declining trend, and forecasts beyond a year without dates', () => {
  const rows = (usage: [number, number, number]) => estimateCapacity([sample(0, usage[0], 1_000), sample(1, usage[1], 1_000)], sample(2, usage[2], 1_000), 90);
  assert.equal(rows([900, 920, 910]).status, 'ALREADY_AT_THRESHOLD');
  assert.equal(rows([700, 600, 550]).status, 'NO_GROWTH');
  const slow = rows([100, 101, 102]);
  assert.equal(slow.status, 'BEYOND_HORIZON');
  assert.equal(slow.estimatedAt, null);
});
