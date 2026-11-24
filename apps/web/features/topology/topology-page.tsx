'use client';

import { useCallback, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Background, BaseEdge, EdgeLabelRenderer, Handle, MiniMap, Position, ReactFlow, applyNodeChanges, getBezierPath, type Connection, type Edge, type EdgeProps, type Node, type NodeChange, type NodeProps, type ReactFlowInstance, useEdgesState, useNodesState } from '@xyflow/react';
import '@xyflow/react/dist/style.css';
import { Activity, Map as MapIcon } from 'lucide-react';
import { AppShell, ToolbarMore } from '@/components/layout/app-shell';
import { listAllDevices, listInterfaces } from '@/features/infrastructure/api';
import { listVlans } from '@/features/ipam/api';
import { listOperationalAlerts } from '@/features/operations/api';
import { AssetImage } from '@/features/infrastructure/components/asset-image';
import { EquipmentTypeIcon } from '@/features/infrastructure/components/equipment-type-icon';
import type { DeviceInterface } from '@/features/infrastructure/types';
import { allPortLayoutPorts } from '@/features/infrastructure/utils';
import { useSiteContext } from '@/lib/site-context';
import { ObservedTopology } from './observed-topology';
import { createTopologyConnection, createTopologyMap, deleteTopologyConnection, deleteTopologyMap, getTopologyConnectionPortAvailability, getTopologyMap, listTopologyMaps, replaceTopologyNodes, updateTopologyConnection } from './api';
import { loadAllTopologyAlerts, summarizeTopologyDeviceAlerts, topologyDeviceImage, topologySeverityColor, type TopologyNodeAlertSummary } from './alerts';
import { availableInterfaces, retainAvailableInterfaceId } from './port-availability';
import { findTopologyNode } from './search';
import { emptyTopologyFilters, hasTopologyFilters, hiddenTopologyNodeIds, topologyLocationOptions, topologyTypeOptions, withHiddenEdges, withHiddenNodes, type TopologyFilters } from './filters';
import { TopologyFiltersMenu, TopologyLegend } from './topology-filters-menu';
import { parseImpactParam, type ImpactTarget, type TopologyImpact, type TopologyPath } from './impact-api';
import { impactHighlight, pathHighlight, withHighlightClasses } from './impact-highlight';
import { ImpactPanel, PathView } from './impact-panel';
import type { TopologyConnection, TopologyMap, TopologyMapType, TopologyNode } from './types';
import { topologyToolbarSummary } from './toolbar-summary';
import { useUiText } from '@/components/ui/use-ui-text';
import { isSnmpNetworkDevice, useSnmpHealthMap, type SnmpHealthSummaryItem } from '@/features/snmp/health/health-api';
import { badgeStatus, snmpHealthDescription, snmpHealthStatusLabel } from '@/features/snmp/health/health-badge';

const types: TopologyMapType[] = ['PHYSICAL', 'NETWORK', 'VLAN_SUBNET'];
const EMPTY_DEVICE_INTERFACES: Record<string, DeviceInterface[]> = {};

type TopologyNodeData = { label: string; deviceName: string; hostname: string; location: string; managementIp: string; modelName: string; status: string; asset: ReturnType<typeof topologyDeviceImage>; equipmentType: string; alertSummary?: TopologyNodeAlertSummary; /** SNMP Phase 2 step 10: undefined = not a network device or no SNMP read access; null = no reading yet. */ health?: SnmpHealthSummaryItem | null };
type TopologyFlowNode = Node<TopologyNodeData, 'topologyDevice'>;
type TopologyEdgeData = { tooltip: string; onSelect: (id: string) => void };
type TopologyFlowEdge = Edge<TopologyEdgeData, 'topologyConnection'>;

function TopologyDeviceNode({ data, selected }: NodeProps<TopologyFlowNode>) {
  const t = useUiText();
  const health = data.health === undefined ? undefined : badgeStatus(data.health?.status);
  // The pill only appears when the device needs a look (Degradado / Desconhecido); OK and Sem dados stay in the tooltip and the accessible name.
  const healthPill = health === 'DEGRADED' || health === 'UNKNOWN';
  return <div className={`topology-device-node${selected ? ' topology-device-node--selected' : ''}`} aria-label={`${data.deviceName}; hostname ${data.hostname || 'não definido'}; localização ${data.location || 'não definida'}${health ? `; ${snmpHealthDescription(t, data.health)}` : ''}`}>
    <Handle type="target" position={Position.Left} className="topology-device-handle" />
    <span className="topology-device-image">{data.asset ? <AssetImage asset={data.asset} alt={`Imagem de ${data.deviceName}`} fallback={<EquipmentTypeIcon type={data.equipmentType} alt="" />} /> : <EquipmentTypeIcon type={data.equipmentType} alt="" />}</span>
    <span className="topology-node-label">{data.deviceName}</span>
    {data.alertSummary && <span className={`topology-node-alert topology-node-alert--${String(data.alertSummary.highestSeverity).toLowerCase()}`} aria-label={`${data.alertSummary.count} alertas ativos · ${data.alertSummary.highestSeverity}`}>{data.alertSummary.count} · {data.alertSummary.highestSeverity}</span>}
    {healthPill && <span className="topology-node-health" data-health={health} aria-hidden="true">{snmpHealthStatusLabel(t, data.health?.status)}{data.health?.issueCount ? ` · ${data.health.issueCount}` : ''}</span>}
    <Handle type="source" position={Position.Right} className="topology-device-handle" />
    <span className="topology-device-tooltip" role="tooltip"><strong>{data.deviceName}</strong><span><small>Hostname:</small><b>{data.hostname || 'Não definido'}</b></span><span><small>Modelo:</small><b>{data.modelName || data.equipmentType}</b></span><span><small>Localização:</small><b>{data.location || 'Não definida'}</b></span><span><small>IP Management:</small><b>{data.managementIp || 'não definido'}</b></span><span><small>Status:</small><b>{data.status.toLowerCase()}</b></span>{data.alertSummary && <span><small>Alertas ativos:</small><b style={{ color: topologySeverityColor(data.alertSummary.highestSeverity) }}>{data.alertSummary.count} · {data.alertSummary.highestSeverity}</b></span>}{health && <span><small>{t('snmpHealth.column')}:</small><b>{snmpHealthStatusLabel(t, data.health?.status)}{data.health?.issueCount ? ` · ${t('snmpHealth.issues', undefined, { count: data.health.issueCount })}` : ''}</b></span>}</span>
  </div>;
}

