// @ts-nocheck
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, Check, ChevronLeft, ChevronRight, Edit3, GripVertical, HardDrive, Layers, MapPinned, Plus, Search, Server, Trash2, Upload, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { EquipmentTypeIcon } from './equipment-type-icon';
import {
  AssetUploadModal,
  AssetList,
  BuildingModal,
  DeviceList,
  Editor as LegacyEditor,
  Modal,
  InterfaceWorkspace,
  ModelList,
  PortLayoutEditor as LegacyPortLayoutEditor,
  AssetImage,
  RoomModal,
} from './infrastructure-workspace';

type Any = any;
const FIXED_RACK_IMAGE = '/assets/rack-empty-42u.png';
const RACK_UNITS = 42;
const RACK_VIEWPORT = { left: 49 / 304, top: 45 / 820, width: 206 / 304, height: 737 / 820 };
const INFRASTRUCTURE_CONTEXT_KEY = 'cociber.infrastructureContext';
const readInfrastructureContext = () => {
  try {
    const value = localStorage.getItem(INFRASTRUCTURE_CONTEXT_KEY);
    return value ? JSON.parse(value) : null;
  } catch {
    return null;
  }
};
const writeInfrastructureContext = (context: Any) => {
  try {
    localStorage.setItem(INFRASTRUCTURE_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // A indisponibilidade do armazenamento local não deve impedir a navegação.
  }
};
const naturalInterfaceCompare = (a: Any, b: Any) => { const tokenize = (value: string) => value.toLocaleLowerCase().split(/(\d+)/).map((part) => /^\d+$/.test(part) ? Number(part) : part); const left = tokenize(a.name || a.portKey || ''); const right = tokenize(b.name || b.portKey || ''); for (let i = 0; i < Math.max(left.length, right.length); i += 1) { if (left[i] === undefined) return -1; if (right[i] === undefined) return 1; if (left[i] === right[i]) continue; return left[i] < right[i] ? -1 : 1; } return String(a.portKey || '').localeCompare(String(b.portKey || '')); };
let currentDetect: Any = () => undefined;
let currentConfirm: Any = () => undefined;
let currentEditInterface: Any = undefined;
let currentEditDevice: Any = undefined;
function PortLayoutEditor(props: Any) { if (!props.modal || !props.layoutModel) return null; return <LegacyPortLayoutEditor {...props} detect={currentDetect} confirm={currentConfirm}/>; }
function normalizedPortLayoutPorts(device:Any){const configured=device?.model?.portLayout?.ports;if(Array.isArray(configured))return configured;const count=Math.max(0,Number(device?.model?.networkPortCount??device?.model?.portCount??(typeof configured==='number'?configured:0))||0);if(!count)return [];const columns=Math.min(24,Math.max(1,count));const rows=Math.ceil(count/columns);return Array.from({length:count},(_,index)=>({portKey:`ethernet1/${index+1}`,label:`${index+1}`,x:(index%columns+.5)/columns,y:(Math.floor(index/columns)+.5)/rows,width:.8/columns,height:.6/rows}))}
function formatPortTooltipTitle(item:Any, port:Any) {
  const value = String(item?.portKey || port?.portKey || item?.name || port?.label || 'Porta');
  return value.replace(/^ethernet/i, 'Eth').replace(/^eth/i, 'Eth');
}
function getInterfaceVlans(item:Any) {
  return [
    item?.accessVlan,
    item?.nativeVlan,
    ...(item?.allowedVlans ?? []).map((entry:Any) => entry?.vlan ?? entry),
  ].filter(Boolean);
}
function getInterfaceSubnets(item:Any) {
  return [...new Set(getInterfaceVlans(item).flatMap((vlan:Any) => (vlan?.subnets ?? []).map((subnet:Any) => subnet?.cidr).filter(Boolean)))];
}
function DeviceImageFrame({ device, interfaces }: Any) {
  const [activePort, setActivePort] = useState<string>('');
  const image = device.frontAsset || device.model?.frontAsset;
  const layout = device.model?.portLayout ?? {};
  const ports = normalizedPortLayoutPorts(device);
  const width = Number(layout.imageWidth) || 1000;
  const height = Number(layout.imageHeight) || 300;
  const byPort = (port: Any) => interfaces.find((item: Any) => item.portKey === port.portKey || item.name === port.portKey);
  const activeLayoutPort = ports.find((port: Any) => port.portKey === activePort);
  const activeInterface = activeLayoutPort ? byPort(activeLayoutPort) : null;
  const activeVlans = getInterfaceVlans(activeInterface);
  return <div className="device-image-frame" style={{ aspectRatio: `${width} / ${height}` }}>
    {image ? <AssetImage asset={image} alt={`Imagem de ${device.name}`} /> : <div className="switch-face-fallback"><EquipmentTypeIcon type={device.type} alt={`Ícone de ${device.type}`} className="equipment-type-icon-large"/><strong>{device.name}</strong></div>}
    {ports.map((port: Any) => {
      const item = byPort(port);
      const allowedVlans = (item?.allowedVlans ?? []).map((x: Any) => x?.vlan?.vlanId ?? x?.vlanId).filter(Boolean);
      const subnets = getInterfaceSubnets(item);
      const vlanSummary = item?.accessVlan
        ? `VLAN access ${item.accessVlan.vlanId}`
        : item?.nativeVlan
          ? `VLAN nativa ${item.nativeVlan.vlanId}`
          : allowedVlans.length
            ? `Allowed: ${allowedVlans.join(', ')}`
            : 'Sem VLAN configurada';
      return <div key={port.portKey} role="button" tabIndex={0} onClick={()=>setActivePort(activePort===port.portKey?'':port.portKey)} onKeyDown={event=>event.key==='Enter'&&setActivePort(activePort===port.portKey?'':port.portKey)} className={`rack-port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${Number(port.x || 0) * 100}%`, top: `${Number(port.y || 0) * 100}%`, width: `${Number(port.width || .03) * 100}%`, height: `${Number(port.height || .3) * 100}%` }} aria-label={`Porta ${port.label || port.portKey}`}>
        <span>{port.label || port.portKey}</span>
        <b className="rack-port-tooltip"><strong>{formatPortTooltipTitle(item, port)}</strong><small>{item?.mode || 'sem modo'} · {item?.operUp ? 'UP' : 'DOWN'}</small><small>{vlanSummary}</small>{item?.accessVlan && allowedVlans.length ? <small>Allowed: {allowedVlans.join(', ')}</small> : null}<small>{subnets.length ? `Subnet: ${subnets.join(', ')}` : 'Sem subnet'}</small></b>
      </div>;
    })}
    {activeLayoutPort && <div className="rack-port-popover" role="dialog" aria-label={`Porta ${activeLayoutPort.label || activeLayoutPort.portKey}`} style={{ left: `${(Number(activeLayoutPort.x || 0) + Number(activeLayoutPort.width || .03) / 2) * 100}%`, top: `calc(${(Number(activeLayoutPort.y || 0) + Number(activeLayoutPort.height || .3)) * 100}% + 8px)` }}><strong>{formatPortTooltipTitle(activeInterface,activeLayoutPort)}</strong>{activeVlans.map((linked:Any)=><div key={linked.id}><span>VLAN {linked.vlanId} · {linked.name}</span>{linked.subnets?.length?linked.subnets.map((network:Any)=><a key={network.id} href={`/ipam?siteId=${encodeURIComponent(linked.siteId||network.siteId||'')}&vlanId=${encodeURIComponent(linked.id)}&subnetId=${encodeURIComponent(network.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id||'')}`}>{network.cidr}</a>):<a href={`/ipam?siteId=${encodeURIComponent(linked.siteId||'')}&vlanId=${encodeURIComponent(linked.id)}&fromDeviceId=${encodeURIComponent(device.id)}&fromInterfaceId=${encodeURIComponent(activeInterface?.id||'')}`}>Abrir VLAN no IPAM</a>}</div>)}{!activeVlans.length&&<small>Sem VLAN associada.</small>}</div>}
  </div>;
}
function LegacyRackDeviceZoom({deviceId,onBack,onInterfaces,onEditDevice}:Any){const {apiFetch}=useAuth();const [device,setDevice]=useState<Any>(null);const [loading,setLoading]=useState(true);const [closing,setClosing]=useState(false);const requestClose=()=>setClosing(true);useEffect(()=>{let live=true;setLoading(true);apiFetch(`/api/v1/devices/${deviceId}`).then((value:Any)=>{if(live)setDevice(value)}).catch(()=>{if(live)setDevice(null)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[deviceId]);useEffect(()=>{const close=(event:KeyboardEvent)=>event.key==='Escape'&&requestClose();window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[]);useEffect(()=>{if(!closing)return;const timer=window.setTimeout(onBack,240);return()=>window.clearTimeout(timer)},[closing,onBack]);if(loading)return <div className={`rack-device-focus${closing?' rack-device-focus-closing':''}`} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={e=>e.stopPropagation()}>A carregar dispositivo…</div></div>;if(!device)return <div className={`rack-device-focus${closing?' rack-device-focus-closing':''}`} onMouseDown={requestClose}><div className="rack-focus-loading" onMouseDown={e=>e.stopPropagation()}>Não foi possível carregar o dispositivo.</div></div>;return <div className={`rack-device-focus${closing?' rack-device-focus-closing':''}`} onMouseDown={requestClose}><div className="rack-focus-backdrop"/><div className="rack-device-focus-content" onMouseDown={e=>e.stopPropagation()}><div className="rack-device-focus-stage"><DeviceImageFrame device={device} interfaces={device.interfaces??[]}/></div><aside className="rack-device-info"><span className="section-kicker">EQUIPAMENTO</span><h2>{device.name}</h2><dl><div><dt>Hostname</dt><dd>{device.hostname||'Não definido'}</dd></div><div><dt>IP de gestão</dt><dd>{device.managementIp||'Não definido'}</dd></div><div><dt>Modelo</dt><dd>{device.model?`${device.model.manufacturer} ${device.model.model}`:'Não definido'}</dd></div><div><dt>Uptime</dt><dd>Não disponível — requer SNMP/agente</dd></div></dl><div className="button-row"><button className="secondary-button" onClick={requestClose}>Voltar ao bastidor</button>{onEditDevice&&<button className="secondary-button" onClick={()=>onEditDevice(device)}>Editar equipamento</button>}<button className="primary-button" onClick={()=>onInterfaces(device)}>Abrir ficha completa</button></div></aside></div></div>}
function InterfaceEditor({modal,close,form,setForm,vlans,save}: Any) {
  const [vlanSearch, setVlanSearch] = useState('');
  const [vlanPage, setVlanPage] = useState(0);
  useEffect(() => {
    if (modal === 'interface') {
      setVlanSearch('');
      setVlanPage(0);
    }
  }, [modal, form.interface?.id]);
  if (modal !== 'interface') return null;
  const update = (patch: Any) => setForm.interface({ ...form.interface, ...patch });
  const mode = form.interface.mode || 'ACCESS';
  const vlanPageSize = 12;
  const filteredVlans = vlans.filter((v: Any) => {
    const query = vlanSearch.trim().toLocaleLowerCase();
    return !query || `${v.vlanId} ${v.name ?? ''}`.toLocaleLowerCase().includes(query);
  });
  const vlanPageCount = Math.max(1, Math.ceil(filteredVlans.length / vlanPageSize));
  const activeVlanPage = Math.min(vlanPage, vlanPageCount - 1);
  const visibleVlans = filteredVlans.slice(activeVlanPage * vlanPageSize, (activeVlanPage + 1) * vlanPageSize);
  const submit = (e: Any) => { e.preventDefault(); const data = { ...form.interface, accessVlanId: mode === 'ACCESS' ? (form.interface.accessVlanId || null) : null, nativeVlanId: mode === 'TRUNK' ? (form.interface.nativeVlanId || null) : null, allowedVlanIds: mode === 'TRUNK' ? (form.interface.allowedVlanIds ?? []).filter(Boolean) : [], speedMbps: form.interface.speedMbps ? Number(form.interface.speedMbps) : null }; const { id, device: _device, ...payload } = data; save(`/api/v1/interfaces/${id}`, payload, 'PATCH'); };
  return <Modal title={`Configurar interface ${form.interface.name}`} close={close}><form className="modal-form" onSubmit={submit}><label>Nome<input required value={form.interface.name ?? ''} onChange={(e) => update({ name: e.target.value })}/></label><div className="form-row"><label>Port key<input value={form.interface.portKey ?? ''} onChange={(e) => update({ portKey: e.target.value })}/></label><label>Tipo<select value={form.interface.interfaceType ?? 'ETHERNET'} onChange={(e) => update({ interfaceType: e.target.value })}><option>FAST_ETHERNET</option><option>ETHERNET</option><option>GIGABIT_ETHERNET</option><option>SFP</option><option>SFP_PLUS</option><option>QSFP</option><option>MANAGEMENT</option><option>CONSOLE</option><option>FIBRE_CHANNEL</option><option>OTHER</option></select></label></div><label>Descrição<input value={form.interface.description ?? ''} onChange={(e) => update({ description: e.target.value })}/></label><div className="form-row"><label>Modo<select value={mode} onChange={(e) => update({ mode: e.target.value, accessVlanId: '', nativeVlanId: '', allowedVlanIds: [] })}><option>ACCESS</option><option>TRUNK</option><option>ROUTED</option></select></label><label>Velocidade Mbps<input type="number" value={form.interface.speedMbps ?? ''} onChange={(e) => update({ speedMbps: e.target.value })}/></label></div>{mode === 'ACCESS' && <label>VLAN access<select value={form.interface.accessVlanId ?? ''} onChange={(e) => update({ accessVlanId: e.target.value })}><option value="">Sem VLAN</option>{vlans.map((v: Any) => <option key={v.id} value={v.id}>VLAN {v.vlanId} · {v.name}</option>)}</select></label>}{mode === 'TRUNK' && <><label>VLAN nativa<select value={form.interface.nativeVlanId ?? ''} onChange={(e) => update({ nativeVlanId: e.target.value })}><option value="">Sem VLAN</option>{vlans.map((v: Any) => <option key={v.id} value={v.id}>VLAN {v.vlanId} · {v.name}</option>)}</select></label><div className="vlan-allowed-heading"><span>VLANs permitidas</span><div className="vlan-search-actions"><div className="vlan-search-slide open"><Search size={13}/><input aria-label="Pesquisar VLANs" placeholder="Pesquisar por número ou nome" value={vlanSearch} onChange={(e) => { setVlanSearch(e.target.value); setVlanPage(0); }}/></div></div></div><div className="multi-select-list">{visibleVlans.map((v: Any) => <label key={v.id}><input type="checkbox" checked={(form.interface.allowedVlanIds ?? []).includes(v.id)} onChange={(e) => update({ allowedVlanIds: e.target.checked ? [...(form.interface.allowedVlanIds ?? []), v.id] : (form.interface.allowedVlanIds ?? []).filter((id: string) => id !== v.id) })}/><span className="vlan-option-text">{v.name}</span></label>)}{!visibleVlans.length && <span className="vlan-search-empty">Nenhuma VLAN encontrada.</span>}</div><div className="vlan-pagination"><button type="button" className="icon-button subtle" aria-label="Página anterior" disabled={activeVlanPage === 0} onClick={() => setVlanPage(activeVlanPage - 1)}><ChevronLeft size={14}/></button><span>Página {activeVlanPage + 1} de {vlanPageCount}</span><button type="button" className="icon-button subtle" aria-label="Página seguinte" disabled={activeVlanPage >= vlanPageCount - 1} onClick={() => setVlanPage(activeVlanPage + 1)}><ChevronRight size={14}/></button></div></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Guardar configuração</button></div></form></Modal>;
}
function Editor(props: Any) { return props.modal === 'interface' ? <InterfaceEditor {...props}/> : <LegacyEditor {...props}/>; }
const rackUnitFromDrop = (event: Any, units: number, size: number) => {
  const bounds = event.currentTarget.getBoundingClientRect();
  const relativeY = Math.max(0, Math.min(bounds.height - 1, event.clientY - bounds.top));
  const pointerUnit = units - Math.floor((relativeY / bounds.height) * units);
  const offsetFromTop = Number(event.dataTransfer.getData('application/x-rack-offset')) || 0;
  const end = pointerUnit + offsetFromTop;
  return Math.max(1, Math.min(units - size + 1, end - size + 1));
};
function RackEquipmentPreview({ rack, reordering = false, movingDeviceId = '', onMove, onMoving }: Any) {
  const placed = (rack.devices ?? []).filter((device: Any) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return Number.isFinite(start) && start >= 1 && start + size - 1 <= RACK_UNITS;
  });
  return <span
    className={`rack-preview-overlay-area${reordering ? ' equipment-drop-zone' : ''}`}
    aria-hidden={reordering ? undefined : 'true'}
    onDragOver={(event) => { if (reordering) { event.preventDefault(); event.dataTransfer.dropEffect = 'move'; } }}
    onDrop={(event) => {
      if (!reordering) return;
      event.preventDefault();
      const deviceId = event.dataTransfer.getData('application/x-device-id') || event.dataTransfer.getData('text/plain');
      const device = placed.find((item: Any) => item.id === deviceId)
        ?? ({ rackUnitSize: Number(event.dataTransfer.getData('application/x-device-size')) || 1 });
      if (deviceId) void onMove(deviceId, rack.id, rackUnitFromDrop(event, rack.units ?? RACK_UNITS, Number(device.rackUnitSize) || 1));
      onMoving('');
    }}
    style={{ left: `${RACK_VIEWPORT.left * 100}%`, top: `${RACK_VIEWPORT.top * 100}%`, width: `${RACK_VIEWPORT.width * 100}%`, height: `${RACK_VIEWPORT.height * 100}%` }}
  >
    {placed.map((device: Any) => {
      const start = Number(device.rackUnitStart);
      const size = Math.max(1, Number(device.rackUnitSize) || 1);
      const end = start + size - 1;
      const top = ((RACK_UNITS - end) / RACK_UNITS) * 100;
      const height = (size / RACK_UNITS) * 100;
      const visual = device.frontAsset || device.model?.frontAsset;
      return <span className={`rack-preview-device${movingDeviceId === device.id ? ' moving' : ''}`} key={device.id} style={{ top: `${top}%`, height: `${height}%` }} draggable={reordering} role={reordering ? 'button' : undefined} tabIndex={reordering ? 0 : undefined} aria-label={reordering ? `Mover ${device.name}, atualmente em U${start}` : undefined} onKeyDown={(event) => {
        if (!reordering) return;
        const rackIndex = onMove.racks.findIndex((item: Any) => item.id === rack.id);
        if (event.key === 'ArrowUp') { event.preventDefault(); void onMove(device.id, rack.id, start + 1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); void onMove(device.id, rack.id, start - 1); }
        if (event.key === 'ArrowLeft' && rackIndex > 0) { event.preventDefault(); void onMove(device.id, onMove.racks[rackIndex - 1].id, start); }
        if (event.key === 'ArrowRight' && rackIndex < onMove.racks.length - 1) { event.preventDefault(); void onMove(device.id, onMove.racks[rackIndex + 1].id, start); }
      }} onDragStart={(event) => {
        if (!reordering) return;
        const bounds = event.currentTarget.getBoundingClientRect();
        const offset = Math.max(0, Math.min(size - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * size)));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', device.id);
        event.dataTransfer.setData('application/x-device-id', device.id);
        event.dataTransfer.setData('application/x-device-size', String(size));
        event.dataTransfer.setData('application/x-rack-offset', String(offset));
        onMoving(device.id);
      }} onDragEnd={() => onMoving('')}>
        {visual
          ? <AssetImage asset={visual} alt="" />
          : <EquipmentTypeIcon type={device.type} alt="" className="rack-device-type-icon"/>}
      </span>;
    })}
  </span>;
}
function RackWorkspace({ rooms, roomId, buildingId, racks, selected, setRack, onOut, onDevice, onEdit, onDelete, deletingRackId, canEdit, onPreviewPlacement, onPlaceDevice }: Any) {
  const racksPerPage = 5;
  const [firstVisibleRack, setFirstVisibleRack] = useState(0);
  const [reordering, setReordering] = useState(false);
  const [movingDeviceId, setMovingDeviceId] = useState('');
  const [savingPlacement, setSavingPlacement] = useState(false);
  const lastPossibleStart = Math.max(0, racks.length - racksPerPage);
  const visibleStart = Math.min(firstVisibleRack, lastPossibleStart);
  const visibleRacks = reordering ? racks : racks.slice(visibleStart, visibleStart + racksPerPage);
  useEffect(() => {
    setFirstVisibleRack(0);
    setReordering(false);
  }, [roomId]);
  useEffect(() => {
    setFirstVisibleRack((current) => Math.min(current, lastPossibleStart));
  }, [lastPossibleStart]);
  const startReordering = () => {
    setReordering(true);
    setFirstVisibleRack(0);
  };
  const cancelReordering = () => {
    setReordering(false);
    setMovingDeviceId('');
  };
  const moveDevice = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    setSavingPlacement(true);
    try {
      await onPlaceDevice(deviceId, targetRackId, rackUnitStart);
    } catch {
      // O workspace apresenta o erro e o modo de reorganização permanece ativo.
    } finally {
      setSavingPlacement(false);
    }
  };
  moveDevice.racks = racks;
  const activeBuildingId = buildingId
    || rooms.find((room: Any) => room.id === roomId)?.building?.id
    || racks.find((rack: Any) => (rack.room?.id ?? rack.roomId) === roomId)?.room?.building?.id
    || new URLSearchParams(location.search).get('buildingId')
    || '';
  if (selected) return <RackDetail rack={selected} onOut={() => {
    onOut();
    const url = new URL(location.href);
    url.searchParams.delete('rackId');
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }} onDevice={onDevice} onEdit={onEdit} onDelete={onDelete} deleting={deletingRackId === selected.id} canEdit={canEdit} onPreviewPlacement={onPreviewPlacement} onPlaceDevice={onPlaceDevice} />;
  if (!activeBuildingId) return <section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona um edifício para ver as salas</strong></section>;
  if (!roomId) return <section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona uma sala para ver os bastidores</strong></section>;
  return <section className="ipam-card rack-room-section">
    <div className="panel-heading"><div><span className="section-kicker">SALA SELECIONADA</span><h2>Bastidores</h2>{reordering && <p>Arrasta os equipamentos para outro bastidor ou U. Cada movimento é guardado automaticamente.</p>}</div><div className="rack-order-actions">{reordering ? <button type="button" className="primary-button" disabled={savingPlacement} onClick={cancelReordering}><Check size={14}/> {savingPlacement ? 'A atualizar…' : 'Concluir reorganização'}</button> : <>{canEdit && racks.length > 0 && <button type="button" className="secondary-button" onClick={startReordering}><GripVertical size={14}/> Reorganizar</button>}{canEdit && <button className="primary-button" onClick={() => onEdit({ name: '', room: { id: roomId }, roomId })}><Plus size={14}/> Adicionar bastidor</button>}</>}</div></div>
    <div className={`rack-figure-grid${reordering ? ' reordering equipment-reordering' : ''}`}>{visibleRacks.map((r: Any) => <figure className={`rack-figure${reordering ? ' equipment-reorderable' : ''}`} key={r.id}>
      {reordering && <span className="rack-drag-handle" aria-hidden="true"><GripVertical size={14}/> Equipamentos</span>}
      <div className="rack-figure-image" role={reordering ? 'group' : 'button'} tabIndex={reordering ? undefined : 0} onClick={() => { if (!reordering) setRack(r); }} onKeyDown={(event) => { if (!reordering && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setRack(r); } }} aria-label={`${reordering ? 'Reorganizar equipamentos no' : 'Abrir'} bastidor ${r.name}, ${r.devices?.length ?? 0} equipamentos`}>
        <img src={FIXED_RACK_IMAGE} alt="" draggable={false}/>
        <RackEquipmentPreview rack={r} reordering={reordering} movingDeviceId={movingDeviceId} onMove={moveDevice} onMoving={setMovingDeviceId}/>
      </div>
      <figcaption><strong>{r.name}</strong><small>Bastidor padrão · 42U · {r.devices?.length ?? 0} equipamentos</small></figcaption>
    </figure>)}</div>
    {!reordering && racks.length > racksPerPage && <nav className="rack-gallery-navigation" aria-label="Navegação dos bastidores">
      <button type="button" className="icon-button subtle" aria-label="Mostrar bastidor anterior" disabled={visibleStart === 0} onClick={() => setFirstVisibleRack(Math.max(0, visibleStart - 1))}><ChevronLeft size={16}/></button>
      <span aria-live="polite">{visibleStart + 1}–{Math.min(visibleStart + racksPerPage, racks.length)} de {racks.length}</span>
      <button type="button" className="icon-button subtle" aria-label="Mostrar bastidor seguinte" disabled={visibleStart === lastPossibleStart} onClick={() => setFirstVisibleRack(Math.min(lastPossibleStart, visibleStart + 1))}><ChevronRight size={16}/></button>
    </nav>}
    {!racks.length && <div className="empty-context"><strong>Esta sala ainda não tem bastidores</strong></div>}
  </section>;
}
function RackEquipmentOverlay({rack,onSelect,onDropDevice,draggingDeviceId,onDragging,canEdit,pendingDeviceId}:Any){const placed=(rack.devices??[]).filter((device:Any)=>{const start=Number(device.rackUnitStart);const size=Math.max(1,Number(device.rackUnitSize)||1);return Number.isFinite(start)&&start>=1&&start+size-1<=RACK_UNITS});return <div className={`rack-overlay-area${canEdit?' equipment-drop-zone':''}`} style={{left:`${RACK_VIEWPORT.left*100}%`,top:`${RACK_VIEWPORT.top*100}%`,width:`${RACK_VIEWPORT.width*100}%`,height:`${RACK_VIEWPORT.height*100}%`}} onDragOver={event=>{if(canEdit){event.preventDefault();event.dataTransfer.dropEffect='move'}}} onDrop={event=>{if(!canEdit)return;event.preventDefault();const id=event.dataTransfer.getData('application/x-device-id')||event.dataTransfer.getData('text/plain');const size=Number(event.dataTransfer.getData('application/x-device-size'))||1;if(id)void onDropDevice(id,rackUnitFromDrop(event,rack.units??RACK_UNITS,size));onDragging('')}}>{placed.map((device:Any)=>{const start=Number(device.rackUnitStart);const size=Math.max(1,Number(device.rackUnitSize)||1);const end=start+size-1;const top=((RACK_UNITS-end)/RACK_UNITS)*100;const height=(size/RACK_UNITS)*100;const visual=device.frontAsset||device.model?.frontAsset;return <button type="button" key={device.id} draggable={canEdit} className={`rack-overlay rack-${String(device.type||'other').toLowerCase()}${draggingDeviceId===device.id?' moving':''}${pendingDeviceId===device.id?' pending-placement':''}`} style={{top:`${top}%`,height:`${height}%`}} onKeyDown={event=>{if(!canEdit)return;if(event.key==='ArrowUp'){event.preventDefault();void onDropDevice(device.id,start+1)}if(event.key==='ArrowDown'){event.preventDefault();void onDropDevice(device.id,start-1)}}} onDragStart={event=>{const bounds=event.currentTarget.getBoundingClientRect();const offset=Math.max(0,Math.min(size-1,Math.floor(((event.clientY-bounds.top)/bounds.height)*size)));event.dataTransfer.effectAllowed='move';event.dataTransfer.setData('text/plain',device.id);event.dataTransfer.setData('application/x-device-id',device.id);event.dataTransfer.setData('application/x-device-size',String(size));event.dataTransfer.setData('application/x-rack-offset',String(offset));onDragging(device.id)}} onDragEnd={()=>window.setTimeout(()=>onDragging(''),0)} onClick={()=>{if(!draggingDeviceId)onSelect(device.id)}} aria-label={`${canEdit?'Arrastar ou abrir':'Abrir'} ${device.name}, U${start}${size>1?` a U${end}`:''}`}>
      <span className="rack-device-media">{visual?<AssetImage asset={visual} alt={`Vista frontal de ${device.name}`}/>:<EquipmentTypeIcon type={device.type} alt={`Ícone de ${device.type}`} className="rack-device-type-icon"/>}</span>
      <span className="rack-equipment-tooltip" role="tooltip"><strong>{device.name}</strong><span><small>Localização:</small><b>{rack.name}</b></span><span><small>U:</small><b>{size > 1 ? `U${start}–U${end}` : `U${start}`}</b></span><span><small>IP Management:</small><b>{device.managementIp||'não definido'}</b></span><span><small>Status:</small><b>{String(device.status||'unknown').toLowerCase()}</b></span></span>
    </button>})}</div>}
function RackDetail({ rack, onOut, onDevice, onEdit, onDelete, deleting, canEdit, onPreviewPlacement, onPlaceDevice }: Any) {
  const [zoomDeviceId, setZoomDeviceId] = useState('');
  const [draggingDeviceId, setDraggingDeviceId] = useState('');
  const [pending, setPending] = useState<Any>(null);
  const [saving, setSaving] = useState(false);
  const [correctingUnit, setCorrectingUnit] = useState(false);
  const [correctedUnit, setCorrectedUnit] = useState('');
  const [adjustingUnit, setAdjustingUnit] = useState(false);
  const displayRack = useMemo(() => {
    if (!pending) return rack;
    const changes = new Map(pending.changes.map((change: Any) => [change.id, change]));
    return {
      ...rack,
      devices: (rack.devices ?? [])
        .map((device: Any) => changes.has(device.id) ? { ...device, ...changes.get(device.id) } : device)
        .filter((device: Any) => device.rackId === rack.id),
    };
  }, [rack, pending]);
  const hasUnpositioned = (rack.devices ?? []).some((device: Any) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return !Number.isFinite(start) || start < 1 || start + size - 1 > RACK_UNITS;
  });
  const preview = async (deviceId: string, rackUnitStart: number) => {
    try {
      const next = await onPreviewPlacement(deviceId, rack.id, rackUnitStart);
      setPending(next);
      setCorrectingUnit(false);
      setCorrectedUnit(String(next.target.rackUnitStart));
    } catch {
      setPending(null);
    }
  };
  const adjustUnit = async (event: Any) => {
    event.preventDefault();
    if (!pending) return;
    const requestedUnit = Number(correctedUnit);
    const maximumStart = (rack.units ?? RACK_UNITS) - pending.target.rackUnitSize + 1;
    if (!Number.isInteger(requestedUnit) || requestedUnit < 1 || requestedUnit > maximumStart) return;
    setAdjustingUnit(true);
    try {
      const next = await onPreviewPlacement(pending.target.id, rack.id, requestedUnit);
      setPending(next);
      setCorrectedUnit(String(next.target.rackUnitStart));
      setCorrectingUnit(false);
    } catch {
      // O workspace apresenta o erro e mantém o valor para o utilizador corrigir.
    } finally {
      setAdjustingUnit(false);
    }
  };
  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await onPlaceDevice(pending.target.id, pending.target.rackId, pending.target.rackUnitStart);
      setPending(null);
      setCorrectingUnit(false);
    } finally {
      setSaving(false);
    }
  };
  const cancelPlacement = () => {
    setPending(null);
    setCorrectingUnit(false);
    setCorrectedUnit('');
  };
  const maximumCorrectedUnit = pending ? (rack.units ?? RACK_UNITS) - pending.target.rackUnitSize + 1 : RACK_UNITS;
  return <section className="ipam-card rack-view">
    <div className="rack-zoom-toolbar"><button className="secondary-button" onClick={onOut}>Voltar aos bastidores</button><span>{rack.room?.building?.name} / {rack.room?.name} / <strong>{rack.name}</strong></span><div className="button-row rack-detail-actions">{onEdit && <button type="button" className="secondary-button" onClick={() => onEdit(rack)}><Edit3 size={14}/> Editar bastidor</button>}{onDelete && <button type="button" className="secondary-button danger-button" disabled={deleting} onClick={() => onDelete(rack)}><Trash2 size={14}/> {deleting ? 'A eliminar…' : 'Eliminar bastidor'}</button>}</div></div>
    <div className="panel-heading"><div><span className="section-kicker">BASTIDOR VISUAL</span><h2>{rack.name}</h2><p>{rack.devices?.length ?? 0} equipamentos · Bastidor padrão · 42U{canEdit ? <>{' · '}<span>Arrasta um equipamento para o mover</span></> : null}</p></div></div>
    <div className="rack-stage"><div className="rack-frame"><img src={FIXED_RACK_IMAGE} alt={`Bastidor ${rack.name}`} draggable={false}/><RackEquipmentOverlay rack={displayRack} onSelect={setZoomDeviceId} onDropDevice={preview} draggingDeviceId={draggingDeviceId} onDragging={setDraggingDeviceId} canEdit={canEdit && !pending} pendingDeviceId={pending?.target?.id}/></div>{zoomDeviceId && <LegacyRackDeviceZoom deviceId={zoomDeviceId} onBack={() => setZoomDeviceId('')} onInterfaces={onDevice} onEditDevice={currentEditDevice}/>}</div>
    {pending && <aside className="rack-placement-confirmation" aria-live="polite">
      <div className="rack-placement-summary"><span className="section-kicker">POSIÇÃO SNAPPED-IN</span><strong>{pending.target.name} ficou em U{pending.target.rackUnitStart}{pending.target.rackUnitSize > 1 ? `–U${pending.target.rackUnitStart + pending.target.rackUnitSize - 1}` : ''}</strong><small>{pending.changes.length > 1 ? `${pending.changes.length - 1} equipamento(s) também serão reposicionados para libertar espaço.` : 'A nova posição está livre.'}</small>{!correctingUnit && <button type="button" className="rack-placement-correction-trigger" disabled={saving} onClick={() => { setCorrectedUnit(String(pending.target.rackUnitStart)); setCorrectingUnit(true); }}>Calhou no U errado?</button>}{correctingUnit && <form className="rack-placement-correction" onSubmit={adjustUnit}><label htmlFor="corrected-rack-unit">Em que U deveria ficar?</label><div><span>U</span><input id="corrected-rack-unit" type="number" inputMode="numeric" min="1" max={maximumCorrectedUnit} required autoFocus value={correctedUnit} onChange={(event) => setCorrectedUnit(event.target.value)} aria-describedby="corrected-rack-unit-help"/><button type="submit" className="secondary-button" disabled={adjustingUnit || !correctedUnit}>{adjustingUnit ? 'A ajustar…' : 'Ajustar automaticamente'}</button></div><small id="corrected-rack-unit-help">Escolhe um valor entre U1 e U{maximumCorrectedUnit}.</small></form>}</div>
      <div className="button-row"><button type="button" className="secondary-button" disabled={saving || adjustingUnit} onClick={cancelPlacement}>Cancelar</button><button type="button" className="primary-button" disabled={saving || adjustingUnit || correctingUnit} onClick={confirm}><Check size={14}/>{saving ? 'A guardar…' : 'Confirmar U'}</button></div>
    </aside>}
    {hasUnpositioned && <div className="no-data">Existem equipamentos por posicionar.</div>}
  </section>;
}

