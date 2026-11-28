'use client';

import { useState } from 'react';
import { Check, Search, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { listMissingIps, markMissingIpsFree, type MissingIp } from './api';
import { useUiText } from '@/components/ui/use-ui-text';
import { translateMessage } from '@/lib/i18n/i18n';
type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;
const portuguese: Translate = (key, fallback, params) => translateMessage('pt-PT', key, fallback, params);

/** One line of evidence for a missing address: when it was last seen and how many scans missed it. */
export function missingIpEvidence(item: Pick<MissingIp, 'lastSeenAt' | 'lastScanAt' | 'scanCount'>, format: (value: string) => string = formatDateTime, t: Translate = portuguese) {
  const seen = item.lastSeenAt ? t('groupB.discovery.lastSeen', undefined, { date: format(item.lastSeenAt) }) : t('groupB.discovery.neverSeen');
  const scans = t(item.scanCount === 1 ? 'groupB.discovery.missedScan' : 'groupB.discovery.missedScans', undefined, { count: item.scanCount });
  return t('groupB.discovery.missingEvidence', undefined, { seen, scans, date: format(item.lastScanAt) });
}

/**
 * Round 2 #14 "Desaparecidos": OCCUPIED addresses that recent completed scans of their subnet no longer see.
 * "Marcar livre" asks for confirmation; the server frees the address only if it is still missing, unlinked and unreserved.
 */
export function DiscoveryMissingSection({ siteId, canEdit, searching, search }: { siteId: string; canEdit: boolean; searching: boolean; search: string }) {
  const tx = useUiText();
  const qc = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [feedback, setFeedback] = useState<Record<string, string>>({});
  const [busyId, setBusyId] = useState('');
  const query = useQuery({ queryKey: ['discovery', 'missing', siteId], queryFn: () => listMissingIps(siteId), retry: false });
  const items = (query.data?.items ?? []).filter((item) => !search || `${item.address} ${item.cidr} ${item.hostname ?? ''}`.toLowerCase().includes(search));

  const markFree = async (item: MissingIp) => {
    if (!(await confirm({ title: tx('discovery.missing.markFree'), message: tx('groupB.discovery.markFreeConfirm', undefined, { address: item.address }), confirmLabel: tx('discovery.missing.markFree'), cancelLabel: tx('discovery.missing.back'), destructive: true }))) return;
    setBusyId(item.ipId);
    try {
      const response = await markMissingIpsFree([item.ipId]);
      const outcome = response.results[0];
      setFeedback((value) => ({ ...value, [item.ipId]: outcome?.ok ? '' : outcome?.message ?? tx('discovery.missing.couldNotMarkTheAddress') }));
      await qc.invalidateQueries({ queryKey: ['discovery', 'missing'] });
    } catch (cause) {
      setFeedback((value) => ({ ...value, [item.ipId]: cause instanceof Error ? cause.message : tx('discovery.missing.couldNotMarkTheAddress') }));
    } finally { setBusyId(''); }
  };

  return <section className="ipam-card">{confirmDialog}<div className="panel-heading"><div><h2>{tx('discovery.missing.occupiedIpsNotResponding')}</h2><p className="panel-description">{tx('discovery.missing.addressesOccupiedInIpamThat')}{query.data?.windowDays ?? 30} {tx('discovery.missing.daysNoAnswerDoesNot')}</p></div></div>
    {query.isError && <div className="ipam-alert error" role="alert"><X size={15} />{query.error instanceof Error ? query.error.message : tx('discovery.missing.couldNotLoadTheMissing')}</div>}
    {items.map((item) => <div className="result-row" key={item.ipId}><span><strong>{item.address}</strong><small>{item.cidr}{item.hostname ? ` · ${item.hostname}` : ''} · {missingIpEvidence(item, formatDateTime, tx)}</small>{feedback[item.ipId] && <small className="field-error" role="alert">{feedback[item.ipId]}</small>}</span><span className="result-actions"><a className="secondary-button" href={`/ipam?${item.siteId ? `siteId=${encodeURIComponent(item.siteId)}&` : ''}subnetId=${encodeURIComponent(item.subnetId)}&ipId=${encodeURIComponent(item.ipId)}`}>{tx('discovery.missing.openInIpam')}</a>{canEdit && <button className="secondary-button" disabled={busyId === item.ipId} onClick={() => void markFree(item)}><Check size={13} /> {tx('discovery.missing.markFree2')}</button>}</span></div>)}
    {query.isSuccess && !items.length && <div className="empty-context"><Search size={22} /><strong>{searching ? tx('discovery.missing.noMatchingMissingIps') : tx('discovery.missing.noOccupiedIpHasStopped')}</strong></div>}
  </section>;
}
