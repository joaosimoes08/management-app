'use client';

import { Edit3, MapPinned } from 'lucide-react';
import type { BuildingWithRooms, RoomWithBuilding } from '../types';
import { useUiText } from '@/components/ui/use-ui-text';

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
  const ui = useUiText();
  return <section className="infra-context-bar" aria-label={ui('infrastructure.locationControls.location')}>
    <div className="location-control-group">
      <label><MapPinned size={15} /><span className="toolbar-filter-label">{ui('infrastructure.locationControls.building')}</span><select aria-label={ui('infrastructure.locationControls.building')} title={ui('infrastructure.locationControls.building')} value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}><option value="">{ui('infrastructure.locationControls.selectABuilding')}</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateBuilding && <option value="__new__">{ui('infrastructure.locationControls.createNewBuilding')}</option>}</select></label>
      {canUpdateBuilding && <button type="button" className="secondary-button compact-button" aria-label={ui('infrastructure.locationControls.editBuilding')} onClick={() => { const building = buildings.find((item) => item.id === buildingId); if (!building) return; onEditBuilding(building); }}><Edit3 size={14} /></button>}
    </div>
    <div className="location-control-group">
      <label><MapPinned size={15} /><span className="toolbar-filter-label">{ui('infrastructure.locationControls.room')}</span><select aria-label={ui('infrastructure.locationControls.room')} title={ui('infrastructure.locationControls.room')} value={roomId} onChange={(event) => chooseRoom(event.target.value)}><option value="">{ui('infrastructure.locationControls.selectARoom')}</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateRoom && <option value="__new__">{ui('infrastructure.locationControls.createNewRoom')}</option>}</select></label>
      {canUpdateRoom && <button type="button" className="secondary-button compact-button" aria-label={ui('infrastructure.locationControls.editRoom')} onClick={() => { const room = rooms.find((item) => item.id === roomId); if (!room) return; onEditRoom(room); }}><Edit3 size={14} /></button>}
    </div>
    {busy && <span className="infra-loading-status" role="status">{ui('infrastructure.locationControls.loading')}</span>}
  </section>;
}
