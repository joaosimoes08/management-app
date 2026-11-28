'use client';

import { Check } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { BuildingForm } from '../../forms';
import { useUiText } from '@/components/ui/use-ui-text';

export interface BuildingModalProps {
  modal: boolean | string;
  close: () => void;
  buildingForm: BuildingForm;
  setBuildingForm: (form: BuildingForm) => void;
  createBuilding: () => void;
  editing?: boolean;
}

/** New building modal for the current site. */
export function BuildingModal({ modal, close, buildingForm, setBuildingForm, createBuilding, editing = false }: BuildingModalProps) {
  const ui = useUiText();
  if (!modal) return null;
  return <Modal title={editing ? ui('infrastructure.buildingModal.editBuilding') : ui('infrastructure.buildingModal.createNewBuilding')} close={close}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); createBuilding(); }}>
    <p className="form-help">{ui('infrastructure.buildingModal.theBuildingWillBeLinked')}</p>
    <label>{ui('infrastructure.buildingModal.buildingName')}<input required autoFocus value={buildingForm.name} onChange={(event) => setBuildingForm({ ...buildingForm, name: event.target.value })} placeholder={ui('infrastructure.buildingModal.eGMainBuilding')} /></label>
    <label>{ui('infrastructure.buildingModal.locationDescription')}<input value={buildingForm.description} onChange={(event) => setBuildingForm({ ...buildingForm, description: event.target.value })} placeholder={ui('infrastructure.buildingModal.eGCampusOrZone')} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{ui('infrastructure.buildingModal.cancel')}</button><button type="submit" className="primary-button" disabled={!buildingForm.name.trim()}><Check size={14} /> {editing ? ui('infrastructure.buildingModal.saveChanges') : ui('infrastructure.buildingModal.createBuilding')}</button></div>
  </form></Modal>;
}
