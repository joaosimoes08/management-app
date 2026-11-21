import { zonedWallClockToInstant } from '../critical-assets/critical-assets.service';

export type ReportFrequency = 'WEEKLY' | 'MONTHLY';
export type ReportScheduleInput = { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string };
/** Local calendar dates (UTC-midnight Dates): start inclusive, end exclusive. */
export type ReportPeriod = { start: Date; end: Date };

const DAY_MS = 86_400_000;

function localDate(instant: Date, timezone: string) {
  const parts = Object.fromEntries(new Intl.DateTimeFormat('en-CA', { timeZone: timezone, year: 'numeric', month: '2-digit', day: '2-digit' }).formatToParts(instant).map(({ type, value }) => [type, value]));
  return new Date(`${parts.year}-${parts.month}-${parts.day}T00:00:00.000Z`);
}

export const isoDay = (date: Date) => date.toISOString().slice(0, 10);
export const addDays = (date: Date, days: number) => new Date(date.getTime() + days * DAY_MS);

/** Today's calendar date in `timezone`, as a UTC-midnight Date. */
export function localToday(now: Date, timezone: string) {
  return localDate(now, timezone);
}

/** Midnight of a local calendar date in `timezone`, as the real instant. */
export function localMidnight(date: Date, timezone: string) {
  return zonedWallClockToInstant(date, 0, timezone);
}

/** ISO weekday 1 (Monday) to 7 (Sunday) of a UTC-midnight calendar date. */
const isoWeekday = (date: Date) => ((date.getUTCDay() + 6) % 7) + 1;

function matches(schedule: ReportScheduleInput, date: Date) {
  return schedule.frequency === 'WEEKLY' ? isoWeekday(date) === schedule.dayOfWeek : date.getUTCDate() === schedule.dayOfMonth;
}

/** First scheduled send strictly after `after` (day and hour are local to the report's time zone). */
export function nextRunAt(schedule: ReportScheduleInput, after: Date) {
  const start = addDays(localDate(after, schedule.timezone), -1);
  for (let offset = 0; offset < 70; offset++) {
    const date = addDays(start, offset);
    if (!matches(schedule, date)) continue;
    const instant = zonedWallClockToInstant(date, schedule.hour, schedule.timezone);
    if (instant.getTime() > after.getTime()) return instant;
  }
  throw new Error('No scheduled date found');
}

/**
 * The period a report sent at `at` covers: the 7 days before the send date (weekly) or the previous calendar month
 * (monthly), in the report's time zone. Reports run on demand use the period the next scheduled send would cover now.
 */
export function reportPeriod(frequency: ReportFrequency, at: Date, timezone: string): ReportPeriod {
  const today = localDate(at, timezone);
  if (frequency === 'WEEKLY') return { start: addDays(today, -7), end: today };
  const end = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth(), 1));
  return { start: new Date(Date.UTC(end.getUTCFullYear(), end.getUTCMonth() - 1, 1)), end };
}

/** Last day included in the period, for display. */
export const lastDay = (period: ReportPeriod) => addDays(period.end, -1);
