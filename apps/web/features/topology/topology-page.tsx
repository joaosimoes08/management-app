'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQueries, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Expand, Link2, Minimize2, Plus, Trash2, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { listAllDevices, listInterfaces } from '@/features/infrastructure/api';
import type { DeviceInterface } from '@/features/infrastructure/types';
import { listVlans } from '@/features/ipam/api';
import { useSiteContext } from '@/lib/site-context';
import { createTopologyConnection, createTopologyMap, deleteTopologyConnection, deleteTopologyMap, getTopologyMap, listTopologyMaps, replaceTopologyNodes, updateTopologyConnection } from './api';
import type { TopologyConnection, TopologyMap, TopologyMapType, TopologyNode } from './types';

const mapTypes: TopologyMapType[] = ['PHYSICAL', 'NETWORK', 'VLAN_SUBNET'];
const nodeColor = (type?: string) => ({ SWITCH: '#2563eb', ROUTER: '#7c3aed', FIREWALL: '#dc2626', SERVER: '#0891b2', STORAGE: '#059669' }[type ?? ''] ?? '#475569');
const deviceIdFromNode = (current: TopologyMap, nodeId: string) => current.nodes.find((node) => node.id === nodeId)?.deviceId;

function nodeLabel(map: TopologyMap, node: TopologyNode) {
  const device = node.device;
  const location = [device?.rack?.room?.building?.name, device?.rack?.room?.name, device?.rack?.name].filter(Boolean).join(' · ');
  const vlanBadges = node.networkContext?.vlans.map((vlan) => `VLAN ${vlan.vlanId}`).join(', ');
  const subnetBadges = node.networkContext?.subnets.map((subnet) => subnet.cidr).join(', ');
  const secondary = map.type === 'PHYSICAL' ? (location || 'Sem localização') : map.type === 'NETWORK' ? (device?.managementIp || 'Sem IP de gestão') : ([vlanBadges, subnetBadges].filter(Boolean).join(' · ') || 'Sem VLAN/subnet documentada');
  return <span className="topology-node-label"><strong>{node.label ?? device?.name ?? node.deviceId}</strong><small>{secondary}</small></span>;
}

