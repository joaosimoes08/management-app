'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { AppShell } from '@/components/layout/app-shell';
import { listAllDevices } from '@/features/infrastructure/api';
import { listVlans } from '@/features/ipam/api';
import { useSiteContext } from '@/lib/site-context';
import { createTopologyConnection, createTopologyMap, deleteTopologyConnection, deleteTopologyMap, getTopologyMap, listTopologyMaps, replaceTopologyNodes, updateTopologyConnection } from './api';
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

export function TopologyPage() {
  const { siteId, activeSite } = useSiteContext();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [name, setName] = useState('');
  const [mapType, setMapType] = useState<TopologyMapType>('PHYSICAL');
  const [selectedVlanIds, setSelectedVlanIds] = useState<string[]>([]);
  const [warning, setWarning] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeType, setEdgeType] = useState<'PHYSICAL' | 'LOGICAL'>('PHYSICAL');
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'failed'>('saved');
  const [pendingPositions, setPendingPositions] = useState<Node[] | null>(null);
  const [retryAction, setRetryAction] = useState<(() => void) | null>(null);
  const [selectedNodeId, setSelectedNodeId] = useState('');
  const maps = useQuery({ queryKey: ['topology', 'maps', siteId], queryFn: () => listTopologyMaps(siteId), enabled: Boolean(siteId) });
  const detail = useQuery({ queryKey: ['topology', selected], queryFn: () => getTopologyMap(selected), enabled: Boolean(selected) });
  const devices = useQuery({ queryKey: ['topology', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const vlans = useQuery({ queryKey: ['topology', 'vlans', siteId], queryFn: () => listVlans(siteId), enabled: Boolean(siteId) });
  const current = detail.data;
  const selectedConnection = current?.connections.find((connection) => connection.id === selectedEdgeId);
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!current) return;
    setNodes(current.nodes.map((node) => ({ id: node.id, position: { x: node.x, y: node.y }, data: { label: nodeLabel(current, node) }, style: { color: '#fff', background: nodeColor(node.device?.type), borderRadius: 8, padding: 10 } })));
    setEdges(current.connections.map((edge) => ({ id: edge.id, source: edge.sourceNodeId, target: edge.targetNodeId, label: edge.label ?? edge.type })));
    setSaveState('saved'); setPendingPositions(null); setRetryAction(null);
    if (selectedEdgeId && !current.connections.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId('');
  }, [current, selectedEdgeId, setEdges, setNodes]);
  useEffect(() => { if (selectedConnection) { setEdgeLabel(selectedConnection.label ?? ''); setEdgeType(selectedConnection.type ?? 'PHYSICAL'); } }, [selectedConnection]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

  const create = useMutation({ mutationFn: () => createTopologyMap({ name: name.trim(), type: mapType, siteId, ...(mapType === 'VLAN_SUBNET' ? { filters: { vlanIds: selectedVlanIds } } : {}) }), onMutate: () => setSaveState('pending'), onSuccess: (map) => { setSaveState('saved'); setWarning(''); setName(''); setSelectedVlanIds([]); setSelected(map.id); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); }, onError: () => { setSaveState('failed'); setWarning('Não foi possível criar o mapa. Confirma as permissões do Site e tenta novamente.'); } });
  const remove = useMutation({ mutationFn: () => deleteTopologyMap(selected, current?.revision), onMutate: () => setSaveState('pending'), onSuccess: () => { setSaveState('saved'); setWarning(''); setSelected(''); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); }, onError: () => { setSaveState('failed'); setWarning('Não foi possível eliminar o mapa. Confirma as permissões do Site e tenta novamente.'); } });
  const persist = (next: Node[]) => {
    if (!current) return;
    setPendingPositions(next); setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: current.nodes.find((item) => item.id === node.id)?.deviceId ?? node.id.split(':').pop()!, x: node.position.x, y: node.position.y })));
        await detail.refetch(); setWarning(''); setSaveState('saved'); setPendingPositions(null); setRetryAction(null);
      } catch (error) {
        setWarning(String(error).includes('alterado') ? 'Este mapa foi alterado noutro separador. Recarrega o mapa para recuperar a versão mais recente.' : 'Não foi possível guardar as posições. Podes tentar novamente.');
        setSaveState('failed');
      }
    }, 500);
  };
  const retrySave = () => { if (pendingPositions) persist(pendingPositions); else retryAction?.(); };
  const onConnect = async (connection: Connection) => {
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return;
    setSaveState('pending'); setRetryAction(() => () => { void onConnect(connection); });
    try {
      await createTopologyConnection(current.id, { sourceNodeId: connection.source, targetNodeId: connection.target, revision: current.revision, type: current.type === 'PHYSICAL' ? 'PHYSICAL' : 'LOGICAL' });
      await detail.refetch(); setWarning(''); setSaveState('saved'); setRetryAction(null);
    } catch (error) {
      setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de criar a ligação.' : 'Não foi possível criar a ligação.');
      setSaveState('failed');
    }
  };
  const addDevice = async () => {
    if (!current || !deviceId || current.nodes.some((node) => node.deviceId === deviceId)) return;
    const next = [...nodes, { id: `${current.id}:${deviceId}`, position: { x: 80 + nodes.length * 30, y: 80 + nodes.length * 20 }, data: { label: devices.data?.items.find((item) => item.id === deviceId)?.name ?? deviceId } } as Node];
    setSaveState('pending'); setRetryAction(() => () => { void addDevice(); });
    try {
      await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: node.id.split(':').pop()!, x: node.position.x, y: node.position.y })));
      setDeviceId(''); await detail.refetch(); setWarning(''); setSaveState('saved'); setRetryAction(null);
    } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de adicionar o equipamento.' : 'Não foi possível adicionar o equipamento ao mapa.'); setSaveState('failed'); }
  };
  const saveConnection = async () => {
    if (!selectedConnection) return;
    setSaveState('pending'); setRetryAction(() => () => { void saveConnection(); });
    try { await updateTopologyConnection(selectedConnection.id, { label: edgeLabel.trim() || undefined, type: edgeType, expectedRevisions: current ? { [current.id]: current.revision } : {} }); await detail.refetch(); setWarning(''); setSaveState('saved'); setRetryAction(null); } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de atualizar a ligação.' : 'Não foi possível atualizar a ligação.'); setSaveState('failed'); }
  };
  const removeConnection = async () => {
    if (!current || !selectedConnection) return;
    setSaveState('pending'); setRetryAction(() => () => { void removeConnection(); });
    try { await deleteTopologyConnection(current.id, selectedConnection.id, current.revision); setSelectedEdgeId(''); await detail.refetch(); setWarning(''); setSaveState('saved'); setRetryAction(null); } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de remover a ligação.' : 'Não foi possível remover a ligação.'); setSaveState('failed'); }
  };
  const mapOptions = useMemo(() => maps.data?.items ?? [], [maps.data]);
  const handleNodesChange = (changes: NodeChange[]) => { const next = applyNodeChanges(changes, nodes); onNodesChange(changes); if (changes.some((change) => change.type === 'position' && change.position)) persist(next); };

  return <AppShell section="Topologia" context={['Infraestrutura']}>
    <main className="module-page topology-page">
      <header className="module-hero"><span className="section-kicker">INFRAESTRUTURA</span><h1>Topologia</h1><p>Cria mapas e organiza ligações entre equipamentos do Site selecionado.</p></header>
      <p className="topology-scope">Âmbito ativo: <strong>{activeSite?.name ?? 'nenhum Site selecionado'}</strong>. Mapas e equipamentos seguem as permissões deste Site; se uma ação não estiver disponível, confirma o teu acesso com um administrador.</p>
      <div className="topology-layout">
        <aside className="topology-sidebar">
          <section className="ipam-card topology-card">
            <div className="panel-heading"><div><span className="section-kicker">NOVO MAPA</span><h2>Criar mapa</h2></div></div>
            <div className="topology-form">
              <label>Nome do mapa<input aria-label="Nome do mapa" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rede principal" /></label>
              <label>Tipo do mapa<select aria-label="Tipo do mapa" value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
              {mapType === 'VLAN_SUBNET' && <label>VLANs associadas<select multiple aria-label="VLANs do mapa" value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select><small>Usa Ctrl ou Command para selecionar várias VLANs.</small></label>}
              <button className="primary-button topology-create" disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'A criar…' : 'Criar mapa'}</button>
            </div>
          </section>
          <section className="ipam-card topology-card">
            <div className="panel-heading"><div><span className="section-kicker">MAPAS DO SITE</span><h2>Mapas existentes</h2></div><span className="topology-count">{mapOptions.length}</span></div>
            {maps.isLoading ? <p className="topology-hint">A carregar mapas…</p> : maps.isError ? <p className="topology-hint" role="alert">Não foi possível carregar os mapas.</p> : mapOptions.length ? <ul className="topology-map-list">{mapOptions.map((map) => <li key={map.id}><button className={selected === map.id ? 'selected' : ''} onClick={() => setSelected(map.id)} aria-current={selected === map.id ? 'page' : undefined}><span>{map.name}</span><small>{map.type.replace('_', ' ')}</small></button></li>)}</ul> : <p className="topology-hint">Ainda não existem mapas neste Site.</p>}
          </section>
          {current && <section className="ipam-card topology-card">
            <div className="panel-heading"><div><span className="section-kicker">EQUIPAMENTOS</span><h2>Adicionar equipamento</h2></div></div>
            <div className="topology-form"><label htmlFor="topology-device">Equipamento<select id="topology-device" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona…</option>{devices.data?.items.filter((device) => !current.nodes.some((node) => node.deviceId === device.id)).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button className="secondary-button" disabled={!deviceId} onClick={() => void addDevice()}>Adicionar ao mapa</button></div>
          </section>}
          {selectedConnection && <section className="ipam-card topology-card">
            <div className="panel-heading"><div><span className="section-kicker">LIGAÇÃO</span><h2>Ligação selecionada</h2></div></div>
            <div className="topology-form"><label>Etiqueta<input value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} placeholder="Etiqueta" /></label><label>Tipo<select value={edgeType} onChange={(event) => setEdgeType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select></label><button className="primary-button" onClick={() => void saveConnection()}>Guardar ligação</button><button className="secondary-button danger" onClick={() => void removeConnection()}>Remover do mapa</button></div>
          </section>}
          {selected && <button className="secondary-button danger topology-delete" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'A eliminar…' : 'Eliminar mapa'}</button>}
          {warning && <p className="ipam-alert error" role="alert">{warning} {create.isError && <button type="button" className="secondary-button" onClick={() => create.mutate()}>Tentar criar novamente</button>} {remove.isError && <button type="button" className="secondary-button" onClick={() => remove.mutate()}>Tentar eliminar novamente</button>}</p>}
        </aside>
        <div className="topology-workspace">
          {selected && detail.isError && <p className="ipam-alert error" role="alert">Não foi possível carregar este mapa. <button type="button" className="secondary-button" onClick={() => void detail.refetch()}>Tentar novamente</button></p>}
          {selected && detail.isFetching && !current && <p className="topology-hint" role="status">A carregar o mapa…</p>}
          {current && <section className="ipam-card topology-card topology-node-list" aria-label="Equipamentos no mapa">
            <div className="panel-heading"><div><span className="section-kicker">LISTA SINCRONIZADA</span><h2>Equipamentos no mapa</h2></div><span className="topology-count">{nodes.length}</span></div>
            {nodes.length ? <ul className="topology-map-list">{current.nodes.map((node) => <li key={node.id}><button type="button" className={selectedNodeId === node.id ? 'selected' : ''} aria-pressed={selectedNodeId === node.id} onClick={() => { setSelectedNodeId(node.id); setNodes((items) => items.map((item) => ({ ...item, selected: item.id === node.id }))); }}><span>{node.device?.name ?? node.label ?? node.deviceId}</span><small>{node.device?.managementIp ?? 'Sem IP de gestão'}</small></button></li>)}</ul> : <p className="topology-hint">Ainda não há equipamentos neste mapa.</p>}
          </section>}
          <section className="topology-canvas panel" aria-label="Área do mapa de topologia"><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_event, node) => { setSelectedNodeId(node.id); setNodes((items) => items.map((item) => ({ ...item, selected: item.id === node.id }))); }} onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)} fitView><Background /><MiniMap /><Controls /></ReactFlow>{!selected && !maps.isLoading && <div className="topology-canvas-empty"><strong>Seleciona ou cria um mapa</strong><span>O teu mapa de topologia aparece aqui.</span></div>}</section>
          {current && <p className={`topology-save-status ${saveState}`} role="status" aria-live="polite">{saveState === 'pending' ? 'A guardar alterações…' : saveState === 'failed' ? <>Falha ao guardar alterações. <button type="button" onClick={retrySave}>Tentar novamente</button> <button type="button" onClick={() => void detail.refetch()}>Recarregar mapa</button></> : 'Todas as alterações estão guardadas.'}</p>}
        </div>
      </div>
    </main>
  </AppShell>;
}
