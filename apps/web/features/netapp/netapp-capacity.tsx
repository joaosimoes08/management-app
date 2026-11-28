'use client';

import { useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { LineChart } from 'lucide-react';
import { DataTable, sortByColumns, type DataTableColumn, type SortState } from '@/components/data-table';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { getNetAppTrend, listNetAppTrendObjects, type NetAppSnapshot, type NetAppTrend, type NetAppTrendKind } from './api';
import { useUiText } from '@/components/ui/use-ui-text';

type UiText = ReturnType<typeof useUiText>;

/** Shared with the page: compact bytes ("1,2 TB"), or "—". */
export const formatBytes = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? formatNumber(value, { style: 'unit', unit: 'byte', unitDisplay: 'narrow', notation: 'compact', maximumFractionDigits: 1 }) : '—';

/** Amber from 80 %, red from 90 %: the same defaults as the rack power thresholds. */
const WARNING_PERCENT = 80;
const CRITICAL_PERCENT = 90;
/** Trend reads are audited server-side (NETAPP_TREND_READ): keep them cached for a while. */
const TREND_STALE_MS = 5 * 60_000;
export const TREND_DAY_OPTIONS = [30, 90, 180, 365] as const;

export function usedPercent(item: { sizeBytes?: number | null; usedBytes?: number | null; usedPercent?: number | null }): number | null {
  if (typeof item.usedPercent === 'number' && Number.isFinite(item.usedPercent)) return item.usedPercent;
  if (typeof item.sizeBytes !== 'number' || typeof item.usedBytes !== 'number' || item.sizeBytes <= 0) return null;
  return (item.usedBytes / item.sizeBytes) * 100;
}

const percentLabel = (value: number | null) => (value === null ? '—' : `${formatNumber(value, { maximumFractionDigits: 1 })}%`);
const barColour = (value: number) => (value >= CRITICAL_PERCENT ? 'red' : value >= WARNING_PERCENT ? 'orange' : 'green');

/** "45%" over a bar-track, coloured by the thresholds. */
export function PercentBar({ value }: { value: number | null }) {
  if (value === null) return <span className="muted-cell">—</span>;
  return <><strong>{percentLabel(value)}</strong><div className="bar-track" role="presentation"><i className={barColour(value)} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} /></div></>;
}

export interface TrendTarget { kind: NetAppTrendKind; key: string | null }

type CapacityRow = { key: string; name: string; uuid?: string; svm?: string; state?: string; sizeBytes?: number; usedBytes?: number; percent: number | null };

function capacityRows(items: NetAppSnapshot['aggregates'] | NetAppSnapshot['volumes']): CapacityRow[] {
  return items.map((item, index) => ({ ...item, svm: 'svm' in item ? item.svm : undefined, key: item.uuid ?? `${item.name}-${index}`, percent: usedPercent(item) }));
}

/** Sortable aggregates / volumes table with a % used bar and a link to the trend. */
export function CapacityTable({ title, kind, items, onTrend }: { title: string; kind: 'AGGREGATE' | 'VOLUME'; items: NetAppSnapshot['aggregates'] | NetAppSnapshot['volumes']; onTrend: (target: TrendTarget) => void }) {
  const ui = useUiText();
  const defaultSort: SortState = { column: 'percent', direction: 'desc' };
  const [sort, setSort] = useState<SortState>(defaultSort);
  const rows = useMemo(() => capacityRows(items), [items]);
  const nameHeader = kind === 'VOLUME' ? 'Volume' : 'Aggregate';
  const columns: DataTableColumn<CapacityRow>[] = [
    { id: 'name', header: nameHeader, cell: (row) => <strong>{row.name}</strong>, sortValue: (row) => row.name },
    ...(kind === 'VOLUME' ? [{ id: 'svm', header: 'SVM', cell: (row: CapacityRow) => row.svm ?? '—', sortValue: (row: CapacityRow) => row.svm ?? null }] : []),
    { id: 'state', header: ui('netapp.capacity.state'), cell: (row) => row.state ?? '—', sortValue: (row) => row.state ?? null },
    { id: 'used', header: ui('netapp.capacity.used'), cell: (row) => formatBytes(row.usedBytes), sortValue: (row) => row.usedBytes ?? null },
    { id: 'size', header: ui('netapp.capacity.total'), cell: (row) => formatBytes(row.sizeBytes), sortValue: (row) => row.sizeBytes ?? null },
    { id: 'percent', header: ui('netapp.capacity.usedPercent'), cell: (row) => <PercentBar value={row.percent} />, sortValue: (row) => row.percent },
    { id: 'actions', header: '', cell: (row) => <div className="table-actions"><button type="button" className="icon-button subtle" onClick={() => onTrend({ kind, key: row.uuid ?? row.name })} aria-label={ui('netapp.capacity.viewTrendOf', undefined, { name: row.name })} title={ui('netapp.capacity.viewTrend')}><LineChart size={14} aria-hidden="true" /></button></div> },
  ];
  return <section className="ipam-card"><div className="panel-heading"><div><h2>{title}</h2></div><span>{rows.length}</span></div>
    {rows.length ? <DataTable rows={sortByColumns(rows, columns, sort)} columns={columns} rowKey={(row) => row.key} label={title} sort={sort} onSortChange={setSort} defaultSort={defaultSort} /> : <p>{ui('netapp.table.empty')}</p>}
  </section>;
}

