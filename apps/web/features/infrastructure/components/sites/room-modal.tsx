'use client';

import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { Building } from '../../types';
import type { RoomForm } from '../../forms';

export interface RoomModalProps {
  modal: boolean | string;
  close: () => void;
  roomForm: RoomForm;
  setRoomForm: (form: RoomForm) => void;
  buildings: Building[];
  createRoom: () => void;
}

/** New room modal for a building of the current site. */
export function RoomModal({ modal, close, roomForm, setRoomForm, buildings, createRoom }: RoomModalProps) {
  if (!modal) return null;
  return <Modal title="Criar nova sala" close={close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); createRoom(); }}>
    <p className="form-help">A sala ficará associada ao edifício escolhido dentro do Site atual.</p>
    <label>Nome da sala<input required autoFocus value={roomForm.name} onChange={(event) => setRoomForm({ ...roomForm, name: event.target.value })} placeholder="Ex.: Sala de servidores" /></label>
    <label>Edifício<select required value={roomForm.buildingId} onChange={(event) => setRoomForm({ ...roomForm, buildingId: event.target.value })}><option value="">Seleciona um edifício</option>{buildings.map((building) => <option key={building.id} value={building.id}>{building.name}</option>)}</select></label>
    {!buildings.length && <div className="ipam-alert error">Este Site ainda não tem edifícios. Cria primeiro um edifício para poderes adicionar uma sala.</div>}
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={!roomForm.name.trim() || !roomForm.buildingId || !buildings.length}><Check size={14} /> Criar sala</button></div>
  </form></Modal>;
}
