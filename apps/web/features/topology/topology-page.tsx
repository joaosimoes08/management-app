'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, addEdge, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, type ReactFlowInstance, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AppShell } from '@/components/layout/app-shell';
import { listAllDevices } from '@/features/infrastructure/api';
import { listVlans } from '@/features/ipam/api';
import { listOperationalAlerts } from '@/features/operations/api';
import { AssetImage } from '@/features/infrastructure/components/asset-image';
import { EquipmentTypeIcon } from '@/features/infrastructure/components/equipment-type-icon';
import { useSiteContext } from '@/lib/site-context';
import { createTopologyConnection, createTopologyMap, deleteTopologyConnection, deleteTopologyMap, getTopologyMap, listTopologyMaps, replaceTopologyNodes, updateTopologyConnection } from './api';
import { loadAllTopologyAlerts, summarizeTopologyDeviceAlerts, topologyDeviceImage, topologySeverityColor, type TopologyNodeAlertSummary } from './alerts';
import { findTopologyNode } from './search';
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

function toFlowNode(map: TopologyMap, node: TopologyNode, alertSummary?: TopologyNodeAlertSummary): Node {
  const severity = alertSummary?.highestSeverity;
  const color = severity ? topologySeverityColor(severity) : undefined;
  const image = topologyDeviceImage(node.device);
  return {
    id: node.id,
    position: { x: node.x, y: node.y },
    data: { label: <span className="topology-node-content"><span className="topology-node-visual">{image ? <AssetImage asset={image} alt={`Imagem de ${node.device?.name ?? 'equipamento'}`} fallback={<EquipmentTypeIcon type={node.device?.type} alt="" />} /> : <EquipmentTypeIcon type={node.device?.type} alt="" />}</span><span className="topology-node-label">{nodeLabel(map, node)}</span>{alertSummary && <span className="topology-node-alert" style={{ color }} aria-label={`${alertSummary.count} alertas ativos; gravidade máxima ${severity}`} title={alertSummary.titles.join('\n')}>● {alertSummary.count} {alertSummary.count === 1 ? 'alerta' : 'alertas'} · {severity}</span>}</span> },
    style: { color: '#fff', background: nodeColor(node.device?.type), border: color ? `2px solid ${color}` : '1px solid rgba(255,255,255,.9)', boxShadow: color ? `0 0 0 3px ${color}35` : undefined, borderRadius: 8, padding: 10 },
  };
}

