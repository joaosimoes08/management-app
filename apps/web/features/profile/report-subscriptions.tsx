'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { useI18n } from '@/lib/i18n';
import { reportCsvFilename, scheduleLabel } from '@/features/reports/report-labels';
import { downloadReportSubscriptionCsv, listReportSubscriptions, profileKeys, setReportSubscription, type ReportSubscription } from './api';
import styles from './notifications-panel.module.css';

export type { ReportSubscription } from './api';

/** Perfil → Notificações: the scheduled reports this person receives, with the subscribe toggle and an on-demand CSV. */
export function ReportSubscriptions({ userId }: { userId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const key = profileKeys.reportSubscriptions(userId);
  const [downloadError, setDownloadError] = useState(false);
  const subscriptions = useQuery({ queryKey: key, queryFn: listReportSubscriptions });
  const toggle = useMutation({
    mutationFn: ({ reportId, subscribed }: { reportId: string; subscribed: boolean }) => setReportSubscription(reportId, subscribed),
    onSuccess: (saved) => queryClient.setQueryData(key, (data: { items: ReportSubscription[] } | undefined) =>
      data ? { items: data.items.map((item) => item.reportId === saved.reportId ? { ...item, subscribed: saved.subscribed } : item) } : data),
  });
  const download = async (item: ReportSubscription) => {
    setDownloadError(false);
    try { await downloadReportSubscriptionCsv(item.reportId, reportCsvFilename(item.name)); }
    catch { setDownloadError(true); }
  };
  const items = subscriptions.data?.items ?? [];
  if (subscriptions.isSuccess && !items.length) return null;

  return <section className="ipam-card" aria-labelledby="report-subscriptions-heading">
    <div className="panel-heading">
      <div><h2 id="report-subscriptions-heading"><FileText size={15} aria-hidden="true" /> {t('reports.subscriptions')}</h2><p className="panel-description">{t('reports.subscriptionsHint')}</p></div>
    </div>
    {subscriptions.isPending && <p role="status">{t('common.loading')}</p>}
    {subscriptions.isError && <p className="ipam-alert error" role="alert">{t('reports.loadError')}</p>}
    {toggle.isError && <p className="ipam-alert error" role="alert">{t('reports.toggleError')}</p>}
    {downloadError && <p className="ipam-alert error" role="alert">{t('reports.downloadError')}</p>}
    <ul className={styles.list}>
      {items.map((item) => <li className={styles.preference} key={item.reportId}>
        <label><input type="checkbox" checked={item.subscribed} disabled={toggle.isPending} onChange={(event) => toggle.mutate({ reportId: item.reportId, subscribed: event.target.checked })} /> <span><strong>{item.name}</strong><br /><small>{scheduleLabel(item)}{!item.enabled ? ` · ${t('reports.paused')}` : ''}</small></span></label>
        <button type="button" className="secondary-button" onClick={() => void download(item)} aria-label={t('reports.downloadLabel', 'CSV: {name}', { name: item.name })}><Download size={14} aria-hidden="true" />{t('reports.download')}</button>
      </li>)}
    </ul>
  </section>;
}
