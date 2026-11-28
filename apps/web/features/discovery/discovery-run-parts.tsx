'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import { formatDateTime } from '@/lib/format/date';
import { UNKNOWN_TRAPS_HREF } from '@/features/snmp/snmp-unknown-traps';
import { discoveryJobProgress, type DiscoveryJob } from './api';
import { formatDurationMs } from './discovery-results';
import { discoveryFailureReason, discoveryProgressPercent, discoveryStatusLabel, formatResultCount, isActiveDiscoveryJob } from './discovery-status';
import { useUiText } from '@/components/ui/use-ui-text';

/**
 * Step 5.5: the discovery flow in three steps, with what pre-registration does and where traps from unknown senders go.
 */
export function DiscoveryFlowHeader() {
  const t = useUiText();
  return <section className="discovery-flow" aria-label={t('discovery.runParts.howDiscoveryWorks')}>
    <ol className="discovery-flow-steps">
      <li><strong><span aria-hidden="true">1</span> {t('discovery.runParts.discover')}</strong><small>{t('discovery.runParts.aRunProbesTheSubnet')}</small></li>
      <li><strong><span aria-hidden="true">2</span> {t('discovery.runParts.review')}</strong><small>{t('discovery.runParts.eachAddressThatRespondedStays')}</small></li>
      <li><strong><span aria-hidden="true">3</span> {t('discovery.runParts.accept')}</strong><small>{t('discovery.runParts.approvingCreatesTheHostThe')}</small></li>
    </ol>
    <p className="discovery-flow-note">{t('discovery.runParts.forSnmpDevicesUseThe')}<a href={UNKNOWN_TRAPS_HREF}>{t('discovery.runParts.viewInSnmpUnknownTraps')}</a></p>
  </section>;
}

/** Live progress of a pending or running scan: a bar plus "32/62 endereços". */
export function DiscoveryRunProgress({ job }: { job: DiscoveryJob }) {
  const tx = useUiText();
  if (!isActiveDiscoveryJob(job)) return null;
  const percent = discoveryProgressPercent(job);
  const label = job.status === 'PENDING' && !job.processedCount ? tx('discovery.runParts.queued') : percent === null ? tx('discovery.runParts.preparing') : `${percent}%`;
  return <span className="discovery-progress" role="progressbar" aria-label={tx('groupB.discovery.progressOf', undefined, { name: job.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={label}>
    <span className="discovery-progress-track"><span className="discovery-progress-fill" style={{ width: `${percent ?? 0}%` }} /></span>
    <span className="discovery-progress-label">{label}</span>
  </span>;
}

export function DiscoveryFailureReason({ job }: { job: DiscoveryJob }) {
  const t = useUiText();
  const reason = discoveryFailureReason(t, job);
  if (!reason) return null;
  return <small className="discovery-failure-reason" role="note"><AlertTriangle size={11} aria-hidden="true" /> {t('discovery.runParts.reason')}{reason}</small>;
}

export function DiscoveryRunRow({ job, onSelect, selected }: { job: DiscoveryJob; onSelect: (id: string) => void; selected?: boolean }) {
  const tx = useUiText();
  const progress = discoveryJobProgress(job, tx);
  return <button className={`job-row${selected ? ' selected' : ''}`} onClick={() => onSelect(job.id)} aria-current={selected ? 'true' : undefined}>
    <span className={`job-status ${job.status.toLowerCase()}`} aria-hidden="true" />
    <span>
      <strong>{job.name}</strong>
      <small>{job.subnet.cidr} · {job.subnet.site?.name ?? tx('discovery.runParts.noSite')} · {formatResultCount(tx, job._count.results)} · <span className="job-status-label">{discoveryStatusLabel(tx, job.status)}</span>{progress ? ` · ${progress}` : ''}</small>
      <small>{formatDateTime(job.startedAt ?? job.createdAt)}{job.durationMs != null ? ` · ${formatDurationMs(job.durationMs)}` : job.status === 'RUNNING' ? tx('discovery.runParts.running') : ''}</small>
      <DiscoveryRunProgress job={job} />
      <DiscoveryFailureReason job={job} />
    </span>
    <ChevronRight size={15} />
  </button>;
}
