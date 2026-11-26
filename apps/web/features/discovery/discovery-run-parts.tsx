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
  return <section className="discovery-flow" aria-label="Como funciona a descoberta">
    <ol className="discovery-flow-steps">
      <li><strong><span aria-hidden="true">1</span> Descobrir</strong><small>Uma execução sonda a subnet com ICMP e portas TCP. Nada é criado no inventário.</small></li>
      <li><strong><span aria-hidden="true">2</span> Rever</strong><small>Cada endereço que respondeu fica pendente. Compara com execuções anteriores e ignora o que não interessa.</small></li>
      <li><strong><span aria-hidden="true">3</span> Aceitar</strong><small>Aprovar cria o host, o IP e os serviços no IPAM. Só aí o endereço passa a fazer parte do inventário.</small></li>
    </ol>
    <p className="discovery-flow-note">Para equipamentos SNMP, usa o separador SNMP. Pré-registar um equipamento é dizer à app, antes de ele estar no inventário, de que IP vão chegar as traps e com que credenciais. O pré-registo dura 24 horas e associa as traps que chegarem desse IP. Traps de IPs não pré-registados não se perdem: <a href={UNKNOWN_TRAPS_HREF}>Ver em SNMP → Traps desconhecidas</a></p>
  </section>;
}

/** Live progress of a pending or running scan: a bar plus "32/62 endereços". */
export function DiscoveryRunProgress({ job }: { job: DiscoveryJob }) {
  const tx = useUiText();
  if (!isActiveDiscoveryJob(job)) return null;
  const percent = discoveryProgressPercent(job);
  const label = job.status === 'PENDING' && !job.processedCount ? 'Na fila' : percent === null ? 'A preparar' : `${percent}%`;
  return <span className="discovery-progress" role="progressbar" aria-label={tx('groupB.discovery.progressOf', undefined, { name: job.name })} aria-valuemin={0} aria-valuemax={100} aria-valuenow={percent ?? undefined} aria-valuetext={label}>
    <span className="discovery-progress-track"><span className="discovery-progress-fill" style={{ width: `${percent ?? 0}%` }} /></span>
    <span className="discovery-progress-label">{label}</span>
  </span>;
}

export function DiscoveryFailureReason({ job }: { job: DiscoveryJob }) {
  const reason = discoveryFailureReason(job);
  if (!reason) return null;
  return <small className="discovery-failure-reason" role="note"><AlertTriangle size={11} aria-hidden="true" /> Motivo: {reason}</small>;
}

export function DiscoveryRunRow({ job, onSelect, selected }: { job: DiscoveryJob; onSelect: (id: string) => void; selected?: boolean }) {
  const tx = useUiText();
  const progress = discoveryJobProgress(job, tx);
  return <button className={`job-row${selected ? ' selected' : ''}`} onClick={() => onSelect(job.id)} aria-current={selected ? 'true' : undefined}>
    <span className={`job-status ${job.status.toLowerCase()}`} aria-hidden="true" />
    <span>
      <strong>{job.name}</strong>
      <small>{job.subnet.cidr} · {job.subnet.site?.name ?? 'sem Site'} · {formatResultCount(job._count.results)} · <span className="job-status-label">{discoveryStatusLabel(job.status)}</span>{progress ? ` · ${progress}` : ''}</small>
      <small>{formatDateTime(job.startedAt ?? job.createdAt)}{job.durationMs != null ? ` · ${formatDurationMs(job.durationMs)}` : job.status === 'RUNNING' ? ' · em curso' : ''}</small>
      <DiscoveryRunProgress job={job} />
      <DiscoveryFailureReason job={job} />
    </span>
    <ChevronRight size={15} />
  </button>;
}
