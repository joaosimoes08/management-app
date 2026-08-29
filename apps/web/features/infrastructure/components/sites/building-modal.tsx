'use client';

import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { BuildingForm } from '../../forms';

export interface BuildingModalProps {
  modal: boolean | string;
  close: () => void;
  buildingForm: BuildingForm;
  setBuildingForm: (form: BuildingForm) => void;
  createBuilding: () => void;
}

/** New building modal for the current site. */
export function BuildingModal({ modal, close, buildingForm, setBuildingForm, createBuilding }: BuildingModalProps) {
  if (!modal) return null;
  return <Modal title="Criar novo edifício" close={close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); createBuilding(); }}>
    <p className="form-help">O edifício ficará associado ao Site selecionado.</p>
    <label>Nome do edifício<input required autoFocus value={buildingForm.name} onChange={(event) => setBuildingForm({ ...buildingForm, name: event.target.value })} placeholder="Ex.: Edifício principal" /></label>
    <label>Localização / descrição<input value={buildingForm.description} onChange={(event) => setBuildingForm({ ...buildingForm, description: event.target.value })} placeholder="Ex.: Campus ou zona" /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="submit" className="primary-button" disabled={!buildingForm.name.trim()}><Check size={14} /> Criar edifício</button></div>
  </form></Modal>;
}
