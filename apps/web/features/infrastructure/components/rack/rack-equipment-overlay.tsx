'use client';

import { EquipmentTypeIcon } from '../equipment-type-icon';
import { RACK_UNITS, RACK_VIEWPORT, rackUnitFromDrop } from '../../utils';
import type { Rack } from '../../types';
import { AssetImage } from '../asset-image';

export interface RackEquipmentOverlayProps {
  rack: Rack;
  onSelect: (deviceId: string) => void;
  onDropDevice: (deviceId: string, rackUnitStart: number) => void;
  draggingDeviceId: string;
  onDragging: (deviceId: string) => void;
  canEdit: boolean;
  pendingDeviceId?: string;
}

/** Interactive overlay over the 42U rack picture in the rack detail view. */
export function RackEquipmentOverlay({ rack, onSelect, onDropDevice, draggingDeviceId, onDragging, canEdit, pendingDeviceId }: RackEquipmentOverlayProps) {
  const placed = (rack.devices ?? []).filter((device) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return Number.isFinite(start) && start >= 1 && start + size - 1 <= RACK_UNITS;
  });

  return <div className={`rack-overlay-area${canEdit ? ' equipment-drop-zone' : ''}`} style={{ left: `${RACK_VIEWPORT.left * 100}%`, top: `${RACK_VIEWPORT.top * 100}%`, width: `${RACK_VIEWPORT.width * 100}%`, height: `${RACK_VIEWPORT.height * 100}%` }} onDragOver={(event) => {
    if (canEdit) {
      event.preventDefault();
      event.dataTransfer.dropEffect = 'move';
    }
  }} onDrop={(event) => {
    if (!canEdit) return;
    event.preventDefault();
    const id = event.dataTransfer.getData('application/x-device-id') || event.dataTransfer.getData('text/plain');
    const size = Number(event.dataTransfer.getData('application/x-device-size')) || 1;
    if (id) void onDropDevice(id, rackUnitFromDrop(event, rack.units ?? RACK_UNITS, size));
    onDragging('');
  }}>
    {placed.map((device) => {
      const start = Number(device.rackUnitStart);
      const size = Math.max(1, Number(device.rackUnitSize) || 1);
      const end = start + size - 1;
      const top = ((RACK_UNITS - end) / RACK_UNITS) * 100;
      const height = (size / RACK_UNITS) * 100;
      const visual = device.frontAsset || device.model?.frontAsset;
      return <button type="button" key={device.id} draggable={canEdit} className={`rack-overlay rack-${String(device.type || 'other').toLowerCase()}${draggingDeviceId === device.id ? ' moving' : ''}${pendingDeviceId === device.id ? ' pending-placement' : ''}`} style={{ top: `${top}%`, height: `${height}%` }} onKeyDown={(event) => {
        if (!canEdit) return;
        if (event.key === 'ArrowUp') { event.preventDefault(); void onDropDevice(device.id, start + 1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); void onDropDevice(device.id, start - 1); }
      }} onDragStart={(event) => {
        const bounds = event.currentTarget.getBoundingClientRect();
        const offset = Math.max(0, Math.min(size - 1, Math.floor(((event.clientY - bounds.top) / bounds.height) * size)));
        event.dataTransfer.effectAllowed = 'move';
        event.dataTransfer.setData('text/plain', device.id);
        event.dataTransfer.setData('application/x-device-id', device.id);
        event.dataTransfer.setData('application/x-device-size', String(size));
        event.dataTransfer.setData('application/x-rack-offset', String(offset));
        onDragging(device.id);
      }} onDragEnd={() => window.setTimeout(() => onDragging(''), 0)} onClick={() => {
        if (!draggingDeviceId) onSelect(device.id);
      }} aria-label={`${canEdit ? 'Arrastar ou abrir' : 'Abrir'} ${device.name}, U${start}${size > 1 ? ` a U${end}` : ''}`}>
      <span className="rack-device-media">{visual ? <AssetImage asset={visual} alt={`Vista frontal de ${device.name}`} /> : <EquipmentTypeIcon type={device.type} alt={`Ícone de ${device.type}`} className="rack-device-type-icon" />}</span>
      <span className="rack-equipment-tooltip" role="tooltip"><strong>{device.name}</strong><span><small>Localização:</small><b>{rack.name}</b></span><span><small>U:</small><b>{size > 1 ? `U${start}–U${end}` : `U${start}`}</b></span><span><small>IP Management:</small><b>{device.managementIp || 'não definido'}</b></span><span><small>Status:</small><b>{String(device.status || 'unknown').toLowerCase()}</b></span></span>
    </button>;
    })}
  </div>;
}
