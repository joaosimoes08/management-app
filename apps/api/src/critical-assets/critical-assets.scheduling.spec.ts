import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { weeklyWindow } from './critical-assets.service';

test('weekly attestation opens at Monday 09:00 in the Site timezone', () => {
  const before = weeklyWindow(new Date('2026-11-09T08:59:00.000Z'), 'Europe/Lisbon');
  const at = weeklyWindow(new Date('2026-11-09T09:00:00.000Z'), 'Europe/Lisbon');
  assert.equal(before.due, false);
  assert.equal(at.due, true);
  assert.equal(at.weekStart.toISOString(), '2026-11-09T00:00:00.000Z');
});

test('weekly attestation respects daylight saving time and computes the local week', () => {
  const result = weeklyWindow(new Date('2026-07-06T08:00:00.000Z'), 'Europe/Lisbon');
  assert.equal(result.due, true);
  assert.equal(result.weekStart.toISOString(), '2026-07-06T00:00:00.000Z');
});
