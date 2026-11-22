import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { activeReservationWhere, rackSpaceUsage, spansOverlap, spanUnits } from './rack-unit-reservations';

test('Round 2 #18: span overlap is inclusive of the first and last unit', () => {
  assert.equal(spansOverlap({ startUnit: 10, size: 4 }, { startUnit: 13, size: 1 }), true);
  assert.equal(spansOverlap({ startUnit: 10, size: 4 }, { startUnit: 14, size: 2 }), false);
  assert.equal(spansOverlap({ startUnit: 5, size: 1 }, { startUnit: 1, size: 5 }), true);
  assert.deepEqual(spanUnits({ startUnit: 41, size: 4 }, 42), [41, 42]);
});

test('Round 2 #18: reserved units exclude units a device already fills; active means unreleased and unexpired', () => {
  assert.deepEqual(rackSpaceUsage(42, [{ rackUnitStart: 1, rackUnitSize: 2 }, { rackUnitStart: null, rackUnitSize: 1 }], [{ startUnit: 2, size: 3 }]), { occupied: 2, reserved: 2, used: 4 });
  const now = new Date('2026-11-23T00:00:00Z');
  assert.deepEqual(activeReservationWhere(now), { releasedAt: null, OR: [{ expiresAt: null }, { expiresAt: { gt: now } }] });
});
