import { describe, expect, it } from 'vitest';
import type { CalendarChangePlan, ChangeCalendar, ChangePlan } from './api';
import { activityLabels, buildTimeline, checkValue, closingNoteRequired, parseChecklistLines, calendarChunks, calendarRange, calendarWeeks, candidateLabels, dayBoundary, filterPlans, matchesText, mergeCalendars, monthKey, overlapsFor, parseMonth, shiftMonth, spanOf } from './workspace';

const plan = (id: string, start: string, end: string, extra: Partial<ChangePlan> = {}): ChangePlan => ({
  id, siteId: 's1', title: `Plano ${id}`, reason: 'Motivo', plannedStartAt: start, plannedEndAt: end, status: 'DRAFT', revision: 1,
  previewRevision: null, previewSnapshot: null, previewedAt: null, submittedAt: null, items: [], ...extra,
});
const local = (y: number, m: number, d: number, h = 0, min = 0) => new Date(y, m - 1, d, h, min).toISOString();
const calendarPlan = (id: string, start: string, end: string, overlapsWith: CalendarChangePlan['overlapsWith'] = [], extra: Partial<CalendarChangePlan> = {}): CalendarChangePlan => ({
  id, title: `Plano ${id}`, status: 'SUBMITTED', plannedStartAt: start, plannedEndAt: end, revision: 1, targetCount: 1, overlapsWith, conflict: false, ...extra,
});
const calendar = (changePlans: CalendarChangePlan[], maintenanceWindows: ChangeCalendar['maintenanceWindows'] = [], truncated = false): ChangeCalendar => ({ siteId: 's1', from: '', to: '', changePlans, maintenanceWindows, truncated });
const overlap = (kind: 'CHANGE_PLAN' | 'MAINTENANCE_WINDOW', id: string, sharedTargetCount = 0) => ({ kind, id, overlapStartsAt: '2026-11-20T11:00:00.000Z', overlapEndsAt: '2026-11-20T12:00:00.000Z', sharedTargetCount });

describe('server overlaps', () => {
  it('splits long ranges into 120-day calls and marks a capped range incomplete', () => {
    const from = new Date('2026-01-01T00:00:00.000Z');
    expect(calendarChunks(from, new Date('2026-02-01T00:00:00.000Z'))).toEqual([{ from: from.toISOString(), to: '2026-02-01T00:00:00.000Z', complete: true }]);
    const long = calendarChunks(from, new Date('2027-01-01T00:00:00.000Z'));
    expect(long).toHaveLength(4);
    expect(long[1].from).toBe(long[0].to);
    expect(long.at(-1)!.to).toBe('2027-01-01T00:00:00.000Z');
    const capped = calendarChunks(from, new Date('2030-01-01T00:00:00.000Z'), 120, 2);
    expect(capped).toHaveLength(2);
    expect(capped[1].complete).toBe(false);
  });

  it('merges a plan returned by two ranges without duplicating its overlaps, and resolves titles', () => {
    const a1 = calendarPlan('a', local(2026, 11, 20, 10), local(2026, 11, 20, 12), [overlap('CHANGE_PLAN', 'b', 1)]);
    const a2 = calendarPlan('a', local(2026, 11, 20, 10), local(2026, 11, 20, 12), [overlap('CHANGE_PLAN', 'b', 1), overlap('MAINTENANCE_WINDOW', 'm')], { conflict: true });
    const b = calendarPlan('b', local(2026, 11, 20, 11), local(2026, 11, 20, 13), [overlap('CHANGE_PLAN', 'a', 1)], { title: 'Renomear VLAN', status: 'APPROVED' });
    const m = { id: 'm', name: 'Janela de rede', siteId: 's1', startsAt: local(2026, 11, 20, 11), endsAt: local(2026, 11, 20, 14), global: false, overlapsWith: [overlap('CHANGE_PLAN', 'a')], conflict: false };
    const data = mergeCalendars([calendar([a1, b]), calendar([a2], [m])]);
    expect(data.plans.get('a')?.overlapsWith).toHaveLength(2);
    expect(data.plans.get('a')?.conflict).toBe(true);
    expect(overlapsFor(data, 'a')).toEqual([
      { kind: 'CHANGE_PLAN', id: 'b', title: 'Renomear VLAN', status: 'APPROVED', startsAt: b.plannedStartAt, endsAt: b.plannedEndAt, sharedTargetCount: 1 },
      { kind: 'MAINTENANCE_WINDOW', id: 'm', title: 'Janela de rede', startsAt: m.startsAt, endsAt: m.endsAt, sharedTargetCount: 0 },
    ]);
    expect(overlapsFor(data, 'unknown')).toEqual([]);
    expect(mergeCalendars([calendar([], [], true)]).truncated).toBe(true);
  });

  it('spans only the plans that can overlap', () => {
    expect(spanOf([plan('x', local(2026, 11, 1), local(2026, 11, 2), { status: 'CANCELLED' })])).toBeNull();
    const span = spanOf([plan('a', local(2026, 11, 5), local(2026, 11, 6)), plan('b', local(2026, 11, 1), local(2026, 11, 3)), plan('c', local(2026, 10, 1), local(2026, 10, 2), { status: 'CANCELLED' })]);
    expect(span).toEqual({ from: new Date(local(2026, 11, 1)), to: new Date(local(2026, 11, 6)) });
  });
});

