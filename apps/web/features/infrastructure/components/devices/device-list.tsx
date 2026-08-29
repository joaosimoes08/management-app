'use client';

import { Edit3, Plus, Server } from 'lucide-react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import type { Device } from '../../types';

export interface DeviceListProps {
  devices: Device[];
  search: string;
  onSelect: (device: Device) => void;
  onEdit: (device: Device) => void;
  onNew: () => void;
  canEdit: boolean;
}

/** Active device inventory of the site. */
export function DeviceList({ devices, search, onSelect, onEdit, onNew, canEdit }: DeviceListProps) {
  return <section className="ipam-card">
    <div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO OPERACIONAL</span><h2>Equipamentos ativos</h2></div>{canEdit && <button className="primary-button" onClick={onNew}><Plus size={14} /> Adicionar equipamento</button>}</div>
    {devices.map((device) => <div className="host-row infra-device-row" key={device.id} onClick={() => onSelect(device)}>
      <span className="host-icon equipment-type-icon-frame"><EquipmentTypeIcon type={device.type} /></span>
      <span><strong>{device.name}</strong><small>{device.type} · {device.model ? `${device.model.manufacturer} ${device.model.model}` : 'Sem modelo'} · {device.managementIp || 'Sem IP de gestão'} · {device.rack ? `${device.rack.name} / ${device.rackUnitStart ?? '?'}U` : 'Por localizar'}</small></span>
      <em className="status-active">{device.status}</em>
      {canEdit && <button className="icon-button subtle" onClick={(event) => { event.stopPropagation(); onEdit(device); }}><Edit3 size={14} /></button>}
    </div>)}
    {!devices.length && <div className="empty-context"><Server size={26} /><strong>{search ? 'Sem equipamentos correspondentes' : 'Não existem equipamentos ativos neste Site'}</strong></div>}
  </section>;
}
