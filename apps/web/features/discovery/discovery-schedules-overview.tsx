'use client';

import { useEffect, useState } from 'react';
import { CalendarClock, Settings2 } from 'lucide-react';
import { useQueries } from '@tanstack/react-query';
import { useUiText } from '@/components/ui/use-ui-text';
import { formatDateTime } from '@/lib/format/date';
import { getDiscoverySchedule, type DiscoverySchedule, type DiscoverySubnet } from './api';
import { describeDiscoveryError } from './discovery-status';

/** D-P2c: how a subnet's schedule reads in the overview. "none" = never saved, the API answers with the defaults. */
export type ScheduleOverviewState = 'active' | 'paused' | 'none';

export function scheduleOverviewState(schedule: Pick<DiscoverySchedule, 'enabled' | 'id'>): ScheduleOverviewState {
  if (!schedule.id) return 'none';
  return schedule.enabled ? 'active' : 'paused';
}

export function scheduleOverviewFailed(schedule: Pick<DiscoverySchedule, 'lastStatus'>): boolean {
  return schedule.lastStatus?.trim().toUpperCase() === 'FAILED';
}

/** Counts shown above the list: active, paused (including never saved) and with a failed last run. */
export function scheduleOverviewCounts(schedules: Array<Pick<DiscoverySchedule, 'enabled' | 'lastStatus' | 'id'>>) {
  return schedules.reduce((counts, schedule) => {
    if (scheduleOverviewState(schedule) === 'active') counts.active += 1; else counts.paused += 1;
    if (scheduleOverviewFailed(schedule)) counts.failed += 1;
    return counts;
  }, { active: 0, paused: 0, failed: 0 });
}

/**
 * D-P2c: every subnet of the active Site with its discovery schedule, on one screen.
 * Each row reads the same per-subnet schedule API (and query cache) as the schedule panel, so saving there updates this list.
 */
export function DiscoverySchedulesOverview({ subnets, search = '', onOpen }: { subnets: DiscoverySubnet[]; search?: string; onOpen: (subnetId: string) => void }) {
  const t = useUiText();
  const [timeZone, setTimeZone] = useState('');
  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || ''); }, []);
  const queries = useQueries({ queries: subnets.map((subnet) => ({ queryKey: ['discovery', 'schedule', subnet.id], queryFn: () => getDiscoverySchedule(subnet.id) })) });
  const rows = subnets.map((subnet, index) => ({ subnet, query: queries[index] }));
  const visible = rows.filter(({ subnet }) => !search || subnet.cidr.toLowerCase().includes(search));
  const loaded = rows.flatMap(({ query }) => query?.data ? [query.data] : []);
  const counts = scheduleOverviewCounts(loaded);
  const when = (value: string | null) => value ? formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short', ...(timeZone ? { timeZone } : {}) }) : '—';
  const interval = (hours: number) => hours >= 24 && hours % 24 === 0 ? t('discoverySchedules.everyDays', undefined, { count: hours / 24 }) : t('discoverySchedules.everyHours', undefined, { count: hours });
  const limit = (value: number | null | undefined, effective: number | undefined, key: string) => effective === undefined ? '—' : `${t(key, undefined, { count: effective })}${value == null ? ` (${t('discoverySchedules.default')})` : ''}`;

  return <section className="ipam-card discovery-schedules-overview" aria-labelledby="discovery-schedules-overview-title">
    <div className="panel-heading"><div><h2 id="discovery-schedules-overview-title">{t('discoverySchedules.title')}</h2><p className="panel-description">{t('discoverySchedules.description')}</p></div><CalendarClock size={18} aria-hidden="true" /></div>
    {!subnets.length ? <div className="no-data">{t('discoverySchedules.noSubnets')}</div> : <>
      <p className="discovery-schedules-counts" aria-live="polite">{t('discoverySchedules.counts', undefined, { active: counts.active, paused: counts.paused, failed: counts.failed })}{timeZone ? ` · ${t('discoverySchedules.timeZone', undefined, { zone: timeZone })}` : ''}</p>
      <ul className="discovery-schedules-list">
        {visible.map(({ subnet, query }) => {
          const schedule = query?.data;
          const state = schedule ? scheduleOverviewState(schedule) : null;
          const failed = schedule ? scheduleOverviewFailed(schedule) : false;
          const status = schedule?.lastStatus?.trim().toUpperCase();
          return <li key={subnet.id} className="discovery-schedule-row" data-state={state ?? 'loading'}>
            <div className="discovery-schedule-row-head">
              <strong>{subnet.cidr}</strong>
              {state && <span className={`discovery-schedule-state ${state}`}>{t(`discoverySchedules.state.${state}`)}</span>}
              {failed && <span className="discovery-schedule-state failed">{t('discoverySchedules.failedBadge')}</span>}
              <button type="button" className="secondary-button" onClick={() => onOpen(subnet.id)} aria-label={t('discoverySchedules.openFor', undefined, { cidr: subnet.cidr })}><Settings2 size={13} aria-hidden="true" /> {t('discoverySchedules.open')}</button>
            </div>
            {query?.isPending ? <small className="no-data">{t('discoverySchedules.loading')}</small> : query?.isError || !schedule ? <small className="schedule-error-text" role="alert">{t('discoverySchedules.loadError')}</small> : <>
              <dl className="discovery-schedule-facts">
                <div><dt>{t('discoverySchedules.interval')}</dt><dd>{interval(schedule.intervalHours)}</dd></div>
                <div><dt>{t('discoverySchedules.nextRun')}</dt><dd>{state === 'active' ? when(schedule.nextRunAt) : t('discoverySchedules.notScheduled')}</dd></div>
                <div><dt>{t('discoverySchedules.lastRun')}</dt><dd className={failed ? 'schedule-error-text' : ''}>{status ? t(`discoverySchedules.status.${status}`, status) : t('discoverySchedules.neverRun')}{schedule.lastRunAt ? ` · ${when(schedule.lastRunAt)}` : ''}</dd></div>
                <div><dt>{t('discoverySchedules.rate')}</dt><dd>{limit(schedule.limits?.probesPerSecond, schedule.limits?.effective.probesPerSecond, 'discoverySchedules.rateValue')}</dd></div>
                <div><dt>{t('discoverySchedules.sockets')}</dt><dd>{limit(schedule.limits?.maxSockets, schedule.limits?.effective.maxSockets, 'discoverySchedules.socketsValue')}</dd></div>
              </dl>
              {schedule.lastError && <p className="schedule-last-error">{t('discoverySchedules.failureReason')}: {describeDiscoveryError(schedule.lastError)}</p>}
            </>}
          </li>;
        })}
      </ul>
      {!visible.length && <div className="no-data">{t('discoverySchedules.noMatches')}</div>}
    </>}
  </section>;
}
