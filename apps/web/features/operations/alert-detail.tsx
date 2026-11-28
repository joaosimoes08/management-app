'use client';

/** Alert detail panel on /alertas: first/last seen, count, source, device, who acted, and history. */
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { HistoryBlock, type HistoryEvent } from '@/components/data-table/history-block';
import { CompactModal } from '@/components/ui/compact-modal';
import { formatDateTime } from '@/lib/format/date';
import { getOperationalAlert, operationsKeys, type AlertDetail, type AlertHistoryEntry, type AlertPerson, type BulkAlertAction } from './api';
import { alertKindLabel, alertNextStep, alertStatusLabel, alertTargetHref, deviceHref, severityMeaning, type Translate } from './alert-meta';
import { useUiText } from '@/components/ui/use-ui-text';
import { AlertRowActions, ReadOnlyAlertNote } from './alert-actions';
import { SeverityTag } from './alert-severity';
import { localizeServerText } from '@/lib/i18n/server-text';

const HISTORY_ACTIONS = ['OPERATIONAL_ALERT_ACKNOWLEDGED', 'OPERATIONAL_ALERT_SNOOZED', 'OPERATIONAL_ALERT_RESOLVED'];

const personName = (person?: AlertPerson | null) => (person ? person.displayName || person.username : null);
const when = (value?: string | null) => (value ? formatDateTime(value) : '—');

function historyNote(entry: AlertHistoryEntry, t: Translate): string | null {
  const metadata = entry.metadata ?? {};
  const until = typeof metadata.until === 'string' ? metadata.until : typeof metadata.snoozedUntil === 'string' ? metadata.snoozedUntil : null;
  const reason = typeof metadata.reason === 'string' && metadata.reason ? metadata.reason : null;
  return [until ? t('operations.alerts.until', undefined, { date: formatDateTime(until) }) : null, reason].filter(Boolean).join(' · ') || null;
}

export const alertHistoryEvents = (detail: Pick<AlertDetail, 'history'>, t: Translate): HistoryEvent[] => detail.history.map((entry) => ({
  id: entry.id,
  title: HISTORY_ACTIONS.includes(entry.action) ? t(`operations.alerts.history.${entry.action}`) : entry.action,
  at: entry.createdAt,
  actor: personName(entry.user),
  note: historyNote(entry, t),
}));

export function AlertDetailDialog({ alertId, title, close, run, running }: { alertId: string; title: string; close: () => void; run: (action: BulkAlertAction, alerts: Array<{ id: string; title: string; status: string; siteId?: string | null }>, hours?: number) => void; running: boolean }) {
  const t = useUiText();
  const query = useQuery({ queryKey: operationsKeys.alertDetail(alertId), queryFn: () => getOperationalAlert(alertId), retry: false });
  const detail = query.data;
  const href = detail ? alertTargetHref(detail) : null;
  return <CompactModal title={title} close={close}>
    <div className="modal-form alert-detail">
      {query.isLoading && <p className="no-data" role="status">{t('operations.alerts.detail.loading')}</p>}
      {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : t('operations.alerts.detail.loadError')}</div>}
      {detail && <>
        <p className="alert-detail-severity"><SeverityTag severity={detail.severity} /> <span>{severityMeaning(detail.severity, t) ?? ''}</span></p>
        {detail.detail && <p className="panel-description">{localizeServerText(t, detail.detail)}</p>}
        <p className="alert-next-step"><strong>{t('operations.alerts.detail.nextStep')}</strong> {alertNextStep(detail, t)}{href && <> <a href={href}>{t('operations.alerts.detail.open')}</a></>}</p>
        <dl className="alert-detail-facts">
          <div><dt>{t('operations.alerts.field.status')}</dt><dd>{alertStatusLabel(detail.status, t)}{detail.status === 'SNOOZED' && detail.snoozedUntil ? ` ${t('operations.alerts.until', undefined, { date: formatDateTime(detail.snoozedUntil) })}` : ''}</dd></div>
          <div><dt>{t('operations.alerts.field.source')}</dt><dd>{alertKindLabel(detail, t)} <code>{detail.source}</code></dd></div>
          <div><dt>{t('operations.alerts.field.device')}</dt><dd>{detail.device ? <a href={deviceHref(detail.device.id, detail.siteId)}>{detail.device.name || t('operations.alerts.deviceRemoved')}</a> : '—'}{detail.device?.managementIp && <small> {detail.device.managementIp}</small>}</dd></div>
          <div><dt>{t('operations.alerts.field.site')}</dt><dd>{detail.site?.name ?? t('operations.alerts.allSites')}</dd></div>
          <div><dt>{t('operations.alerts.detail.firstSeen')}</dt><dd>{when(detail.firstOccurredAt)}</dd></div>
          <div><dt>{t('operations.alerts.field.lastSeen')}</dt><dd>{when(detail.lastOccurredAt)}</dd></div>
          <div><dt>{t('operations.alerts.detail.occurrences')}</dt><dd>{detail.occurrenceCount ?? 1}</dd></div>
          {detail.acknowledgedAt && <div><dt>{t('operations.alerts.detail.acknowledged')}</dt><dd>{when(detail.acknowledgedAt)}{personName(detail.acknowledgedBy) ? ` · ${personName(detail.acknowledgedBy)}` : ''}</dd></div>}
          {detail.resolvedAt && <div><dt>{t('operations.alerts.detail.resolved')}</dt><dd>{when(detail.resolvedAt)}{personName(detail.resolvedBy) ? ` · ${personName(detail.resolvedBy)}` : ''}{detail.resolutionReason ? ` · ${detail.resolutionReason}` : ''}</dd></div>}
        </dl>
        <HistoryBlock heading={t('operations.alerts.detail.history')} events={alertHistoryEvents(detail, t)} formatDate={(value) => formatDateTime(value)} empty={t('operations.alerts.detail.historyEmpty')} noteLabel={t('operations.alerts.detail.historyNote')} />
        {detail.status !== 'RESOLVED' && (detail.canAct ? <AlertRowActions alert={detail} disabled={running} run={run} /> : <ReadOnlyAlertNote />)}
      </>}
    </div>
  </CompactModal>;
}
