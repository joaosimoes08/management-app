'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { useUiText } from '@/components/ui/use-ui-text';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { HISTORY_RANGES, deviceHealthHistoryKey, getDeviceHealthHistory, historyCpu, type HealthHistoryItem, type HistoryRangeId, type Limits } from './thresholds-api';
import { useDeviceHealthThresholds } from './health-limits-panels';

type UiText = ReturnType<typeof useUiText>;
export type Point = { time: number; value: number };
export type SeriesStats = { min: number; max: number; avg: number; latest: number } | null;
type Metric = 'cpu' | 'memory' | 'temperature';

const PICK: Record<Metric, (item: HealthHistoryItem) => number | null> = {
  cpu: historyCpu,
  memory: (item) => item.memoryUsedPercent,
  temperature: (item) => item.maxTemperatureCelsius,
};

/**
 * Downsamples the readings to at most `maxPoints` (the highest value of each group, so a peak that would fire an alert
 * is never averaged away) and splits the line where a value is missing or the device was not polled for more than
 * three usual intervals, so a gap never looks like a straight ramp.
 */
export function buildSeries(items: HealthHistoryItem[], pick: (item: HealthHistoryItem) => number | null, maxPoints = 240): { segments: Point[][]; stats: SeriesStats } {
  const times = items.map((item) => Date.parse(item.observedAt));
  const gaps = times.slice(1).map((time, index) => time - times[index]).filter((gap) => gap > 0).sort((a, b) => a - b);
  const usual = gaps.length ? gaps[Math.floor(gaps.length / 2)] : Infinity;
  const size = Math.max(1, Math.ceil(items.length / maxPoints));
  const segments: Point[][] = [];
  let current: Point[] = [];
  let previousEnd: number | null = null;
  const values: number[] = [];
  for (let start = 0; start < items.length; start += size) {
    const group = items.slice(start, start + size);
    const groupValues = group.map(pick).filter((value): value is number => value !== null && Number.isFinite(value));
    values.push(...groupValues);
    const firstTime = times[start];
    if (previousEnd !== null && firstTime - previousEnd > usual * 3 && current.length) { segments.push(current); current = []; }
    previousEnd = times[Math.min(start + size, items.length) - 1];
    if (!groupValues.length) { if (current.length) { segments.push(current); current = []; } continue; }
    current.push({ time: previousEnd, value: Math.max(...groupValues) });
  }
  if (current.length) segments.push(current);
  const latest = [...items].reverse().map(pick).find((value): value is number => value !== null && Number.isFinite(value));
  const stats = values.length && latest !== undefined ? { min: Math.min(...values), max: Math.max(...values), avg: values.reduce((sum, value) => sum + value, 0) / values.length, latest } : null;
  return { segments, stats };
}

const unitOf = (metric: Metric) => (metric === 'temperature' ? ' °C' : '%');
const fmt = (metric: Metric, value: number) => `${formatNumber(value, { maximumFractionDigits: 1 })}${unitOf(metric)}`;

function MetricChart({ t, metric, segments, stats, limit, from, to, reboots, rangeLabel }: { t: UiText; metric: Metric; segments: Point[][]; stats: SeriesStats; limit: number | null; from: number; to: number; reboots: number[]; rangeLabel: string }) {
  const title = t(`healthHistory.${metric}`);
  if (!stats) return <figure className="health-history-metric"><figcaption><strong>{title}</strong></figcaption><p className="panel-description">{t('healthHistory.noValues')}</p></figure>;
  const percent = metric !== 'temperature';
  const top = percent ? 100 : Math.ceil(Math.max(stats.max, limit ?? -Infinity) + 5);
  const bottom = percent ? 0 : Math.min(0, Math.floor(stats.min - 5));
  const span = Math.max(1, to - from);
  const x = (time: number) => 2 + ((time - from) / span) * 96;
  const y = (value: number) => 46 - ((value - bottom) / Math.max(1, top - bottom)) * 42;
  const label = t('healthHistory.chartLabel', undefined, { metric: title, range: rangeLabel, min: fmt(metric, stats.min), max: fmt(metric, stats.max), latest: fmt(metric, stats.latest) })
    + (limit !== null ? ` ${t('healthHistory.limitLabel', undefined, { value: fmt(metric, limit) })}` : '');
  return <figure className="health-history-metric" data-metric={metric}>
    <figcaption><strong>{title}</strong><span>{t('healthHistory.latest', undefined, { value: fmt(metric, stats.latest) })}</span></figcaption>
    <div className="health-history-plot">
      <span className="health-history-axis top" aria-hidden="true">{fmt(metric, top)}</span>
      <span className="health-history-axis bottom" aria-hidden="true">{fmt(metric, bottom)}</span>
      <svg className="health-history-chart" viewBox="0 0 100 48" preserveAspectRatio="none" role="img" aria-label={label}>
        <line className="grid" x1="2" x2="98" y1="4" y2="4" vectorEffect="non-scaling-stroke" />
        <line className="grid" x1="2" x2="98" y1="46" y2="46" vectorEffect="non-scaling-stroke" />
        {reboots.map((time) => <line key={time} className="reboot" x1={x(time)} x2={x(time)} y1="4" y2="46" vectorEffect="non-scaling-stroke" />)}
        {limit !== null && limit >= bottom && limit <= top && <line className="limit" x1="2" x2="98" y1={y(limit)} y2={y(limit)} vectorEffect="non-scaling-stroke" />}
        {segments.map((segment, index) => segment.length === 1
          ? <line key={index} className="dot" x1={x(segment[0].time)} x2={x(segment[0].time)} y1={y(segment[0].value)} y2={y(segment[0].value)} vectorEffect="non-scaling-stroke" />
          : <polyline key={index} points={segment.map((point) => `${x(point.time).toFixed(2)},${y(point.value).toFixed(2)}`).join(' ')} vectorEffect="non-scaling-stroke" />)}
      </svg>
      {limit !== null && limit >= bottom && limit <= top && <span className="health-history-limit" aria-hidden="true" style={{ top: `${(y(limit) / 48) * 100}%` }}>{t('healthHistory.limit', undefined, { value: fmt(metric, limit) })}</span>}
    </div>
  </figure>;
}

