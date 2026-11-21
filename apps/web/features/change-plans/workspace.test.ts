import { describe, expect, it } from 'vitest';
import type { ChangePlan } from './api';
import { buildTimeline, calendarWeeks, candidateLabels, countByStatus, filterPlans, matchesSearch, monthKey, overlapIndex, parseMonth, shiftMonth } from './workspace';

const plan = (id: string, start: string, end: string, extra: Partial<ChangePlan> = {}): ChangePlan => ({
  id, siteId: 's1', title: `Plano ${id}`, reason: 'Motivo', plannedStartAt: start, plannedEndAt: end, status: 'DRAFT', revision: 1,
  previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null, items: [], ...extra,
});
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();

describe('overlapIndex', () => {
  it('pairs overlapping windows both ways and treats windows as half-open', () => {
    const a = plan('a', local(2026, 11, 20, 10), local(2026, 11, 20, 12));
    const b = plan('b', local(2026, 11, 20, 11), local(2026, 11, 20, 13));
    const c = plan('c', local(2026, 11, 20, 13), local(2026, 11, 20, 14)); // starts when b ends
    const index = overlapIndex([c, b, a]);
    expect(index.get('a')?.map((p) => p.id)).toEqual(['b']);
    expect(index.get('b')?.map((p) => p.id)).toEqual(['a']);
    expect(index.has('c')).toBe(false);
  });

  it('ignores cancelled plans and finds a long window overlapping several short ones', () => {
    const long = plan('long', local(2026, 11, 1), local(2026, 11, 30));
    const x = plan('x', local(2026, 11, 5), local(2026, 11, 6));
    const y = plan('y', local(2026, 11, 20), local(2026, 11, 21));
    const cancelled = plan('z', local(2026, 11, 5), local(2026, 11, 6), { status: 'CANCELLED' });
    const index = overlapIndex([long, x, y, cancelled]);
    expect(index.get('long')?.map((p) => p.id).sort()).toEqual(['x', 'y']);
    expect(index.has('z')).toBe(false);
    expect(index.get('x')?.map((p) => p.id)).toEqual(['long']);
  });
});

describe('search and status counts', () => {
  const labels = candidateLabels([{ entityType: 'DEVICE', entityId: 'd1', label: 'Core-SW-01', detail: '10.0.0.1' }]);
  const target = plan('t', local(2026, 11, 1), local(2026, 11, 2), { title: 'Atualização', items: [{ entityType: 'DEVICE', entityId: 'd1', operationSummary: 'Firmware 9.4' }], status: 'SUBMITTED' });
  const other = plan('o', local(2026, 11, 1), local(2026, 11, 2), { title: 'Outra', items: [{ entityType: 'VLAN', entityId: 'v1', operationSummary: 'Renomear' }] });

  it('matches target labels, operations, ids and ignores accents', () => {
    expect(matchesSearch(target, 'core-sw', labels)).toBe(true);
    expect(matchesSearch(target, 'firmware 9.4', labels)).toBe(true);
    expect(matchesSearch(target, 'atualizacao', labels)).toBe(true);
    expect(matchesSearch(target, 't', labels)).toBe(true);
    expect(matchesSearch(other, 'core', labels)).toBe(false);
  });

  it('filters by target type and counts each status', () => {
    expect(filterPlans([target, other], '', { type: 'VLAN' }, labels).map((p) => p.id)).toEqual(['o']);
    expect(countByStatus([target, other])).toMatchObject({ ALL: 2, SUBMITTED: 1, DRAFT: 1, APPROVED: 0 });
  });
});

describe('calendar', () => {
  it('parses YYYY-MM and falls back to the given month', () => {
    expect(monthKey(parseMonth('2026-02'))).toBe('2026-02');
    expect(monthKey(parseMonth('2026-13', new Date(2026, 10, 21)))).toBe('2026-11');
    expect(monthKey(shiftMonth(parseMonth('2026-12'), 1))).toBe('2027-01');
  });

  it('builds Monday-first weeks and places multi-day windows on every day they touch', () => {
    const spanning = plan('span', local(2026, 11, 2, 22), local(2026, 11, 4, 0)); // ends exactly at midnight
    const weeks = calendarWeeks(new Date(2026, 10, 1), [spanning]);
    expect(weeks[0][0].date.getDay()).toBe(1);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    const days = weeks.flat().filter((day) => day.plans.length).map((day) => day.date.getDate());
    expect(days).toEqual([2, 3]);
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(30);
  });
});

describe('buildTimeline', () => {
  it('falls back to the milestones recorded on the plan, newest first', () => {
    const reviewed = plan('r', local(2026, 11, 1), local(2026, 11, 2), {
      status: 'REJECTED', createdAt: '2026-11-01T08:00:00Z', previewedAt: '2026-11-01T09:00:00Z', previewRevision: 2,
      submittedAt: '2026-11-01T10:00:00Z', reviewedAt: '2026-11-01T11:00:00Z', reviewNote: 'Falta rollback',
      creator: { username: 'ana' }, reviewer: { username: 'rui', displayName: 'Rui Admin' },
    });
    const timeline = buildTimeline(reviewed, null);
    expect(timeline.map((entry) => entry.action)).toEqual(['CHANGE_PLAN_REJECTED', 'CHANGE_PLAN_SUBMITTED', 'CHANGE_PLAN_IMPACT_PREVIEWED', 'CHANGE_PLAN_CREATED']);
    expect(timeline[0]).toMatchObject({ actor: 'Rui Admin', note: 'Falta rollback' });
    expect(timeline[3].actor).toBe('ana');
  });

  it('uses the activity log when the API provides one', () => {
    const timeline = buildTimeline(plan('p', local(2026, 11, 1), local(2026, 11, 2)), [
      { id: '1', action: 'CHANGE_PLAN_CREATED', at: '2026-11-01T08:00:00Z', actor: { username: 'ana' } },
      { id: '2', action: 'CHANGE_PLAN_UPDATED', at: '2026-11-01T09:00:00Z', actor: { username: 'ana' }, revision: 2 },
    ]);
    expect(timeline.map((entry) => entry.id)).toEqual(['2', '1']);
    expect(timeline[0].revision).toBe(2);
  });
});