export function TopologyPage() {
  const { siteId } = useSiteContext();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [mapType, setMapType] = useState<TopologyMapType>('PHYSICAL');
  const [selectedVlanIds, setSelectedVlanIds] = useState<string[]>([]);
  const [showCreateMap, setShowCreateMap] = useState(false);
  const [showConnection, setShowConnection] = useState(false);
  const [warning, setWarning] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [sourceDeviceId, setSourceDeviceId] = useState('');
  const [targetDeviceId, setTargetDeviceId] = useState('');
  const [sourceInterfaceId, setSourceInterfaceId] = useState('');
  const [targetInterfaceId, setTargetInterfaceId] = useState('');
  const [connectionType, setConnectionType] = useState<'PHYSICAL' | 'LOGICAL'>('PHYSICAL');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [isFullscreen, setIsFullscreen] = useState(false);
  const canvasRef = useRef<HTMLElement | null>(null);
  const maps = useQuery({ queryKey: ['topology', 'maps', siteId], queryFn: () => listTopologyMaps(siteId), enabled: Boolean(siteId) });
  const devices = useQuery({ queryKey: ['topology', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const vlans = useQuery({ queryKey: ['topology', 'vlans', siteId], queryFn: () => listVlans(siteId), enabled: Boolean(siteId && mapType === 'VLAN_SUBNET') });
  const detail = useQuery({ queryKey: ['topology', selected], queryFn: () => getTopologyMap(selected), enabled: Boolean(selected) });
  const current = detail.data;
  const mapOptions = useMemo(() => maps.data?.items ?? [], [maps.data]);
  const nodesInMap = current?.nodes ?? [];
  const interfaceQueries = useQueries({ queries: nodesInMap.map((node) => ({ queryKey: ['topology', 'interfaces', node.deviceId], queryFn: () => listInterfaces(node.deviceId), enabled: Boolean(current) })) });
  const interfaceSignature = interfaceQueries.map((query) => query.dataUpdatedAt).join(':');
  const interfacesByDevice = Object.fromEntries(nodesInMap.map((node, index) => [node.deviceId, interfaceQueries[index]?.data ?? []])) as Record<string, DeviceInterface[]>;
  const usedInterfaceIds = useMemo(() => new Set((current?.connections ?? []).flatMap((connection) => [connection.sourceInterfaceId, connection.targetInterfaceId].filter((id): id is string => Boolean(id)))), [current?.connections]);
  const sourceInterfaces = (interfacesByDevice[sourceDeviceId] ?? []).filter((item) => !usedInterfaceIds.has(item.id));
  const targetInterfaces = (interfacesByDevice[targetDeviceId] ?? []).filter((item) => !usedInterfaceIds.has(item.id));
  const selectedConnection = current?.connections.find((connection) => connection.id === selectedEdgeId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!maps.data) return;
    if (!mapOptions.some((map) => map.id === selected)) setSelected(mapOptions[0]?.id ?? '');
  }, [mapOptions, maps.data, selected]);
  useEffect(() => {
    if (!current) { setNodes([]); setEdges([]); return; }
    setNodes(current.nodes.map((node) => ({ id: node.id, position: { x: node.x, y: node.y }, data: { label: nodeLabel(current, node) }, style: { color: '#fff', background: nodeColor(node.device?.type), borderRadius: 10, padding: 12, border: '1px solid rgba(255,255,255,.25)', minWidth: 150 } })));
    setEdges(current.connections.map((connection) => ({ id: connection.id, source: connection.sourceNodeId, target: connection.targetNodeId, label: connectionLabel(connection, interfacesByDevice) })));
    if (selectedEdgeId && !current.connections.some((connection) => connection.id === selectedEdgeId)) setSelectedEdgeId('');
    // Query result wrappers are recreated every render; dataUpdatedAt signature tracks actual interface changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [current, selectedEdgeId, interfaceSignature, setEdges, setNodes]);
  useEffect(() => {
    const syncFullscreen = () => setIsFullscreen(document.fullscreenElement === canvasRef.current);
    document.addEventListener('fullscreenchange', syncFullscreen);
    return () => document.removeEventListener('fullscreenchange', syncFullscreen);
  }, []);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const ids = current?.nodes.map((node) => node.deviceId) ?? [];
    if (!ids.includes(sourceDeviceId)) setSourceDeviceId(ids[0] ?? '');
    if (!ids.includes(targetDeviceId) || targetDeviceId === sourceDeviceId) setTargetDeviceId(ids.find((id) => id !== sourceDeviceId) ?? '');
  }, [current?.nodes, sourceDeviceId, targetDeviceId]);
  useEffect(() => { setSourceInterfaceId(''); }, [sourceDeviceId]);
  useEffect(() => { setTargetInterfaceId(''); }, [targetDeviceId]);

  const create = useMutation({ mutationFn: () => createTopologyMap({ name: name.trim(), type: mapType, siteId, ...(mapType === 'VLAN_SUBNET' ? { filters: { vlanIds: selectedVlanIds } } : {}) }), onSuccess: (map) => { setName(''); setSelectedVlanIds([]); setShowCreateMap(false); setSelected(map.id); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const remove = useMutation({ mutationFn: () => deleteTopologyMap(selected, current?.revision), onSuccess: () => { setSelected(''); setSelectedEdgeId(''); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const addDevice = useMutation({ mutationFn: async () => {
    if (!current || !deviceId || current.nodes.some((node) => node.deviceId === deviceId)) throw new Error('Seleciona um equipamento ainda não incluído neste mapa.');
    const next = [...current.nodes.map((node) => ({ ...node, x: node.x, y: node.y })), { id: `${current.id}:${deviceId}`, deviceId, x: 80 + current.nodes.length * 180, y: 100 + (current.nodes.length % 3) * 110 } as TopologyNode];
    return replaceTopologyNodes(current.id, current.revision, next);
  }, onSuccess: async () => { setDeviceId(''); setWarning(''); await detail.refetch(); }, onError: (error) => setWarning(error instanceof Error ? error.message : 'Não foi possível adicionar o equipamento.') });
  const link = useMutation({ mutationFn: () => {
    if (!current || !sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId || !sourceInterfaceId || !targetInterfaceId || sourceInterfaceId === targetInterfaceId) throw new Error('Seleciona dois equipamentos diferentes e uma porta válida em cada extremo.');
    return createTopologyConnection(current.id, { sourceNodeId: `${current.id}:${sourceDeviceId}`, targetNodeId: `${current.id}:${targetDeviceId}`, sourceInterfaceId, targetInterfaceId, revision: current.revision, type: connectionType });
  }, onSuccess: async () => { setWarning(''); setShowConnection(false); setSourceInterfaceId(''); setTargetInterfaceId(''); await detail.refetch(); }, onError: (error) => setWarning(error instanceof Error ? error.message : 'Não foi possível criar a ligação.') });
  const saveConnection = useMutation({ mutationFn: () => selectedConnection ? updateTopologyConnection(selectedConnection.id, { label: edgeLabel.trim() || undefined, type: selectedConnection.type ?? 'PHYSICAL', expectedRevisions: current ? { [current.id]: current.revision } : {} }) : Promise.reject(new Error('Seleciona uma ligação.')), onSuccess: async () => { setWarning(''); await detail.refetch(); }, onError: () => setWarning('Não foi possível guardar os detalhes da ligação.') });
  const removeConnection = useMutation({ mutationFn: () => current && selectedConnection ? deleteTopologyConnection(current.id, selectedConnection.id, current.revision) : Promise.reject(new Error('Seleciona uma ligação.')), onSuccess: async () => { setSelectedEdgeId(''); setWarning(''); await detail.refetch(); }, onError: () => setWarning('Não foi possível remover a ligação.') });

  const persist = (next: Node[]) => {
    if (!current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try { await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ deviceId: current.nodes.find((item) => item.id === node.id)?.deviceId ?? node.id.split(':').pop()!, x: node.position.x, y: node.position.y }))); await detail.refetch(); setWarning(''); }
      catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa foi alterado noutro separador. Atualiza antes de guardar.' : 'Não foi possível guardar as posições.'); await detail.refetch(); }
    }, 500);
  };
  const handleNodesChange = (changes: NodeChange[]) => { const next = applyNodeChanges(changes, nodes); onNodesChange(changes); if (changes.some((change) => change.type === 'position' && change.position)) persist(next); };
  const handleConnect = (connection: Connection) => {
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return;
    const source = deviceIdFromNode(current, connection.source); const target = deviceIdFromNode(current, connection.target);
    if (!source || !target) return;
    setSourceDeviceId(source); setTargetDeviceId(target); setShowConnection(true); setWarning('Escolhe a porta de inventário em cada equipamento para concluir a ligação.');
  };
  const toggleFullscreen = async () => {
    try { if (document.fullscreenElement === canvasRef.current) await document.exitFullscreen(); else await canvasRef.current?.requestFullscreen(); }
    catch { setWarning('O navegador não permitiu abrir o mapa em ecrã inteiro.'); }
  };
  const availableDevices = devices.data?.items.filter((device) => !current?.nodes.some((node) => node.deviceId === device.id)) ?? [];
  const sourceName = nodesInMap.find((node) => node.deviceId === sourceDeviceId)?.device?.name ?? devices.data?.items.find((device) => device.id === sourceDeviceId)?.name ?? 'Equipamento de origem';
  const targetName = nodesInMap.find((node) => node.deviceId === targetDeviceId)?.device?.name ?? devices.data?.items.find((device) => device.id === targetDeviceId)?.name ?? 'Equipamento de destino';

  return <AppShell section="Topologia" context={['Infraestrutura']}>
    <main className="module-page topology-map-page">
      <header className="topology-page-heading"><div><span className="section-kicker">INFRAESTRUTURA</span><h1>Topologia</h1><p>Seleciona um mapa, coloca equipamentos e liga as portas registadas no inventário.</p></div></header>
      <section className="topology-map-toolbar" aria-label="Controlos do mapa">
        <label className="topology-map-picker">Mapa<select aria-label="Selecionar mapa" value={selected} onChange={(event) => { setSelected(event.target.value); setSelectedEdgeId(''); }} disabled={!mapOptions.length}><option value="">{maps.isLoading ? 'A carregar mapas…' : 'Seleciona um mapa'}</option>{mapOptions.map((map) => <option key={map.id} value={map.id}>{map.name} · {map.type.replaceAll('_', ' ')}</option>)}</select></label>
        <button className="secondary-button" onClick={() => setShowCreateMap((open) => !open)} aria-expanded={showCreateMap}>{showCreateMap ? <X size={15} /> : <Plus size={15} />}{showCreateMap ? 'Cancelar' : 'Novo mapa'}</button>
        <span className="topology-toolbar-spacer" />
        {selected && <button className="secondary-button danger" onClick={() => remove.mutate()} disabled={remove.isPending}><Trash2 size={14} />{remove.isPending ? 'A eliminar…' : 'Eliminar mapa'}</button>}
      </section>
      {showCreateMap && <section className="topology-inline-form" aria-label="Criar mapa">
        <label>Nome do mapa<input value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rede principal" /></label>
        <label>Tipo<select value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{mapTypes.map((type) => <option key={type} value={type}>{type.replaceAll('_', ' ')}</option>)}</select></label>
        {mapType === 'VLAN_SUBNET' && <label>VLANs<select multiple value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>}
        <button className="primary-button" disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'A criar…' : 'Criar mapa'}</button>
      </section>}
      {current && <section className="topology-canvas-toolbar" aria-label="Equipamentos e ligações">
        <label>Adicionar equipamento<select aria-label="Equipamento para adicionar ao mapa" value={deviceId} onChange={(event) => setDeviceId(event.target.value)} disabled={!availableDevices.length}><option value="">{availableDevices.length ? 'Seleciona do inventário' : 'Todos os equipamentos já estão no mapa'}</option>{availableDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
        <button className="secondary-button" onClick={() => addDevice.mutate()} disabled={!deviceId || addDevice.isPending}><Plus size={14} />{addDevice.isPending ? 'A adicionar…' : 'Adicionar ao mapa'}</button>
        <button className="secondary-button" onClick={() => setShowConnection((open) => !open)} aria-expanded={showConnection} disabled={nodesInMap.length < 2}><Link2 size={14} />{showConnection ? 'Fechar ligação' : 'Ligar equipamentos'}</button>
        <span className="topology-toolbar-spacer" />
        <button className="secondary-button" onClick={() => void toggleFullscreen()} aria-pressed={isFullscreen} aria-label={isFullscreen ? 'Sair de ecrã inteiro' : 'Abrir mapa em ecrã inteiro'}>{isFullscreen ? <Minimize2 size={14} /> : <Expand size={14} />}{isFullscreen ? 'Sair de ecrã inteiro' : 'Ecrã inteiro'}</button>
      </section>}
      {showConnection && current && <section className="topology-link-form" aria-label="Criar ligação entre portas">
        <div className="topology-link-endpoint"><label>Equipamento de origem<select aria-label="Equipamento de origem" value={sourceDeviceId} onChange={(event) => setSourceDeviceId(event.target.value)}>{nodesInMap.map((node) => <option key={node.deviceId} value={node.deviceId}>{node.device?.name ?? node.deviceId}</option>)}</select></label><label>Porta de origem<select aria-label="Porta de origem" value={sourceInterfaceId} onChange={(event) => setSourceInterfaceId(event.target.value)} disabled={interfaceQueries[nodesInMap.findIndex((node) => node.deviceId === sourceDeviceId)]?.isLoading}><option value="">{sourceInterfaces.length ? 'Seleciona uma porta inventariada' : 'Sem portas disponíveis no inventário'}</option>{sourceInterfaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <span className="topology-link-connector" aria-hidden="true">↔</span>
        <div className="topology-link-endpoint"><label>Equipamento de destino<select aria-label="Equipamento de destino" value={targetDeviceId} onChange={(event) => setTargetDeviceId(event.target.value)}>{nodesInMap.filter((node) => node.deviceId !== sourceDeviceId).map((node) => <option key={node.deviceId} value={node.deviceId}>{node.device?.name ?? node.deviceId}</option>)}</select></label><label>Porta de destino<select aria-label="Porta de destino" value={targetInterfaceId} onChange={(event) => setTargetInterfaceId(event.target.value)} disabled={interfaceQueries[nodesInMap.findIndex((node) => node.deviceId === targetDeviceId)]?.isLoading}><option value="">{targetInterfaces.length ? 'Seleciona uma porta inventariada' : 'Sem portas disponíveis no inventário'}</option>{targetInterfaces.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</select></label></div>
        <label className="topology-link-type">Tipo<select value={connectionType} onChange={(event) => setConnectionType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select></label>
        <button className="primary-button" onClick={() => link.mutate()} disabled={!sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId || !sourceInterfaceId || !targetInterfaceId || sourceInterfaceId === targetInterfaceId || link.isPending}><Link2 size={14} />{link.isPending ? 'A ligar…' : 'Criar ligação'}</button>
      </section>}
      {selectedConnection && <section className="topology-selected-link" aria-label="Ligação selecionada"><div><span className="section-kicker">LIGAÇÃO SELECIONADA</span><strong>{connectionLabel(selectedConnection, interfacesByDevice) || 'Ligação sem portas de inventário'}</strong></div><label>Etiqueta<input value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} placeholder="Opcional" /></label><button className="secondary-button" onClick={() => saveConnection.mutate()} disabled={saveConnection.isPending}>Guardar</button><button className="secondary-button danger" onClick={() => removeConnection.mutate()} disabled={removeConnection.isPending}><Trash2 size={14} />Remover</button></section>}
      {warning && <p className="ipam-alert error topology-warning" role="status">{warning}</p>}
      {!siteId && <p className="no-data" role="status">Seleciona um site para consultar os mapas de topologia.</p>}
      {maps.isError && <p className="ipam-alert error" role="alert">Não foi possível carregar os mapas.</p>}
      {selected && detail.isLoading && <p className="no-data" role="status">A carregar o mapa…</p>}
      {current && <section ref={canvasRef} className={`topology-map-canvas${isFullscreen ? ' is-fullscreen' : ''}`} aria-label={`Área do mapa ${current.name}`}>
        <div className="topology-canvas-title"><div><span className="section-kicker">{current.type.replaceAll('_', ' ')}</span><strong>{current.name}</strong></div><span>{current.nodes.length} equipamentos · {current.connections.length} ligações</span>{isFullscreen && <button className="secondary-button" onClick={() => void toggleFullscreen()} aria-label="Sair de ecrã inteiro"><Minimize2 size={14} />Sair de ecrã inteiro</button>}</div>
        <div className="topology-flow-wrap"><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={handleConnect} onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setEdgeLabel(current.connections.find((item) => item.id === edge.id)?.label ?? ''); }} fitView><Background /><MiniMap /><Controls /></ReactFlow>{!current.nodes.length && <div className="topology-canvas-empty"><strong>Este mapa ainda não tem equipamentos</strong><span>Adiciona dispositivos do inventário pela barra acima.</span></div>}</div>
      </section>}
      {!selected && !maps.isLoading && mapOptions.length === 0 && <section className="topology-empty-state"><strong>Ainda não existem mapas neste site</strong><span>Cria um mapa para começar a organizar a infraestrutura.</span><button className="primary-button" onClick={() => setShowCreateMap(true)}><Plus size={14} />Criar primeiro mapa</button></section>}
      {interfaceQueries.some((query) => query.isError) && <p className="ipam-alert error" role="alert">Não foi possível carregar as portas de um equipamento. Atualiza a página antes de criar ligações.</p>}
      {(sourceInterfaces.length === 0 || targetInterfaces.length === 0) && showConnection && current && !interfaceQueries.some((query) => query.isLoading || query.isError) && <p className="topology-port-note" role="status">{sourceName}: {sourceInterfaces.length} portas disponíveis · {targetName}: {targetInterfaces.length} portas disponíveis. As portas são lidas do inventário e não podem ser escritas nesta página.</p>}
    </main>
  </AppShell>;
}

function connectionLabel(connection: TopologyConnection, interfacesByDevice: Record<string, DeviceInterface[]>) {
  const source = (interfacesByDevice[connection.sourceDeviceId] ?? []).find((item) => item.id === connection.sourceInterfaceId)?.name;
  const target = (interfacesByDevice[connection.targetDeviceId] ?? []).find((item) => item.id === connection.targetInterfaceId)?.name;
  return source && target ? `${source} ↔ ${target}` : connection.label ?? '';
}
