'use client';

import { Edit3, MapPinned } from 'lucide-react';
import type { BuildingWithRooms, RoomWithBuilding } from '../types';

type LocationControlsProps = {
  buildings: BuildingWithRooms[];
  rooms: RoomWithBuilding[];
  buildingId: string;
  roomId: string;
  /** `'__new__'` asks for the create form. */
  chooseBuilding: (id: string) => void;
  chooseRoom: (id: string) => void;
  canCreateBuilding: boolean;
  canCreateRoom: boolean;
  canUpdateBuilding: boolean;
  canUpdateRoom: boolean;
  onEditBuilding: (building: BuildingWithRooms) => void;
  onEditRoom: (room: RoomWithBuilding) => void;
  busy: boolean;
};

/** Edifício / Sala pickers in the shell toolbar (every tab except Sites). */
export function LocationControls({ buildings, rooms, buildingId, roomId, chooseBuilding, chooseRoom, canCreateBuilding, canCreateRoom, canUpdateBuilding, canUpdateRoom, onEditBuilding, onEditRoom, busy }: LocationControlsProps) {
  return <section className="infra-context-bar" aria-label="Localização">
    <div className="location-control-group">
      <label><MapPinned size={15} /><span className="toolbar-filter-label">Edifício</span><select aria-label="Edifício" title="Edifício" value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}><option value="">Seleciona um edifício</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateBuilding && <option value="__new__">Criar novo Edifício</option>}</select></label>
      {canUpdateBuilding && <button type="button" className="secondary-button compact-button" aria-label="Editar edifício" onClick={() => { const building = buildings.find((item) => item.id === buildingId); if (!building) return; onEditBuilding(building); }}><Edit3 size={14} /></button>}
    </div>
    <div className="location-control-group">
      <label><MapPinned size={15} /><span className="toolbar-filter-label">Sala</span><select aria-label="Sala" title="Sala" value={roomId} onChange={(event) => chooseRoom(event.target.value)}><option value="">Seleciona uma sala</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateRoom && <option value="__new__">Criar nova Sala</option>}</select></label>
      {canUpdateRoom && <button type="button" className="secondary-button compact-button" aria-label="Editar sala" onClick={() => { const room = rooms.find((item) => item.id === roomId); if (!room) return; onEditRoom(room); }}><Edit3 size={14} /></button>}
    </div>
    {busy && <span className="infra-loading-status" role="status">A carregar…</span>}
  </section>;
}
