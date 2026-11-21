import { describe, it } from 'node:test';
import { strict as assert } from 'node:assert';
import { cadenceWeeks, computeDueState, cycleWindow, isCycleWeek, nextCycleWeek, weeklyWindow } from './critical-assets.service';
import { criticalityWrite } from '../infrastructure/criticality';

const TZ = 'Europe/Lisbon';
const SITE = { criticalCadenceT1Weeks: 1, criticalCadenceT2Weeks: 2, criticalCadenceT3Weeks: 4 };
const monday = (iso: string) => new Date(`${iso}T00:00:00.000Z`);

describe('cadence periods', () => {
  it('maps tiers to the site cadence, with T2 as the fallback', () => {
    assert.equal(cadenceWeeks('T1', SITE), 1);
    assert.equal(cadenceWeeks('T2', SITE), 2);
    assert.equal(cadenceWeeks('T3', SITE), 4);
    assert.equal(cadenceWeeks(null, SITE), 2);
  });

  it('gives a 2-week cadence every other Monday and a 4-week cadence every fourth', () => {
    const weeks = Array.from({ length: 8 }, (_, i) => monday('2026-11-23').getTime() + i * 7 * 86_400_000).map((t) => new Date(t));
    const every2 = weeks.filter((w) => isCycleWeek(w, 2)).length;
    const every4 = weeks.filter((w) => isCycleWeek(w, 4)).length;
    assert.equal(every2, 4);
    assert.equal(every4, 2);
    const first4 = nextCycleWeek(weeks[0], 4);
    assert.ok(isCycleWeek(first4, 4));
    assert.ok(first4.getTime() >= weeks[0].getTime() && first4.getTime() - weeks[0].getTime() < 4 * 7 * 86_400_000);
  });

  it('a 2-week cycle is due when the next cycle opens, two weeks later', () => {
    const weekStart = monday('2026-11-23');
    const cycle = cycleWindow(weekStart, TZ, 2);
    const weekly = cycleWindow(weekStart, TZ, 1);
    assert.equal(cycle.dueAt.getTime() - weekly.dueAt.getTime(), 7 * 86_400_000);
  });

  it('a 2-week pending cycle is not overdue one week later', () => {
    const weekStart = monday('2026-11-23');
    const now = new Date(cycleWindow(weekStart, TZ, 2).opensAt.getTime() + 7 * 86_400_000);
    const due = computeDueState([{ weekStart, outcome: null }], true, TZ, now, 2);
    assert.equal(due.dueState, 'due_this_week');
    const later = computeDueState([{ weekStart, outcome: null }], true, TZ, new Date(now.getTime() + 7 * 86_400_000), 2);
    assert.equal(later.dueState, 'overdue');
  });

  it('weekly default still reports the same due date as before for a recorded cycle', () => {
    const weekStart = monday('2026-11-23');
    const now = new Date(weeklyWindow(monday('2026-11-23'), TZ).weekStart.getTime() + 1);
    const state = computeDueState([{ weekStart, outcome: 'CONFIRMED' }], true, TZ, now);
    assert.equal(state.dueState, 'up_to_date');
  });
});

describe('criticality write rules', () => {
  it('a tier sets isCritical and marks the tier reviewed', () => {
    assert.deepEqual(criticalityWrite({ criticalityTier: 'T1' }), { criticalityTier: 'T1', isCritical: true, criticalityTierReviewed: true });
  });

  it('clearing the tier makes the device non-critical', () => {
    assert.deepEqual(criticalityWrite({ criticalityTier: null }), { criticalityTier: null, isCritical: false, criticalityTierReviewed: true });
  });

  it('legacy isCritical=true keeps an existing tier and defaults a new one to T1 unreviewed', () => {
    assert.deepEqual(criticalityWrite({ isCritical: true }, { criticalityTier: 'T3', criticalityTierReviewed: true }), { isCritical: true });
    assert.deepEqual(criticalityWrite({ isCritical: true }), { isCritical: true, criticalityTier: 'T1', criticalityTierReviewed: false });
  });

  it('legacy isCritical=false clears the tier, and no input leaves criticality alone', () => {
    assert.deepEqual(criticalityWrite({ isCritical: false }), { isCritical: false, criticalityTier: null, criticalityTierReviewed: false });
    assert.deepEqual(criticalityWrite({}), {});
  });
});
