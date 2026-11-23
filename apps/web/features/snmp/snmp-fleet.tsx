'use client';

import { useQuery } from '@tanstack/react-query';
import { RadioTower, Settings2, X } from 'lucide-react';
import { ApiRequestError } from '@/lib/api/errors';
import { formatDateTime } from '@/lib/format/date';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { getSnmpFleetSummary, type SnmpAttentionReason, type SnmpFleetSummary } from './api';

const reasonBadges: Record<string, { tone: string; label: string }> = {
  FAILED: { tone: 'excluded', label: 'Polling falhou' },
  BLOCKED: { tone: 'reserved', label: 'Bloqueado' },
  NO_SCHEDULE: { tone: 'excluded', label: 'Sem agendamento' },
  STALE: { tone: 'reserved', label: 'Desatualizado' },
  NEVER_POLLED: { tone: 'pending', label: 'Nunca sincronizado' },
  NOT_CONFIGURED: { tone: 'pending', label: 'Não configurado' },
};

/** Badge for an attention reason; unknown reasons render as a neutral badge with the raw code. */
export function SnmpAttentionBadge({ reason }: { reason: SnmpAttentionReason }) {
  const badge = reasonBadges[reason];
  return <span className={`state-badge ${badge?.tone ?? ''}`.trim()}><i />{badge?.label ?? reason}</span>;
}

/** Message for a failed fleet summary request: SITE_NOT_FOUND is explained, anything else shows the API message. */
export function fleetErrorMessage(cause: unknown): string {
  if (cause instanceof ApiRequestError && cause.code === 'SITE_NOT_FOUND') return 'O Site selecionado não existe ou não tens acesso a ele.';
  return cause instanceof Error && cause.message ? cause.message : 'Não foi possível carregar o resumo da frota SNMP.';
}

const count = (value: number | undefined) => value ?? 0;

type Props = {
  siteId: string;
  openDevice: (deviceId: string) => void;
  openDrifts: () => void;
  /** SNMP Phase 1 step 5: opens the "Configurar SNMP" wizard for a device without SNMP config (ADMIN only). */
  configureDevice?: (deviceId: string, name: string) => void;
};
type AttentionRow = NonNullable<SnmpFleetSummary['attention']>[number];

const attentionColumns = (openDevice: Props['openDevice'], configureDevice?: Props['configureDevice']): DataTableColumn<AttentionRow>[] => [
  { id: 'device', header: 'Equipamento', cell: (item) => <><strong>{item.name}</strong>{item.lastStatus ? <small>{item.lastStatus}</small> : null}</> },
  { id: 'reason', header: 'Motivo', cell: (item) => <SnmpAttentionBadge reason={item.reason} /> },
  { id: 'lastPoll', header: 'Último poll', cell: (item) => (item.lastPollAt ? formatDateTime(item.lastPollAt) : <span className="muted-cell">Nunca</span>) },
  { id: 'error', header: 'Erro', cell: (item) => (item.lastErrorCode ? <span className="mono">{item.lastErrorCode}</span> : <span className="muted-cell">—</span>) },
  { id: 'drifts', header: 'Divergências', cell: (item) => count(item.pendingDrifts) },
  { id: 'actions', header: null, className: 'table-actions', cell: (item) => <span className="button-row">{item.reason === 'NOT_CONFIGURED' && configureDevice && <button type="button" className="primary-button" aria-label={`Configurar SNMP em ${item.name}`} onClick={() => configureDevice(item.deviceId, item.name)}><Settings2 size={13} /> Configurar</button>}<button type="button" className="secondary-button" aria-label={`Abrir ${item.name}`} onClick={() => openDevice(item.deviceId)}>Abrir</button></span> },
];

/** Fleet-wide SNMP health for the active Site: configuration, polling state, drift and the devices needing attention. */
export function SnmpFleetSummaryView({ siteId, openDevice, openDrifts, configureDevice }: Props) {
  const { data, error, isLoading } = useQuery({ queryKey: ['snmp', 'fleet', siteId], queryFn: () => getSnmpFleetSummary(siteId || undefined), refetchInterval: 60_000, retry: false });
  if (error) return <div className="ipam-alert error" role="alert"><X size={15} />{fleetErrorMessage(error)}</div>;
  if (isLoading || !data) return <div className="empty-context" aria-busy="true"><RadioTower size={24} /><strong>A carregar o resumo da frota…</strong></div>;
  return <FleetSummaryContent data={data} openDevice={openDevice} openDrifts={openDrifts} configureDevice={configureDevice} />;
}

function FleetSummaryContent({ data, openDevice, openDrifts, configureDevice }: { data: SnmpFleetSummary; openDevice: (deviceId: string) => void; openDrifts: () => void; configureDevice?: Props['configureDevice'] }) {
  const byStatus = data.polling?.byStatus ?? {};
  const attention = data.attention ?? [];
  const attentionTotal = data.attentionTotal ?? attention.length;
  return <>
    <div className="summary-stats" role="group" aria-label="Resumo da frota SNMP">
      <div><strong>{`${count(data.devices?.configured)} / ${count(data.devices?.total)}`}</strong><span>Equipamentos com SNMP configurado</span></div>
      <div><strong>{count(data.devices?.enabled)}</strong><span>{`Polling ativo · ${count(data.devices?.disabled)} desativados`}</span></div>
      <div><strong>{count(data.devices?.notConfigured)}</strong><span>Sem configuração SNMP</span></div>
      <div><strong>{count(byStatus.FAILED)}</strong><span>{`Polling falhou · ${count(byStatus.BLOCKED)} bloqueados`}</span></div>
      <div><strong>{count(data.polling?.stale)}</strong><span>{`Desatualizados · ${count(byStatus.NEVER_POLLED)} nunca sincronizados${data.polling?.noSchedule ? ` · ${data.polling.noSchedule} sem agendamento` : ''}`}</span></div>
      <div><strong>{count(data.drift?.pending)}</strong><span>{`Divergências pendentes em ${count(data.drift?.devicesWithPending)} equipamentos`}</span></div>
    </div>
    <p className="ipam-scope-note">{`Último poll: ${data.polling?.lastPollAt ? formatDateTime(data.polling.lastPollAt) : '—'} · Poll mais antigo: ${data.polling?.oldestPollAt ? formatDateTime(data.polling.oldestPollAt) : '—'}`}{data.generatedAt ? ` · Gerado em ${formatDateTime(data.generatedAt)}` : ''}{data.scheduler?.ok === false ? ` · Agendamento do polling com falhas (${data.scheduler.errorCode ?? `${data.scheduler.failed} equipamento(s)`})` : ''}</p>
    <section className="ipam-card">
      <div className="panel-heading"><div><h2>Equipamentos que precisam de atenção</h2><p className="panel-description">{attentionTotal > attention.length ? `A mostrar ${attention.length} de ${attentionTotal} equipamentos.` : 'Polling falhado, bloqueado, desatualizado, nunca executado ou SNMP por configurar.'}</p></div>{count(data.drift?.pending) > 0 && <button type="button" className="secondary-button" onClick={openDrifts}>Rever divergências</button>}</div>
      {attention.length ? <DataTable rows={attention} columns={attentionColumns(openDevice, configureDevice)} rowKey={(item) => item.deviceId} label="Equipamentos que precisam de atenção" /> : <div className="no-data">Nenhum equipamento precisa de atenção.</div>}
    </section>
  </>;
}
