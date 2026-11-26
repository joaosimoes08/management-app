import { formatDate, getFormatLocale } from '@/lib/format/date';
// Direct module path: tests that mock '@/lib/i18n' (useI18n only) still get the real message table here.
import { translateMessage } from '@/lib/i18n/i18n';

/** Shared labels for scheduled reports (Definições → Relatórios and Perfil → Notificações). */
export type ReportSection = 'COMPLIANCE' | 'LIFECYCLE' | 'QUALITY' | 'CAPACITY' | 'CHANGES';
export type ReportFrequency = 'WEEKLY' | 'MONTHLY';

const SECTION_VALUES: ReportSection[] = ['COMPLIANCE', 'LIFECYCLE', 'QUALITY', 'CAPACITY', 'CHANGES'];
/** Messages in the app's current language (kept in step by I18nProvider through setFormatLocale). */
const text = (key: string, params?: Record<string, string | number>) => translateMessage(getFormatLocale(), key, undefined, params);

/** Sections in display order; `label` and `description` are read in the current app language each time. */
export const REPORT_SECTIONS: readonly { readonly value: ReportSection; readonly label: string; readonly description: string }[] = SECTION_VALUES.map((value) => ({
  value,
  get label() { return text(`reports.section.${value}`); },
  get description() { return text(`reports.section.${value}.description`); },
}));
export const SECTION_LABEL = Object.defineProperties({} as Record<ReportSection, string>, Object.fromEntries(SECTION_VALUES.map((value) => [value, { enumerable: true, get: () => text(`reports.section.${value}`) }])));
/** Weekday names, Monday first, in the current app language (1 Jan 2024 was a Monday). */
export const WEEKDAYS: readonly string[] = Object.defineProperties(Array.from({ length: 7 }, () => ''), Object.fromEntries(Array.from({ length: 7 }, (_, index) => [index, { enumerable: true, get: () => formatDate(new Date(2024, 0, 1 + index), { weekday: 'long' }) }])));

export function scheduleLabel(report: { frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string }) {
  const hour = `${String(report.hour).padStart(2, '0')}:00`;
  return report.frequency === 'WEEKLY'
    ? text('reports.schedule.weekly', { day: WEEKDAYS[(report.dayOfWeek ?? 1) - 1], hour, timezone: report.timezone })
    : text('reports.schedule.monthly', { day: report.dayOfMonth ?? 1, hour, timezone: report.timezone });
}

export const reportCsvFilename = (name: string) => `relatorio-${name.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 60) || 'agendado'}.csv`;
