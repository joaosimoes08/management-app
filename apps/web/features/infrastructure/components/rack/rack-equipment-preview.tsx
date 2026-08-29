'use client';

import { EquipmentTypeIcon } from '../equipment-type-icon';
import { RACK_UNITS, RACK_VIEWPORT, rackUnitFromDrop } from '../../utils';
import type { Rack } from '../../types';
import { AssetImage } from '../asset-image';

export interface RackEquipmentPreviewProps {
  rack: Rack;
  /** All racks of the room, used by the keyboard arrows to move devices sideways. */
  racks: Rack[];
  reordering?: boolean;
  movingDeviceId?: string;
  onMove: (deviceId: string, targetRackId: string, rackUnitStart: number) => Promise<void>;
  onMoving: (deviceId: string) => void;
}

/**
 * The zone over the rack picture where placed devices are rendered.
 * In reordering mode devices can be dragged to another rack or rack unit.
 */
export function RackEquipmentPreview({ rack, racks, reordering = false, movingDeviceId = '', onMove, onMoving }: RackEquipmentPreviewProps) {
  const placed = (rack.devices ?? []).filter((device) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return Number.isFinite(start) && start >= 1 && start + size - 1 <= RACK_UNITS;
  });

  return <span
    className={`rack-preview-overlay-area${reordering ? ' equipment-drop-zone' : ''}`}
    aria-hidden={reordering ? undefined : 'true'}
    onDragOver={(event) => {
      if (reordering) {
        event.preventDefault();
        event.dataTransfer.dropEffect = 'move';
      }
    }}
    onDrop={(event) => {
      if (!reordering) return;
      event.preventDefault();
      const deviceId = event.dataTransfer.getData('application/x-device-id') || event.dataTransfer.getData('text/plain');
      const device = placed.find((item) => item.id === deviceId)
        ?? ({ rackUnitSize: Number(event.dataTransfer.getData('application/x-device-size')) || 1 });
      if (deviceId) void onMove(deviceId, rack.id, rackUnitFromDrop(event, rack.units ?? RACK_UNITS, Number(device.rackUnitSize) || 1));
      onMoving('');
    }}
    style={{ left: `${RACK_VIEWPORT.left * 100}%`, top: `${RACK_VIEWPORT.top * 100}%`, width: `${RACK_VIEWPORT.width * 100}%`, height: `${RACK_VIEWPORT.height * 100}%` }}
  >
    {placed.map((device) => {
      const start = Number(device.rackUnitStart);
      const size = Math.max(1, Number(device.rackUnitSize) || 1);
      const end = start + size - 1;
      const top = ((RACK_UNITS - end) / RACK_UNITS) * 100;
      const height = (size / RACK_UNITS) * 100;
      const visual = device.frontAsset || device.model?.frontAsset;
      return <span className={`rack-preview-device${movingDeviceId === device.id ? ' moving' : ''}`} key={device.id} style={{ top: `${top}%`, height: `${height}%` }} draggable={reordering} role={reordering ? 'button' : undefined} tabIndex={reordering ? 0 : undefined} aria-label={reordering ? `Mover ${device.name}, atualmente em U${start}` : undefined} onKeyDown={(event) => {
        if (!reordering) return;
        const rackIndex = racks.findIndex((item) => item.id === rack.id);
        if (event.key === 'ArrowUp') { event.preventDefault(); void onMove(device.id, rack.id, start + 1); }
        if (event.key === 'ArrowDown') { event.preventDefault(); void onMove(device.id, rack.id, start - 1); }
        if (event.key === 'ArrowLeft' && rackIndex > 0) { event.preventDefault(); void onMove(device.id, racks[rackIndex - 1].id, start); }
        if (event.key === 'ArrowRight' && rackIndex < racks.length - 1) { event.preventDefault(); void onMove(device.id, racks[rackIndex + 1].id, start); }
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