function TopologyConnectionEdge(props: EdgeProps<TopologyFlowEdge>) {
  const [hovered, setHovered] = useState(false);
  const [reducedMotion, setReducedMotion] = useState(true);
  const [path, labelX, labelY] = getBezierPath(props);
  useEffect(() => {
    const query = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReducedMotion(query.matches);
    update();
    query.addEventListener('change', update);
    return () => query.removeEventListener('change', update);
  }, []);
  return <>
    <BaseEdge id={props.id} path={path} style={props.style} markerEnd={props.markerEnd} interactionWidth={18} />
    {!reducedMotion && <>
      <circle r="3" className="topology-flow-particle"><animateMotion dur="2.8s" repeatCount="indefinite" path={path} /></circle>
      <circle r="3" className="topology-flow-particle topology-flow-particle--reverse"><animateMotion dur="2.8s" repeatCount="indefinite" path={path} keyPoints="1;0" keyTimes="0;1" calcMode="linear" /></circle>
    </>}
    <path d={path} className="topology-edge-hit-area" onMouseEnter={() => setHovered(true)} onMouseLeave={() => setHovered(false)} onClick={(event) => { event.stopPropagation(); props.data?.onSelect(props.id); }} />
    {hovered && <EdgeLabelRenderer><div className="topology-edge-tooltip" style={{ transform: `translate(-50%, -50%) translate(${labelX}px,${labelY}px)` }}>{props.data?.tooltip}</div></EdgeLabelRenderer>}
  </>;
}

const topologyNodeTypes = { topologyDevice: TopologyDeviceNode };
const topologyEdgeTypes = { topologyConnection: TopologyConnectionEdge };

function connectionPort(deviceId: string, interfaceId: string | null | undefined, interfaces: Record<string, DeviceInterface[]>) {
  if (!interfaceId) return undefined;
  return (interfaces[deviceId] ?? []).find((port) => port.id === interfaceId);
}

function configuredPortLabel(node: TopologyNode | undefined, port?: DeviceInterface) {
  const layoutPorts = allPortLayoutPorts(node?.device?.model?.portLayout);
  const mappedPort = layoutPorts.find((item) => item.portKey === port?.portKey || item.portKey === port?.name);
  return mappedPort?.label ?? port?.portKey ?? port?.name ?? 'Porta não definida';
}

function toFlowNode(node: TopologyNode, alertSummary?: TopologyNodeAlertSummary, healthMap?: ReadonlyMap<string, SnmpHealthSummaryItem>): TopologyFlowNode {
  const severity = alertSummary?.highestSeverity;
  const image = topologyDeviceImage(node.device);
  return {
    id: node.id,
    position: { x: node.x, y: node.y },
    type: 'topologyDevice',
    data: { label: node.label ?? node.device?.name ?? node.deviceId, deviceName: node.device?.name ?? node.deviceId, hostname: node.device?.hostname ?? '', location: [node.device?.rack?.room?.building?.name, node.device?.rack?.room?.name, node.device?.rack?.name].filter(Boolean).join(' · '), managementIp: node.device?.managementIp ?? '', modelName: [node.device?.model?.manufacturer, node.device?.model?.model].filter(Boolean).join(' '), status: node.device?.status ?? 'UNKNOWN', asset: image, equipmentType: node.device?.type ?? 'OTHER', alertSummary: severity ? alertSummary : undefined, health: healthMap && isSnmpNetworkDevice(node.device?.type) ? healthMap.get(node.deviceId) ?? null : undefined },
    style: { width: 194, height: 100, padding: 0, border: 0, background: 'transparent', boxShadow: 'none', overflow: 'visible' },
  };
}

