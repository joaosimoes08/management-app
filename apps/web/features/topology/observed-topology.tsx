'use client';

import { useCallback, useEffect, useMemo, useState, type Dispatch, type ReactNode, type SetStateAction } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, Clock3, RefreshCw, RotateCcw } from 'lucide-react';
import { listAllDevices } from '@/features/infrastructure/api';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { applyTopologyProposal, getSnmpDeviceOverview, listDeviceLldpObservations, listDeviceTopologyProposals, rejectTopologyProposal, undoTopologyProposal, type LldpObservation, type NeighborProtocol, type SnmpInterfaceObservation, type TopologyProposal } from './observed-api';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';

const dateTime = (value: string) => formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short' });
const confidence = (value: number) => `${Math.round(Math.max(0, Math.min(100, value)))}%`;
const actionLabel = (action: TopologyProposal['action']) => ({ ADD: 'topology.observedTopology.action.add', UPDATE: 'topology.observedTopology.action.update', REMOVAL_CANDIDATE: 'topology.observedTopology.action.removalCandidate', CONNECTION_ADD: 'topology.observedTopology.action.connectionAdd', CONNECTION_UPDATE: 'topology.observedTopology.action.connectionUpdate' })[action];
const interfaceName = (item: SnmpInterfaceObservation) => item.name || item.description || `ifIndex ${item.ifIndex}`;
const proposalForLink = (items: TopologyProposal[], observation: LldpObservation) => items.find((item) => (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') && item.context?.observationId === observation.id);

/** The protocol a link was seen by: the observation's own, else its proposal's context (both from #180), else LLDP (rows before #180). */
export const linkProtocol = (observation: LldpObservation, proposal?: TopologyProposal): NeighborProtocol => {
  const fromProposal = proposal?.context?.protocol;
  return observation.protocol ?? (fromProposal === 'CDP' || fromProposal === 'LLDP' ? fromProposal : 'LLDP');
};
/** "LLDP", "CDP" or "LLDP e CDP": the protocols behind the links listed (LLDP or CDP while there is none). */
export const evidenceProtocols = (protocols: NeighborProtocol[]) => {
  const seen = (['LLDP', 'CDP'] as const).filter((protocol) => protocols.includes(protocol));
  return seen.length === 1 ? seen[0] : seen.length ? 'LLDP e CDP' : 'LLDP ou CDP';
};

/** The joined protocol phrases are Portuguese; everything else (LLDP, CDP) reads the same in every language. */
const protocolKeys: Record<string, string> = { 'LLDP e CDP': 'topology.observed.protocols.both', 'LLDP ou CDP': 'topology.observed.protocols.either' };

export function ObservedTopology({ onToolbarChange }: { onToolbarChange: Dispatch<SetStateAction<ReactNode>> }) {
  const tx = useUiText();
  const protocolText = (protocols: string) => (protocolKeys[protocols] ? tx(protocolKeys[protocols], protocols) : protocols);
  const { siteId } = useSiteContext();
  const { hasRole } = useAuth();
  const canReview = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const queryClient = useQueryClient();
  const [deviceId, setDeviceId] = useState('');
  const [error, setError] = useState('');
  const devices = useQuery({ queryKey: ['topology', 'observed', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const deviceItems = useMemo(() => devices.data?.items ?? [], [devices.data?.items]);
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
  const apply = useMutation({ mutationFn: applyTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : tx('topology.observedTopology.couldNotApplyThisProposal')) });
  const reject = useMutation({ mutationFn: rejectTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : tx('topology.observedTopology.couldNotRejectThisProposal')) });
  const undo = useMutation({ mutationFn: undoTopologyProposal, onSuccess: invalidate, onError: (cause) => setError(cause instanceof Error ? cause.message : tx('topology.observedTopology.couldNotRevertThisChange')) });
  const busy = apply.isPending || reject.isPending || undo.isPending;
  const refresh = useCallback(async () => { setError(''); await Promise.all([queryClient.refetchQueries({ queryKey: ['topology', 'observed', 'devices', siteId] }), ...(selectedDeviceId ? [queryClient.refetchQueries({ queryKey: ['topology', 'observed', 'snapshot', selectedDeviceId] }), queryClient.refetchQueries({ queryKey: ['topology', 'observed', 'links', selectedDeviceId] }), queryClient.refetchQueries({ queryKey: ['topology', 'observed', 'proposals', selectedDeviceId] })] : [])]); }, [queryClient, selectedDeviceId, siteId]);
  useEffect(() => { onToolbarChange(<><label className="observed-device-select">{tx('topology.observedTopology.equipment')}<select className="context-toolbar-selector" aria-label={tx('topology.observedTopology.deviceForSnmpObservation')} value={selectedDeviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">{tx('topology.observedTopology.selectADevice')}</option>{deviceItems.map((device) => <option key={device.id} value={device.id}>{`${device.name} · ${device.managementIp || tx('topology.observed.noManagementIp', 'sem IP de gestão')}`}</option>)}</select></label><button className="secondary-button" onClick={() => void refresh()} disabled={devices.isFetching || overview.isFetching || links.isFetching || proposals.isFetching}><RefreshCw size={14} className={devices.isFetching || overview.isFetching || links.isFetching || proposals.isFetching ? 'spin' : ''} /> {tx('topology.observedTopology.refresh')}</button></>); }, [deviceItems, devices.isFetching, links.isFetching, onToolbarChange, overview.isFetching, proposals.isFetching, refresh, selectedDeviceId, tx]);
  const snapshot = overview.data?.latestSnapshot;
  const items = proposals.data ?? [];
  const interfaceItems = items.filter((item) => item.action !== 'CONNECTION_ADD' && item.action !== 'CONNECTION_UPDATE');
  const loadError = overview.error || links.error || proposals.error || devices.error;

  return <div className="observed-topology">
    <div className="observed-heading"><div><h2>{tx('topology.observedTopology.interfacesAndLinksCollectedOver')}</h2><p>{tx('topology.observedTopology.observationsStaySeparateFromThe')}</p></div></div>
    {!siteId && <div className="no-data">{tx('topology.observedTopology.selectASiteToView')}</div>}
    {loadError && <div className="ipam-alert error" role="alert">{loadError instanceof Error ? loadError.message : tx('topology.observedTopology.couldNotLoadSnmpObservations')}</div>}
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    {devices.isLoading && siteId && <div className="no-data" role="status">{tx('topology.observedTopology.loadingDevices')}</div>}
    {selectedDevice && <>
      <div className="observed-device-name"><strong>{selectedDevice.name}</strong><span>{selectedDevice.type} · {selectedDevice.managementIp || tx('topology.observedTopology.noManagementIp')}{selectedDevice.hostname ? ` · ${selectedDevice.hostname}` : ''}</span></div>
      {overview.isLoading && <div className="no-data" role="status">{tx('topology.observedTopology.loadingTheLatestSnmpCollection')}</div>}
      {snapshot && <><div className="observed-freshness"><Clock3 size={15} /><span><strong>{tx('topology.observedTopology.lastCollectionCompleted')}</strong> {dateTime(snapshot.observedAt)}</span><span>{tx(`topology.observed.interfaceCount.${snapshot.interfaces.length === 1 ? 'one' : 'other'}`, '{count} interfaces observadas', { count: snapshot.interfaces.length })}</span></div>
        <section className="ipam-card observed-interfaces"><div className="panel-heading"><div><h3>{tx('topology.observedTopology.observedInterfaces')}</h3></div></div>{snapshot.interfaces.map((item) => <article className="observed-row" key={item.id}><strong>{interfaceName(item)}</strong><small>ifIndex {item.ifIndex}{item.description && item.description !== item.name ? ` · ${item.description}` : ''}{item.alias ? ` · ${item.alias}` : ''}</small><div className="observed-evidence">{item.macAddress && <span>MAC: {item.macAddress}</span>}{item.adminUp !== undefined && item.adminUp !== null && <span>{tx('topology.observed.admin', 'Admin: {state}', { state: tx(item.adminUp ? 'topology.observed.state.up' : 'topology.observed.state.down', item.adminUp ? 'ativo' : 'inativo') })}</span>}{item.operUp !== undefined && item.operUp !== null && <span>{tx('topology.observed.operational', 'Operacional: {state}', { state: tx(item.operUp ? 'topology.observed.state.up' : 'topology.observed.state.down', item.operUp ? 'ativo' : 'inativo') })}</span>}{item.speedMbps ? <span>{tx('topology.observed.speed', 'Velocidade: {speed} Mbps', { speed: item.speedMbps })}</span> : null}{item.interfaceType !== undefined && item.interfaceType !== null && <span>{tx('topology.observed.snmpType', 'Tipo SNMP: {type}', { type: item.interfaceType })}</span>}</div></article>)}{!snapshot.interfaces.length && <div className="no-data">{tx('topology.observedTopology.theLatestCollectionHasNo')}</div>}</section>
      </>}
      {!overview.isLoading && !snapshot && !overview.error && <div className="no-data">{tx('topology.observedTopology.thereIsNoSnmpCollection')}</div>}
      <section className="ipam-card observed-links" aria-labelledby="observed-links-title"><div className="panel-heading"><div><h3 id="observed-links-title">{tx('topology.observedTopology.linksBetweenDevices')}</h3><p className="panel-description">{tx('topology.observed.linksEvidence', 'Evidência {protocols} da última recolha. As ligações observadas não alteram os mapas manuais.', { protocols: protocolText(evidenceProtocols((links.data ?? []).map((link) => linkProtocol(link, proposalForLink(items, link))))) })}</p></div></div>
        {links.isLoading && <div className="no-data" role="status">{tx('topology.observedTopology.loadingObservedLinks')}</div>}
        {!links.isLoading && !links.error && !(links.data?.length) && <div className="observed-links-empty" role="status"><strong>{tx('topology.observedTopology.noObservedLinksInThis')}</strong><span>{tx('topology.observedTopology.thereAreNoLldpOr')}</span></div>}
        {links.data?.map((link) => {
          const candidateDevices = deviceItems.filter((candidate) => Boolean(link.managementAddress) && candidate.managementIp === link.managementAddress);
          const remoteDevice = deviceItems.find((candidate) => candidate.id === link.resolvedDeviceId);
          const ambiguous = !link.resolvedDeviceId && candidateDevices.length > 1;
          const proposal = proposalForLink(items, link);
          const observed = new Date(link.observedAt);
          const ageMinutes = Math.max(0, Math.floor((Date.now() - observed.getTime()) / 60000));
          const freshness = ageMinutes < 60 ? tx('topology.observed.freshness.minutes', 'Atual · {minutes} min', { minutes: ageMinutes }) : ageMinutes < 1440 ? tx('topology.observed.freshness.hours', 'Desatualizada · {hours} h', { hours: Math.floor(ageMinutes / 60) }) : tx('topology.observed.freshness.days', 'Desatualizada · {days} d', { days: Math.floor(ageMinutes / 1440) });
          const values = proposal?.observedValues ?? {};
          const pendingConnection = (proposal?.action === 'CONNECTION_ADD' || proposal?.action === 'CONNECTION_UPDATE') && proposal.status === 'PENDING';
          return <article className="observed-link-row" key={link.id}>
            <div className="observed-link-endpoints"><strong>{selectedDevice?.name || tx('topology.observedTopology.equipment')} <span>↔</span> {remoteDevice?.name || link.remoteSystemName || link.managementAddress || link.remoteChassisId || tx('topology.observedTopology.unidentifiedNeighbor')}</strong><span>{link.localPortDescription || link.localPortId || (link.localPortNumber != null ? tx('groupB.topology.portNumber', undefined, { number: link.localPortNumber }) : tx('topology.observedTopology.unknownLocalPort'))} <span>↔</span> {link.remotePortDescription || link.remotePortId || tx('topology.observedTopology.unknownRemotePort')}</span></div>
            <div className="observed-evidence"><span className="observed-link-protocol">{tx('topology.observed.linkEvidence', 'Evidência {protocol}', { protocol: linkProtocol(link, proposal) })}</span><span>{tx('topology.observedTopology.source')} {link.source}</span><span>{tx('topology.observedTopology.confidence')} {confidence(link.confidence)}</span><span>{tx('topology.observedTopology.observed')} {dateTime(link.observedAt)}</span><span>{tx('topology.observedTopology.freshness')} {freshness}</span><span className={`observed-link-status ${ambiguous ? 'ambiguous' : link.resolvedDeviceId ? 'resolved' : 'unresolved'}`}>{ambiguous ? tx('topology.observedTopology.ambiguous') : link.resolvedDeviceId ? tx('topology.observedTopology.resolved') : tx('topology.observedTopology.unresolved')}</span></div>
            {(link.remoteChassisId || link.remoteSystemName || link.managementAddress) && <details className="observed-link-details"><summary>{tx('topology.observedTopology.evidenceAndIdentifiers')}</summary><ul>{link.remoteSystemName && <li>{tx('topology.observedTopology.remoteSystem')} {link.remoteSystemName}</li>}{link.managementAddress && <li>{tx('topology.observedTopology.managementAddress')} {link.managementAddress}</li>}{link.remoteChassisId && <li>{tx('topology.observed.chassisId', 'Chassis ID: {id} (subtipo {subtype})', { id: link.remoteChassisId, subtype: link.remoteChassisIdSubtype ?? '—' })}</li>}{link.remotePortId && <li>{tx('topology.observed.remotePortId', 'Remote port ID: {id} (subtipo {subtype})', { id: link.remotePortId, subtype: link.remotePortIdSubtype ?? '—' })}</li>}</ul></details>}
            {proposal && <div className="observed-link-proposal"><strong>{proposal.status === 'PENDING' ? tx('topology.observedTopology.linkProposedForReview') : proposal.status === 'APPLIED' ? tx('topology.observedTopology.linkAppliedToTheInventory') : proposal.status === 'REJECTED' ? tx('topology.observedTopology.proposalRejected') : tx('topology.observedTopology.applicationReverted')}</strong><span>{proposal.action === 'CONNECTION_UPDATE' ? tx('topology.observedTopology.theCollectionDetectedChangesOn') : tx('topology.observedTopology.theNeighbourWasObservedBut')}</span>{proposal.beforeValues && <details><summary>{tx('topology.observedTopology.before')}</summary><pre>{JSON.stringify(proposal.beforeValues, null, 2)}</pre></details>}<details><summary>{tx('topology.observedTopology.proposedLink')}</summary><pre>{JSON.stringify(values, null, 2)}</pre></details><div className="proposal-controls">{pendingConnection && <><button className="primary-button" disabled={!canReview || busy || !link.resolvedDeviceId} title={!canReview ? tx('topology.observedTopology.noPermissionToReviewProposals') : !link.resolvedDeviceId ? tx('topology.observedTopology.theRemoteDeviceMustBe') : undefined} onClick={() => { setError(''); apply.mutate(proposal.id); }}><Check size={13} /> {tx('topology.observedTopology.applyLink')}</button><button className="secondary-button" disabled={!canReview || busy} onClick={() => { setError(''); reject.mutate(proposal.id); }}>{tx('topology.observedTopology.reject')}</button></>}{proposal.status === 'APPLIED' && !proposal.undoneAt && <button className="secondary-button" disabled={!canReview || busy} onClick={() => { setError(''); undo.mutate(proposal.id); }}><RotateCcw size={13} /> {tx('topology.observedTopology.revert')}</button>}</div></div>}
          </article>;
        })}
      </section>
      <section className="ipam-card observed-proposals"><div className="panel-heading"><div><h3>{tx('topology.observedTopology.inventoryProposals')}</h3><p className="panel-description">{tx('topology.observedTopology.additionsAndUpdatesNeedApproval')}</p></div></div>
        {proposals.isLoading && <div className="no-data" role="status">{tx('topology.observedTopology.loadingProposals')}</div>}
        {interfaceItems.map((item) => <article className="proposal-item" key={item.id}><div className="proposal-copy"><span className={`proposal-action ${item.action === 'REMOVAL_CANDIDATE' ? 'remove' : item.action.toLowerCase()}`}>{tx(actionLabel(item.action))}</span><strong>{item.interface?.name || (typeof item.observedValues?.name === 'string' ? item.observedValues.name : null) || `ifIndex ${item.observedIfIndex ?? '—'}`}</strong><small>{item.action === 'ADD' ? tx('topology.observedTopology.observedInterfaceThatIsNot') : item.action === 'UPDATE' ? tx('topology.observedTopology.observedValuesDifferFromThe') : tx('topology.observedTopology.theInterfaceDidNotAppear')}</small><div className="observed-evidence"><span>{tx('topology.observedTopology.source')} {item.source}</span><span>{tx('topology.observedTopology.confidence')} {confidence(item.confidence)}</span><span>{tx('topology.observedTopology.observed')} {dateTime(item.snapshot.observedAt)}</span>{item.context && <details><summary>{tx('topology.observedTopology.observationContext')}</summary><pre>{JSON.stringify(item.context, null, 2)}</pre></details>}{item.beforeValues && <details><summary>{tx('topology.observedTopology.currentInventoryValue')}</summary><pre>{JSON.stringify(item.beforeValues, null, 2)}</pre></details>}<details><summary>{tx('topology.observedTopology.observedValue')}</summary><pre>{JSON.stringify(item.observedValues ?? {}, null, 2)}</pre></details><details><summary>{tx('topology.observedTopology.proposedDifferences')}</summary><ul>{[...new Set([...Object.keys(item.beforeValues ?? {}), ...Object.keys(item.observedValues ?? {})])].filter((key) => JSON.stringify(item.beforeValues?.[key]) !== JSON.stringify(item.observedValues?.[key])).map((key) => <li key={key}><strong>{key}:</strong> {JSON.stringify(item.beforeValues?.[key] ?? null)} → {JSON.stringify(item.observedValues?.[key] ?? null)}</li>)}{!Object.keys(item.beforeValues ?? {}).length && <li>{tx('topology.observedTopology.noPreviousValuesRecorded')}</li>}</ul></details></div></div>
          <div className="proposal-controls">{item.action === 'REMOVAL_CANDIDATE' && <span className="blocked-note"><AlertTriangle size={13} /> {tx('topology.observedTopology.blockedRemovalCandidatesCannotBe')}</span>}{item.status === 'PENDING' ? <>{item.action !== 'REMOVAL_CANDIDATE' && <button className="primary-button" disabled={!canReview || busy} title={!canReview ? tx('topology.observedTopology.noPermissionToReviewProposals') : undefined} onClick={() => { setError(''); apply.mutate(item.id); }}><Check size={13} /> {tx('topology.observedTopology.apply')}</button>}<button className="secondary-button" disabled={!canReview || busy} title={!canReview ? tx('topology.observedTopology.noPermissionToReviewProposals') : undefined} onClick={() => { setError(''); reject.mutate(item.id); }}>{tx('topology.observedTopology.reject')}</button></> : item.status === 'APPLIED' ? <span className="applied-note"><Check size={13} /> {item.appliedAt ? tx('topology.observed.appliedAt', 'Aplicada {date}', { date: dateTime(item.appliedAt) }) : tx('topology.observedTopology.applied')}{item.reviewedBy ? ` · ${tx('topology.observed.reviewer', 'revisor {name}', { name: item.reviewedBy })}` : ''} · <a href="/auditoria">{tx('topology.observedTopology.audit')}</a></span> : <span className="proposal-state">{item.status === 'UNDONE' ? tx('topology.observedTopology.rolledBack') : tx('topology.observedTopology.rejected')}{item.reviewedAt ? ` · ${dateTime(item.reviewedAt)}` : ''}</span>}
            {item.status === 'APPLIED' && item.action !== 'REMOVAL_CANDIDATE' && !item.undoneAt && <button className="secondary-button" disabled={!canReview || busy} title={!canReview ? tx('topology.observedTopology.noPermissionToRevertProposals') : undefined} onClick={() => { setError(''); undo.mutate(item.id); }}><RotateCcw size={13} /> {tx('topology.observedTopology.revert')}</button>}
          </div></article>)}
        {!proposals.isLoading && !interfaceItems.length && <div className="no-data">{tx('topology.observedTopology.thereAreNoInterfaceProposals')}</div>}
      </section>
    </>}
  </div>;
}
