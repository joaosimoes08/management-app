'use client';

import { formatIpamPercent } from '../utilization';
import type { SubnetCapacityHistory } from '../types';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';

const dateLabel = (value: string) => formatDateTime(value, { day: '2-digit', month: 'short', timeZone: 'UTC' });

export function SubnetCapacityTrend({ history, loading = false }: { history: SubnetCapacityHistory | null; loading?: boolean }) {
  const ui = useUiText();
  if (loading) return <section className="subnet-capacity-trend ipam-card subnet-capacity-loading" aria-label={ui('ipam.trend.loading')} aria-busy="true"><div className="panel-heading"><div><span className="content-skeleton settings-loading-label"/><span className="content-skeleton settings-loading-title"/></div></div><div className="content-skeleton subnet-capacity-chart-skeleton"/><div className="content-skeleton subnet-capacity-copy-skeleton"/></section>;
  if (!history) return <section className="subnet-capacity-trend ipam-card"><div className="panel-heading"><div><h2>{ui('ipam.trend.title')}</h2></div></div><p className="subnet-capacity-forecast">{ui('ipam.trend.loadError')}</p></section>;
  const ipv4 = history.subnet.version === 4;
  const samples = history.samples;
  const values = samples.map((sample) => ipv4 ? sample.utilizationPercent ?? 0 : sample.trackedAddresses);
  const max = Math.max(...values, ipv4 ? 100 : 1);
  const points = values.map((value, index) => `${samples.length < 2 ? 50 : 8 + index * (84 / (samples.length - 1))},${44 - (value / max) * 34}`).join(' ');
  const forecast = history.forecast;
  const forecastText = forecast.status === 'AVAILABLE'
    ? ui('ipam.trend.forecast.available', undefined, { count: forecast.daysUntilFull ?? 0, date: dateLabel(forecast.projectedFullAt!) })
    : forecast.status === 'AT_CAPACITY' ? ui('ipam.trend.forecast.atCapacity')
    : forecast.status === 'INSUFFICIENT_HISTORY' ? ui('ipam.trend.forecast.insufficientHistory')
      : forecast.status === 'NO_GROWTH' ? ui('ipam.trend.forecast.noGrowth')
        : forecast.status === 'LOW_CONFIDENCE' ? ui('ipam.trend.forecast.lowConfidence')
          : forecast.status === 'BEYOND_FORECAST_WINDOW' ? ui('ipam.trend.forecast.beyondWindow')
            : ui('ipam.trend.forecast.ipv6');

  return <section className="subnet-capacity-trend ipam-card" aria-labelledby="subnet-capacity-title">
    <div className="panel-heading"><div><h3 id="subnet-capacity-title">{ui('ipam.trend.heading')}</h3><p className="panel-description">{ipv4 ? ui('ipam.trend.ipv4Description') : ui('ipam.trend.ipv6Description')}</p></div></div>
    {samples.length ? <>
      <div className="subnet-capacity-chart-wrap">
        <div className="subnet-capacity-value">{ipv4 ? ui('ipam.trend.used', undefined, { percent: formatIpamPercent(values.at(-1)!) }) : ui('ipam.trend.tracked', undefined, { count: values.at(-1)!, value: formatNumber(values.at(-1)!) })}</div>
        <svg className="subnet-capacity-chart" viewBox="0 0 100 50" role="img" aria-label={ipv4 ? ui('ipam.trend.ipv4Chart') : ui('ipam.trend.ipv6Chart')} preserveAspectRatio="none">
          <line x1="8" y1="10" x2="92" y2="10" />
          <line x1="8" y1="44" x2="92" y2="44" />
          {samples.length > 1 && <polyline points={points} />}
          {samples.length === 1 && <line className="subnet-capacity-single-point" x1="50" x2="50" y1={44 - (values[0] / max) * 34} y2={44 - (values[0] / max) * 34} vectorEffect="non-scaling-stroke" />}
          {samples.length > 1 && <><circle cx={points.split(' ').at(-1)!.split(',')[0]} cy={points.split(' ').at(-1)!.split(',')[1]} r="1.5" /><circle cx={points.split(' ')[0].split(',')[0]} cy={points.split(' ')[0].split(',')[1]} r="1.5" /></>}
        </svg>
        <div className="subnet-capacity-dates"><span>{dateLabel(samples[0].sampledAt)}</span><span>{dateLabel(samples.at(-1)!.sampledAt)}</span></div>
      </div>
      <p className="subnet-capacity-forecast">{forecastText}</p>
      {ipv4 && forecast.dailyGrowth !== null && forecast.dailyGrowth > 0 && <small className="subnet-capacity-growth">{ui('ipam.trend.growth', undefined, { value: formatNumber(forecast.dailyGrowth) })}</small>}
    </> : <p className="subnet-capacity-forecast">{ui('ipam.trend.empty')}</p>}
  </section>;
}
