'use client';

import { Edit3, Layers, Plus, Server } from 'lucide-react';
import type { Device, DeviceInterface } from '../../types';
import { deviceFaceImage, normalizedPortLayoutPorts, primaryPortFace } from '../../utils';
import { AssetImage } from '../asset-image';
import { PageToolbarPortal } from '@/components/layout/app-shell';

export interface InterfaceWorkspaceProps {
  devices: Device[];
  selected: Device | null;
  interfaces: DeviceInterface[];
  selectedInterface: DeviceInterface | null;
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
  return normalizedPortLayoutPorts(device, primaryPortFace(device.model)).map((port) => {
    const item = interfaces.find((candidate) => candidate.portKey === port.portKey || candidate.name === port.portKey);
    return <button key={port.portKey} className={`port-hotspot ${item?.operUp ? 'up' : ''}`} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} title={port.label} onClick={() => { if (item) onInterface(item); }}>{port.label}</button>;
  });
}

/** Interfaces tab: device picker, switch face with hotspots and interface list. */
export function InterfaceWorkspace({ devices, selected, interfaces, selectedInterface, onDevice, onInterface, onGenerate, onEditDevice }: InterfaceWorkspaceProps) {
  // The face that carries the mapped ports, so hotspots sit on the image they were drawn on.
  const selectedImage = selected ? deviceFaceImage(selected, primaryPortFace(selected.model)) : null;
  return <section className="ipam-card interfaces-workspace">
    <div className="panel-heading"><div><span className="section-kicker">PORTAS E CONFIGURAÇÃO</span><h2>Interfaces de rede</h2></div></div><PageToolbarPortal><div className="interface-toolbar-controls"><label>Equipamento<select aria-label="Equipamento para gerir interfaces" value={selected?.id ?? ''} onChange={(event) => { const device = devices.find((item) => item.id === event.target.value); if (device) onDevice(device); }}><option value="">Seleciona um equipamento</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name} · {device.managementIp || 'sem IP'}</option>)}</select></label>{selected && <><button className="secondary-button" onClick={onGenerate}><Plus size={14} /> Gerar interfaces</button><button className="secondary-button" onClick={onEditDevice}><Edit3 size={14} /> Editar equipamento</button></>}</div></PageToolbarPortal>
    {!selected && <div className="empty-context"><Layers size={26} /><strong>Seleciona um equipamento</strong><span>Todos os equipamentos ativos com interfaces configuráveis aparecem aqui.</span></div>}
    {selected && <div className="interface-detail">
      <div className="switch-face-container">{selectedImage ? <div className="switch-face-image"><AssetImage asset={selectedImage} alt={`Imagem de ${selected.name}`} />{renderHotspots(selected, interfaces, onInterface)}</div> : <div className="switch-face-fallback"><Server size={28} /><strong>{selected.name}</strong><span>Associa uma imagem e mapeia as portas no modelo.</span></div>}</div>
      <div className="interface-list">{interfaces.map((item) => <InterfaceCard key={item.id} interfaceData={item} selected={selectedInterface?.id === item.id} onEdit={onInterface} />)}{!interfaces.length && <div className="no-data">Ainda não existem interfaces. Usa “Gerar interfaces”.</div>}</div>
    </div>}
  </section>;
}