export function TopologyPage() {
  const { siteId } = useSiteContext();
  const queryClient = useQueryClient();
  const [selected, setSelected] = useState('');
  const [workspace, setWorkspace] = useState<'manual' | 'observed'>('manual');
  const [observedToolbar, setObservedToolbar] = useState<ReactNode>(null);
  const [search, setSearch] = useState('');
  const [filters, setFilters] = useState<TopologyFilters>(emptyTopologyFilters);
  const [labelsVisible, setLabelsVisible] = useState(true);
  const [showGrid, setShowGrid] = useState(true);
  const [interactive, setInteractive] = useState(true);
  const [fullscreen, setFullscreen] = useState(false);
  const [fullscreenAnnouncement, setFullscreenAnnouncement] = useState('');
  const fullscreenAnnouncementRef = useRef<HTMLSpanElement>(null);
  const [flow, setFlow] = useState<ReactFlowInstance | null>(null);
  const [name, setName] = useState('');
  const [mapType, setMapType] = useState<TopologyMapType>('PHYSICAL');
  const [selectedVlanIds, setSelectedVlanIds] = useState<string[]>([]);
  const [warning, setWarning] = useState('');
  const [deviceId, setDeviceId] = useState('');
  const [selectedEdgeId, setSelectedEdgeId] = useState('');
  const [saveState, setSaveState] = useState<'saved' | 'pending' | 'failed'>('saved');
  const [pendingPositions, setPendingPositions] = useState<Node[] | null>(null);
  const [selectedConnectionTab, setSelectedConnectionTab] = useState<'source' | 'target'>('source');
  const [edgeLabel, setEdgeLabel] = useState('');
  const [edgeType, setEdgeType] = useState<'PHYSICAL' | 'LOGICAL'>('PHYSICAL');
  const [edgeNotes, setEdgeNotes] = useState('');
  const [sourcePortId, setSourcePortId] = useState('');
  const [targetPortId, setTargetPortId] = useState('');
  const [pendingConnection, setPendingConnection] = useState<{ sourceDeviceId: string; targetDeviceId: string } | null>(null);
  const [newSourcePortId, setNewSourcePortId] = useState('');
  const [newTargetPortId, setNewTargetPortId] = useState('');
  /** Step 34: what goes down (from the menu or `?impact=device:<id>`), its result and the path view. */
  const [impactTarget, setImpactTarget] = useState<ImpactTarget | null>(null);
  const [impactDeviceId, setImpactDeviceId] = useState('');
  const [impactResult, setImpactResult] = useState<TopologyImpact | null>(null);
  const [pathResult, setPathResult] = useState<TopologyPath | null>(null);
  const [pathFrom, setPathFrom] = useState('');
  const [analysisRequested, setAnalysisRequested] = useState(false);
  const maps = useQuery({ queryKey: ['topology', 'maps', siteId], queryFn: () => listTopologyMaps(siteId), enabled: Boolean(siteId) });
  const detail = useQuery({ queryKey: ['topology', selected], queryFn: () => getTopologyMap(selected), enabled: Boolean(selected) });
  const devices = useQuery({ queryKey: ['topology', 'devices', siteId], queryFn: () => listAllDevices(siteId, ''), enabled: Boolean(siteId) });
  const vlans = useQuery({ queryKey: ['topology', 'vlans', siteId], queryFn: () => listVlans(siteId), enabled: Boolean(siteId) });
  const operationalAlerts = useQuery({ queryKey: ['topology', 'alerts', siteId], queryFn: async () => ({ items: await loadAllTopologyAlerts((page) => listOperationalAlerts(siteId, 100, page)) }), enabled: Boolean(siteId), refetchInterval: 30_000 });
  const current = detail.data;
  const selectedConnection = current?.connections.find((connection) => connection.id === selectedEdgeId);
  const mapDeviceIds = current?.nodes.map((node) => node.deviceId) ?? [];
  const interfaceData = useQuery<Record<string, DeviceInterface[]>>({ queryKey: ['topology', 'interfaces', current?.id, mapDeviceIds], queryFn: async () => Object.fromEntries(await Promise.all(mapDeviceIds.map(async (id) => [id, await listInterfaces(id)]))) as Record<string, DeviceInterface[]>, enabled: Boolean(current) });
  const interfaceAvailability = useQuery({ queryKey: ['topology', 'interface-availability', current?.id, selectedConnection?.id ?? null], queryFn: () => getTopologyConnectionPortAvailability(current!.id, selectedConnection?.id), enabled: Boolean(current) });
  const interfacesByDevice = interfaceData.data ?? EMPTY_DEVICE_INTERFACES;
  const usedInterfaceIds = useMemo(() => new Set(interfaceAvailability.data?.usedInterfaceIds ?? []), [interfaceAvailability.data?.usedInterfaceIds]);
  const newSourcePorts = pendingConnection ? availableInterfaces(interfacesByDevice[pendingConnection.sourceDeviceId] ?? [], usedInterfaceIds) : [];
  const newTargetPorts = pendingConnection ? availableInterfaces(interfacesByDevice[pendingConnection.targetDeviceId] ?? [], usedInterfaceIds) : [];
  const selectedSourcePorts = selectedConnection ? availableInterfaces(interfacesByDevice[selectedConnection.sourceDeviceId] ?? [], usedInterfaceIds) : [];
  const selectedTargetPorts = selectedConnection ? availableInterfaces(interfacesByDevice[selectedConnection.targetDeviceId] ?? [], usedInterfaceIds) : [];
  const nodeAlertSummaries = useMemo(() => summarizeTopologyDeviceAlerts(current?.nodes ?? [], operationalAlerts.data?.items ?? []), [current?.nodes, operationalAlerts.data?.items]);
  // SNMP Phase 2 step 10: one Site-wide health request for every node on the map.
  const snmpHealth = useSnmpHealthMap(siteId, Boolean(siteId) && Boolean(current));
  const snmpHealthMap = snmpHealth.size ? snmpHealth : undefined;
  const mapProblemCount = [...nodeAlertSummaries.values()].reduce((total, summary) => total + summary.count, 0);
  const searchMatch = current ? findTopologyNode(current.nodes, search) : undefined;
  const [nodes, setNodes, onNodesChange] = useNodesState<Node>([]);
  const [edges, setEdges, onEdgesChange] = useEdgesState<Edge>([]);
  const typeOptions = useMemo(() => topologyTypeOptions(current?.nodes ?? []), [current?.nodes]);
  const locationOptions = useMemo(() => topologyLocationOptions(current?.nodes ?? []), [current?.nodes]);
  const hiddenNodeIds = useMemo(() => hiddenTopologyNodeIds(current?.nodes ?? [], filters, nodeAlertSummaries), [current?.nodes, filters, nodeAlertSummaries]);
  const highlight = useMemo(() => (!current ? null : impactTarget && impactResult ? impactHighlight(impactResult, current) : pathResult?.found ? pathHighlight(pathResult, current) : null), [current, impactTarget, impactResult, pathResult]);
  const visibleNodes = useMemo(() => withHighlightClasses(withHiddenNodes(nodes, hiddenNodeIds), highlight?.nodes ?? null, 'node'), [nodes, hiddenNodeIds, highlight]);
  const visibleEdges = useMemo(() => withHighlightClasses(withHiddenEdges(edges, hiddenNodeIds), highlight?.edges ?? null, 'edge'), [edges, hiddenNodeIds, highlight]);
  const filtering = hasTopologyFilters(filters);
  const visibleCount = (current?.nodes.length ?? 0) - hiddenNodeIds.size;
  const saveTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);

  useEffect(() => {
    if (!current) return;
    setNodes(current.nodes.map((node) => { const flowNode = toFlowNode(node, nodeAlertSummaries.get(node.deviceId), snmpHealthMap); const pending = pendingPositions?.find((item) => item.id === node.id); return pending ? { ...flowNode, position: pending.position } : flowNode; }));
    setEdges(current.connections.map((edge) => makeFlowEdge(edge, current, interfacesByDevice, setSelectedEdgeId)));
  }, [current, interfacesByDevice, pendingPositions, setEdges, setNodes]);
  useEffect(() => {
    if (!current) return;
    const currentNodes = new Map(current.nodes.map((node) => [node.id, node]));
    setNodes((existing) => {
      if (existing.length !== current.nodes.length || existing.some((node) => !currentNodes.has(node.id))) return current.nodes.map((node) => toFlowNode(node, nodeAlertSummaries.get(node.deviceId), snmpHealthMap));
      return existing.map((flowNode) => {
        const node = currentNodes.get(flowNode.id)!;
        const refreshed = toFlowNode(node, nodeAlertSummaries.get(node.deviceId), snmpHealthMap);
        return { ...flowNode, data: refreshed.data, style: { ...flowNode.style, ...refreshed.style } };
      });
    });
  }, [current, nodeAlertSummaries, snmpHealthMap, setNodes]);
  useEffect(() => {
    if (current && selectedEdgeId && !current.connections.some((connection) => connection.id === selectedEdgeId)) setSelectedEdgeId('');
  }, [current, selectedEdgeId]);
  useEffect(() => { if (selectedConnection) { setEdgeLabel(selectedConnection.label ?? ''); setEdgeType(selectedConnection.type ?? 'PHYSICAL'); setEdgeNotes(selectedConnection.notes ?? ''); setSourcePortId(selectedConnection.sourceInterfaceId ?? ''); setTargetPortId(selectedConnection.targetInterfaceId ?? ''); } }, [selectedConnection]);
  useEffect(() => {
    if (!interfaceAvailability.data) return;
    const occupied = new Set(interfaceAvailability.data.usedInterfaceIds);
    const retainFreePort = (id: string) => retainAvailableInterfaceId(id, occupied);
    setNewSourcePortId(retainFreePort);
    setNewTargetPortId(retainFreePort);
    setSourcePortId(retainFreePort);
    setTargetPortId(retainFreePort);
  }, [interfaceAvailability.data?.usedInterfaceIds]);
  useEffect(() => () => clearTimeout(saveTimer.current), []);
  useEffect(() => {
    const params = new URLSearchParams(window.location.search);
    const fromUrl = parseImpactParam(params.get('impact'));
    const from = params.get('pathFrom') ?? '';
    if (fromUrl) { setImpactTarget(fromUrl); if (fromUrl.kind === 'DEVICE') setImpactDeviceId(fromUrl.id); }
    if (from) setPathFrom(from);
    if (fromUrl || from) setAnalysisRequested(true);
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

  const create = useMutation({ mutationFn: () => createTopologyMap({ name: name.trim(), type: mapType, siteId, ...(mapType === 'VLAN_SUBNET' ? { filters: { vlanIds: selectedVlanIds } } : {}) }), onSuccess: (map) => { setWarning(''); setName(''); setSelectedVlanIds([]); setSelected(map.id); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); }, onError: () => setWarning('Não foi possível criar o mapa. Confirma as permissões do Site e tenta novamente.') });
  const remove = useMutation({ mutationFn: () => deleteTopologyMap(selected, current?.revision), onSuccess: () => { setWarning(''); setSelected(''); void queryClient.invalidateQueries({ queryKey: ['topology', 'maps', siteId] }); }, onError: () => setWarning('Não foi possível eliminar o mapa. Confirma as permissões do Site e tenta novamente.') });
  const persist = (next: Node[]) => {
    if (!current) return;
    setPendingPositions(next);
    setSaveState('pending');
    clearTimeout(saveTimer.current);
    saveTimer.current = setTimeout(async () => {
      try {
        await replaceTopologyNodes(current.id, current.revision, next.map((node) => ({ id: node.id, deviceId: current.nodes.find((item) => item.id === node.id)?.deviceId ?? node.id.split(':').pop()!, x: node.position.x, y: node.position.y })));
        setPendingPositions(null); setSaveState('saved'); setWarning('');
        await detail.refetch();
      } catch (error) {
        setSaveState('failed');
        setWarning(String(error).includes('alterado') ? 'Este mapa foi alterado noutro separador. As posições locais foram mantidas; recarrega ou tenta guardar novamente.' : 'Não foi possível guardar as posições. As posições locais foram mantidas; tenta novamente.');
      }
    }, 500);
  };
  const retrySave = () => { if (pendingPositions) persist(pendingPositions); };
  const reloadMap = () => { clearTimeout(saveTimer.current); setPendingPositions(null); setSaveState('saved'); setWarning(''); void detail.refetch(); };
  const onConnect = (connection: Connection) => {
    if (!current || !connection.source || !connection.target || connection.source === connection.target) return;
    const sourceDeviceId = current.nodes.find((node) => node.id === connection.source)?.deviceId;
    const targetDeviceId = current.nodes.find((node) => node.id === connection.target)?.deviceId;
    if (!sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId) return;
    setSelectedEdgeId('');
    setPendingConnection({ sourceDeviceId, targetDeviceId });
    setNewSourcePortId('');
    setNewTargetPortId('');
    setWarning('Seleciona uma porta livre em cada equipamento para criar a ligação.');
  };
  const createConnectionFromPorts = async () => {
    if (!current || !pendingConnection || !newSourcePortId || !newTargetPortId || newSourcePortId === newTargetPortId) return;
    try {
      await createTopologyConnection(current.id, { sourceNodeId: `${current.id}:${pendingConnection.sourceDeviceId}`, targetNodeId: `${current.id}:${pendingConnection.targetDeviceId}`, revision: current.revision, sourceInterfaceId: newSourcePortId, targetInterfaceId: newTargetPortId, type: current.type === 'PHYSICAL' ? 'PHYSICAL' : 'LOGICAL' });
      setPendingConnection(null); setNewSourcePortId(''); setNewTargetPortId('');
      await Promise.all([detail.refetch(), interfaceAvailability.refetch()]); setWarning('');
    } catch (error) {
      setWarning(String(error).includes('já utilizadas') ? 'Uma das portas já está ligada. Escolhe novamente entre as portas livres.' : String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de criar a ligação.' : 'Não foi possível criar a ligação.');
      const [, availability] = await Promise.all([detail.refetch(), interfaceAvailability.refetch()]);
      const occupied = new Set(availability.data?.usedInterfaceIds ?? []);
      setNewSourcePortId((id) => retainAvailableInterfaceId(id, occupied));
      setNewTargetPortId((id) => retainAvailableInterfaceId(id, occupied));
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
    try { await updateTopologyConnection(selectedConnection.id, { label: edgeLabel.trim() || undefined, notes: edgeNotes.trim() || undefined, type: edgeType, sourceInterfaceId: sourcePortId || null, targetInterfaceId: targetPortId || null, expectedRevisions: current ? { [current.id]: current.revision } : {} }); await detail.refetch(); setWarning(''); } catch (error) { setWarning(String(error).includes('já utilizadas') ? 'Uma das portas já foi atribuída a outra ligação. Escolhe novamente entre as portas livres.' : String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de atualizar a ligação.' : 'Não foi possível atualizar a ligação.'); const [, availability] = await Promise.all([detail.refetch(), interfaceAvailability.refetch()]); const occupied = new Set(availability.data?.usedInterfaceIds ?? []); setSourcePortId((id) => retainAvailableInterfaceId(id, occupied)); setTargetPortId((id) => retainAvailableInterfaceId(id, occupied)); }
  };
  const removeConnection = async () => {
    if (!current || !selectedConnection) return;
    try { await deleteTopologyConnection(current.id, selectedConnection.id, current.revision); setSelectedEdgeId(''); await detail.refetch(); setWarning(''); } catch (error) { setWarning(String(error).includes('alterado') ? 'O mapa mudou entretanto. Recarrega antes de remover a ligação.' : 'Não foi possível remover a ligação.'); }
  };
  const mapOptions = useMemo(() => maps.data?.items ?? [], [maps.data]);
  useEffect(() => { if (analysisRequested && !selected && mapOptions.length) setSelected(mapOptions[0].id); }, [analysisRequested, selected, mapOptions]);
  const onImpactResult = useCallback((result: TopologyImpact | null) => setImpactResult(result), []);
  const onPathResult = useCallback((result: TopologyPath | null) => { setPathResult(result); if (result) { setImpactTarget(null); setImpactResult(null); } }, []);
  const analyseImpact = () => { if (!impactDeviceId) return; setPathResult(null); setImpactResult(null); setImpactTarget({ kind: 'DEVICE', id: impactDeviceId }); };
  const clearImpact = () => { setImpactTarget(null); setImpactResult(null); };
  const siteDevices = useMemo(() => (devices.data?.items ?? []).map((device) => ({ id: device.id, name: device.name })), [devices.data]);
  const handleNodesChange = (changes: NodeChange[]) => { const next = applyNodeChanges(changes, nodes); onNodesChange(changes); if (changes.some((change) => change.type === 'position' && change.position)) persist(next); };
  const focusNode = (nodeId: string) => {
    void flow?.fitView({ nodes: [{ id: nodeId }], duration: 450, padding: 0.45 });
  };
  const toggleFullscreen = () => {
    const next = !fullscreen;
    setFullscreen(next);
    setFullscreenAnnouncement(next ? 'Modo de ecrã inteiro ativado. Prima Escape para sair.' : 'Modo de ecrã inteiro desativado.');
  };

  const openDeviceInterfaces = (device: TopologyNode['device']) => {
    if (!device?.id) return;
    window.location.assign(`/infraestrutura?siteId=${encodeURIComponent(siteId)}&tab=interfaces&deviceId=${encodeURIComponent(device.id)}`);
  };

  const closeConnectionCard = () => setSelectedEdgeId('');
  const selectedConnectionDisplay = selectedConnection && current ? connectionDisplay(selectedConnection, current, interfacesByDevice) : undefined;

  const topbarActions = <div className="topology-topbar-actions">
    <select className="context-toolbar-selector" aria-label="Mapa do site" value={selected} onChange={(event) => { setSelected(event.target.value); setFilters(emptyTopologyFilters); }}><option value="">Seleciona mapa…</option>{mapOptions.map((map) => <option key={map.id} value={map.id}>{map.name} · {map.type.replace('_', ' ')}</option>)}</select>
    {pendingConnection && current && <details className="topology-topbar-menu" open onToggle={(event) => { if (!event.currentTarget.open) setPendingConnection(null); }}><summary>Concluir ligação</summary><div className="topology-topbar-form"><strong>Seleciona as portas da ligação</strong><label>Porta de origem<select aria-label="Porta de origem da nova ligação" value={newSourcePortId} onChange={(event) => setNewSourcePortId(event.target.value)} disabled={interfaceData.isLoading || interfaceData.isError || interfaceAvailability.isLoading || interfaceAvailability.isError || !newSourcePorts.length}><option value="">{interfaceAvailability.isLoading ? 'A verificar disponibilidade…' : newSourcePorts.length ? 'Seleciona uma porta livre' : 'Sem portas livres'}</option>{newSourcePorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</select></label><label>Porta de destino<select aria-label="Porta de destino da nova ligação" value={newTargetPortId} onChange={(event) => setNewTargetPortId(event.target.value)} disabled={interfaceData.isLoading || interfaceData.isError || interfaceAvailability.isLoading || interfaceAvailability.isError || !newTargetPorts.length}><option value="">{interfaceAvailability.isLoading ? 'A verificar disponibilidade…' : newTargetPorts.length ? 'Seleciona uma porta livre' : 'Sem portas livres'}</option>{newTargetPorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</select></label>{(interfaceData.isError || interfaceAvailability.isError) && <p role="alert">Não foi possível verificar as portas livres. Atualiza o mapa e tenta novamente.</p>}<button className="primary-button" onClick={() => void createConnectionFromPorts()} disabled={!newSourcePortId || !newTargetPortId || newSourcePortId === newTargetPortId || interfaceData.isLoading || interfaceData.isError || interfaceAvailability.isLoading || interfaceAvailability.isError}>Criar ligação</button><button type="button" className="secondary-button" onClick={() => setPendingConnection(null)}>Cancelar</button></div></details>}
    {current && <TopologyFiltersMenu filters={filters} onChange={setFilters} types={typeOptions} locations={locationOptions} alertsUnavailable={operationalAlerts.isError} />}
    {current && <TopologyLegend types={typeOptions} />}
    <details className="topology-topbar-menu topology-impact-menu" open={pathFrom ? true : undefined}><summary>Impacto e caminho</summary><div className="topology-topbar-form">
      <strong>Impacto</strong><label>Equipamento que vai abaixo<select aria-label="Equipamento para analisar impacto" value={impactDeviceId} onChange={(event) => setImpactDeviceId(event.target.value)}><option value="">Seleciona…</option>{siteDevices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label>
      <button type="button" className="primary-button" disabled={!impactDeviceId} onClick={analyseImpact}>Analisar impacto</button>
      <strong>Caminho entre dois equipamentos</strong>
      <PathView devices={siteDevices} initialFrom={pathFrom} onResult={onPathResult} />
    </div></details>
    <details className="topology-topbar-menu"><summary>Editar mapa</summary><div className="topology-topbar-form">
      <strong>Criar mapa</strong><label>Nome<input aria-label="Nome do novo mapa" value={name} onChange={(event) => setName(event.target.value)} placeholder="Ex.: Rede principal" /></label><label>Tipo<select aria-label="Tipo do novo mapa" value={mapType} onChange={(event) => setMapType(event.target.value as TopologyMapType)}>{types.map((type) => <option key={type}>{type}</option>)}</select></label>
      {mapType === 'VLAN_SUBNET' && <label>VLANs associadas<select multiple aria-label="VLANs do mapa" value={selectedVlanIds} onChange={(event) => setSelectedVlanIds([...event.target.selectedOptions].map((option) => option.value))}>{vlans.data?.items.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>}
      <button className="primary-button" disabled={!name.trim() || !siteId || create.isPending} onClick={() => create.mutate()}>{create.isPending ? 'A criar…' : 'Criar mapa'}</button>
      {current && <><strong>Adicionar equipamento</strong><label>Equipamento<select aria-label="Equipamento para adicionar" value={deviceId} onChange={(event) => setDeviceId(event.target.value)}><option value="">Seleciona…</option>{devices.data?.items.filter((device) => !current.nodes.some((node) => node.deviceId === device.id)).map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><button className="secondary-button" disabled={!deviceId} onClick={() => void addDevice()}>Adicionar ao mapa</button></>}
      {selectedConnection && <><strong>Ligação selecionada</strong><small>{selectedConnection.source === 'MANUAL' ? 'Documentada' : `Observada (${selectedConnection.source ?? 'origem desconhecida'})`}</small><label>Etiqueta<input aria-label="Etiqueta da ligação" value={edgeLabel} onChange={(event) => setEdgeLabel(event.target.value)} placeholder="Etiqueta" /></label><label>Porta de origem<select aria-label="Porta de origem" value={sourcePortId} onChange={(event) => setSourcePortId(event.target.value)} disabled={interfaceData.isLoading || interfaceData.isError || interfaceAvailability.isLoading || interfaceAvailability.isError}><option value="">Porta não indicada</option>{selectedSourcePorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</select></label><label>Porta de destino<select aria-label="Porta de destino" value={targetPortId} onChange={(event) => setTargetPortId(event.target.value)} disabled={interfaceData.isLoading || interfaceData.isError || interfaceAvailability.isLoading || interfaceAvailability.isError}><option value="">Porta não indicada</option>{selectedTargetPorts.map((port) => <option key={port.id} value={port.id}>{port.name}</option>)}</select></label>{interfaceAvailability.isError && <p role="alert">Não foi possível verificar a disponibilidade das portas.</p>}<label>Percurso físico / patch panel<textarea aria-label="Percurso físico / patch panel" value={edgeNotes} onChange={(event) => setEdgeNotes(event.target.value)} placeholder="Patch panel, porta, bastidor, etiqueta do cabo…" rows={3} /></label><label>Tipo da ligação<select aria-label="Tipo da ligação" value={edgeType} onChange={(event) => setEdgeType(event.target.value as 'PHYSICAL' | 'LOGICAL')}><option value="PHYSICAL">Física</option><option value="LOGICAL">Lógica</option></select></label><button className="primary-button" onClick={() => void saveConnection()} disabled={interfaceAvailability.isLoading || interfaceAvailability.isError || interfaceData.isLoading || interfaceData.isError}>Guardar ligação</button><button className="secondary-button danger" onClick={() => void removeConnection()}>Remover ligação</button></>}
      {selected && <button className="secondary-button danger" onClick={() => remove.mutate()} disabled={remove.isPending}>{remove.isPending ? 'A eliminar…' : 'Eliminar mapa'}</button>}
      {warning && <p className="ipam-alert error" role="alert">{warning} {create.isError && <button type="button" className="secondary-button" onClick={() => create.mutate()}>Tentar criar novamente</button>} {remove.isError && <button type="button" className="secondary-button" onClick={() => remove.mutate()}>Tentar eliminar novamente</button>}</p>}
    </div></details>
  </div>;
  const toolbarSummary = topologyToolbarSummary({ mapName: current?.name, nodeCount: current?.nodes.length ?? 0, visibleCount, filtering, connectionCount: current?.connections.length ?? 0, alertsUnavailable: operationalAlerts.isError, problemCount: mapProblemCount });
  const mapViewActions = <><span className="topology-toolbar-summary" title={toolbarSummary}>{toolbarSummary}</span><ToolbarMore label="Controlos do mapa"><button type="button" disabled={!searchMatch} onClick={() => searchMatch && focusNode(searchMatch.id)}>Encontrar equipamento</button><button type="button" aria-pressed={labelsVisible} onClick={() => setLabelsVisible((value) => !value)}>{labelsVisible ? 'Ocultar etiquetas' : 'Mostrar etiquetas'}</button><button type="button" aria-pressed={showGrid} onClick={() => setShowGrid((value) => !value)}>{showGrid ? 'Ocultar grelha' : 'Mostrar grelha'}</button><button type="button" onClick={() => void flow?.zoomIn({ duration: 180 })}>Ampliar</button><button type="button" onClick={() => void flow?.zoomOut({ duration: 180 })}>Reduzir</button><button type="button" onClick={() => void flow?.fitView({ duration: 300, padding: 0.2 })}>Ajustar mapa</button><button type="button" aria-pressed={interactive} onClick={() => setInteractive((value) => !value)}>{interactive ? 'Bloquear mapa' : 'Desbloquear mapa'}</button><button type="button" onClick={toggleFullscreen}>Alternar ecrã inteiro</button></ToolbarMore></>;

  return <AppShell section="Topologia" toolbarKey={workspace} context={['Infraestrutura']} search={workspace === 'manual' ? { value: search, onChange: setSearch, placeholder: 'Procurar equipamento no mapa', ariaLabel: 'Procurar equipamento no mapa', scopeLabel: 'Mapas manuais' } : undefined} moduleTabs={<nav className="infra-menu" aria-label="Visualização de topologia"><button className={workspace === 'manual' ? 'active' : ''} aria-pressed={workspace === 'manual'} onClick={() => setWorkspace('manual')}><MapIcon size={15}/><span>Mapas manuais</span></button><button className={workspace === 'observed' ? 'active' : ''} aria-pressed={workspace === 'observed'} onClick={() => setWorkspace('observed')}><Activity size={15}/><span>Observada e reconciliação</span></button></nav>} toolbar={<div className="topology-toolbar-stack">{workspace === 'manual' ? <div className="topology-toolbar-row">{topbarActions}{mapViewActions}</div> : <div className="topology-toolbar-row">{observedToolbar}</div>}</div>}>
    <div className="topology-page">
      {workspace === 'observed' ? <ObservedTopology onToolbarChange={setObservedToolbar} /> : <>
        <section className={`topology-canvas panel${fullscreen ? ' topology-canvas--fullscreen' : ''}${labelsVisible ? '' : ' topology-canvas--auto-labels'}`} aria-label="Área do mapa de topologia">

          {current && search.trim() && !searchMatch && <p className="topology-map-no-results" role="status">Nenhum equipamento encontrado para “{search.trim()}”.</p>}
          {current && filtering && visibleCount === 0 && <p className="topology-map-no-results" role="status">Nenhum equipamento corresponde aos filtros.</p>}
          <span ref={fullscreenAnnouncementRef} className="topology-sr-only" aria-live="polite" />
          {warning && <p className="ipam-alert error topology-warning" role="alert">{warning}</p>}
          {current && <p className={`topology-save-status ${saveState}`} role="status" aria-live="polite">{saveState === 'pending' ? 'A guardar posições…' : saveState === 'failed' ? <>Falha ao guardar posições. <button type="button" onClick={retrySave}>Tentar novamente</button> <button type="button" onClick={reloadMap}>Recarregar mapa</button></> : 'Todas as posições estão guardadas.'}</p>}
          {selectedConnection && selectedConnectionDisplay && <aside className="topology-terminal-card" aria-label="Configuração da ligação"><header><strong>Terminal · {selectedConnection.type ?? 'Ligação'}</strong><button type="button" className="topology-terminal-close" aria-label="Fechar configuração" onClick={closeConnectionCard}>×</button></header><div className="topology-terminal-tabs" role="tablist" aria-label="Extremos da ligação"><button role="tab" aria-selected={selectedConnectionTab === 'source'} onClick={() => setSelectedConnectionTab('source')}>{selectedConnectionDisplay.sourceName}</button><button role="tab" aria-selected={selectedConnectionTab === 'target'} onClick={() => setSelectedConnectionTab('target')}>{selectedConnectionDisplay.targetName}</button></div><div className="topology-terminal-output" role="tabpanel"><span>{selectedConnectionTab === 'source' ? selectedConnectionDisplay.sourcePort : selectedConnectionDisplay.targetPort}</span><p className="topology-terminal-note">Não há configuração CLI disponível para esta ligação.</p></div></aside>}
          {impactTarget && <aside className="topology-impact-card" aria-labelledby="topology-impact-title"><header><strong id="topology-impact-title"><span>Impacto</span>{impactResult?.origin.name ? ` · ${impactResult.origin.name}` : ''}</strong><button type="button" className="topology-terminal-close" aria-label="Fechar impacto" onClick={clearImpact}>×</button></header>
            {current && highlight && <p className="topology-impact-legend"><span className="topology-impact-key topology-impact-key--down">Vai abaixo</span><span className="topology-impact-key topology-impact-key--cut">Sem caminho</span><span className="topology-impact-key topology-impact-key--degraded">Perde uma alimentação</span>{highlight.offMap > 0 && <small><span>Fora deste mapa:</span> {highlight.offMap}</small>}</p>}
            {!current && <p className="panel-description">Seleciona um mapa para destacar os equipamentos afetados.</p>}
            <ImpactPanel target={impactTarget} siteId={siteId} onMap onResult={onImpactResult} headingId="topology-impact-title" />
          </aside>}
          {!impactTarget && pathResult?.found && current && highlight && <p className="topology-impact-legend topology-path-legend" role="status"><span className="topology-impact-key topology-impact-key--path">Caminho documentado</span><span>Saltos:</span> {pathResult.hops}{highlight.offMap > 0 && <small><span>Fora deste mapa:</span> {highlight.offMap}</small>}</p>}
          <ReactFlow nodes={visibleNodes} edges={visibleEdges} nodeTypes={topologyNodeTypes} edgeTypes={topologyEdgeTypes} onInit={setFlow} onNodesChange={handleNodesChange} onEdgesChange={onEdgesChange} onConnect={onConnect} onNodeClick={(_event, node) => { const mapNode = current?.nodes.find((item) => item.id === node.id); openDeviceInterfaces(mapNode?.device); }} onEdgeClick={(_event, edge) => { setSelectedEdgeId(edge.id); setSelectedConnectionTab('source'); }} nodesDraggable={interactive} nodesConnectable={interactive} elementsSelectable={interactive} fitView><>{showGrid && <Background />}<MiniMap /></></ReactFlow>
          {!selected && !maps.isLoading && <div className="topology-canvas-empty"><strong>Seleciona ou cria um mapa</strong><span>O teu mapa de topologia aparece aqui.</span></div>}
        </section>
      </>}
    </div>
  </AppShell>;
}

function connectionDisplay(connection: TopologyConnection, map: TopologyMap, interfaces: Record<string, DeviceInterface[]>) {
  const source = map.nodes.find((node) => node.deviceId === connection.sourceDeviceId);
  const target = map.nodes.find((node) => node.deviceId === connection.targetDeviceId);
  const sourcePort = connectionPort(connection.sourceDeviceId, connection.sourceInterfaceId, interfaces);
  const targetPort = connectionPort(connection.targetDeviceId, connection.targetInterfaceId, interfaces);
  const sourceName = source?.device?.name ?? connection.sourceDeviceId;
  const targetName = target?.device?.name ?? connection.targetDeviceId;
  const sourcePortName = configuredPortLabel(source, sourcePort);
  const targetPortName = configuredPortLabel(target, targetPort);
  return { sourceName, targetName, sourcePort: sourcePortName, targetPort: targetPortName, tooltip: `${connection.label || connection.type || 'Ligação'} / ${sourceName} (Device 1) / ${sourcePortName} / ${targetName} (Device 2) / ${targetPortName}` };
}

function makeFlowEdge(connection: TopologyConnection, map: TopologyMap, interfaces: Record<string, DeviceInterface[]>, onSelect: (id: string) => void): TopologyFlowEdge {
  const display = connectionDisplay(connection, map, interfaces);
  return { id: connection.id, type: 'topologyConnection', source: connection.sourceNodeId, target: connection.targetNodeId, data: { ...display, onSelect }, label: connection.label ?? connection.type };
}
