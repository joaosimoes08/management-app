// @ts-nocheck
'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Boxes, HardDrive, Layers, MapPinned, Plus, Server, Upload, X } from 'lucide-react';
import { AppShell } from './app-shell';
import { useAuth } from '../lib/auth';
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
  RackWorkspace as LegacyRackWorkspace,
  AssetImage,
  RoomModal,
} from './infrastructure-workspace';

type Any = any;
const networkTypes = ['SWITCH', 'ROUTER', 'FIREWALL'];
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
function DeviceImageFrame({ device, interfaces }: Any) {
  const image = device.frontAsset || device.model?.frontAsset;
  const layout = device.model?.portLayout ?? {};
  const ports = normalizedPortLayoutPorts(device);
  const width = Number(layout.imageWidth) || 1000;
  const height = Number(layout.imageHeight) || 300;
  const byPort = (port: Any) => interfaces.find((item: Any) => item.portKey === port.portKey || item.name === port.portKey);
  return <div className="device-image-frame" style={{ aspectRatio: `${width} / ${height}` }}>
    {image ? <AssetImage asset={image} alt={`Imagem de ${device.name}`} /> : <div className="switch-face-fallback"><Server size={32}/><strong>{device.name}</strong></div>}
    {ports.map((port: Any) => {
      const item = byPort(port);
      return <button key={port.portKey} type="button" className={`rack-port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${Number(port.x || 0) * 100}%`, top: `${Number(port.y || 0) * 100}%`, width: `${Number(port.width || .03) * 100}%`, height: `${Number(port.height || .3) * 100}%` }} aria-label={`Porta ${port.label || port.portKey}`}>
        <span>{port.label || port.portKey}</span>
        <b className="rack-port-tooltip"><strong>{item?.name || port.label || port.portKey}</strong><small>{item?.mode || 'sem modo'} · {item?.operUp ? 'UP' : 'DOWN'}</small><small>{item?.accessVlan ? `VLAN access ${item.accessVlan.vlanId}` : item?.nativeVlan ? `VLAN nativa ${item.nativeVlan.vlanId}` : 'Sem VLAN configurada'}</small><small>{item?.allowedVlans?.length ? `Allowed: ${item.allowedVlans.map((x: Any) => x.vlan?.vlanId ?? x.vlanId).join(', ')}` : ''}</small><small>{item?.accessVlan?.subnets?.[0]?.cidr || item?.nativeVlan?.subnets?.[0]?.cidr || 'Sem subnet'}</small></b>
      </button>;
    })}
  </div>;
}
function LegacyRackDeviceZoom({deviceId,onBack,onInterfaces,onEditDevice}:Any){const {apiFetch}=useAuth();const [device,setDevice]=useState<Any>(null);const [loading,setLoading]=useState(true);useEffect(()=>{let live=true;setLoading(true);apiFetch(`/api/v1/devices/${deviceId}`).then((value:Any)=>{if(live)setDevice(value)}).catch(()=>{if(live)setDevice(null)}).finally(()=>{if(live)setLoading(false)});return()=>{live=false}},[deviceId]);useEffect(()=>{const close=(event:KeyboardEvent)=>event.key==='Escape'&&onBack();window.addEventListener('keydown',close);return()=>window.removeEventListener('keydown',close)},[onBack]);if(loading)return <div className="rack-device-focus" onMouseDown={onBack}><div className="rack-focus-loading" onMouseDown={e=>e.stopPropagation()}>A carregar dispositivo…</div></div>;if(!device)return <div className="rack-device-focus" onMouseDown={onBack}><div className="rack-focus-loading" onMouseDown={e=>e.stopPropagation()}>Não foi possível carregar o dispositivo.</div></div>;return <div className="rack-device-focus" onMouseDown={onBack}><div className="rack-focus-backdrop"/><div className="rack-device-focus-content" onMouseDown={e=>e.stopPropagation()}><div className="rack-device-focus-stage"><DeviceImageFrame device={device} interfaces={device.interfaces??[]}/></div><aside className="rack-device-info"><span className="section-kicker">EQUIPAMENTO</span><h2>{device.name}</h2><dl><div><dt>Hostname</dt><dd>{device.hostname||'Não definido'}</dd></div><div><dt>IP de gestão</dt><dd>{device.managementIp||'Não definido'}</dd></div><div><dt>Modelo</dt><dd>{device.model?`${device.model.manufacturer} ${device.model.model}`:'Não definido'}</dd></div><div><dt>Uptime</dt><dd>Não disponível — requer SNMP/agente</dd></div></dl><div className="button-row"><button className="secondary-button" onClick={onBack}>Voltar ao bastidor</button>{onEditDevice&&<button className="secondary-button" onClick={()=>onEditDevice(device)}>Editar equipamento</button>}<button className="primary-button" onClick={()=>onInterfaces(device)}>Abrir ficha completa</button></div></aside></div></div>}
function InterfaceEditor({modal,close,form,setForm,vlans,save}: Any) {
  if (modal !== 'interface') return null;
  const update = (patch: Any) => setForm.interface({ ...form.interface, ...patch });
  const mode = form.interface.mode || 'ACCESS';
  const submit = (e: Any) => { e.preventDefault(); const data = { ...form.interface, accessVlanId: mode === 'ACCESS' ? (form.interface.accessVlanId || null) : null, nativeVlanId: mode === 'TRUNK' ? (form.interface.nativeVlanId || null) : null, allowedVlanIds: mode === 'TRUNK' ? (form.interface.allowedVlanIds ?? []).filter(Boolean) : [], speedMbps: form.interface.speedMbps ? Number(form.interface.speedMbps) : null }; const { id, ...payload } = data; save(`/api/v1/interfaces/${id}`, payload, 'PATCH'); };
  return <Modal title={`Configurar interface ${form.interface.name}`} close={close}><form className="modal-form" onSubmit={submit}><label>Nome<input required value={form.interface.name ?? ''} onChange={(e) => update({ name: e.target.value })}/></label><div className="form-row"><label>Port key<input value={form.interface.portKey ?? ''} onChange={(e) => update({ portKey: e.target.value })}/></label><label>Tipo<select value={form.interface.interfaceType ?? 'ETHERNET'} onChange={(e) => update({ interfaceType: e.target.value })}><option>FAST_ETHERNET</option><option>ETHERNET</option><option>GIGABIT_ETHERNET</option><option>SFP</option><option>SFP_PLUS</option><option>QSFP</option><option>MANAGEMENT</option><option>CONSOLE</option><option>FIBRE_CHANNEL</option><option>OTHER</option></select></label></div><label>Descrição<input value={form.interface.description ?? ''} onChange={(e) => update({ description: e.target.value })}/></label><div className="form-row"><label>Modo<select value={mode} onChange={(e) => update({ mode: e.target.value, accessVlanId: '', nativeVlanId: '', allowedVlanIds: [] })}><option>ACCESS</option><option>TRUNK</option><option>ROUTED</option></select></label><label>Velocidade Mbps<input type="number" value={form.interface.speedMbps ?? ''} onChange={(e) => update({ speedMbps: e.target.value })}/></label></div>{mode === 'ACCESS' && <label>VLAN access<select value={form.interface.accessVlanId ?? ''} onChange={(e) => update({ accessVlanId: e.target.value })}><option value="">Sem VLAN</option>{vlans.map((v: Any) => <option key={v.id} value={v.id}>VLAN {v.vlanId} · {v.name}</option>)}</select></label>}{mode === 'TRUNK' && <><label>VLAN nativa<select value={form.interface.nativeVlanId ?? ''} onChange={(e) => update({ nativeVlanId: e.target.value })}><option value="">Sem VLAN</option>{vlans.map((v: Any) => <option key={v.id} value={v.id}>VLAN {v.vlanId} · {v.name}</option>)}</select></label><label>VLANs permitidas</label><div className="multi-select-list">{vlans.map((v: Any) => <label key={v.id}><input type="checkbox" checked={(form.interface.allowedVlanIds ?? []).includes(v.id)} onChange={(e) => update({ allowedVlanIds: e.target.checked ? [...(form.interface.allowedVlanIds ?? []), v.id] : (form.interface.allowedVlanIds ?? []).filter((id: string) => id !== v.id) })}/>{v.vlanId} · {v.name}</label>)}</div></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Guardar configuração</button></div></form></Modal>;
}
function Editor(props: Any) { return props.modal === 'interface' ? <InterfaceEditor {...props}/> : <LegacyEditor {...props}/>; }
function RackWorkspace({ roomId, buildingId, racks, selected, setRack, onOut, onDevice, onEdit, canEdit }: Any) { const activeBuildingId = buildingId || new URLSearchParams(location.search).get('buildingId') || ''; if (selected) return <RackDetail rack={selected} onOut={onOut} onDevice={onDevice} onEdit={onEdit} />; if (!activeBuildingId) return <section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona um edifício para ver as salas</strong></section>; if (!roomId) return <section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona uma sala para ver os bastidores</strong></section>; return <section className="ipam-card rack-room-section"><div className="panel-heading"><div><span className="section-kicker">SALA SELECIONADA</span><h2>Bastidores</h2></div>{canEdit && <button className="primary-button" onClick={() => onEdit({ name: '', units: 42, room: { id: roomId }, roomId })}><Plus size={14}/> Adicionar bastidor</button>}</div><div className="rack-figure-grid">{racks.map((r: Any) => <figure className="rack-figure" key={r.id}><button className="rack-figure-image" onClick={() => setRack(r)}>{r.frontAsset || r.model?.frontAsset ? <AssetImage asset={r.frontAsset || r.model.frontAsset} alt={`Imagem do bastidor ${r.name}`}/> : <img src="/assets/rack-empty-42u.png" alt={`Imagem default do bastidor ${r.name}`}/>}</button><figcaption><strong>{r.name}</strong><small>{r.model ? `${r.model.manufacturer} ${r.model.model}` : 'Modelo genérico'} · {r.units}U · {r.devices?.length ?? 0} equipamentos</small></figcaption></figure>)}</div>{!racks.length && <div className="empty-context"><strong>Esta sala ainda não tem bastidores</strong></div>}</section>; }
function rackViewport(rack:Any){const configured=rack.model?.capabilities?.viewport;return configured&&Number.isFinite(configured.left)&&Number.isFinite(configured.top)&&Number.isFinite(configured.width)&&Number.isFinite(configured.height)?configured:{left:.27,top:.14,width:.51,height:.81}}
function RackEquipmentOverlay({rack,onSelect}:Any){const viewport=rackViewport(rack);const units=Math.max(1,Number(rack.units)||42);const placed=(rack.devices??[]).filter((device:Any)=>Number.isFinite(Number(device.rackUnitStart))&&Number(device.rackUnitStart)>0);return <div className="rack-overlay-area" style={{left:`${viewport.left*100}%`,top:`${viewport.top*100}%`,width:`${viewport.width*100}%`,height:`${viewport.height*100}%`}}>{placed.map((device:Any)=>{const size=Math.max(1,Number(device.rackUnitSize)||1);const top=((Number(device.rackUnitStart)-1)/units)*100;const visual=device.frontAsset||device.model?.frontAsset;return <button type="button" key={device.id} className={`rack-overlay rack-${String(device.type||'other').toLowerCase()}`} style={{top:`${Math.max(0,top)}%`,height:`${Math.max(1,Math.min(100-top,size/units*100))}%`}} onClick={()=>onSelect(device.id)} aria-label={`Abrir ${device.name}, ${size} unidades U`}>
      <span className="rack-device-media">{visual?<AssetImage asset={visual} alt={`Vista frontal de ${device.name}`}/>:<span className="rack-device-fallback">{String(device.type||'EQ').slice(0,3)}</span>}</span>
      <span className="rack-equipment-tooltip" role="tooltip"><strong>{device.name}</strong><span><small>Localização:</small><b>{rack.name}</b></span><span><small>U:</small><b>{size > 1 ? `U${device.rackUnitStart}–U${Number(device.rackUnitStart) + size - 1}` : `U${device.rackUnitStart}`}</b></span><span><small>IP Management:</small><b>{device.managementIp||'não definido'}</b></span><span><small>Status:</small><b>{String(device.status||'unknown').toLowerCase()}</b></span></span>
    </button>})}</div>}
function RackDetail({ rack, onOut, onDevice, onEdit }: Any) { const [zoomDeviceId, setZoomDeviceId] = useState(''); const image = rack.frontAsset || rack.model?.frontAsset; return <section className="ipam-card rack-view"><div className="rack-zoom-toolbar"><button className="secondary-button" onClick={onOut}>Voltar aos bastidores</button><span>{rack.room?.building?.name} / {rack.room?.name} / <strong>{rack.name}</strong></span>{onEdit && <button className="secondary-button" onClick={() => onEdit(rack)}>Editar bastidor</button>}</div><div className="panel-heading"><div><span className="section-kicker">BASTIDOR VISUAL</span><h2>{rack.name}</h2><p>{rack.devices?.length ?? 0} equipamentos · {rack.units}U</p></div></div><div className="rack-stage">{image ? <AssetImage asset={image} alt={`Bastidor ${rack.name}`}/> : <img src="/assets/rack-empty-42u.png" alt={`Bastidor ${rack.name}`}/>}<RackEquipmentOverlay rack={rack} onSelect={setZoomDeviceId}/>{zoomDeviceId && <LegacyRackDeviceZoom deviceId={zoomDeviceId} onBack={() => setZoomDeviceId('')} onInterfaces={onDevice} onEditDevice={currentEditDevice}/>}</div>{(rack.devices ?? []).some((d: Any) => !Number.isFinite(d.rackUnitStart) || d.rackUnitStart < 1) && <div className="no-data">Existem equipamentos por posicionar.</div>}</section>; }

export function InfrastructureWorkspace() {
  const { apiFetch, hasRole } = useAuth();
  const canEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');
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
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [assetName, setAssetName] = useState('');
  const [uploadModelId, setUploadModelId] = useState('');
  const [buildingForm, setBuildingForm] = useState({ name: '', description: '' });
  const [roomForm, setRoomForm] = useState({ name: '', buildingId: '' });
  const [rackForm, setRackForm] = useState({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  const [deviceForm, setDeviceForm] = useState({ name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', frontAssetId: '', iconAssetId: '' });
  const [interfaceForm, setInterfaceForm] = useState({ id: '', name: '', portKey: '', interfaceType: 'ETHERNET', description: '', adminUp: true, operUp: false, speedMbps: '', mode: 'ACCESS', accessVlanId: '', nativeVlanId: '', allowedVlanIds: [], macAddress: '' });
  const [modelForm, setModelForm] = useState({ manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '', iconAssetId: '' });
  const [layoutModel, setLayoutModel] = useState<Any>(null);
  const [layout, setLayout] = useState<Any>(null);
  const [layoutAssetId, setLayoutAssetId] = useState('');
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const clickRef = useRef({ key: '', at: 0 });

  const buildings = locations;
  const rooms = useMemo(() => buildingId ? locations.filter((b) => b.id === buildingId).flatMap((b) => (b.rooms ?? []).map((r: Any) => ({ ...r, building: b }))) : [], [locations, buildingId]);
  const selectedRack = racks.find((r) => r.id === rackId);
  const roomRacks = racks.filter((r) => (r.room?.id ?? r.roomId) === roomId);

  const load = async (id = siteId) => {
    if (!id) return;
    setBusy(true);
    try {
      const [locationsData, racksData, modelsData, assetsData, vlansData, devicesData] = await Promise.all([
        apiFetch(`/api/v1/sites/${id}/locations`),
        apiFetch(`/api/v1/sites/${id}/racks`),
        apiFetch('/api/v1/device-models'),
        apiFetch('/api/v1/assets'),
        apiFetch(`/api/v1/vlans?siteId=${id}&pageSize=500`),
        apiFetch(`/api/v1/devices?siteId=${id}&search=${encodeURIComponent(search)}&pageSize=100`),
      ]);
      setLocations(locationsData);
      setRacks(racksData);
      setModels(modelsData);
      setAssets(assetsData);
      setVlans(vlansData.items ?? vlansData ?? []);
      setDevices((devicesData.items ?? []).filter((d: Any) => d.status !== 'RETIRED'));
      const query = new URLSearchParams(location.search);
      const storedContext = readInfrastructureContext();
      const rack = racksData.find((r: Any) => r.id === query.get('rackId'));
      if (rack) {
        setBuildingId(rack.room?.building?.id ?? '');
        setRoomId(rack.room?.id ?? '');
        setRackId(rack.id);
      } else {
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
  useEffect(() => { if (siteId) void load(siteId); }, [siteId, search]);
  useEffect(() => {
    const openUpload = () => { setPendingUpload(null); setAssetName(''); setUploadModelId(''); setModal('asset-upload'); };
    window.addEventListener('asset-upload-request', openUpload);
    return () => window.removeEventListener('asset-upload-request', openUpload);
  }, []);

  const chooseSite = (id: string) => { setSiteId(id); localStorage.setItem('cociber.siteId', id); writeInfrastructureContext({ siteId: id, buildingId: '', roomId: '' }); setBuildingId(''); setRoomId(''); setRackId(''); setDevice(null); setSelectedInterface(null); history.replaceState({}, '', `/infraestrutura?siteId=${id}`); };
  const chooseBuilding = (id: string) => { if (id === '__new__') { setBuildingForm({ name: '', description: '' }); setModal('building'); return; } setBuildingId(id); setRoomId(''); setRackId(''); setDevice(null); writeInfrastructureContext({ siteId, buildingId: id, roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${id}`); };
  const chooseRoom = (id: string) => { if (id === '__new__') { setRoomForm({ name: '', buildingId: buildingId || buildings[0]?.id || '' }); setModal('room'); return; } const room = rooms.find((r: Any) => r.id === id); const nextBuilding = room?.building?.id || buildingId; setBuildingId(nextBuilding); setRoomId(id); setRackId(''); setDevice(null); writeInfrastructureContext({ siteId, buildingId: nextBuilding, roomId: id }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${nextBuilding}&roomId=${id}`); };
  const createBuilding = async () => { if (!buildingForm.name.trim()) return; try { await apiFetch(`/api/v1/sites/${siteId}/buildings`, { method: 'POST', body: JSON.stringify({ name: buildingForm.name.trim() }) }); const fresh = await apiFetch(`/api/v1/sites/${siteId}/locations`); setLocations(fresh); const created = fresh.find((b: Any) => b.name === buildingForm.name.trim()); setModal(''); if (created) { setBuildingId(created.id); setRoomId(''); writeInfrastructureContext({ siteId, buildingId: created.id, roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${created.id}`); } } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar o edifício.'); } };
  const createRoom = async () => { if (!roomForm.name.trim() || !roomForm.buildingId) return; try { await apiFetch(`/api/v1/buildings/${roomForm.buildingId}/rooms`, { method: 'POST', body: JSON.stringify({ name: roomForm.name.trim() }) }); const fresh = await apiFetch(`/api/v1/sites/${siteId}/locations`); setLocations(fresh); const created = fresh.flatMap((b: Any) => b.rooms ?? []).find((r: Any) => r.name === roomForm.name.trim() && r.buildingId === roomForm.buildingId); setModal(''); if (created) { setBuildingId(roomForm.buildingId); setRoomId(created.id); writeInfrastructureContext({ siteId, buildingId: roomForm.buildingId, roomId: created.id }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${roomForm.buildingId}&roomId=${created.id}`); } } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível criar a sala.'); } };
  const openDevice = async (d: Any) => { setDevice(d); setTab('interfaces'); setSelectedInterface(null); try { const list = await apiFetch(`/api/v1/interfaces?deviceId=${d.id}`); setInterfaces((list ?? []).sort(naturalInterfaceCompare)); } catch (e) { setError(e instanceof Error ? e.message : 'Não foi possível carregar as interfaces.'); } };
  const editDevice = async (d: Any) => { const full = await apiFetch(`/api/v1/devices/${d.id}`); setEditingId(full.id); setDeviceForm({ name: full.name ?? '', type: full.type ?? 'SWITCH', hostname: full.hostname ?? '', managementIp: full.managementIp ?? '', managementIpAddressId: full.ipAddresses?.find((i: Any) => i.address === full.managementIp)?.id ?? '', rackId: full.rackId ?? '', rackUnitStart: full.rackUnitStart ? String(full.rackUnitStart) : '', rackUnitSize: String(full.rackUnitSize ?? 1), modelId: full.modelId ?? full.model?.id ?? '', status: full.status ?? 'UNKNOWN', frontAssetId: full.frontAssetId ?? full.frontAsset?.id ?? '', iconAssetId: full.iconAssetId ?? full.iconAsset?.id ?? '' }); setModal('device'); };
  const editInterface = (i: Any) => { setSelectedInterface(i); setInterfaceForm({ ...interfaceForm, ...i, id: i.id, speedMbps: i.speedMbps ? String(i.speedMbps) : '', accessVlanId: i.accessVlanId ?? '', nativeVlanId: i.nativeVlanId ?? '', allowedVlanIds: (i.allowedVlans ?? []).map((v: Any) => v.vlanId) }); setModal('interface'); };
  const save = async (path: string, body: Any, method = editingId ? 'PATCH' : 'POST') => { try { await apiFetch(path, { method, body: JSON.stringify(body) }); setModal(''); setEditingId(''); await load(); if (device) await openDevice(device); } catch (e) { setError(e instanceof Error ? e.message : 'Operação falhou.'); } };
  const reset = () => { setBuildingId(''); setRoomId(''); setRackId(''); setDevice(null); setSelectedInterface(null); setInterfaces([]); setModal(''); writeInfrastructureContext({ siteId, buildingId: '', roomId: '' }); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}`); };
  const selectTab = (key: string) => { const now = Date.now(); const double = tab === key && clickRef.current.key === key && now - clickRef.current.at < 500; clickRef.current = { key, at: now }; if (double) { reset(); setTab(key); clickRef.current = { key: '', at: 0 }; } else setTab(key); };
  const newDevice = () => { setEditingId(''); setDeviceForm({ name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', frontAssetId: '', iconAssetId: '' }); setModal('device'); };
  const openLayout = async (model: Any) => { const data = await apiFetch(`/api/v1/device-models/${model.id}/port-layout`); setLayoutModel(model); setLayout(Array.isArray(data.portLayout?.ports) ? data.portLayout : { imageWidth: 1000, imageHeight: 300, ports: [] }); setLayoutAssetId(model.frontAssetId ?? model.frontAsset?.id ?? ''); setModal('layout'); };
  const detectLayout = async () => { if (!layoutModel) return; try { const proposal = await apiFetch(`/api/v1/device-models/${layoutModel.id}/port-layout/detect`, { method: 'POST', body: JSON.stringify({ assetId: layoutAssetId, portCount: layoutModel.networkPortCount ?? layoutModel.portCount, imageWidth: layout?.imageWidth, imageHeight: layout?.imageHeight }) }); setLayout(proposal); } catch (e) { setLayoutError(e instanceof Error ? e.message : 'A deteção falhou.'); } };
  const confirmLayout = async () => { if (!layoutModel || !layout) return; setLayoutSaving(true); setLayoutError(''); try { const ports = (layout.ports ?? []).map((p: Any, index: number) => ({ ...p, portKey: String(p.portKey || `ethernet1/${index + 1}`), label: String(p.label || p.portKey || `Porta ${index + 1}`), x: Math.max(0, Math.min(1, Number(p.x) || 0)), y: Math.max(0, Math.min(1, Number(p.y) || 0)), width: Math.max(.005, Math.min(1, Number(p.width) || .03)), height: Math.max(.005, Math.min(1, Number(p.height) || .3)) })); await apiFetch(`/api/v1/device-models/${layoutModel.id}/port-layout`, { method: 'PATCH', body: JSON.stringify({ ...layout, ports, assetId: layoutAssetId || null, confirmedAt: new Date().toISOString() }) }); setModal(''); setLayout(null); await load(); } catch (e) { setLayoutError(e instanceof Error ? e.message : 'Não foi possível guardar o template.'); } finally { setLayoutSaving(false); } };
  const generateInterfaces = async () => { if (device) { await apiFetch(`/api/v1/devices/${device.id}/interfaces/generate`, { method: 'POST' }); await openDevice(device); } };
  const submitUpload = async () => { if (!pendingUpload || !assetName.trim() || !uploadModelId) return; setUploading(true); try { const reader = new FileReader(); const contentBase64 = await new Promise<string>((resolve, reject) => { reader.onload = () => resolve(String(reader.result)); reader.onerror = reject; reader.readAsDataURL(pendingUpload); }); const asset = await apiFetch('/api/v1/assets', { method: 'POST', body: JSON.stringify({ filename: assetName.trim(), mimeType: pendingUpload.type, kind: 'INFRASTRUCTURE', contentBase64 }) }); await apiFetch(`/api/v1/device-models/${uploadModelId}/assets/front`, { method: 'POST', body: JSON.stringify({ assetId: asset.id }) }); setModal(''); await load(); } catch (e) { setError(e instanceof Error ? e.message : 'Upload falhou.'); } finally { setUploading(false); } };
  const deleteAsset = async (asset: Any) => {
    if (!window.confirm(`Eliminar o asset “${asset.filename}”? As associações visuais serão removidas.`)) return;
    try {
      await apiFetch(`/api/v1/assets/${asset.id}`, { method: 'DELETE' });
      await load();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Não foi possível eliminar o asset.');
    }
  };

  if (!siteId) return <AppShell section="Infraestrutura"><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Seleciona um Site para começar.</p></div></header><section className="ipam-card empty-context"><MapPinned size={28}/><strong>Seleciona um Site para começar</strong></section></main></AppShell>;
  currentDetect = detectLayout;
  currentConfirm = confirmLayout;
  currentEditInterface = editInterface;
  currentEditDevice = editDevice;
  const modalForEditor = modal === 'room' || modal === 'building' ? '' : modal;
  return <AppShell section="Infraestrutura"><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Site → edifício → sala → bastidor → equipamento → interfaces.</p></div><div className="workspace-actions">{canEdit && <><button className="secondary-button" onClick={() => setModal('model')}><Plus size={14}/> Novo modelo</button><button className="secondary-button" onClick={() => setModal('asset-upload')}><Upload size={14}/> Importar imagem</button></>}</div></header>{error && <div className="ipam-alert error"><X size={15}/>{error}</div>}<section className="infra-context-bar"><label><MapPinned size={15}/> Site<select value={siteId} onChange={(e) => chooseSite(e.target.value)}>{sites.map((s: Any) => <option key={s.id} value={s.id}>{s.name} · {s.code}</option>)}</select></label><label><MapPinned size={15}/> Edifício<select value={buildingId} onChange={(e) => chooseBuilding(e.target.value)}><option value="">Seleciona um edifício</option>{buildings.map((b: Any) => <option key={b.id} value={b.id}>{b.name}</option>)}{canEdit && <option value="__new__">Criar novo Edifício</option>}</select></label><label><MapPinned size={15}/> Sala<select value={roomId} onChange={(e) => chooseRoom(e.target.value)}><option value="">Seleciona uma sala</option>{rooms.map((r: Any) => <option key={r.id} value={r.id}>{r.name}</option>)}{canEdit && <option value="__new__">Criar nova Sala</option>}</select></label><span>{busy ? 'A carregar…' : `${racks.length} bastidores · ${devices.length} equipamentos ativos`}</span></section><nav className="infra-menu">{[['racks', 'Bastidores', MapPinned], ['devices', 'Equipamentos', Server], ['models', 'Modelos', Boxes], ['interfaces', 'Interfaces', Layers], ['assets', 'Assets', HardDrive]].map(([key, label, Icon]: Any) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => selectTab(key)}><Icon size={15}/><span>{label}</span></button>)}</nav>{tab === 'racks' && <RackWorkspace rooms={rooms} roomId={roomId} racks={roomRacks} selected={selectedRack} setRoom={(id: string) => { setRoomId(id); setRackId(''); }} setRack={(r: Any) => { setRoomId(r.room.id); setRackId(r.id); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${r.room?.building?.id ?? buildingId}&roomId=${r.room?.id ?? roomId}&rackId=${r.id}`); }} onOut={() => setRackId('')} onDevice={openDevice} onEdit={(r: Any) => { setEditingId(r.id ?? ''); setRackForm({ name: r.name ?? '', units: String(r.units ?? 42), roomId: r.room?.id ?? r.roomId ?? roomId, modelId: r.modelId ?? r.model?.id ?? '', frontAssetId: r.frontAssetId ?? r.frontAsset?.id ?? '' }); setModal('rack'); }} canEdit={canEdit}/>} {tab === 'devices' && <DeviceList devices={devices} search={search} setSearch={setSearch} onSelect={openDevice} onEdit={editDevice} onNew={newDevice} canEdit={canEdit}/>} {tab === 'models' && <ModelList models={models} onEdit={(m: Any) => { setEditingId(m.id); setModelForm({ manufacturer: m.manufacturer, model: m.model, type: m.type ?? 'OTHER', supportsNetworkPorts: !!m.supportsNetworkPorts, networkPortCount: String(m.networkPortCount ?? ''), frontAssetId: m.frontAssetId ?? m.frontAsset?.id ?? '', iconAssetId: m.iconAssetId ?? m.iconAsset?.id ?? '' }); setModal('model'); }} onLayout={openLayout} canEdit={canEdit}/>} {tab === 'assets' && <AssetList assets={assets} onDelete={deleteAsset} canEdit={canEdit} canDelete={hasRole('ADMIN')}/>} {tab === 'interfaces' && <InterfaceWorkspace devices={devices.filter((d: Any) => networkTypes.includes(d.type) && d.status !== 'RETIRED')} selected={device} interfaces={interfaces} selectedInterface={selectedInterface} onDevice={openDevice} onInterface={editInterface} onGenerate={generateInterfaces} onEditDevice={() => device && editDevice(device)}/>}<Editor modal={modalForEditor} close={() => setModal('')} editingId={editingId} form={{ rack: rackForm, device: deviceForm, interface: interfaceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, interface: setInterfaceForm, model: setModelForm }} rooms={rooms} racks={racks} models={models} assets={assets} vlans={vlans} ips={ips} save={save}/><BuildingModal modal={modal === 'building'} close={() => setModal('')} buildingForm={buildingForm} setBuildingForm={setBuildingForm} createBuilding={createBuilding}/><RoomModal modal={modal === 'room'} close={() => setModal('')} roomForm={roomForm} setRoomForm={setRoomForm} buildings={buildings} createRoom={createRoom}/><AssetUploadModal modal={modal === 'asset-upload'} close={() => setModal('')} file={pendingUpload} name={assetName} setName={setAssetName} modelId={uploadModelId} setModelId={setUploadModelId} models={models} choose={(e: Any) => { const file = e.target.files?.[0]; if (file) { setPendingUpload(file); setAssetName(file.name); } }} submit={submitUpload} busy={uploading}/><PortLayoutEditor modal={modal === 'layout'} close={() => setModal('')} layoutModel={layoutModel} layout={layout} setLayout={setLayout} assets={assets} assetId={layoutAssetId} setAssetId={setLayoutAssetId} detect={() => undefined} confirm={() => undefined} saving={layoutSaving} error={layoutError}/></main></AppShell>;
}
