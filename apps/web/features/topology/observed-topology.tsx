'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock3, RefreshCw, RotateCcw } from 'lucide-react';
import { listAllDevices } from '@/features/infrastructure/api';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { applyTopologyProposal, getSnmpDeviceOverview, listDeviceLldpObservations, listDeviceTopologyProposals, rejectTopologyProposal, undoTopologyProposal, type LldpObservation, type SnmpInterfaceObservation, type TopologyProposal } from './observed-api';

const dateTime = (value: string) => new Intl.DateTimeFormat('pt-PT', { dateStyle: 'medium', timeStyle: 'short' }).format(new Date(value));
const confidence = (value: number) => `${Math.round(Math.max(0, Math.min(100, value)))}%`;
const actionLabel = (action: TopologyProposal['action']) => ({ ADD: 'Adicionar interface', UPDATE: 'Atualizar interface', REMOVAL_CANDIDATE: 'Candidato a remoção · bloqueado', CONNECTION_ADD: 'Proposta de ligação', CONNECTION_UPDATE: 'Proposta de atualização de ligação' })[action];
const interfaceName = (item: SnmpInterfaceObservation) => item.name || item.description || `ifIndex ${item.ifIndex}`;
const proposalForLink = (items: TopologyProposal[], observation: LldpObservation) => items.find((item) => (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') && item.context?.observationId === observation.id);

export function ObservedTopology() {
  const { siteId } = useSiteContext();
  const { hasRole } = useAuth();
  const canReview = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const devices = useQuery({ queryKey: ['topology', 'observed', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const deviceItems = devices.data?.items ?? [];
  const selectedDeviceId = deviceId || deviceItems[0]?.id || '';
  const selectedDevice = deviceItems.find((item) => item.id === selectedDeviceId);
  const overview = useQuery({ queryKey: ['topology', 'observed', 'snapshot', selectedDeviceId], queryFn: () => getSnmpDeviceOverview(selectedDeviceId), enabled: Boolean(selectedDeviceId) });
  const links = useQuery({ queryKey: ['topology', 'observed', 'links', selectedDeviceId], queryFn: () => listDeviceLldpObservations(selectedDeviceId), enabled: Boolean(selectedDeviceId) });
  const proposals = useQuery({ queryKey: ['topology', 'observed', 'proposals', selectedDeviceId], queryFn: () => listDeviceTopologyProposals(selectedDeviceId), enabled: Boolean(selectedDeviceId) });
  const invalidate = async () => Promise.all([
    queryClient.invalidateQueries({ queryKey: ['topology', 'observed', 'snapshot', selectedDeviceId] }),
    queryClient.invalidateQueries({ queryKey: ['topology', 'observed', 'links', selectedDeviceId] }),
    queryClient.invalidateQueries({ queryKey: ['topology', 'observed', 'proposals', selectedDeviceId] }),
  ]);
  const apply = useMutation({ mutationFn: applyTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível aplicar esta proposta.') });
  const reject = useMutation({ mutationFn: rejectTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível rejeitar esta proposta.') });
  const undo = useMutation({ mutationFn: undoTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível reverter esta alteração.') });
  const busy = apply.isPending || reject.isPending || undo.isPending;
  const refresh = async () => { setError(''); await Promise.all([devices.refetch(), ...(selectedDeviceId ? [overview.refetch(), links.refetch(), proposals.refetch()] : [])]); };
  const snapshot = overview.data?.latestSnapshot;
  const items = proposals.data ?? [];
  const interfaceItems = items.filter((item) => item.action !== 'CONNECTION_ADD' && item.action !== 'CONNECTION_UPDATE');
  const loadError = overview.error || links.error || proposals.error || devices.error;

  return <div className="observed-topology">
    <div className="observed-heading"><div><span className="section-kicker">TOPOLOGIA OBSERVADA</span><h2>Interfaces e ligações recolhidas por SNMP</h2><p>As observações permanecem separadas do inventário. Só propostas revistas alteram dados mantidos.</p></div><button className="secondary-button" onClick={() => void refresh()} disabled={devices.isFetching || overview.isFetching || links.isFetching || proposals.isFetching}><RefreshCw size={14} className={devices.isFetching || overview.isFetching || links.isFetching || proposals.isFetching ? 'spin' : ''} /> Atualizar</button></div>
    {!siteId && <div className="no-data">Seleciona um site para consultar a topologia observada.</div>}
    {siteId && <label className="observed-device-select">Equipamento<select aria-label="Equipamento para observação SNMP" value={selectedDeviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona um equipamento</option>{deviceItems.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.managementIp || 'sem IP de gestão'}</option>)}</select></label>}
    {loadError && <div className="ipam-alert error" role="alert">{loadError instanceof Error ? loadError.message : 'Não foi possível carregar observações SNMP.'}</div>}
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    {devices.isLoading && siteId && <div className="no-data" role="status">A carregar equipamentos…</div>}
    {selectedDevice && <>
      <div className="observed-device-name"><strong>{selectedDevice.name}</strong><span>{selectedDevice.type} · {selectedDevice.managementIp || 'Sem IP de gestão'}{selectedDevice.hostname ? ` · ${selectedDevice.hostname}` : ''}</span></div>
      {overview.isLoading && <div className="no-data" role="status">A carregar última recolha SNMP…</div>}
      {snapshot && <><div className="observed-freshness"><Clock3 size={15} /><span><strong>Última recolha concluída</strong> {dateTime(snapshot.observedAt)}</span><span>{snapshot.interfaces.length} interfaces observadas</span></div>
        <section className="ipam-card observed-interfaces"><div className="panel-heading"><div><span className="section-kicker">VISTAS NA REDE</span><h3>Interfaces observadas</h3></div></div>{snapshot.interfaces.map((item) => <article className="observed-row" key={item.id}><strong>{interfaceName(item)}</strong><small>ifIndex {item.ifIndex}{item.description && item.description !== item.name ? ` · ${item.description}` : ''}{item.alias ? ` · ${item.alias}` : ''}</small><div className="observed-evidence">{item.macAddress && <span>MAC: {item.macAddress}</span>}{item.adminUp !== undefined && item.adminUp !== null && <span>Admin: {item.adminUp ? 'ativo' : 'inativo'}</span>}{item.operUp !== undefined && item.operUp !== null && <span>Operacional: {item.operUp ? 'ativo' : 'inativo'}</span>}{item.speedMbps ? <span>Velocidade: {item.speedMbps} Mbps</span> : null}{item.interfaceType !== undefined && item.interfaceType !== null && <span>Tipo SNMP: {item.interfaceType}</span>}</div></article>)}{!snapshot.interfaces.length && <div className="no-data">A última recolha não contém interfaces observadas.</div>}</section>
      </>}
      {!overview.isLoading && !snapshot && !overview.error && <div className="no-data">Ainda não existe uma recolha SNMP para este equipamento.</div>}
      <section className="ipam-card observed-links" aria-labelledby="observed-links-title"><div className="panel-heading"><div><span className="section-kicker">VIZINHANÇAS OBSERVADAS</span><h3 id="observed-links-title">Ligações entre equipamentos</h3><p className="panel-description">Evidência LLDP da última recolha. As ligações observadas não alteram os mapas manuais.</p></div></div>
        {links.isLoading && <div className="no-data" role="status">A carregar ligações observadas…</div>}
        {!links.isLoading && !links.error && !(links.data?.length) && <div className="observed-links-empty" role="status"><strong>Sem ligações observadas nesta recolha</strong><span>Não há vizinhanças LLDP registadas para este equipamento.</span></div>}
        {links.data?.map((link) => {
          const candidateDevices = deviceItems.filter((candidate) => Boolean(link.managementAddress) && candidate.managementIp === link.managementAddress);
          const remoteDevice = deviceItems.find((candidate) => candidate.id === link.resolvedDeviceId);
          const ambiguous = !link.resolvedDeviceId && candidateDevices.length > 1;
          const proposal = proposalForLink(items, link);
          const observed = new Date(link.observedAt);
          const ageMinutes = Math.max(0, Math.floor((Date.now() - observed.getTime()) / 60000));
          const freshness = ageMinutes < 60 ? `Atual · ${ageMinutes} min` : ageMinutes < 1440 ? `Desatualizada · ${Math.floor(ageMinutes / 60)} h` : `Desatualizada · ${Math.floor(ageMinutes / 1440)} d`;
          const values = proposal?.observedValues ?? {};
          const pendingConnection = (proposal?.action === 'CONNECTION_ADD' || proposal?.action === 'CONNECTION_UPDATE') && proposal.status === 'PENDING';
          return <article className="observed-link-row" key={link.id}>
            <div className="observed-link-endpoints"><strong>{selectedDevice?.name || 'Equipamento'} <span>↔</span> {remoteDevice?.name || link.remoteSystemName || link.managementAddress || link.remoteChassisId || 'Vizinho por identificar'}</strong><span>{link.localPortDescription || link.localPortId || (link.localPortNumber != null ? `Porta ${link.localPortNumber}` : 'Porta local desconhecida')} <span>↔</span> {link.remotePortDescription || link.remotePortId || 'Porta remota desconhecida'}</span></div>
            <div className="observed-evidence"><span>Origem: {link.source}</span><span>Confiança: {confidence(link.confidence)}</span><span>Observado: {dateTime(link.observedAt)}</span><span>Frescura: {freshness}</span><span className={`observed-link-status ${ambiguous ? 'ambiguous' : link.resolvedDeviceId ? 'resolved' : 'unresolved'}`}>{ambiguous ? 'Ambíguo' : link.resolvedDeviceId ? 'Resolvido' : 'Por resolver'}</span></div>
            {(link.remoteChassisId || link.remoteSystemName || link.managementAddress) && <details className="observed-link-details"><summary>Evidência e identificadores</summary><ul>{link.remoteSystemName && <li>Sistema remoto: {link.remoteSystemName}</li>}{link.managementAddress && <li>Endereço de gestão: {link.managementAddress}</li>}{link.remoteChassisId && <li>Chassis ID: {link.remoteChassisId} (subtipo {link.remoteChassisIdSubtype ?? '—'})</li>}{link.remotePortId && <li>Remote port ID: {link.remotePortId} (subtipo {link.remotePortIdSubtype ?? '—'})</li>}</ul></details>}
            {proposal && <div className="observed-link-proposal"><strong>{proposal.status === 'PENDING' ? 'Ligação proposta para revisão' : proposal.status === 'APPLIED' ? 'Ligação aplicada ao inventário' : proposal.status === 'REJECTED' ? 'Proposta rejeitada' : 'Aplicação revertida'}</strong><span>{proposal.action === 'CONNECTION_UPDATE' ? 'A recolha detetou alterações numa ligação já registada; só a revisão controlada altera o inventário.' : 'A vizinhança foi observada, mas ainda não consta como ligação manual.'}</span>{proposal.beforeValues && <details><summary>Antes</summary><pre>{JSON.stringify(proposal.beforeValues, null, 2)}</pre></details>}<details><summary>Ligação proposta</summary><pre>{JSON.stringify(values, null, 2)}</pre></details><div className="proposal-controls">{pendingConnection && <><button className="primary-button" disabled={!canReview || busy || !link.resolvedDeviceId} title={!canReview ? 'Sem permissões para rever propostas' : !link.resolvedDeviceId ? 'O equipamento remoto tem de estar resolvido para aplicar a ligação' : undefined} onClick={() => { setError(''); apply.mutate(proposal.id); }}><Check size={13} /> Aplicar ligação</button><button className="secondary-button" disabled={!canReview || busy} onClick={() => { setError(''); reject.mutate(proposal.id); }}>Rejeitar</button></>}{proposal.status === 'APPLIED' && !proposal.undoneAt && <button className="secondary-button" disabled={!canReview || busy} onClick={() => { setError(''); undo.mutate(proposal.id); }}><RotateCcw size={13} /> Reverter</button>}</div></div>}
          </article>;
        })}
      </section>
      <section className="ipam-card observed-proposals"><div className="panel-heading"><div><span className="section-kicker">REVISÃO CONTROLADA</span><h3>Propostas para o inventário</h3><p className="panel-description">Adicionar e atualizar exigem aprovação. Candidatos a remoção ficam bloqueados.</p></div></div>
        {proposals.isLoading && <div className="no-data" role="status">A carregar propostas…</div>}
        {interfaceItems.map((item) => <article className="proposal-item" key={item.id}><div className="proposal-copy"><span className={`proposal-action ${item.action === 'REMOVAL_CANDIDATE' ? 'remove' : item.action.toLowerCase()}`}>{actionLabel(item.action)}</span><strong>{item.interface?.name || (typeof item.observedValues?.name === 'string' ? item.observedValues.name : null) || `ifIndex ${item.observedIfIndex ?? '—'}`}</strong><small>{item.action === 'ADD' ? 'Interface observada que ainda não existe no inventário.' : item.action === 'UPDATE' ? 'Valores observados diferem dos valores atualmente mantidos.' : 'A interface não apareceu nesta recolha; remoção não pode ser inferida com segurança.'}</small><div className="observed-evidence"><span>Origem: {item.source}</span><span>Confiança: {confidence(item.confidence)}</span><span>Observado: {dateTime(item.snapshot.observedAt)}</span>{item.context && <details><summary>Contexto da observação</summary><pre>{JSON.stringify(item.context, null, 2)}</pre></details>}{item.beforeValues && <details><summary>Valor atual no inventário</summary><pre>{JSON.stringify(item.beforeValues, null, 2)}</pre></details>}<details><summary>Valor observado</summary><pre>{JSON.stringify(item.observedValues ?? {}, null, 2)}</pre></details><details><summary>Diferenças propostas</summary><ul>{[...new Set([...Object.keys(item.beforeValues ?? {}), ...Object.keys(item.observedValues ?? {})])].filter((key) => JSON.stringify(item.beforeValues?.[key]) !== JSON.stringify(item.observedValues?.[key])).map((key) => <li key={key}><strong>{key}:</strong> {JSON.stringify(item.beforeValues?.[key] ?? null)} → {JSON.stringify(item.observedValues?.[key] ?? null)}</li>)}{!Object.keys(item.beforeValues ?? {}).length && <li>Sem valores anteriores registados.</li>}</ul></details></div></div>
          <div className="proposal-controls">{item.action === 'REMOVAL_CANDIDATE' && <span className="blocked-note"><AlertTriangle size={13} /> Bloqueada: candidatos a remoção não podem ser aplicados.</span>}{item.status === 'PENDING' ? <>{item.action !== 'REMOVAL_CANDIDATE' && <button className="primary-button" disabled={!canReview || busy} title={!canReview ? 'Sem permissões para rever propostas' : undefined} onClick={() => { setError(''); apply.mutate(item.id); }}><Check size={13} /> Aplicar</button>}<button className="secondary-button" disabled={!canReview || busy} title={!canReview ? 'Sem permissões para rever propostas' : undefined} onClick={() => { setError(''); reject.mutate(item.id); }}>Rejeitar</button></> : item.status === 'APPLIED' ? <span className="applied-note"><Check size={13} /> Aplicada {item.appliedAt ? dateTime(item.appliedAt) : ''}{item.reviewedBy ? ` · revisor ${item.reviewedBy}` : ''} · <a href="/auditoria">auditoria</a></span> : <span className="proposal-state">{item.status === 'UNDONE' ? 'Revertida' : 'Rejeitada'}{item.reviewedAt ? ` · ${dateTime(item.reviewedAt)}` : ''}</span>}
            {item.status === 'APPLIED' && item.action !== 'REMOVAL_CANDIDATE' && !item.undoneAt && <button className="secondary-button" disabled={!canReview || busy} title={!canReview ? 'Sem permissões para reverter propostas' : undefined} onClick={() => { setError(''); undo.mutate(item.id); }}><RotateCcw size={13} /> Reverter</button>}
          </div></article>)}
        {!proposals.isLoading && !interfaceItems.length && <div className="no-data">Ainda não existem propostas de interface para este equipamento.</div>}
      </section>
    </>}
  </div>;
}
