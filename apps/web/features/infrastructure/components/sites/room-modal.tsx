'use client';

import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { Building } from '../../types';
import type { RoomForm } from '../../forms';
import { useUiText } from '@/components/ui/use-ui-text';

export interface RoomModalProps {
  modal: boolean | string;
  close: () => void;
  roomForm: RoomForm;
  setRoomForm: (form: RoomForm) => void;
  buildings: Building[];
  createRoom: () => void;
  editing?: boolean;
}

/** New room modal for a building of the current site. */
export function RoomModal({ modal, close, roomForm, setRoomForm, buildings, createRoom, editing = false }: RoomModalProps) {
  const ui = useUiText();
  if (!modal) return null;
  return <Modal title={editing ? ui('infrastructure.roomModal.editRoom') : ui('infrastructure.roomModal.createNewRoom')} close={close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); createRoom(); }}>
    <p className="form-help">{ui('infrastructure.roomModal.theRoomWillBeLinked')}</p>
    <label>{ui('infrastructure.roomModal.roomName')}<input required autoFocus value={roomForm.name} onChange={(event) => setRoomForm({ ...roomForm, name: event.target.value })} placeholder={ui('infrastructure.roomModal.eGServerRoom')} /></label>
    <label>{ui('infrastructure.roomModal.building')}<select required disabled={editing} value={roomForm.buildingId} onChange={(event) => setRoomForm({ ...roomForm, buildingId: event.target.value })}><option value="">{ui('infrastructure.roomModal.selectABuilding')}</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
    {!editing && !buildings.length && <div className="ipam-alert error">{ui('infrastructure.roomModal.thisSiteHasNoBuildings')}</div>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{ui('infrastructure.roomModal.cancel')}</button><button type="submit" className="primary-button" disabled={!roomForm.name.trim() || !roomForm.buildingId || !buildings.length}><Check size={14} /> {editing ? ui('infrastructure.roomModal.saveChanges') : ui('infrastructure.roomModal.createRoom')}</button></div>
  </form></Modal>;
}
