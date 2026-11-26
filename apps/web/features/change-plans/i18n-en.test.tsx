import { render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { setFormatLocale } from '@/lib/format/date';
import type { CalendarChangePlan } from './api';
import { ChangeCalendar } from './change-calendar';
import { REPORT_SECTIONS, scheduleLabel, SECTION_LABEL, WEEKDAYS } from '@/features/reports/report-labels';

// Render the change-plans components as the app does in English.
vi.mock('@/lib/i18n/i18n', async (importOriginal) => {
  const actual = await importOriginal<typeof import('@/lib/i18n/i18n')>();
  return { ...actual, useOptionalI18n: () => ({ t: (key: string, fallback?: string, params?: Record<string, string | number>) => actual.translateMessage('en-US', key, fallback, params) }) };
});

const plan = (id: string, title: string, overlapsWith: CalendarChangePlan['overlapsWith'] = []): CalendarChangePlan => ({ id, title, status: 'APPROVED', plannedStartAt: '2026-11-10T09:00:00.000Z', plannedEndAt: '2026-11-10T11:00:00.000Z', revision: 1, targetCount: 1, overlapsWith, conflict: overlapsWith.length > 0 });

describe('change plans and reports in en-US', () => {
  afterEach(() => setFormatLocale('pt-PT'));

  it('shows the calendar summary, legend and overlap titles in English', () => {
    setFormatLocale('en-US');
    const a = plan('a', 'Core switch', [{ kind: 'CHANGE_PLAN', id: 'b', overlapStartsAt: '2026-11-10T09:00:00.000Z', overlapEndsAt: '2026-11-10T11:00:00.000Z', sharedTargetCount: 1 }]);
    const b = plan('b', 'Firewall', [{ kind: 'CHANGE_PLAN', id: 'a', overlapStartsAt: '2026-11-10T09:00:00.000Z', overlapEndsAt: '2026-11-10T11:00:00.000Z', sharedTargetCount: 1 }]);
    const overlaps = { plans: new Map([['a', a], ['b', b]]), windows: new Map(), truncated: false };
    render(<ChangeCalendar month={new Date(2026, 10, 1)} plans={[a, b]} windows={[]} overlaps={overlaps} onMonthChange={() => undefined} onOpen={() => undefined} />);
    expect(screen.getByText('2 changes with overlapping windows this month.')).toBeInTheDocument();
    expect(screen.getByText('Returned for correction')).toBeInTheDocument();
    expect(screen.getByTitle('Core switch · Approved · overlaps Firewall')).toBeInTheDocument();
  });

  it('builds report labels in the app language', () => {
    const report = { frequency: 'WEEKLY' as const, dayOfWeek: 1, dayOfMonth: null, hour: 8, timezone: 'Europe/Lisbon' };
    expect(scheduleLabel(report)).toBe('Semanal · segunda-feira às 08:00 (Europe/Lisbon)');
    setFormatLocale('en-US');
    expect(scheduleLabel(report)).toBe('Weekly · Monday at 08:00 (Europe/Lisbon)');
    expect(scheduleLabel({ ...report, frequency: 'MONTHLY', dayOfMonth: 15 })).toBe('Monthly · day 15 at 08:00 (Europe/Lisbon)');
    expect(REPORT_SECTIONS.map(({ label }) => label)).toEqual(['Attestation compliance', 'Lifecycle dates', 'Inventory quality', 'Capacity', 'Changes']);
    expect(SECTION_LABEL.CHANGES).toBe('Changes');
    expect(WEEKDAYS[6]).toBe('Sunday');
    expect(WEEKDAYS.map((day) => day)).toHaveLength(7);
  });
});
