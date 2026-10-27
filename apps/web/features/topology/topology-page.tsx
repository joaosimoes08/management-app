'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, Controls, MiniMap, ReactFlow, addEdge, applyNodeChanges, type Connection, type Edge, type Node, type NodeChange, useEdgesState, useNodesState } from '@xyflow/react';
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
  const { siteId } = useSiteContext();
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
    if (selectedEdgeId && !current.connections.some((edge) => edge.id === selectedEdgeId)) setSelectedEdgeId('');
  }, [current, selectedEdgeId, setEdges, setNodes]);
  useEffect(() => { if (selectedConnection) { setEdgeLabel(selectedConnection.label ?? ''); setEdgeType(selectedConnection.type ?? 'PHYSICAL'); } }, [selectedConnection]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);

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

  return <AppShell section="Topologia" context={['Infraestrutura']}>
    <div style={{ display: 'grid', gridTemplateColumns: '300px 1fr', gap: 20, minHeight: 'calc(100vh - 150px)' }}>
      <aside>
        <h1>Topologia</h1>
        <div style={{ display: 'grid', gap: 8, marginBottom: 16 }}><input aria-label="Nome do mapa" value={name} onChange={(event) => setName(event.target.value)} placeholder="Novo mapa" /><select aria-label="Tipo do mapa" value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{types.map((type) => <option key={type}>{type}</option>)}</select>{mapType === 'VLAN_SUBNET' && <select multiple aria-label="VLANs do mapa" value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select>}<button disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>Criar mapa</button></div>
        <ul>{mapOptions.map((map) => <li key={map.id}><button onClick={() => setSelected(map.id)} aria-current={selected === map.id}>{map.name} ({map.type})</button></li>)}</ul>
        {current && <div style={{ display: 'grid', gap: 8, marginTop: 20 }}><strong>Adicionar equipamento</strong><select value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona…</option>{devices.data?.items.filter((device) => !current.nodes.some((node) => node.deviceId === device.id)).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select><button disabled={!deviceId} onClick={() => void addDevice()}>Adicionar ao mapa</button></div>}
        {selectedConnection && <div style={{ display: 'grid', gap: 8, marginTop: 20 }}><strong>Ligação selecionada</strong><input value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} placeholder="Etiqueta" /><select value={edgeType} onChange={(event) => setEdgeType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select><button onClick={() => void saveConnection()}>Guardar ligação</button><button onClick={() => void removeConnection()}>Remover do mapa</button></div>}
        {selected && <button onClick={() => remove.mutate()} disabled={remove.isPending} style={{ marginTop: 20 }}>Eliminar mapa</button>}
        {warning && <p role="alert">{warning}</p>}
      </aside>
      <section style={{ minHeight: 600, border: '1px solid #d1d5db', borderRadius: 8 }}><ReactFlow nodes={nodes} edges={edges} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onEdgeClick={(_event, edge) => setSelectedEdgeId(edge.id)} fitView><Background /><MiniMap /><Controls /></ReactFlow></section>
    </div>
  </AppShell>;
}