/** The ten fullest aggregates and volumes of the snapshot. */
export function TopFullest({ snapshot, onTrend }: { snapshot: NetAppSnapshot; onTrend: (target: TrendTarget) => void }) {
  const ui = useUiText();
  const items = [
    ...snapshot.volumes.map((item) => ({ kind: 'VOLUME' as const, label: item.svm ? `Volume · ${item.svm}` : 'Volume', item })),
    ...snapshot.aggregates.map((item) => ({ kind: 'AGGREGATE' as const, label: 'Aggregate', item })),
  ]
    .map((entry) => ({ ...entry, percent: usedPercent(entry.item) }))
    .filter((entry): entry is typeof entry & { percent: number } => entry.percent !== null)
    .sort((a, b) => b.percent - a.percent || a.item.name.localeCompare(b.item.name))
    .slice(0, 10);
  return <section className="ipam-card" aria-labelledby="netapp-top-fullest"><div className="panel-heading"><div><h2 id="netapp-top-fullest">{ui('netapp.top.title')}</h2></div></div>
    {items.length ? <div className="inventory-bars" data-testid="netapp-top-fullest">{items.map(({ kind, label, item, percent }) => <div className="inventory-bar" key={`${kind}-${item.uuid ?? item.name}`}>
      <div><span><button type="button" className="link-button" onClick={() => onTrend({ kind, key: item.uuid ?? item.name })}>{item.name}</button>{` · ${label}`}</span><strong>{percentLabel(percent)}</strong></div>
      <div className="bar-track"><i className={barColour(percent)} style={{ width: `${Math.min(100, percent)}%` }} /></div>
    </div>)}</div> : <p>{ui('netapp.top.empty')}</p>}
  </section>;
}

const shortDate = (value: string) => formatDateTime(value, { day: '2-digit', month: 'short', timeZone: 'UTC' });
const messageOf = (value: unknown, ui: UiText) => (value instanceof Error && value.message ? value.message : ui('netapp.trend.loadError'));

function trendSeries(trend: NetAppTrend) {
  const points = trend.points.filter((point) => typeof point.usedPercent === 'number' || typeof point.usedBytes === 'number');
  const byPercent = points.every((point) => typeof point.usedPercent === 'number');
  const values = points.map((point) => (byPercent ? point.usedPercent! : point.usedBytes ?? 0));
  const max = byPercent ? Math.max(100, ...values) : Math.max(1, ...values, ...points.map((point) => point.sizeBytes ?? 0));
  const coords = values.map((value, index) => [points.length < 2 ? 50 : 8 + index * (84 / (points.length - 1)), 44 - (value / max) * 34] as const);
  return { points, coords };
}

