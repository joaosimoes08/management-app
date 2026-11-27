'use client';

/** Alert detail panel on /alertas: first/last seen, count, source, device, who acted, and history. */
import { useQuery } from '@tanstack/react-query';
import { X } from 'lucide-react';
import { HistoryBlock, type HistoryEvent } from '@/components/data-table/history-block';
import { CompactModal } from '@/components/ui/compact-modal';
import { formatDateTime } from '@/lib/format/date';
import { getOperationalAlert, operationsKeys, type AlertDetail, type AlertHistoryEntry, type AlertPerson, type BulkAlertAction } from './api';
import { alertKindLabel, alertNextStep, alertStatusLabels, alertTargetHref, deviceHref, severityMeanings } from './alert-meta';
import { AlertRowActions, ReadOnlyAlertNote } from './alert-actions';
import { SeverityTag } from './alert-severity';

const historyLabels: Record<string, string> = {
  OPERATIONAL_ALERT_ACKNOWLEDGED: 'Reconhecido',
  OPERATIONAL_ALERT_SNOOZED: 'Adiado',
  OPERATIONAL_ALERT_RESOLVED: 'Resolvido',
};

const personName = (person?: AlertPerson | null) => (person ? person.displayName || person.username : null);
const when = (value?: string | null) => (value ? formatDateTime(value) : '—');

function historyNote(entry: AlertHistoryEntry): string | null {
  const metadata = entry.metadata ?? {};
  const until = typeof metadata.until === 'string' ? metadata.until : typeof metadata.snoozedUntil === 'string' ? metadata.snoozedUntil : null;
  const reason = typeof metadata.reason === 'string' && metadata.reason ? metadata.reason : null;
  return [until ? `até ${formatDateTime(until)}` : null, reason].filter(Boolean).join(' · ') || null;
}

export const alertHistoryEvents = (detail: Pick<AlertDetail, 'history'>): HistoryEvent[] => detail.history.map((entry) => ({
  id: entry.id,
  title: historyLabels[entry.action] ?? entry.action,
  at: entry.createdAt,
  actor: personName(entry.user),
  note: historyNote(entry),
}));

export function AlertDetailDialog({ alertId, title, close, run, running }: { alertId: string; title: string; close: () => void; run: (action: BulkAlertAction, alerts: Array<{ id: string; title: string; status: string; siteId?: string | null }>, hours?: number) => void; running: boolean }) {
  const query = useQuery({ queryKey: operationsKeys.alertDetail(alertId), queryFn: () => getOperationalAlert(alertId), retry: false });
  const detail = query.data;
  const href = detail ? alertTargetHref(detail) : null;
  return <CompactModal title={title} close={close}>
    <div className="modal-form alert-detail">
      {query.isLoading && <p className="no-data" role="status">A carregar o alerta…</p>}
      {query.error && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : 'Não foi possível carregar o alerta.'}</div>}
      {detail && <>
        <p className="alert-detail-severity"><SeverityTag severity={detail.severity} /> <span>{severityMeanings[detail.severity] ?? ''}</span></p>
        {detail.detail && <p className="panel-description">{detail.detail}</p>}
        <p className="alert-next-step"><strong>Próximo passo:</strong> {alertNextStep(detail)}{href && <> <a href={href}>Abrir</a></>}</p>
        <dl className="alert-detail-facts">
          <div><dt>Estado</dt><dd>{alertStatusLabels[detail.status] ?? detail.status}{detail.status === 'SNOOZED' && detail.snoozedUntil ? ` até ${formatDateTime(detail.snoozedUntil)}` : ''}</dd></div>
          <div><dt>Origem</dt><dd>{alertKindLabel(detail)} <code>{detail.source}</code></dd></div>
          <div><dt>Equipamento</dt><dd>{detail.device ? <a href={deviceHref(detail.device.id, detail.siteId)}>{detail.device.name || 'Equipamento removido'}</a> : '—'}{detail.device?.managementIp && <small> {detail.device.managementIp}</small>}</dd></div>
          <div><dt>Site</dt><dd>{detail.site?.name ?? 'Todos os Sites'}</dd></div>
          <div><dt>Primeira ocorrência</dt><dd>{when(detail.firstOccurredAt)}</dd></div>
          <div><dt>Última ocorrência</dt><dd>{when(detail.lastOccurredAt)}</dd></div>
          <div><dt>Ocorrências</dt><dd>{detail.occurrenceCount ?? 1}</dd></div>
          {detail.acknowledgedAt && <div><dt>Reconhecido</dt><dd>{when(detail.acknowledgedAt)}{personName(detail.acknowledgedBy) ? ` · ${personName(detail.acknowledgedBy)}` : ''}</dd></div>}
          {detail.resolvedAt && <div><dt>Resolvido</dt><dd>{when(detail.resolvedAt)}{personName(detail.resolvedBy) ? ` · ${personName(detail.resolvedBy)}` : ''}{detail.resolutionReason ? ` · ${detail.resolutionReason}` : ''}</dd></div>}
        </dl>
        <HistoryBlock heading="Histórico" events={alertHistoryEvents(detail)} formatDate={(value) => formatDateTime(value)} empty="Ainda ninguém agiu sobre este alerta." noteLabel="Detalhe" />
        {detail.status !== 'RESOLVED' && (detail.canAct ? <AlertRowActions alert={detail} disabled={running} run={run} /> : <ReadOnlyAlertNote />)}
      </>}
    </div>
  </CompactModal>;
}
