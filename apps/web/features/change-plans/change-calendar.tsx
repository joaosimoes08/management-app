'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/format/date';
import type { CalendarChangePlan, CalendarMaintenanceWindow } from './api';
import { statusText, useChangeT } from './i18n';
import { calendarWeeks, changeStatuses, isToday, monthKey, overlapsFor, shiftMonth, type OverlapData } from './workspace';

/** 1 Jan 2024 was a Monday: short weekday names in the app language, Monday first. */
const weekdays = () => Array.from({ length: 7 }, (_, index) => formatDate(new Date(2024, 0, 1 + index), { weekday: 'short' }));
const hour = (value: string) => formatDateTime(value, { hour: '2-digit', minute: '2-digit' });

export type ChangeCalendarProps = {
  month: Date;
  /** Plans to place (already filtered by tab, search and type). */
  plans: readonly CalendarChangePlan[];
  /** Maintenance windows in the grid's range. */
  windows: readonly CalendarMaintenanceWindow[];
  /** Overlaps computed by the API for the whole Site, so a conflict with a plan hidden by the filters is still flagged. */
  overlaps: OverlapData;
  /** The overlap check could not be loaded. */
  overlapError?: boolean;
  onMonthChange: (month: string) => void;
  onOpen: (plan: Pick<CalendarChangePlan, 'id'>) => void;
};

/** Month grid (Monday first) in the app's table style; overlapping windows carry a "Sobreposição" badge. */
export function ChangeCalendar({ month, plans, windows, overlaps, overlapError, onMonthChange, onOpen }: ChangeCalendarProps) {
  const t = useChangeT();
  const weeks = calendarWeeks(month, plans, windows);
  const title = formatDate(month, { month: 'long', year: 'numeric' });
  const inMonth = new Set(weeks.flat().filter((day) => day.inMonth).flatMap((day) => day.plans.map((plan) => plan.id)));
  const conflicting = [...inMonth].filter((id) => overlapsFor(overlaps, id).length > 0).length;

  return <section aria-labelledby="change-calendar-title">
    <div className="change-section-heading panel-heading">
      <div><h2 id="change-calendar-title">{title}</h2><p className="panel-description">{overlapError ? 'Não foi possível verificar as sobreposições.' : conflicting ? t('changePlans.calendar.overlapsInMonth', { count: conflicting }) : 'Sem janelas sobrepostas neste mês.'}</p></div>
      <div className="change-actions">
        <button type="button" className="secondary-button" aria-label="Mês anterior" onClick={() => onMonthChange(monthKey(shiftMonth(month, -1)))}><ChevronLeft size={14} /></button>
        <button type="button" className="secondary-button" onClick={() => onMonthChange('')}>Hoje</button>
        <button type="button" className="secondary-button" aria-label="Mês seguinte" onClick={() => onMonthChange(monthKey(shiftMonth(month, 1)))}><ChevronRight size={14} /></button>
      </div>
    </div>
    <ul className="change-calendar-legend" aria-label="Legenda do calendário">
      {changeStatuses.map((status) => <li key={status}><span className={`change-status status-${status.toLowerCase()}`}>{statusText(t, status)}</span></li>)}
      <li><span className="state-badge reserved"><i />Manutenção</span></li>
      <li className="muted-cell">As canceladas aparecem no separador Canceladas.</li>
    </ul>
    <div className="ip-table-wrap" role="region" aria-label="Calendário de alterações" tabIndex={0}>
      <table className="ip-table change-calendar">
        <thead><tr>{weekdays().map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
        <tbody>{weeks.map((week) => <tr key={week[0].key}>{week.map((day) => {
          const today = isToday(day.date);
          return <td key={day.key} className={day.inMonth ? undefined : 'muted-cell'} aria-current={today ? 'date' : undefined}>
            <strong><time dateTime={day.key}>{day.date.getDate()}</time>{today && <small>Hoje</small>}</strong>
            {day.windows.map((item) => <span key={item.id} className="muted-cell" title={`${item.name} · ${hour(item.startsAt)} – ${hour(item.endsAt)}${item.reason ? ` · ${item.reason}` : ''}`}>
              <span className="state-badge reserved"><i />Manutenção</span> {item.name}
            </span>)}
            {day.plans.map((plan) => {
              const others = overlapsFor(overlaps, plan.id);
              return <button key={plan.id} type="button" className="link-button" title={others.length ? t('changePlans.calendar.planTitleOverlaps', { title: plan.title, status: statusText(t, plan.status), others: others.map((other) => other.title).join(', ') }) : `${plan.title} · ${statusText(t, plan.status)}`} onClick={() => onOpen(plan)}>
                <span className={`change-status status-${plan.status.toLowerCase()}`}>{hour(plan.plannedStartAt)}</span>
                <span>{plan.title}</span>
                {others.length > 0 && <span className="state-badge excluded"><i />Sobreposição</span>}
              </button>;
            })}
          </td>;
        })}</tr>)}</tbody>
      </table>
    </div>
  </section>;
}