export function TopologyPage() {
  const { siteId } = useSiteContext();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const [search, setSearch] = useState('');
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAnnouncement, setFullscreenAnnouncement] = useState('');
  const fullscreenAnnouncementRef = useRef<HTMLSpanElement>(null);
  const [toolbarExpanded, setToolbarExpanded] = useState(true);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [name, setName] = useState('');
  const [mapType, setMapType] = useState<TopologyMapType>('PHYSICAL');
  const [selectedVlanIds, setSelectedVlanIds] = useState<string[]>([]);
  const [warning, setWarning] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeType, setEdgeType] = useState<'PHYSICAL' | 'LOGICAL'>('PHYSICAL');
  const maps = useQuery({ queryKey: ['topology', 'maps', siteId], queryFn: () => listTopologyMaps(siteId), enabled: Boolean(siteId) });
  const detail = useQuery({ queryKey: ['topology', selected], queryFn: () => getTopologyMap(selected), enabled: Boolean(selected) });
  const devices = useQuery({ queryKey: ['topology', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const vlans = useQuery({ queryKey: ['topology', 'vlans', siteId], queryFn: () => listVlans(siteId), enabled: Boolean(siteId) });
  const operationalAlerts = useQuery({ queryKey: ['topology', 'alerts', siteId], queryFn: async () => ({ items: await loadAllTopologyAlerts((page) => listOperationalAlerts(siteId, 100, page)) }), enabled: Boolean(siteId), refetchInterval: 30_000 });
  const current = detail.data;
  const nodeAlertSummaries = useMemo(() => summarizeTopologyDeviceAlerts(current?.nodes ?? [], operationalAlerts.data?.items ?? []), [current?.nodes, operationalAlerts.data?.items]);
  const mapProblemCount = [...nodeAlertSummaries.values()].reduce((total, summary) => total + summary.count, 0);
  const selectedNode = current?.nodes.find((node) => node.id === selectedNodeId);
  const searchMatch = current ? findTopologyNode(current.nodes, search) : undefined;
  const selectedConnection = current?.connections.find((connection) => connection.id === selectedEdgeId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!current) return;
    setNodes(current.nodes.map((node) => toFlowNode(current, node, nodeAlertSummaries.get(node.deviceId))));
    setEdges(current.connections.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label: edge.label ?? edge.type })));
  }, [current, setEdges, setNodes]);
  useEffect(() => {
    if (!current) return;
    const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
    setNodes((existing) => {
      if (existing.length !== current.nodes.length || existing.some((node) => !currentNodes.has(node.id))) return current.nodes.map((node) => toFlowNode(current, node, nodeAlertSummaries.get(node.deviceId)));
      return existing.map((flowNode) => {
        const node = currentNodes.get(flowNode.id)!;
        const refreshed = toFlowNode(current, node, nodeAlertSummaries.get(node.deviceId));
        return { ...flowNode, data: refreshed.data, style: { ...flowNode.style, ...refreshed.style } };
      });
    });
  }, [current, nodeAlertSummaries, setNodes]);
  useEffect(() => {
    if (current && selectedEdgeId && !current.connections.some((connection) => connection.id === selectedEdgeId)) setSelectedEdgeId('');
  }, [current, selectedEdgeId]);
  useEffect(() => { if (selectedConnection) { setEdgeLabel(selectedConnection.label ?? ''); setEdgeType(selectedConnection.type ?? 'PHYSICAL'); } }, [selectedConnection]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const compact = window.matchMedia('(max-width: 980px)');
    const update = () => setToolbarExpanded(!compact.matches);
    update();
    compact.addEventListener('change', update);
    return () => compact.removeEventListener('change', update);
  }, []);
  useEffect(() => {
    if (!fullscreen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        setFullscreen(false);
        setFullscreenAnnouncement('Modo de ecrã inteiro desativado.');
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [fullscreen]);
  useEffect(() => {
    if (!fullscreenAnnouncement || !fullscreenAnnouncementRef.current) return;
    fullscreenAnnouncementRef.current.textContent = fullscreen
      ? 'Modo de ecrã inteiro ativado. Prima Escape para sair.'
      : 'Modo de ecrã inteiro desativado.';
  }, [fullscreen, fullscreenAnnouncement]);

  const create = useMutation({ mutationFn: () => createTopologyMap({ name: name.trim(), type: mapType, siteId, ...(mapType === 'VLAN_SUBNET' ? { filters: { vlanIds: selectedVlanIds } } : {}) }), onSuccess: (map) => { setName(''); setSelectedVlanIds([]); setSelected(map.id); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const remove = useMutation({ mutationFn: () => deleteTopologyMap(selected, current?.revision), onSuccess: () => { setSelected(''); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); } });
  const persist = (next: Node[]) => {
    if (!current) return;
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: current.nodes.find((item) => item.id === node.id)?.deviceId ?? node.id.split(':').pop()!, x: node.position.x, y: node.position.y })));
        await detail.refetch(); setWarning('');
      } catch (error) {
        setWarning(String(error).includes('alterado') ? 'Este mapa foi alterado noutro separador. Recarrega o mapa antes de guardar.' : 'Não foi possível guardar as posições.');
        await detail.refetch();
      }
    }, 500);
  };
  const onConnect = async (connection: Connection) => {
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return;
    setEdges((items) => addEdge(connection, items));
    try {
      await createTopologyConnection(current.id, { sourceNodeId: connection.source, targetNodeId: connection.target, revision: current.revision, type: current.type === 'PHYSICAL' ? 'PHYSICAL' : 'LOGICAL' });
      await detail.refetch(); setWarning('');
    } catch (error) {
      setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de criar a ligação.' : 'Não foi possível criar a ligação.');
      await detail.refetch();
    }
  };
  const addDevice = async () => {
    if (!current || !deviceId || current.nodes.some((node) => node.deviceId === deviceId)) return;
    const next = [...nodes, { id: `${current.id}:${deviceId}`, position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 20 }, data: { label: devices.data?.items.find((item) => item.id === deviceId)?.name ?? deviceId } } as Node];
    try {
      await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: node.id.split(':').pop()!, x: node.position.x, y: node.position.y })));
      setDeviceId(''); await detail.refetch(); setWarning('');
    } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de adicionar o equipamento.' : 'Não foi possível adicionar o equipamento ao mapa.'); }
  };
  const saveConnection = async () => {
    if (!selectedConnection) return;
    try { await updateTopologyConnection(selectedConnection.id, { label: edgeLabel.trim() || undefined, type: edgeType, expectedRevisions: current ? { [current.id]: current.revision } : {} }); await detail.refetch(); setWarning(''); } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de atualizar a ligação.' : 'Não foi possível atualizar a ligação.'); await detail.refetch(); }
  };
  const removeConnection = async () => {
    if (!current || !selectedConnection) return;
    try { await deleteTopologyConnection(current.id, selectedConnection.id, current.revision); setSelectedEdgeId(''); await detail.refetch(); setWarning(''); } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de remover a ligação.' : 'Não foi possível remover a ligação.'); }
  };
  const mapOptions = useMemo(() => maps.data?.items ?? [], [maps.data]);
  const handleNodesChange = (changes: NodeChange[]) => { const next = applyNodeChanges(changes, nodes); onNodesChange(changes); if (changes.some((change) => change.type === 'position' && change.position)) persist(next); };
  const focusNode = (nodeId: string) => {
    setSelectedNodeId(nodeId);
    void flow?.fitView({ nodes: [{ id: nodeId }], duration: 450, padding: 0.45 });
  };
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    setFullscreenAnnouncement(next ? 'Modo de ecrã inteiro ativado. Prima Escape para sair.' : 'Modo de ecrã inteiro desativado.');
  };

  const topbarActions = <div className="topology-topbar-actions">
    <select aria-label="Mapa do site" value={selected} onChange={(event) => setSelected(event.target.value)}><option value="">Seleciona mapa…</option>{mapOptions.map((map) => <option key={map.id} value={map.id}>{map.name} · {map.type.replace('_', ' ')}</option>)}</select>
    <details className="topology-topbar-menu"><summary>Editar mapa</summary><div className="topology-topbar-form">
      <strong>Criar mapa</strong><label>Nome<input aria-label="Nome do novo mapa" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rede principal" /></label><label>Tipo<select aria-label="Tipo do novo mapa" value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
      {mapType === 'VLAN_SUBNET' && <label>VLANs associadas<select multiple aria-label="VLANs do mapa" value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>}
      <button className="primary-button" disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'A criar…' : 'Criar mapa'}</button>
      {current && <><strong>Adicionar equipamento</strong><label>Equipamento<select aria-label="Equipamento para adicionar" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona…</option>{devices.data?.items.filter((device) => !current.nodes.some((node) => node.deviceId === device.id)).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button className="secondary-button" disabled={!deviceId} onClick={() => void addDevice()}>Adicionar ao mapa</button></>}
      {selectedConnection && <><strong>Ligação selecionada</strong><label>Etiqueta<input aria-label="Etiqueta da ligação" value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} placeholder="Etiqueta" /></label><label>Tipo da ligação<select aria-label="Tipo da ligação" value={edgeType} onChange={(event) => setEdgeType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select></label><button className="primary-button" onClick={() => void saveConnection()}>Guardar ligação</button><button className="secondary-button danger" onClick={() => void removeConnection()}>Remover ligação</button></>}
      {selected && <button className="secondary-button danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'A eliminar…' : 'Eliminar mapa'}</button>}
      {warning && <p className="ipam-alert error" role="alert">{warning}</p>}
    </div></details>
  </div>;

  return <AppShell section="Topologia" context={['Infraestrutura']} actions={topbarActions}>
    <main className="topology-page">
        <section className={`topology-canvas panel${fullscreen ? ' topology-canvas--fullscreen' : ''}${labelsVisible ? '' : ' topology-canvas--auto-labels'}`} aria-label="Área do mapa de topologia">
          {current && <div className={`topology-map-toolbar${toolbarExpanded ? ' topology-map-toolbar--expanded' : ' topology-map-toolbar--collapsed'}`}>
            <div><strong>{current.name}</strong><span>{current.nodes.length} equipamentos · {current.connections.length} ligações · {operationalAlerts.isLoading ? 'A carregar problemas…' : operationalAlerts.isError ? 'Problemas indisponíveis' : `${mapProblemCount} problemas ativos`}</span>{operationalAlerts.isError && <span role="status">Estado dos alertas indisponível</span>}</div>
            <button className="secondary-button topology-map-more" aria-expanded={toolbarExpanded} aria-controls="topology-map-tools" onClick={() => setToolbarExpanded((value) => !value)}>{toolbarExpanded ? 'Menos controlos' : 'Controlos'}</button>
            <div id="topology-map-tools" className="topology-map-tools">
            <label className="topology-map-search">Procurar equipamento<input aria-label="Procurar equipamento no mapa" value={search} onChange={(event) => setSearch(event.target.value)} onKeyDown={(event) => { if (event.key === 'Escape') { setSearch(''); if (fullscreen) { setFullscreen(false); setFullscreenAnnouncement('Modo de ecrã inteiro desativado.'); event.stopPropagation(); } } if (event.key === 'Enter' && searchMatch) focusNode(searchMatch.id); }} placeholder="Nome, IP ou tipo" /></label>
            <button className="secondary-button" disabled={!searchMatch} onClick={() => searchMatch && focusNode(searchMatch.id)}>Encontrar</button>
            <button className="secondary-button" aria-pressed={labelsVisible} onClick={() => setLabelsVisible((value) => !value)}>{labelsVisible ? 'Ocultar etiquetas' : 'Mostrar etiquetas'}</button>
            <button className="secondary-button" aria-pressed={showGrid} onClick={() => setShowGrid((value) => !value)}>{showGrid ? 'Ocultar grelha' : 'Mostrar grelha'}</button>
            <button className="secondary-button" onClick={() => void flow?.fitView({ duration: 450, padding: 0.2 })}>Ajustar mapa</button>
            <button className="secondary-button" onClick={toggleFullscreen}>Alternar ecrã inteiro</button>
            </div>
          </div>}
          {current && search.trim() && !searchMatch && <p className="topology-map-no-results" role="status">Nenhum equipamento encontrado para “{search.trim()}”.</p>}
          <span ref={fullscreenAnnouncementRef} className="topology-sr-only" aria-live="polite" />
          {warning && <p className="ipam-alert error topology-warning" role="alert">{warning}</p>}
          {selectedNode && <aside className="topology-node-details" aria-live="polite"><strong>{selectedNode.label ?? selectedNode.device?.name ?? selectedNode.deviceId}</strong><span>{selectedNode.device?.type ?? 'Equipamento'}</span>{selectedNode.device?.managementIp && <span>{selectedNode.device.managementIp}</span>}{nodeAlertSummaries.get(selectedNode.deviceId) && <span className="topology-detail-alert">{nodeAlertSummaries.get(selectedNode.deviceId)?.count} alertas ativos · {nodeAlertSummaries.get(selectedNode.deviceId)?.highestSeverity}</span>}<button className="secondary-button" onClick={() => focusNode(selectedNode.id)}>Focar equipamento</button></aside>}
          <ReactFlow nodes={nodes} edges={edges} onInit={setFlow} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_event, node) => setSelectedNodeId(node.id)} onPaneClick={() => setSelectedNodeId('')} onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)} fitView><>{showGrid && <Background />}<MiniMap /><Controls /></></ReactFlow>
          {!selected && !maps.isLoading && <div className="topology-canvas-empty"><strong>Seleciona ou cria um mapa</strong><span>O teu mapa de topologia aparece aqui.</span></div>}
        </section>
    </main>
  </AppShell>;
}
