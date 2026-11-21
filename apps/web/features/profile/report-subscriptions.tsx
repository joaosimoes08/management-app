'use client';

import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Download, FileText } from 'lucide-react';
import { useState } from 'react';
import { apiDownload, apiFetch } from '@/lib/api/client';
import { useI18n } from '@/lib/i18n';
import { reportCsvFilename, scheduleLabel, type ReportFrequency } from '@/features/reports/report-labels';
import styles from './notifications-panel.module.css';

export type ReportSubscription = {
  reportId: string; name: string; enabled: boolean; frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null;
  hour: number; timezone: string; sendEmail: boolean; subscribed: boolean;
};

/** Perfil → Notificações: the scheduled reports this person receives, with the subscribe toggle and an on-demand CSV. */
export function ReportSubscriptions({ userId }: { userId: string }) {
  const { t } = useI18n();
  const queryClient = useQueryClient();
  const key = ['profile', 'report-subscriptions', userId] as const;
  const [downloadError, setDownloadError] = useState(false);
  const subscriptions = useQuery({ queryKey: key, queryFn: () => apiFetch<{ items: ReportSubscription[] }>('/api/v1/reports/subscriptions') });
  const toggle = useMutation({
    mutationFn: ({ reportId, subscribed }: { reportId: string; subscribed: boolean }) =>
      apiFetch<{ reportId: string; subscribed: boolean }>(`/api/v1/reports/subscriptions/${reportId}`, { method: 'PATCH', body: JSON.stringify({ subscribed }) }),
    onSuccess: (saved) => queryClient.setQueryData(key, (data: { items: ReportSubscription[] } | undefined) =>
      data ? { items: data.items.map((item) => item.reportId === saved.reportId ? { ...item, subscribed: saved.subscribed } : item) } : data),
  });
  const download = async (item: ReportSubscription) => {
    setDownloadError(false);
    try { await apiDownload(`/api/v1/reports/subscriptions/${item.reportId}/csv`, reportCsvFilename(item.name)); }
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