describe('search and filters', () => {
  const labels = candidateLabels([{ entityType: 'DEVICE', entityId: 'd1', label: 'Core-SW-01', detail: '10.0.0.1' }]);
  const target = plan('t', local(2026, 11, 1), local(2026, 11, 2), { title: 'Atualização', items: [{ entityType: 'DEVICE', entityId: 'd1', operationSummary: 'Firmware 9.4' }], status: 'SUBMITTED' });
  const other = plan('o', local(2026, 11, 1), local(2026, 11, 2), { title: 'Outra', items: [{ entityType: 'VLAN', entityId: 'v1', operationSummary: 'Renomear' }] });

  it('matches the same fields as the API q (title, reason, operations)', () => {
    expect(matchesText(target, 'firmware 9.4')).toBe(true);
    expect(matchesText(target, 'ATUALIZ')).toBe(true);
    expect(matchesText(target, 'core-sw')).toBe(false);
    expect(labels.get('DEVICE:d1')).toBe('Core-SW-01 · 10.0.0.1');
  });

  it('keeps plans touching the targets the search matched, and filters by target type', () => {
    expect(filterPlans([target, other], { search: 'core-sw', type: '', targetKeys: new Set(['DEVICE:d1']) }).map((p) => p.id)).toEqual(['t']);
    expect(filterPlans([target, other], { search: 'renomear', type: '', targetKeys: new Set(['DEVICE:d1']) }).map((p) => p.id)).toEqual(['t', 'o']);
    expect(filterPlans([target, other], { search: '', type: 'VLAN' }).map((p) => p.id)).toEqual(['o']);
  });

  it('turns date inputs into local day boundaries', () => {
    expect(dayBoundary('2026-11-05')).toBe(new Date(2026, 10, 5).toISOString());
    expect(dayBoundary('2026-11-05', true)).toBe(new Date(2026, 10, 6).toISOString());
    expect(dayBoundary('')).toBeUndefined();
    expect(dayBoundary('05/11/2026')).toBeUndefined();
  });
});

describe('calendar', () => {
  it('parses YYYY-MM and falls back to the given month', () => {
    expect(monthKey(parseMonth('2026-02'))).toBe('2026-02');
    expect(monthKey(parseMonth('2026-13', new Date(2026, 10, 21)))).toBe('2026-11');
    expect(monthKey(shiftMonth(parseMonth('2026-12'), 1))).toBe('2027-01');
  });

  it('builds Monday-first weeks and places multi-day windows and maintenance on every day they touch', () => {
    const spanning = calendarPlan('span', local(2026, 11, 2, 22), local(2026, 11, 4, 0)); // ends exactly at midnight
    const window = { id: 'm', name: 'Manutenção', siteId: null, startsAt: local(2026, 11, 10, 22), endsAt: local(2026, 11, 11, 2), global: true, overlapsWith: [], conflict: false };
    const weeks = calendarWeeks(new Date(2026, 10, 1), [spanning], [window]);
    expect(weeks[0][0].date.getDay()).toBe(1);
    expect(weeks.every((week) => week.length === 7)).toBe(true);
    expect(weeks.flat().filter((day) => day.plans.length).map((day) => day.date.getDate())).toEqual([2, 3]);
    expect(weeks.flat().filter((day) => day.windows.length).map((day) => day.date.getDate())).toEqual([10, 11]);
    expect(weeks.flat().filter((day) => day.inMonth)).toHaveLength(30);
    const range = calendarRange(new Date(2026, 10, 1));
    expect(range.from).toEqual(weeks[0][0].date);
    expect(range.days).toBe(weeks.length * 7);
  });
});

describe('buildTimeline', () => {
  it('lists the audit trail newest first with actor, note and revision', () => {
    const timeline = buildTimeline([
      { id: '1', action: 'CHANGE_PLAN_CREATED', at: '2026-11-01T08:00:00Z', actor: { username: 'ana' } },
      { id: '2', action: 'CHANGE_PLAN_REJECTED', at: '2026-11-01T09:00:00Z', actor: { username: 'rui', displayName: 'Rui Admin' }, note: 'Falta rollback', revision: 2 },
    ]);
    expect(timeline.map((entry) => entry.id)).toEqual(['2', '1']);
    expect(timeline[0]).toMatchObject({ actor: 'Rui Admin', note: 'Falta rollback', revision: 2 });
    expect(timeline[1].actor).toBe('ana');
  });
});

describe('implementation and close-out (Step 30)', () => {
  it('reads checklist lines one per line, trimmed, without blanks, one-letter lines or duplicates', () => {
    expect(parseChecklistLines('  Guardar configuração \n\nx\nReiniciar\r\nreiniciar\n')).toEqual(['Guardar configuração', 'Reiniciar']);
    expect(parseChecklistLines('a'.repeat(300))[0]).toHaveLength(240);
  });
  it('needs a closing note only for failed or rolled-back changes', () => {
    expect(closingNoteRequired('COMPLETED')).toBe(false);
    expect(closingNoteRequired('FAILED')).toBe(true);
    expect(closingNoteRequired('ROLLED_BACK')).toBe(true);
  });
  it('labels the new audit actions and shows compared values as text', () => {
    for (const action of ['CHANGE_PLAN_STARTED', 'CHANGE_PLAN_COMPLETED', 'CHANGE_PLAN_FAILED', 'CHANGE_PLAN_ROLLED_BACK', 'CHANGE_PLAN_CHECKLIST_TICKED']) expect(activityLabels[action]).toBeTruthy();
    expect(checkValue(null)).toBe('—');
    expect(checkValue(24)).toBe('24');
    expect(checkValue({ a: 1 })).toBe('{"a":1}');
  });
});