function growthText(trend: NetAppTrend, ui: UiText): string {
  const { summary } = trend;
  if (summary.projectedFullAt) return ui('netapp.trend.projectedFull', undefined, { date: formatDateTime(summary.projectedFullAt, { day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC' }) });
  if (summary.growthBytesPerDay !== null && summary.growthBytesPerDay <= 0) return ui('netapp.trend.noGrowth');
  if (summary.growthBytesPerDay === null) return ui('netapp.trend.notEnoughSamples');
  return ui('netapp.trend.noExhaustion');
}

/** Capacity trend (cluster, one aggregate or one volume) drawn with the app's inline SVG chart. */
export function NetAppCapacityTrend({ siteId, target, onTarget }: { siteId: string; target: TrendTarget; onTarget: (target: TrendTarget) => void }) {
  const ui = useUiText();
  // Until a period is chosen the API default applies (90 days, capped by its retention).
  const [chosenDays, setChosenDays] = useState<number | null>(null);
  const objectKind = target.kind === 'CLUSTER' ? null : target.kind;
  const objectsQuery = useQuery({
    queryKey: ['netapp', 'trend-objects', siteId, objectKind, chosenDays],
    queryFn: () => listNetAppTrendObjects(siteId, { kind: objectKind!, days: chosenDays ?? undefined }),
    enabled: Boolean(siteId && objectKind),
    staleTime: TREND_STALE_MS,
    retry: false,
  });
  const objects = useMemo(() => [...(objectsQuery.data?.items ?? [])].sort((a, b) => (usedPercent(b) ?? -1) - (usedPercent(a) ?? -1) || a.name.localeCompare(b.name)), [objectsQuery.data]);
  const key = objectKind ? target.key ?? objects[0]?.key ?? null : null;
  const trendQuery = useQuery({
    queryKey: ['netapp', 'trend', siteId, target.kind, key, chosenDays],
    queryFn: () => getNetAppTrend(siteId, { kind: target.kind, key, days: chosenDays ?? undefined }),
    enabled: Boolean(siteId && (target.kind === 'CLUSTER' || key)),
    staleTime: TREND_STALE_MS,
    retry: false,
  });
  const trend = trendQuery.data;
  const retention = trend?.retentionDays ?? objectsQuery.data?.retentionDays ?? null;
  const days = chosenDays ?? trend?.days ?? objectsQuery.data?.days ?? 90;
  const dayOptions = [...new Set([...TREND_DAY_OPTIONS.filter((value) => !retention || value <= retention), ...(retention && retention < 365 ? [retention] : []), days])].sort((a, b) => a - b);
  const series = trend ? trendSeries(trend) : null;
  const selectedMissing = Boolean(objectKind && key && objectsQuery.data && !objects.some((item) => item.key === key || item.name === key));

  return <section className="ipam-card" aria-labelledby="netapp-trend-title" id="netapp-capacity-trend">
    <div className="panel-heading"><div><h2 id="netapp-trend-title">{ui('netapp.trend.lastDays', undefined, { count: days })}</h2><p className="panel-description">{ui('netapp.trend.description')}</p></div></div>
    <div className="snmp-form-grid">
      <label><span>{ui('netapp.trend.object')}</span><select value={target.kind} onChange={(event) => onTarget({ kind: event.target.value as NetAppTrendKind, key: null })}><option value="CLUSTER">{ui('netapp.trend.cluster')}</option><option value="AGGREGATE">Aggregate</option><option value="VOLUME">Volume</option></select></label>
      {objectKind && <label><span>{objectKind === 'VOLUME' ? 'Volume' : 'Aggregate'}</span><select value={key ?? ''} disabled={objectsQuery.isLoading} onChange={(event) => onTarget({ kind: target.kind, key: event.target.value || null })}>
        {!objects.length && <option value="">{objectsQuery.isLoading ? ui('netapp.trend.loading') : ui('netapp.trend.noObjects')}</option>}
        {selectedMissing && key && <option value={key}>{key}</option>}
        {objects.map((item) => <option key={item.key} value={item.key}>{item.svm ? `${item.name} (${item.svm})` : item.name}</option>)}
      </select></label>}
      <label><span>{ui('netapp.trend.period')}</span><select value={days} onChange={(event) => setChosenDays(Number(event.target.value))}>{dayOptions.map((value) => <option key={value} value={value}>{ui('netapp.trend.days', undefined, { count: value })}</option>)}</select></label>
    </div>
    {objectsQuery.isError && <div role="alert" className="ipam-alert error">{messageOf(objectsQuery.error, ui)}</div>}
    {objectsQuery.data?.truncated && <div className="ipam-alert warning">{ui('netapp.trend.truncated')}</div>}
    {trendQuery.isError && <div role="alert" className="ipam-alert error">{messageOf(trendQuery.error, ui)}</div>}
    {trendQuery.isLoading && trendQuery.fetchStatus !== 'idle' && <p className="subnet-capacity-forecast" aria-live="polite">{ui('netapp.trend.loadingTrend')}</p>}
    {trend && series && (series.points.length ? <>
      <div className="subnet-capacity-chart-wrap">
        <div className="subnet-capacity-value">{trend.summary.latestUsedPercent !== null ? ui('netapp.trend.usedPercent', undefined, { value: percentLabel(trend.summary.latestUsedPercent) }) : ui('netapp.trend.usedBytes', undefined, { value: formatBytes(trend.summary.lastUsedBytes) })}</div>
        <svg className="subnet-capacity-chart" viewBox="0 0 100 50" role="img" aria-label={ui('netapp.trend.chartLabel', undefined, { name: trend.name ?? 'cluster' })} preserveAspectRatio="none" data-testid="netapp-trend-chart">
          <line x1="8" y1="10" x2="92" y2="10" />
          <line x1="8" y1="44" x2="92" y2="44" />
          {series.coords.length > 1 && <polyline points={series.coords.map(([x, y]) => `${x},${y}`).join(' ')} />}
          {(series.coords.length > 1 ? [series.coords[0], series.coords.at(-1)!] : series.coords).map(([x, y], index) => <circle key={index} cx={x} cy={y} r="1.5" />)}
        </svg>
        <div className="subnet-capacity-dates"><span>{shortDate(series.points[0].observedAt ?? series.points[0].date)}</span><span>{shortDate(series.points.at(-1)!.observedAt ?? series.points.at(-1)!.date)}</span></div>
      </div>
      <p className="subnet-capacity-forecast">{growthText(trend, ui)}</p>
      {trend.summary.changeBytes !== null && <small className="subnet-capacity-growth">{ui('netapp.trend.change', undefined, { value: `${trend.summary.changeBytes > 0 ? '+' : ''}${formatBytes(trend.summary.changeBytes)}` })}{trend.summary.growthBytesPerDay !== null ? ui('netapp.trend.perDay', undefined, { value: formatBytes(trend.summary.growthBytesPerDay) }) : ''}</small>}
    </> : <p className="subnet-capacity-forecast">{ui('netapp.trend.noSamples')}</p>)}
  </section>;
}