/**
 * Device 360 health history: CPU, memory and the hottest sensor over 24 h / 7 d / 30 d (GET …/health/history), one small
 * chart per metric so each keeps its own scale, with the limit in effect drawn as a dashed line and reboots marked.
 * "Mostrar os valores" gives the same figures as a table.
 */
export function HealthHistoryChart({ deviceId }: { deviceId: string }) {
  const t = useUiText();
  const [range, setRange] = useState<HistoryRangeId>('24h');
  const hours = HISTORY_RANGES.find((item) => item.id === range)!.hours;
  const query = useQuery({ queryKey: deviceHealthHistoryKey(deviceId, hours), queryFn: () => getDeviceHealthHistory(deviceId, hours), enabled: Boolean(deviceId), retry: false, refetchInterval: 300_000, placeholderData: (previous) => previous });
  const limits: Limits | undefined = useDeviceHealthThresholds(deviceId).data?.effective;
  const rangeLabel = t(`healthHistory.range.${range}`);
  const data = query.data;
  const metrics: Metric[] = ['cpu', 'memory', 'temperature'];
  const series = data ? metrics.map((metric) => ({ metric, ...buildSeries(data.items, PICK[metric]) })) : [];
  const reboots = data ? data.items.filter((item) => item.rebooted).map((item) => Date.parse(item.observedAt)) : [];
  const limitFor = (metric: Metric) => (!limits ? null : metric === 'cpu' ? limits.cpuPercent : metric === 'memory' ? limits.memoryPercent : limits.temperatureHighCelsius);

  return <div className="health-history" aria-busy={query.isFetching || undefined}>
    <div className="health-history-head">
      <h3>{t('healthHistory.title')}</h3>
      <div className="health-history-ranges" role="group" aria-label={t('healthHistory.rangeLabel')}>
        {HISTORY_RANGES.map((item) => <button key={item.id} type="button" aria-pressed={range === item.id} className={range === item.id ? 'is-active' : undefined} onClick={() => setRange(item.id)}>{t(`healthHistory.range.${item.id}`)}</button>)}
      </div>
    </div>
    {query.error && !data ? <p className="ipam-scope-note" role="alert">{t('healthHistory.loadError')} <button type="button" className="text-button" onClick={() => void query.refetch()}>{t('snmpHealth.panel.retry')}</button></p>
      : !data ? <p className="panel-description" role="status">{t('healthHistory.loading')}</p>
        : !data.items.length ? <p className="panel-description">{t('healthHistory.empty')}</p>
          : <>
            <div className={`health-history-grid${query.isFetching ? ' is-updating' : ''}`}>
              {series.map((item) => <MetricChart key={item.metric} t={t} metric={item.metric} segments={item.segments} stats={item.stats} limit={limitFor(item.metric)} from={Date.parse(data.from)} to={Date.parse(data.to)} reboots={reboots} rangeLabel={rangeLabel} />)}
            </div>
            <p className="health-history-dates panel-description"><span>{formatDateTime(data.from, { dateStyle: 'short', timeStyle: 'short' })}</span><span>{formatDateTime(data.to, { dateStyle: 'short', timeStyle: 'short' })}</span></p>
            {reboots.length > 0 && <p className="panel-description">{t('healthHistory.reboots', undefined, { count: reboots.length })}</p>}
            <details className="health-history-numbers">
              <summary>{t('healthHistory.table')}</summary>
              <div className="health-limits-table-wrap"><table className="health-limits-table">
                <thead><tr><th scope="col">{t('healthHistory.col.metric')}</th><th scope="col">{t('healthHistory.col.min')}</th><th scope="col">{t('healthHistory.col.avg')}</th><th scope="col">{t('healthHistory.col.max')}</th><th scope="col">{t('healthHistory.col.latest')}</th></tr></thead>
                <tbody>{series.map(({ metric, stats }) => <tr key={metric}><th scope="row">{t(`healthHistory.${metric}`)}</th>{stats ? <><td>{fmt(metric, stats.min)}</td><td>{fmt(metric, stats.avg)}</td><td>{fmt(metric, stats.max)}</td><td>{fmt(metric, stats.latest)}</td></> : <td colSpan={4}>{t('healthHistory.noValues')}</td>}</tr>)}</tbody>
              </table></div>
              <p className="panel-description">{t('healthHistory.retention', undefined, { days: data.retentionDays, readings: formatNumber(data.items.length) })}</p>
            </details>
          </>}
  </div>;
}
