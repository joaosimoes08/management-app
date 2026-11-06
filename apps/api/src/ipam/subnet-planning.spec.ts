import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculateIpv4SubnetPlan } from './ipam-advanced.service';

test('subnet planning counts reserved and excluded addresses as unavailable', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/29', [
    { address: '192.0.2.2', state: 'RESERVED' },
    { address: '192.0.2.3', state: 'FREE' },
    { address: '192.0.2.4', state: 'OCCUPIED' },
    { address: '192.0.2.5', state: 'EXCLUDED' },
  ]);

  assert.equal(plan.unavailable, 3);
  assert.equal(plan.free, 3);
  assert.equal(plan.utilizationPercent, 50);
  assert.deepEqual(plan.usableGaps, [
    { start: '192.0.2.1', end: '192.0.2.1', count: 1 },
    { start: '192.0.2.3', end: '192.0.2.3', count: 1 },
    { start: '192.0.2.6', end: '192.0.2.6', count: 1 },
  ]);
});
