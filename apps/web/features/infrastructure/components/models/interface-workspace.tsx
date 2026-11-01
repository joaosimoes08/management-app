'use client';

import { Edit3, Layers, Plus, Server } from 'lucide-react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import type { Device, DeviceInterface } from '../../types';
import { deviceFrontImage, normalizedPortLayoutPorts } from '../../utils';
import { AssetImage } from '../asset-image';
import type { TopologyConnection } from '@/features/topology/types';

export interface InterfaceWorkspaceProps {
  devices: Device[];
  selected: Device | null;
  interfaces: DeviceInterface[];
  selectedInterface: DeviceInterface | null;
  connections: TopologyConnection[];
  connectionsLoading: boolean;
  connectionsError: boolean;
  onDevice: (device: Device) => void;
  onInterface: (item: DeviceInterface) => void;
  onGenerate: () => void;
  onEditDevice: () => void;
}

function InterfaceCard({ interfaceData, selected, onEdit }: { interfaceData: DeviceInterface; selected: boolean; onEdit: (item: DeviceInterface) => void }) {
  const open = () => onEdit(interfaceData);
  return <article className={`interface-row ${selected ? 'selected' : ''}`} role="button" tabIndex={0} onClick={open} onKeyDown={(event) => { if (event.key === 'Enter' || event.key === ' ') { event.preventDefault(); open(); } }}><span className={`port-dot ${interfaceData.operUp ? 'up' : ''}`} /><span className="interface-row-summary"><strong>{interfaceData.name}</strong><small>{interfaceData.interfaceType || 'Ethernet'} · {interfaceData.mode || 'sem modo'} · {interfaceData.description || 'sem descrição'}</small></span><em>{interfaceData.accessVlan ? `VLAN ${interfaceData.accessVlan.vlanId}` : 'sem VLAN'}</em></article>;
}

function renderHotspots(device: Device, interfaces: DeviceInterface[], onInterface: (item: DeviceInterface) => void) {
  return normalizedPortLayoutPorts(device).map((port) => {
    const item = interfaces.find((candidate) => candidate.portKey === port.portKey || candidate.name === port.portKey);
    return <button key={port.portKey} className={`port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} title={port.label} onClick={() => { if (item) onInterface(item); }}>{port.label}</button>;
  });
}

/** Interfaces tab: device picker, switch face with hotspots and interface list. */
export function InterfaceWorkspace({ devices, selected, interfaces, selectedInterface, connections, connectionsLoading, connectionsError, onDevice, onInterface, onGenerate, onEditDevice }: InterfaceWorkspaceProps) {
  const selectedImage = selected ? deviceFrontImage(selected) : null;
  const relatedConnections = selected ? connections.filter((connection) => connection.sourceDeviceId === selected.id || connection.targetDeviceId === selected.id) : [];
  return <section className="ipam-card interfaces-workspace">
    <div className="panel-heading"><div><span className="section-kicker">PORTAS E CONFIGURAÇÃO</span><h2>Interfaces de rede</h2></div>{selected && <div className="button-row"><button className="secondary-button" onClick={onGenerate}><Plus size={14} /> Gerar interfaces</button><button className="secondary-button" onClick={onEditDevice}><Edit3 size={14} /> Editar equipamento</button></div>}</div>
    <div className="interface-device-list">{devices.map((device) => <button key={device.id} className={`interface-device ${selected?.id === device.id ? 'active' : ''}`} onClick={() => onDevice(device)}><EquipmentTypeIcon type={device.type} className="interface-device-type-icon" /><span><strong>{device.name}</strong><small>{device.model ? `${device.model.manufacturer} ${device.model.model}` : device.type} · {device.managementIp || 'sem IP'}</small></span><em>{device.status}</em></button>)}</div>
    {!selected && <div className="empty-context"><Layers size={26} /><strong>Seleciona um equipamento</strong><span>Todos os equipamentos ativos com interfaces configuráveis aparecem aqui.</span></div>}
    {selected && <div className="interface-detail">
      <div className="switch-face-container">{selectedImage ? <div className="switch-face-image"><AssetImage asset={selectedImage} alt={`Imagem de ${selected.name}`} />{renderHotspots(selected, interfaces, onInterface)}</div> : <div className="switch-face-fallback"><Server size={28} /><strong>{selected.name}</strong><span>Associa uma imagem e mapeia as portas no modelo.</span></div>}</div>
      <div className="interface-list">{interfaces.map((item) => <InterfaceCard key={item.id} interfaceData={item} selected={selectedInterface?.id === item.id} onEdit={onInterface} />)}{!interfaces.length && <div className="no-data">Ainda não existem interfaces. Usa “Gerar interfaces”.</div>}</div>
    </div>}
    {selected && <section className="ipam-card" aria-labelledby="device-connections-heading" style={{ marginTop: 16 }}><div className="panel-heading"><div><span className="section-kicker">CABLAGEM E PERCURSOS</span><h2 id="device-connections-heading">Ligações físicas</h2></div></div>{connectionsLoading ? <p role="status">A carregar ligações…</p> : connectionsError ? <p role="alert">Não foi possível carregar as ligações deste equipamento.</p> : relatedConnections.length === 0 ? <div className="no-data">Ainda não há ligações documentadas ou observadas para este equipamento.</div> : <div style={{ display: 'grid', gap: 10 }}>{relatedConnections.map((connection) => <article key={connection.id} style={{ border: '1px solid var(--border, #dbe1e8)', borderRadius: 8, padding: 12 }}><div style={{ display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', gap: 8 }}><strong>{connection.sourceDevice?.name ?? connection.sourceDeviceId} · {connection.sourceInterface?.name ?? 'porta não indicada'} → {connection.targetDevice?.name ?? connection.targetDeviceId} · {connection.targetInterface?.name ?? 'porta não indicada'}</strong><span>{connection.source === 'MANUAL' ? 'Documentada' : `Observada (${connection.source ?? 'origem desconhecida'})`}</span></div><small>{connection.sourceDevice?.rack?.name ?? 'Sem bastidor'} → {connection.targetDevice?.rack?.name ?? 'Sem bastidor'}{connection.label ? ` · ${connection.label}` : ''}</small>{connection.notes && <p style={{ margin: '6px 0 0' }}>{connection.notes}</p>}</article>)}</div>}</section>}
  </section>;
}
