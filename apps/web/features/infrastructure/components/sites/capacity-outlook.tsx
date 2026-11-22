'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { RefreshCw } from 'lucide-react';
import { DataTable, EntityLink, sortByColumns, type DataTableColumn, type SortState } from '@/components/data-table';
import { formatDate, formatNumber } from '@/lib/format/date';
import { useI18n } from '@/lib/i18n';
import { readPowerThresholds } from '../rack/rack-power-summary';
import { capacityKinds, capacityResourceHref, getSiteCapacityOutlook, type CapacityKind, type CapacityOutlook, type CapacityOutlookItem } from './capacity-outlook-api';

const defaultSort: SortState = { column: 'estimate', direction: 'asc' };
const levelClass = { ok: 'occupied', warning: 'reserved', critical: 'excluded' };

export function SiteCapacityOutlook({ siteId, siteName }: { siteId: string; siteName: string }) {
  const [thresholds] = useState(readPowerThresholds);
  const outlook = useQuery({
    queryKey: ['infrastructure', 'capacity-outlook', siteId, thresholds],
    queryFn: () => getSiteCapacityOutlook(siteId, thresholds),
  });
  return <CapacityOutlookCard siteName={siteName} data={outlook.data} loading={outlook.isFetching} error={outlook.isError} onRefresh={() => void outlook.refetch()} />;
}

export function CapacityOutlookCard({ siteName, data, loading = false, error = false, onRefresh }: {
  siteName: string;
  data?: CapacityOutlook;
  loading?: boolean;
  error?: boolean;
  onRefresh: () => void;
}) {
  const { t, locale } = useI18n();
  const [type, setType] = useState<CapacityKind | ''>('');
  const [sort, setSort] = useState<SortState>(defaultSort);
  const percent = (value: number) => `${formatNumber(value, { locale, maximumFractionDigits: 1 })}%`;
  const shortDate = (value: string) => formatDate(value, { locale, timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric' });
  const typeName = (kind: CapacityKind) => t(`capacity.kind.${kind}`);
  const critical = data ? percent(data.thresholds.criticalPercent) : '';
  const heading = t('capacity.title');
  const labelFor = (row: CapacityOutlookItem) => {
    if (row.kind !== 'PDU_POWER') return row.name;
    const name = row.name || (row.source ? `PDU ${t(`rack.pdu.source.${row.source}`)}` : 'PDU');
    return row.rackName ? `${row.rackName} · ${name}` : name;
  };

  const columns: DataTableColumn<CapacityOutlookItem>[] = [
    { id: 'name', header: t('capacity.resource'), sortValue: labelFor, cell: (row) => <div className="capacity-resource">
      {row.kind === 'SUBNET'
        ? <EntityLink className="link-button" kind="subnet" id={row.id} siteId={data?.siteId} label={row.name} />
        : <a className="link-button" href={capacityResourceHref(row, data?.siteId ?? '')}>{labelFor(row)}</a>}
      <small>{typeName(row.kind)}{row.reservedUnits ? ` · ${t('capacity.reservedUnits', undefined, { count: String(row.reservedUnits) })}` : ''}</small>
    </div> },
    { id: 'current', header: t('capacity.current'), sortValue: (row) => row.currentPercent, cell: (row) => row.currentPercent === null
      ? '—'
      : <span className={`state-badge ${row.level ? levelClass[row.level] : ''}`} title={row.observedAt ? t('capacity.observed', undefined, { date: shortDate(row.observedAt) }) : undefined}>
        <i aria-hidden="true" />{percent(row.currentPercent)}
        {row.level && <span className="topology-sr-only"> · {t(`capacity.level.${row.level}`)}</span>}
      </span> },
    { id: 'trend', header: t('capacity.trend'), sortValue: (row) => row.trendPer30Days, cell: (row) => row.trendPer30Days === null
      ? '—'
      : t('capacity.points', undefined, { amount: formatNumber(row.trendPer30Days, { locale, maximumFractionDigits: 1, signDisplay: 'exceptZero' }) }) },
    { id: 'estimate', header: critical ? t('capacity.estimateAt', undefined, { threshold: critical }) : t('capacity.estimate'),
      sortValue: (row) => row.status === 'ALREADY_AT_THRESHOLD' ? 0 : row.estimatedAt ? Date.parse(row.estimatedAt) : null,
      cell: (row) => row.estimatedAt
        ? <time dateTime={row.estimatedAt}>{shortDate(row.estimatedAt)}</time>
        : <span className="capacity-estimate-status">{t(`capacity.status.${row.status}`)}</span>,
    },
  ];
  const matches = (data?.items ?? []).filter((row) => !type || row.kind === type);
  const ranked = [...matches].sort((a, b) => (b.currentPercent ?? -1) - (a.currentPercent ?? -1));
  const rows = sortByColumns(ranked, columns, sort);

  return <section className="ipam-card page-primary-card site-capacity-card" aria-labelledby="site-capacity-title">
    <div className="panel-heading">
      <div><h2 id="site-capacity-title">{heading}</h2><p className="panel-description">{siteName}</p></div>
      <button type="button" className="secondary-button" onClick={onRefresh} disabled={loading}><RefreshCw size={14} />{t('capacity.refresh')}</button>
    </div>
    <div className="page-primary-content">
      <div className="capacity-outlook-controls">
        <label>{t('capacity.filter')} <select className="context-toolbar-selector" value={type} onChange={(event) => setType(event.target.value as CapacityKind | '')}>
          <option value="">{t('capacity.all')}</option>
          {capacityKinds.map((kind) => <option key={kind} value={kind}>{typeName(kind)}</option>)}
        </select></label>
        {data && <p className="panel-description">{t('capacity.thresholds', undefined, { warning: percent(data.thresholds.warningPercent), critical })}</p>}
      </div>
      {error && <p className="ipam-alert error" role="alert">{t('capacity.failed')}</p>}
      <DataTable rows={rows} columns={columns} rowKey={(row) => `${row.kind}/${row.id}`} label={heading} className="capacity-outlook-table" sort={sort} defaultSort={defaultSort} onSortChange={setSort} loading={loading && !data}
        empty={error ? undefined : <div className="no-data">{t('capacity.empty')}</div>} />
      {data && <p className="panel-description capacity-outlook-note">{t('capacity.method', undefined, { days: data.historyDays })}</p>}
    </div>
  </section>;
}
