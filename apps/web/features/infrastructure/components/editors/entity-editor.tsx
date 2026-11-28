'use client';

import { Modal } from '@/components/ui/modal';
import { EQUIPMENT_TYPES } from '../../utils';
import { emptyRackPower, type DeviceForm, type ModelForm, type RackForm } from '../../forms';
import type { AssetFile, DeviceModel, IpAddress, Rack, RoomWithBuilding } from '../../types';
import { AssetUploadPicker, FormError, ModalActions } from './editor-shared';
import { DeviceEditor } from './device-editor';
import type { DeviceEditorTab, MappedFieldError } from '../../device-requirements';
import { RackPowerFields, type RackPowerFieldsProps } from './rack-power-fields';
import { useUiText } from '@/components/ui/use-ui-text';

export interface EntityEditorProps {
  modal: string;
  close: () => void;
  editingId: string;
  animateDeviceEntry?: boolean;
  form: { rack: RackForm; device: DeviceForm; model: ModelForm };
  setForm: {
    rack: React.Dispatch<React.SetStateAction<RackForm>>;
    device: React.Dispatch<React.SetStateAction<DeviceForm>>;
    model: React.Dispatch<React.SetStateAction<ModelForm>>;
  };
  rooms: RoomWithBuilding[];
  racks: Rack[];
  models: DeviceModel[];
  assets: AssetFile[];
  ips: IpAddress[];
  save: (path: string, body: Record<string, unknown>, method?: string) => Promise<void>;
  /** API error from the last save, shown inside the open form. */
  formError?: string;
  /** Rack saves go through here when set (rack + its power settings, with the 409 handling). */
  saveRack?: () => Promise<void>;
  /** Devices that stop the rack's power change, and the "Desligar todos da UPS" action. */
  rackPower?: Pick<RackPowerFieldsProps, 'blocked' | 'onDisconnectAllUps' | 'disconnecting'>;
  /** Opens the power step of the device being edited (shown for a device in a rack when the user may change power). */
  onDevicePower?: () => void;
  /** Device editor: API field errors from the last save, and the tab to open on (deep link). */
  deviceFieldErrors?: MappedFieldError[];
  deviceTab?: DeviceEditorTab;
}

/** Device, rack and model create/edit modals (the interface modal lives in InterfaceEditor). */
export function EntityEditor({ modal, close, editingId, animateDeviceEntry = false, form, setForm, rooms, racks, models, assets, ips, save, formError = '', saveRack, rackPower, onDevicePower, deviceFieldErrors, deviceTab }: EntityEditorProps) {
  const ui = useUiText();
  if (!modal || modal === 'layout') return null;

  if (modal === 'device') return <DeviceEditor key={editingId || 'new'} close={close} editingId={editingId} animateEntry={animateDeviceEntry} form={form.device} setForm={setForm.device} racks={racks} models={models} assets={assets} ips={ips} save={save} formError={formError} fieldErrors={deviceFieldErrors} initialTab={deviceTab} onDevicePower={onDevicePower} />;

  if (modal === 'rack') return <Modal title={editingId ? ui('infrastructure.entityEditor.editRack') : ui('infrastructure.entityEditor.newRack')} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    if (saveRack) { void saveRack(); return; }
    void save(editingId ? `/api/v1/racks/${editingId}` : '/api/v1/racks', { name: form.rack.name, roomId: form.rack.roomId });
  }}>
    <p className="form-help">{ui('infrastructure.entityEditor.allRacksUseTheFixed')}</p>
    <label>{ui('infrastructure.entityEditor.name')}<input required value={form.rack.name} onChange={(event) => setForm.rack({ ...form.rack, name: event.target.value })} /></label>
    <label>{ui('infrastructure.entityEditor.room')}<select required value={form.rack.roomId} onChange={(event) => setForm.rack({ ...form.rack, roomId: event.target.value })}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.building.name} / {room.name}</option>)}</select></label>
    {saveRack && <RackPowerFields value={form.rack.power ?? emptyRackPower()} onChange={(power) => setForm.rack({ ...form.rack, power })} {...rackPower} />}
    <FormError message={formError} />
    <ModalActions close={close} />
  </form></Modal>;

  // The front image is required to create a model; an edit only may not remove one that exists.
  const editedModel = editingId ? models.find((model) => model.id === editingId) : undefined;
  const storedFront = editedModel ? editedModel.frontAssetId ?? editedModel.frontAsset?.id ?? '' : '';
  const frontRequired = !editingId || Boolean(storedFront);
  const missingFrontWarning = editingId && !storedFront && !form.model.frontAssetId ? ui('infrastructure.entityEditor.noFrontImageAddOne') : undefined;
  return <Modal title={editingId ? ui('infrastructure.entityEditor.editModel') : ui('infrastructure.entityEditor.newModel')} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    const { frontAssetId, backAssetId, ...modelPayload } = form.model;
    void save(editingId ? `/api/v1/device-models/${editingId}` : '/api/v1/device-models', {
      ...modelPayload,
      networkPortCount: form.model.networkPortCount ? Number(form.model.networkPortCount) : null,
      ...(frontAssetId ? { frontAssetId } : {}),
      backAssetId: backAssetId || null,
    });
  }}>
    <div className="form-row">
      <label>{ui('infrastructure.entityEditor.manufacturer')}<input required value={form.model.manufacturer} onChange={(event) => setForm.model({ ...form.model, manufacturer: event.target.value })} /></label>
      <label>{ui('infrastructure.entityEditor.model')}<input required value={form.model.model} onChange={(event) => setForm.model({ ...form.model, model: event.target.value })} /></label>
    </div>
    <label>{ui('infrastructure.entityEditor.type')}<select value={form.model.type} onChange={(event) => setForm.model({ ...form.model, type: event.target.value })}>{EQUIPMENT_TYPES.map((option) => <option key={option}>{option}</option>)}</select></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.model.supportsNetworkPorts} onChange={(event) => setForm.model({ ...form.model, supportsNetworkPorts: event.target.checked })} /> {ui('infrastructure.entityEditor.hasConfigurableNetworkPorts')}</label>
    <label>{ui('infrastructure.entityEditor.networkPorts')}<input type="number" min="1" value={form.model.networkPortCount} onChange={(event) => setForm.model({ ...form.model, networkPortCount: event.target.value })} /></label>
    <div className="model-face-images">
      <AssetUploadPicker label={ui('infra.model.frontImage')} required={frontRequired} value={form.model.frontAssetId} assets={assets} onChange={(value) => setForm.model({ ...form.model, frontAssetId: value })} help={frontRequired ? ui('infra.model.frontImageRequiredHelp') : ui('infra.model.frontImageHelp')} warning={missingFrontWarning} />
      <AssetUploadPicker label={ui('infra.model.rearImage')} value={form.model.backAssetId} assets={assets} onChange={(value) => setForm.model({ ...form.model, backAssetId: value })} help={ui('infra.model.rearImageHelp')} />
    </div>
    {form.model.supportsNetworkPorts && <p className="form-help">{ui('infrastructure.entityEditor.afterSavingMapEveryPort')}</p>}
    <FormError message={formError} />
    <ModalActions close={close} />
  </form></Modal>;
}
