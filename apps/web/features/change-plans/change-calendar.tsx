'use client';

import { ChevronLeft, ChevronRight } from 'lucide-react';
import { formatDate, formatDateTime } from '@/lib/format/date';
import type { ChangePlan } from './api';
import { calendarWeeks, isToday, monthKey, shiftMonth, statusLabels } from './workspace';

/** 1 Jan 2024 was a Monday: short weekday names in the app language, Monday first. */
const weekdays = () => Array.from({ length: 7 }, (_, index) => formatDate(new Date(2024, 0, 1 + index), { weekday: 'short' }));
const hour = (value: string) => formatDateTime(value, { hour: '2-digit', minute: '2-digit' });

export type ChangeCalendarProps = {
  month: Date;
  /** Plans to place (already filtered by tab, search and type). */
  plans: readonly ChangePlan[];
  /** Site-wide overlaps, so a conflict with a plan hidden by the filters is still flagged. */
  overlaps: Map<string, ChangePlan[]>;
  onMonthChange: (month: string) => void;
  onOpen: (plan: ChangePlan) => void;
};

/** Month grid (Monday first) in the app's table style; overlapping windows carry a "Sobreposição" badge. */
export function ChangeCalendar({ month, plans, overlaps, onMonthChange, onOpen }: ChangeCalendarProps) {
  const weeks = calendarWeeks(month, plans);
  const title = formatDate(month, { month: 'long', year: 'numeric' });
  const inMonth = new Set(weeks.flat().filter((day) => day.inMonth).flatMap((day) => day.plans.map((plan) => plan.id)));
  const conflicting = [...inMonth].filter((id) => overlaps.has(id)).length;

  return <section aria-labelledby="change-calendar-title">
    <div className="change-section-heading panel-heading">
      <div><h2 id="change-calendar-title">{title}</h2><p className="panel-description">{conflicting ? `${conflicting} alterações com janelas sobrepostas neste mês.` : 'Sem janelas sobrepostas neste mês.'}</p></div>
      <div className="change-actions">
        <button type="button" className="secondary-button" aria-label="Mês anterior" onClick={() => onMonthChange(monthKey(shiftMonth(month, -1)))}><ChevronLeft size={14} /></button>
        <button type="button" className="secondary-button" onClick={() => onMonthChange('')}>Hoje</button>
        <button type="button" className="secondary-button" aria-label="Mês seguinte" onClick={() => onMonthChange(monthKey(shiftMonth(month, 1)))}><ChevronRight size={14} /></button>
      </div>
    </div>
    <div className="ip-table-wrap" role="region" aria-label="Calendário de alterações" tabIndex={0}>
      <table className="ip-table change-calendar">
        <thead><tr>{weekdays().map((day) => <th key={day} scope="col">{day}</th>)}</tr></thead>
        <tbody>{weeks.map((week) => <tr key={week[0].key}>{week.map((day) => {
          const today = isToday(day.date);
          return <td key={day.key} className={day.inMonth ? undefined : 'muted-cell'} aria-current={today ? 'date' : undefined}>
            <strong><time dateTime={day.key}>{day.date.getDate()}</time>{today && <small>Hoje</small>}</strong>
            {day.plans.map((plan) => {
              const others = overlaps.get(plan.id) ?? [];
              return <button key={plan.id} type="button" className="link-button" title={`${plan.title} · ${statusLabels[plan.status]}${others.length ? ` · sobrepõe-se a ${others.map((other) => other.title).join(', ')}` : ''}`} onClick={() => onOpen(plan)}>
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
