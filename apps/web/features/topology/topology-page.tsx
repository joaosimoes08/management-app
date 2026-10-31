'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Edge, type Node, type NodeChange, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AppShell } from '@/components/layout/app-shell';
import { listAllDevices, listInterfaces } from '@/features/infrastructure/api';
import type { DeviceInterface } from '@/features/infrastructure/types';
import { listVlans } from '@/features/ipam/api';
import { useSiteContext } from '@/lib/site-context';
import { createTopologyConnection, createTopologyMap, deleteTopologyConnection, deleteTopologyMap, getTopologyMap, listTopologyConnections, listTopologyMaps, replaceTopologyNodes, updateTopologyConnection } from './api';
import type { TopologyMap, TopologyMapType, TopologyNode } from './types';

const types: TopologyMapType[] = ['PHYSICAL', 'NETWORK', 'VLAN_SUBNET'];
const nodeColor = (type?: string) => ({ SWITCH: '#2563eb', ROUTER: '#7c3aed', FIREWALL: '#dc2626', SERVER: '#0891b2', STORAGE: '#059669' }[type ?? ''] ?? '#475569');
function nodeLabel(map: TopologyMap, node: TopologyNode) {
  const device = node.device;
  const location = [device?.rack?.room?.building?.name, device?.rack?.room?.name, device?.rack?.name].filter(Boolean).join(' · ');
  const vlanBadges = node.networkContext?.vlans.map((vlan) => `VLAN ${vlan.vlanId}`).join(', ');
  const subnetBadges = node.networkContext?.subnets.map((subnet) => subnet.cidr).join(', ');
  const secondary = map.type === 'PHYSICAL' ? (location || 'Sem localização') : map.type === 'NETWORK' ? (device?.managementIp || 'Sem IP de gestão') : ([vlanBadges, subnetBadges].filter(Boolean).join(' · ') || 'Sem VLAN/subnet documentada');
  return <span style={{ display: 'grid', gap: 3 }}><strong>{node.label ?? device?.name ?? node.deviceId}</strong><small style={{ opacity: .8 }}>{secondary}</small></span>;
}
const interfaceLabel = (item: DeviceInterface) => item.name;