export function InfrastructureWorkspace() {
  const { apiFetch, hasRole } = useAuth();
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');
  const [tab, setTab] = useState('racks');
  const [sites, setSites] = useState<Any[]>([]);
  const [siteId, setSiteId] = useState('');
  const [locations, setLocations] = useState<Any[]>([]);
  const [racks, setRacks] = useState<Any[]>([]);
  const [models, setModels] = useState<Any[]>([]);
  const [assets, setAssets] = useState<Any[]>([]);
  const [vlans, setVlans] = useState<Any[]>([]);
  const [ips, setIps] = useState<Any[]>([]);
  const [devices, setDevices] = useState<Any[]>([]);
  const [buildingId, setBuildingId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rackId, setRackId] = useState('');
  const [device, setDevice] = useState<Any>(null);
  const [interfaces, setInterfaces] = useState<Any[]>([]);
  const [selectedInterface, setSelectedInterface] = useState<Any>(null);
  const [modal, setModal] = useState('');
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [busy, setBusy] = useState(false);
  const [deletingRackId, setDeletingRackId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [assetName, setAssetName] = useState('');
  const [uploadModelId, setUploadModelId] = useState('');
  const [buildingForm, setBuildingForm] = useState({ name: '', description: '' });
  const [roomForm, setRoomForm] = useState({ name: '', buildingId: '' });
  const [rackForm, setRackForm] = useState({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  const [deviceForm, setDeviceForm] = useState({ name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', frontAssetId: '' });
  const [interfaceForm, setInterfaceForm] = useState({ id: '', name: '', portKey: '', interfaceType: 'ETHERNET', description: '', adminUp: true, operUp: false, speedMbps: '', mode: 'ACCESS', accessVlanId: '', nativeVlanId: '', allowedVlanIds: [], macAddress: '' });
  const [modelForm, setModelForm] = useState({ manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '' });
  const [layoutModel, setLayoutModel] = useState<Any>(null);
  const [layout, setLayout] = useState<Any>(null);
  const [layoutAssetId, setLayoutAssetId] = useState('');
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const [effective, setEffective] = useState<Any>(null);
  const clickRef = useRef({ key: '', at: 0 });
  const scopeActions = roomId ? effective?.infrastructure?.rooms?.find((item: Any) => item.id === roomId)?.actions ?? [] : buildingId ? effective?.infrastructure?.buildings?.find((item: Any) => item.id === buildingId)?.actions ?? [] : effective?.infrastructure?.site ?? [];
  const canEdit = (roomId ? roleCanEdit : hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && scopeActions.some((action: string) => action !== 'READ');
  const canCreateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && (effective?.infrastructure?.site ?? []).includes('CREATE');
  const canCreateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item: Any) => item.id === buildingId)?.actions ?? []).includes('CREATE');

  const buildings = locations;
  const rooms = useMemo(() => buildingId ? locations.filter((b) => b.id === buildingId).flatMap((b) => (b.rooms ?? []).map((r: Any) => ({ ...r, building: b }))) : [], [locations, buildingId]);
  const selectedRack = racks.find((r) => r.id === rackId);
  const normalizedSearch = search.trim().toLowerCase();
  const matches = (...values: unknown[]) => !normalizedSearch || values.join(' ').toLowerCase().includes(normalizedSearch);
  const roomRacks = racks.filter((r) => (r.room?.id ?? r.roomId) === roomId && matches(r.name, ...(r.devices ?? []).map((item: Any) => item.name)));
  const visibleModels = models.filter((model) => matches(model.manufacturer, model.model, model.type));
  const visibleAssets = assets.filter((asset) => matches(asset.filename, asset.kind, asset.mimeType));
  const visibleInterfaces = interfaces.filter((item) => matches(item.name, item.portKey, item.description, item.macAddress));

  const load = async (id = siteId) => {
    if (!id) return;
    setBusy(true);
    try {
      const accessData = await apiFetch(`/api/v1/access/effective?siteId=${id}`);
      const canUseCatalog = Boolean(accessData?.tabs?.models || accessData?.tabs?.assets);
      const canUseInterfaces = Boolean(accessData?.tabs?.interfaces);
      const [locationsData, racksData, modelsData, assetsData, vlansData, devicesData] = await Promise.all([
        apiFetch(`/api/v1/sites/${id}/locations`),
        apiFetch(`/api/v1/sites/${id}/racks`),
        canUseCatalog ? apiFetch('/api/v1/device-models') : Promise.resolve([]),
        canUseCatalog ? apiFetch('/api/v1/assets') : Promise.resolve([]),
        canUseInterfaces ? apiFetch(`/api/v1/vlans?siteId=${id}&pageSize=500`) : Promise.resolve({ items: [] }),
        apiFetch(`/api/v1/devices?siteId=${id}&search=${encodeURIComponent(search)}&pageSize=100`),
      ]);
      setLocations(locationsData);
      setRacks(racksData);
      setModels(modelsData);
      setAssets(assetsData);
      setVlans(vlansData.items ?? vlansData ?? []);
      setDevices((devicesData.items ?? []).filter((d: Any) => d.status !== 'RETIRED'));
      setEffective(accessData);
      const query = new URLSearchParams(location.search);
      const requestedDevice = (devicesData.items ?? []).find((item:Any)=>item.id===query.get('deviceId'));
      if(requestedDevice&&canUseInterfaces){setDevice(requestedDevice);setTab('interfaces');const interfaceData=await apiFetch(`/api/v1/interfaces?deviceId=${requestedDevice.id}`);const ordered=(interfaceData??[]).sort(naturalInterfaceCompare);setInterfaces(ordered);setSelectedInterface(ordered.find((item:Any)=>item.id===query.get('interfaceId'))??null)}
      const storedContext = readInfrastructureContext();
      const rack = racksData.find((r: Any) => r.id === query.get('rackId'));
      if (rack) {
        setBuildingId(rack.room?.building?.id ?? '');
        setRoomId(rack.room?.id ?? '');
        setRackId(rack.id);
      } else {
        setRackId('');
        const contextForSite = storedContext?.siteId === id ? storedContext : null;
        const requestedRoomId = query.get('roomId') || contextForSite?.roomId || '';
        const requestedBuildingId = query.get('buildingId') || contextForSite?.buildingId || '';
        const restoredRoom = locationsData
          .flatMap((building: Any) => building.rooms ?? [])
          .find((room: Any) => room.id === requestedRoomId);
        const restoredBuildingId = restoredRoom?.buildingId || requestedBuildingId;

        // A sala persistida é a fonte mais específica. Derivar o edifício a
        // partir dela mantém o filtro de bastidores alinhado com o contexto
        // restaurado, mesmo quando a URL só contém o site.
        setBuildingId(restoredBuildingId);
        setRoomId(restoredRoom?.id || requestedRoomId);
        if (restoredBuildingId || restoredRoom?.id) {
          writeInfrastructureContext({
            siteId: id,
            buildingId: restoredBuildingId,
            roomId: restoredRoom?.id || requestedRoomId,
          });
        }
      }
    } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar a infraestrutura.'); }
    finally { setBusy(false); }
  };

  useEffect(() => {
    void apiFetch('/api/v1/sites?pageSize=100').then((data: Any) => {
      const list = data.items ?? data;
      setSites(list);
      const query = new URLSearchParams(location.search);
      const storedContext = readInfrastructureContext();
      const wanted = query.get('siteId') || storedContext?.siteId || localStorage.getItem('cociber.siteId');
      const id = wanted && list.some((s: Any) => s.id === wanted) ? wanted : list.length === 1 ? list[0].id : '';
      setSiteId(id);
      if (id) writeInfrastructureContext(storedContext?.siteId === id ? { ...storedContext, siteId: id } : { siteId: id, buildingId: '', roomId: '' });
    }).catch((e: Any) => setError(e instanceof Error ? e.message : 'Não foi possível carregar os Sites.'));
  }, []);
  useEffect(() => { const change = (event: Event) => { const id = (event as CustomEvent<{ siteId: string }>).detail.siteId; setSiteId(id); setBuildingId(''); setRoomId(''); setRackId(''); setDevice(null); if (id) void load(id); }; window.addEventListener('cociber:site-change', change); return () => window.removeEventListener('cociber:site-change', change); }, []);
  useEffect(() => { if (siteId) void load(siteId); }, [siteId]);
  useEffect(() => {
    if (!siteId || tab !== 'devices') return;
    const timer = window.setTimeout(() => {
      void apiFetch(`/api/v1/devices?siteId=${siteId}&search=${encodeURIComponent(search)}&pageSize=100`)
        .then((data: Any) => setDevices((data.items ?? []).filter((item: Any) => item.status !== 'RETIRED')))
        .catch((cause: Any) => setError(cause instanceof Error ? cause.message : 'Não foi possível pesquisar equipamentos.'));
    }, 250);
    return () => window.clearTimeout(timer);
  }, [apiFetch, search, siteId, tab]);
  useEffect(() => {
    const openUpload = () => { setPendingUpload(null); setAssetName(''); setUploadModelId(''); setModal('asset-upload'); };
    const openModel = () => { setEditingId(''); setModelForm({ manufacturer: '', model: '', type: 'OTHER', supportsNetworkPorts: false, networkPortCount: '', frontAssetId: '' }); setModal('model'); };
    window.addEventListener('asset-upload-request', openUpload);
    window.addEventListener('model-create-request', openModel);
    return () => {
      window.removeEventListener('asset-upload-request', openUpload);
      window.removeEventListener('model-create-request', openModel);
    };
  }, []);

  const chooseBuilding = (id: string) => { if (id === '__new__') { setBuildingForm({ name: '', description: '' }); setModal('building'); return; } setBuildingId(id); setRoomId(''); setRackId(''); setDevice(null); writeInfrastructureContext({ siteId, buildingId: id, roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${id}`); };
  const chooseRoom = (id: string) => { if (id === '__new__') { setRoomForm({ name: '', buildingId: buildingId || buildings[0]?.id || '' }); setModal('room'); return; } const room = rooms.find((r: Any) => r.id === id); const nextBuilding = room?.building?.id || buildingId; setBuildingId(nextBuilding); setRoomId(id); setRackId(''); setDevice(null); writeInfrastructureContext({ siteId, buildingId: nextBuilding, roomId: id }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${nextBuilding}&roomId=${id}`); };
  const createBuilding = async () => { if (!buildingForm.name.trim()) return; try { await apiFetch(`/api/v1/sites/${siteId}/buildings`, { method: 'POST', body: JSON.stringify({ name: buildingForm.name.trim() }) }); const fresh = await apiFetch(`/api/v1/sites/${siteId}/locations`); setLocations(fresh); const created = fresh.find((b: Any) => b.name === buildingForm.name.trim()); setModal(''); if (created) { setBuildingId(created.id); setRoomId(''); writeInfrastructureContext({ siteId, buildingId: created.id, roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${created.id}`); } } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar o edifício.'); } };
  const createRoom = async () => { if (!roomForm.name.trim() || !roomForm.buildingId) return; try { await apiFetch(`/api/v1/buildings/${roomForm.buildingId}/rooms`, { method: 'POST', body: JSON.stringify({ name: roomForm.name.trim() }) }); const fresh = await apiFetch(`/api/v1/sites/${siteId}/locations`); setLocations(fresh); const created = fresh.flatMap((b: Any) => b.rooms ?? []).find((r: Any) => r.name === roomForm.name.trim() && r.buildingId === roomForm.buildingId); setModal(''); if (created) { setBuildingId(roomForm.buildingId); setRoomId(created.id); writeInfrastructureContext({ siteId, buildingId: roomForm.buildingId, roomId: created.id }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${roomForm.buildingId}&roomId=${created.id}`); } } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar a sala.'); } };
  const openDevice = async (d: Any) => { setDevice(d); setTab('interfaces'); setSelectedInterface(null); history.replaceState({},'',`/infraestrutura?siteId=${siteId}&tab=interfaces&deviceId=${d.id}`); try { const list = await apiFetch(`/api/v1/interfaces?deviceId=${d.id}`); setInterfaces((list ?? []).sort(naturalInterfaceCompare)); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar as interfaces.'); } };
  const editDevice = async (d: Any) => { const full = await apiFetch(`/api/v1/devices/${d.id}`); setEditingId(full.id); setDeviceForm({ name: full.name ?? '', type: full.type ?? 'SWITCH', hostname: full.hostname ?? '', managementIp: full.managementIp ?? '', managementIpAddressId: full.ipAddresses?.find((i: Any) => i.address === full.managementIp)?.id ?? '', rackId: full.rackId ?? '', rackUnitStart: full.rackUnitStart ? String(full.rackUnitStart) : '', rackUnitSize: String(full.rackUnitSize ?? 1), modelId: full.modelId ?? full.model?.id ?? '', status: full.status ?? 'UNKNOWN', frontAssetId: full.frontAssetId ?? full.frontAsset?.id ?? '' }); setModal('device'); };
  const editInterface = (i: Any) => { setSelectedInterface(i); setInterfaceForm({ ...interfaceForm, ...i, id: i.id, speedMbps: i.speedMbps ? String(i.speedMbps) : '', accessVlanId: i.accessVlanId ?? '', nativeVlanId: i.nativeVlanId ?? '', allowedVlanIds: (i.allowedVlans ?? []).map((v: Any) => v.vlanId) }); setModal('interface'); };
  const save = async (path: string, body: Any, method = editingId ? 'PATCH' : 'POST') => { try { await apiFetch(path, { method, body: JSON.stringify(body) }); setModal(''); setEditingId(''); await load(); if (device) await openDevice(device); } catch (e) { setError(e instanceof Error ? e.message : 'Operação falhou.'); } };
  const previewPlacement = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    try {
      setError('');
      return await apiFetch(`/api/v1/devices/${deviceId}/placement/preview`, { method: 'POST', body: JSON.stringify({ rackId: targetRackId, rackUnitStart }) });
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível pré-visualizar a posição do equipamento.';
      setError(message);
      throw e;
    }
  };
  const placeDevice = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    try {
      setError('');
      const result = await apiFetch(`/api/v1/devices/${deviceId}/placement`, { method: 'PATCH', body: JSON.stringify({ rackId: targetRackId, rackUnitStart }) });
      await load();
      return result;
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Não foi possível atualizar a localização do equipamento.';
      setError(message);
      throw e;
    }
  };
  const deleteRack = async (rack: Any) => {
    if (!window.confirm(`Eliminar o bastidor “${rack.name}”? Os bastidores seguintes serão deslocados uma posição para a esquerda.`)) return;
    setDeletingRackId(rack.id);
    setError('');
    try {
      await apiFetch(`/api/v1/racks/${rack.id}`, { method: 'DELETE' });
      setRackId('');
      const url = new URL(location.href);
      url.searchParams.delete('rackId');
      history.replaceState({}, '', `${url.pathname}${url.search}`);
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível eliminar o bastidor.');
    } finally {
      setDeletingRackId('');
    }
  };
  const reset = () => { setBuildingId(''); setRoomId(''); setRackId(''); setDevice(null); setSelectedInterface(null); setInterfaces([]); setModal(''); writeInfrastructureContext({ siteId, buildingId: '', roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}`); };
  const selectTab = (key: string) => { const now = Date.now(); const double = tab === key && clickRef.current.key === key && now - clickRef.current.at < 500; clickRef.current = { key, at: now }; setSearch(''); if (double) { reset(); setTab(key); clickRef.current = { key: '', at: 0 }; } else setTab(key); };
  const newDevice = () => { setEditingId(''); setDeviceForm({ name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', frontAssetId: '' }); setModal('device'); };
  const openLayout = async (model: Any) => { const data = await apiFetch(`/api/v1/device-models/${model.id}/port-layout`); setLayoutModel(model); setLayout(Array.isArray(data.portLayout?.ports) ? data.portLayout : { imageWidth: 1000, imageHeight: 300, ports: [] }); setLayoutAssetId(model.frontAssetId ?? model.frontAsset?.id ?? ''); setModal('layout'); };
  const detectLayout = async () => { if (!layoutModel) return; try { const proposal = await apiFetch(`/api/v1/device-models/${layoutModel.id}/port-layout/detect`, { method: 'POST', body: JSON.stringify({ assetId: layoutAssetId, portCount: layoutModel.networkPortCount ?? layoutModel.portCount, imageWidth: layout?.imageWidth, imageHeight: layout?.imageHeight }) }); setLayout(proposal); } catch (e) { setLayoutError(e instanceof Error ? e.message : 'A deteção falhou.'); } };
  const confirmLayout = async () => { if (!layoutModel || !layout) return; setLayoutSaving(true); setLayoutError(''); try { const ports = (layout.ports ?? []).map((p: Any, index: number) => ({ ...p, portKey: String(p.portKey || `ethernet1/${index + 1}`), label: String(p.label || p.portKey || `Porta ${index + 1}`), x: Math.max(0, Math.min(1, Number(p.x) || 0)), y: Math.max(0, Math.min(1, Number(p.y) || 0)), width: Math.max(.005, Math.min(1, Number(p.width) || .03)), height: Math.max(.005, Math.min(1, Number(p.height) || .3)) })); await apiFetch(`/api/v1/device-models/${layoutModel.id}/port-layout`, { method: 'PATCH', body: JSON.stringify({ ...layout, ports, assetId: layoutAssetId || null, confirmedAt: new Date().toISOString() }) }); setModal(''); setLayout(null); await load(); } catch (e) { setLayoutError(e instanceof Error ? e.message : 'Não foi possível guardar o template.'); } finally { setLayoutSaving(false); } };
  const generateInterfaces = async () => { if (device) { await apiFetch(`/api/v1/devices/${device.id}/interfaces/generate`, { method: 'POST' }); await openDevice(device); } };
  const submitUpload = async () => { if (!pendingUpload || !assetName.trim() || !uploadModelId) return; setUploading(true); try { const reader = new FileReader(); const contentBase64 = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(pendingUpload); }); const asset = await apiFetch('/api/v1/assets', { method: 'POST', body: JSON.stringify({ filename: assetName.trim(), mimeType: pendingUpload.type, kind: 'INFRASTRUCTURE', contentBase64 }) }); await apiFetch(`/api/v1/device-models/${uploadModelId}/assets/front`, { method: 'POST', body: JSON.stringify({ assetId: asset.id }) }); setModal(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Upload falhou.'); } finally { setUploading(false); } };
  const chooseUpload = (event: Any) => { const file = event.dataTransfer?.files?.[0] ?? event.target.files?.[0]; if (event.target?.type === 'file') event.target.value = ''; if (!file) return; setPendingUpload(file); setAssetName((current: string) => current.trim() || file.name); };
  const deleteAsset = async (asset: Any) => {
    if (!window.confirm(`Eliminar o asset “${asset.filename}”? As associações visuais serão removidas.`)) return;
    try {
      await apiFetch(`/api/v1/assets/${asset.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível eliminar o asset.');
    }
  };

  if (!siteId) return <AppShell section="Infraestrutura"><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Seleciona um Site na barra lateral para começar.</p></div></header><section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona um Site na barra lateral</strong></section></main></AppShell>;
  currentDetect = detectLayout;
  currentConfirm = confirmLayout;
  currentEditInterface = editInterface;
  currentEditDevice = editDevice;
  const canDeleteRack = hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR');
  const modalForEditor = modal === 'room' || modal === 'building' ? '' : modal;
  const siteName = sites.find((item: Any) => item.id === siteId)?.name ?? 'Site';
  const buildingName = buildings.find((item: Any) => item.id === buildingId)?.name;
  const roomName = rooms.find((item: Any) => item.id === roomId)?.name;
  const tabName = ({ racks: 'Bastidores', devices: 'Equipamentos', models: 'Modelos', interfaces: 'Interfaces', assets: 'Assets', permissions: 'Permissões' } as Record<string, string>)[tab] ?? tab;
  const visibleTabs: Any[] = [['racks', 'Bastidores', MapPinned], ['devices', 'Equipamentos', Server], ...(effective?.tabs?.models ? [['models', 'Modelos', Boxes]] : []), ...(effective?.tabs?.interfaces ? [['interfaces', 'Interfaces', Layers]] : []), ...(effective?.tabs?.assets ? [['assets', 'Assets', HardDrive]] : [])];
  return <AppShell section="Infraestrutura" context={[siteName, ...(buildingName ? [buildingName] : []), ...(roomName ? [roomName] : []), tabName]} search={{ value: search, onChange: setSearch, placeholder: `Pesquisar em ${tabName.toLowerCase()}…` }}><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Site → edifício → sala → bastidor → equipamento → interfaces.</p></div></header>{error && <div className="ipam-alert error"><X size={15}/>{error}</div>}<section className="infra-context-bar"><label><MapPinned size={15}/> Edifício<select value={buildingId} onChange={(e) => chooseBuilding(e.target.value)}><option value="">Seleciona um edifício</option>{buildings.map((b: Any) => <option key={b.id} value={b.id}>{b.name}</option>)}{canCreateBuilding && <option value="__new__">Criar novo Edifício</option>}</select></label><label><MapPinned size={15}/> Sala<select value={roomId} onChange={(e) => chooseRoom(e.target.value)}><option value="">Seleciona uma sala</option>{rooms.map((r: Any) => <option key={r.id} value={r.id}>{r.name}</option>)}{canCreateRoom && <option value="__new__">Criar nova Sala</option>}</select></label><span>{busy ? 'A carregar…' : `${racks.length} bastidores · ${devices.length} equipamentos ativos`}</span></section><nav className="infra-menu">{visibleTabs.map(([key, label, Icon]: Any) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => selectTab(key)}><Icon size={15}/><span>{label}</span></button>)}</nav>{tab === 'racks' && <RackWorkspace rooms={rooms} roomId={roomId} buildingId={buildingId} racks={roomRacks} selected={selectedRack} setRoom={(id: string) => { setRoomId(id); setRackId(''); }} setRack={(r: Any) => { setRoomId(r.room.id); setRackId(r.id); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${r.room?.building?.id ?? buildingId}&roomId=${r.room?.id ?? roomId}&rackId=${r.id}`); }} onOut={() => setRackId('')} onDevice={openDevice} onEdit={(r: Any) => { setEditingId(r.id ?? ''); setRackForm({ name: r.name ?? '', units: String(r.units ?? 42), roomId: r.room?.id ?? r.roomId ?? roomId, modelId: r.modelId ?? r.model?.id ?? '', frontAssetId: r.frontAssetId ?? r.frontAsset?.id ?? '' }); setModal('rack'); }} onDelete={canDeleteRack && scopeActions.includes('DELETE') ? deleteRack : undefined} deletingRackId={deletingRackId} canEdit={canEdit} onPreviewPlacement={previewPlacement} onPlaceDevice={placeDevice}/>} {tab === 'devices' && <DeviceList devices={devices} search={search} setSearch={setSearch} onSelect={openDevice} onEdit={editDevice} onNew={newDevice} canEdit={canEdit}/>} {tab === 'models' && effective?.tabs?.models && <ModelList models={visibleModels} onEdit={(m: Any) => { setEditingId(m.id); setModelForm({ manufacturer: m.manufacturer, model: m.model, type: m.type ?? 'OTHER', supportsNetworkPorts: !!m.supportsNetworkPorts, networkPortCount: String(m.networkPortCount ?? ''), frontAssetId: m.frontAssetId ?? m.frontAsset?.id ?? '' }); setModal('model'); }} onLayout={openLayout} canEdit={roleCanEdit}/>} {tab === 'assets' && effective?.tabs?.assets && <AssetList assets={visibleAssets} onDelete={deleteAsset} canEdit={roleCanEdit} canDelete={roleCanEdit}/>} {tab === 'interfaces' && effective?.tabs?.interfaces && <InterfaceWorkspace devices={devices} selected={device} interfaces={visibleInterfaces} selectedInterface={selectedInterface} onDevice={openDevice} onInterface={editInterface} onGenerate={generateInterfaces} onEditDevice={() => device && editDevice(device)}/>}<Editor modal={modalForEditor} close={() => setModal('')} editingId={editingId} form={{ rack: rackForm, device: deviceForm, interface: interfaceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, interface: setInterfaceForm, model: setModelForm }} rooms={rooms} racks={racks} models={models} assets={assets} vlans={vlans} ips={ips} save={save}/><BuildingModal modal={modal === 'building'} close={() => setModal('')} buildingForm={buildingForm} setBuildingForm={setBuildingForm} createBuilding={createBuilding}/><RoomModal modal={modal === 'room'} close={() => setModal('')} roomForm={roomForm} setRoomForm={setRoomForm} buildings={buildings} createRoom={createRoom}/><AssetUploadModal modal={modal === 'asset-upload'} close={() => setModal('')} file={pendingUpload} name={assetName} setName={setAssetName} modelId={uploadModelId} setModelId={setUploadModelId} models={models} choose={chooseUpload} submit={submitUpload} busy={uploading}/><PortLayoutEditor modal={modal === 'layout'} close={() => setModal('')} layoutModel={layoutModel} layout={layout} setLayout={setLayout} assets={assets} assetId={layoutAssetId} setAssetId={setLayoutAssetId} detect={() => undefined} confirm={() => undefined} saving={layoutSaving} error={layoutError}/></main></AppShell>;
}