export function TopologyPage() {
  const { siteId } = useSiteContext();
  const queryClient = useQueryClient();
  const canvasRef = useRef<HTMLElement>(null);
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [mapType, setMapType] = useState<TopologyMapType>('PHYSICAL');
  const [selectedVlanIds, setSelectedVlanIds] = useState<string[]>([]);
  const [warning, setWarning] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [sourceDeviceId, setSourceDeviceId] = useState('');
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [sourceInterfaceId, setSourceInterfaceId] = useState('');
  const [targetInterfaceId, setTargetInterfaceId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeType, setEdgeType] = useState<'PHYSICAL' | 'LOGICAL'>('PHYSICAL');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const maps = useQuery({ queryKey: ['topology', 'maps', siteId], queryFn: () => listTopologyMaps(siteId), enabled: Boolean(siteId) });
  const detail = useQuery({ queryKey: ['topology', selected], queryFn: () => getTopologyMap(selected), enabled: Boolean(selected) });
  const devices = useQuery({ queryKey: ['topology', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const vlans = useQuery({ queryKey: ['topology', 'vlans', siteId], queryFn: () => listVlans(siteId), enabled: Boolean(siteId) });
  const allConnections = useQuery({ queryKey: ['topology', 'connections', siteId], queryFn: () => listTopologyConnections(siteId), enabled: Boolean(siteId) });
  const sourceInterfaces = useQuery({ queryKey: ['topology', 'interfaces', sourceDeviceId], queryFn: () => listInterfaces(sourceDeviceId), enabled: Boolean(sourceDeviceId) });
  const targetInterfaces = useQuery({ queryKey: ['topology', 'interfaces', targetDeviceId], queryFn: () => listInterfaces(targetDeviceId), enabled: Boolean(targetDeviceId) });
  const current = detail.data;
  const selectedConnection = current?.connections.find((connection) => connection.id === selectedEdgeId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!current) return;
    setNodes(current.nodes.map((node) => ({ id: node.id, position: { x: node.x, y: node.y }, data: { label: nodeLabel(current, node) }, style: { color: '#fff', background: nodeColor(node.device?.type), borderRadius: 8, padding: 10 } })));
    setEdges(current.connections.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label: edge.label || [edge.sourceInterface?.name, edge.targetInterface?.name].filter(Boolean).join(' ↔ ') || edge.type })));
    if (selectedEdgeId && !current.connections.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId('');
  }, [current, selectedEdgeId, setEdges, setNodes]);
  useEffect(() => { if (selectedConnection) { setEdgeLabel(selectedConnection.label ?? ''); setEdgeType(selectedConnection.type ?? 'PHYSICAL'); } }, [selectedConnection]);
  useEffect(() => { const sync = () => setIsFullscreen(Boolean(document.fullscreenElement)); document.addEventListener('fullscreenchange', sync); return () => { document.removeEventListener('fullscreenchange', sync); clearTimeout(saveTimer.current); }; }, []);

  const create = useMutation({ mutationFn: () => createTopologyMap({ name: name.trim(), type: mapType, siteId, ...(mapType === 'VLAN_SUBNET' ? { filters: { vlanIds: selectedVlanIds } } : {}) }), onSuccess: (map) => { setName(''); setSelectedVlanIds([]); setSelected(map.id); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const remove = useMutation({ mutationFn: () => deleteTopologyMap(selected, current?.revision), onSuccess: () => { setSelected(''); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const persist = (next: Node[]) => {
    if (!current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: current.nodes.find((item) => item.id === node.id)?.deviceId ?? node.id.split(':').pop()!, x: node.position.x, y: node.position.y }))); await detail.refetch(); setWarning(''); }
      catch (error) { setWarning(String(error).includes('alterado') ? 'Este mapa foi alterado noutro separador. Recarrega o mapa antes de guardar.' : 'Não foi possível guardar as posições.'); await detail.refetch(); }
    }, 500);
  };
  const addDevice = async () => {
    if (!current || !deviceId || current.nodes.some((node) => node.deviceId === deviceId)) return;
    const next = [...nodes, { id: `${current.id}:${deviceId}`, position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 20 }, data: { label: devices.data?.items.find((device) => device.id === deviceId)?.name ?? deviceId } } as Node];
    try { await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: node.id.split(':').pop()!, x: node.position.x, y: node.position.y }))); setDeviceId(''); await detail.refetch(); setWarning(''); }
    catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de adicionar o equipamento.' : 'Não foi possível adicionar o equipamento ao mapa.'); }
  };
  const addConnection = async () => {
    if (!current || !sourceDeviceId || !targetDeviceId || !sourceInterfaceId || !targetInterfaceId || sourceDeviceId === targetDeviceId) return;
    const sourcePort = sourceInterfaces.data?.find((item) => item.id === sourceInterfaceId);
    const targetPort = targetInterfaces.data?.find((item) => item.id === targetInterfaceId);
    if (!sourcePort || !targetPort) return;
    try {
      await createTopologyConnection(current.id, { sourceNodeId: `${current.id}:${sourceDeviceId}`, targetNodeId: `${current.id}:${targetDeviceId}`, revision: current.revision, sourceInterfaceId, targetInterfaceId, type: 'PHYSICAL', label: `${sourcePort.name} ↔ ${targetPort.name}` });
      setSourceInterfaceId(''); setTargetInterfaceId(''); await detail.refetch(); await allConnections.refetch(); setWarning('');
    } catch (error) { setWarning(String(error).includes('já ligada') ? 'Uma das portas já está ligada. Escolhe portas livres.' : String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de criar a ligação.' : 'Não foi possível criar a ligação.'); await detail.refetch(); await allConnections.refetch(); }
  };
  const saveConnection = async () => {
    if (!selectedConnection) return;
    try { await updateTopologyConnection(selectedConnection.id, { label: edgeLabel.trim() || undefined, type: edgeType, expectedRevisions: current ? { [current.id]: current.revision } : {} }); await detail.refetch(); setWarning(''); }
    catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de atualizar a ligação.' : 'Não foi possível atualizar a ligação.'); await detail.refetch(); }
  };
  const removeConnection = async () => {
    if (!current || !selectedConnection) return;
    try { await deleteTopologyConnection(current.id, selectedConnection.id, current.revision); setSelectedEdgeId(''); await detail.refetch(); await allConnections.refetch(); setWarning(''); }
    catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de remover a ligação.' : 'Não foi possível remover a ligação.'); }
  };
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement) await document.exitFullscreen(); else await canvasRef.current?.requestFullscreen(); }
    catch { setWarning('O navegador não permitiu alterar o modo de ecrã inteiro.'); }
  };
  const mapOptions = useMemo(() => maps.data?.items ?? [], [maps.data]);
  const busyInterfaceIds = new Set((allConnections.data?.items ?? []).flatMap((connection) => [connection.sourceInterfaceId, connection.targetInterfaceId].filter((id): id is string => Boolean(id))));
  const available = (items?: DeviceInterface[]) => (items ?? []).filter((item) => !busyInterfaceIds.has(item.id));
  const handleNodesChange = (changes: NodeChange[]) => { const next = applyNodeChanges(changes, nodes); onNodesChange(changes); if (changes.some((change) => change.type === 'position' && change.position)) persist(next); };

  return <AppShell section="Topologia" context={['Infraestrutura']}>
    <main className="module-page topology-page">
      <header className="module-hero"><span className="section-kicker">INFRAESTRUTURA</span><h1>Topologia</h1><p>Mapas do Site e ligações entre equipamentos.</p></header>
      <div className="topology-toolbar" aria-label="Controlos do mapa">
        <label className="topology-map-select">Mapa<select aria-label="Selecionar mapa" value={selected} onChange={(event) => { setSelected(event.target.value); setSelectedEdgeId(''); }} disabled={maps.isLoading || !mapOptions.length}><option value="">{maps.isLoading ? 'A carregar mapas…' : mapOptions.length ? 'Seleciona um mapa…' : 'Sem mapas'}</option>{mapOptions.map((map) => <option key={map.id} value={map.id}>{map.name} · {map.type.replace('_', ' ')}</option>)}</select></label>
        <details className="topology-tool"><summary>Criar mapa</summary><div className="topology-popover"><label>Nome<input aria-label="Nome do mapa" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rede principal" /></label><label>Tipo<select aria-label="Tipo do mapa" value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>{mapType === 'VLAN_SUBNET' && <label>VLANs<select multiple aria-label="VLANs do mapa" value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>}<button className="primary-button" disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'A criar…' : 'Criar mapa'}</button></div></details>
        {current && <details className="topology-tool"><summary>Adicionar equipamento</summary><div className="topology-popover"><label>Equipamento<select aria-label="Equipamento a adicionar" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona…</option>{devices.data?.items.filter((device) => !current.nodes.some((node) => node.deviceId === device.id)).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button className="primary-button" disabled={!deviceId} onClick={() => void addDevice()}>Adicionar ao mapa</button></div></details>}
        {current && <details className="topology-tool"><summary>Nova ligação</summary><div className="topology-popover topology-link-form"><label>Equipamento A<select aria-label="Equipamento A" value={sourceDeviceId} onChange={(event) => { const next = event.target.value; setSourceDeviceId(next); setSourceInterfaceId(''); if (next === targetDeviceId) { setTargetDeviceId(''); setTargetInterfaceId(''); } }}><option value="">Seleciona…</option>{current.nodes.map((node) => <option key={node.deviceId} value={node.deviceId}>{node.device?.name ?? node.deviceId}</option>)}</select></label><label>Porta A<select aria-label="Porta A" value={sourceInterfaceId} onChange={(event) => setSourceInterfaceId(event.target.value)} disabled={!sourceDeviceId || sourceInterfaces.isLoading}><option value="">Seleciona uma porta existente…</option>{available(sourceInterfaces.data).map((item) => <option key={item.id} value={item.id}>{interfaceLabel(item)}</option>)}</select></label><span className="topology-link-symbol" aria-hidden="true">↔</span><label>Equipamento B<select aria-label="Equipamento B" value={targetDeviceId} onChange={(event) => { setTargetDeviceId(event.target.value); setTargetInterfaceId(''); }}><option value="">Seleciona…</option>{current.nodes.filter((node) => node.deviceId !== sourceDeviceId).map((node) => <option key={node.deviceId} value={node.deviceId}>{node.device?.name ?? node.deviceId}</option>)}</select></label><label>Porta B<select aria-label="Porta B" value={targetInterfaceId} onChange={(event) => setTargetInterfaceId(event.target.value)} disabled={!targetDeviceId || targetInterfaces.isLoading}><option value="">Seleciona uma porta existente…</option>{available(targetInterfaces.data).map((item) => <option key={item.id} value={item.id}>{interfaceLabel(item)}</option>)}</select></label><button className="primary-button" disabled={!sourceInterfaceId || !targetInterfaceId || allConnections.isLoading} onClick={() => void addConnection()}>Criar ligação</button><small>As portas vêm do inventário e não podem ser editadas aqui. Uma porta física só pode estar numa ligação.</small></div></details>}
        {current && <button className="secondary-button danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'A eliminar…' : 'Eliminar mapa'}</button>}
        <button className="secondary-button topology-fullscreen" onClick={() => void toggleFullscreen()} aria-label={isFullscreen ? 'Sair do ecrã inteiro' : 'Ver mapa em ecrã inteiro'}>{isFullscreen ? 'Sair do ecrã inteiro' : 'Ecrã inteiro'}</button>
      </div>
      {selectedConnection && <section className="topology-selection" aria-label="Ligação selecionada"><strong>{current?.nodes.find((node) => node.deviceId === selectedConnection.sourceDeviceId)?.device?.name ?? 'Equipamento'} · {selectedConnection.sourceInterface?.name ?? 'porta não indicada'} ↔ {current?.nodes.find((node) => node.deviceId === selectedConnection.targetDeviceId)?.device?.name ?? 'Equipamento'} · {selectedConnection.targetInterface?.name ?? 'porta não indicada'}</strong><label>Etiqueta<input aria-label="Etiqueta da ligação" value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} /></label><label>Tipo<select aria-label="Tipo da ligação" value={edgeType} onChange={(event) => setEdgeType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select></label><button className="primary-button" onClick={() => void saveConnection()}>Guardar</button><button className="secondary-button danger" onClick={() => void removeConnection()}>Remover ligação</button></section>}
      {warning && <p className="ipam-alert error" role="alert">{warning}</p>}
      <section ref={canvasRef} className={`topology-canvas panel${isFullscreen ? ' topology-canvas-fullscreen' : ''}`} aria-label="Área do mapa de topologia">{isFullscreen && <button className="secondary-button topology-fullscreen-exit" onClick={() => void toggleFullscreen()}>Sair do ecrã inteiro</button>}<ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} nodesConnectable={false} onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)} fitView><Background /><MiniMap /><Controls /></ReactFlow>{!selected && !maps.isLoading && <div className="topology-canvas-empty"><strong>Seleciona ou cria um mapa</strong><span>O mapa de topologia ocupa esta área.</span></div>}</section>
    </main>
  </AppShell>;
}
