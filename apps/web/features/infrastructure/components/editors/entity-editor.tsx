'use client';

import { Modal } from '@/components/ui/modal';
import { EQUIPMENT_TYPES } from '../../utils';
import type { DeviceForm, ModelForm, RackForm } from '../../forms';
import type { AssetFile, DeviceModel, IpAddress, Rack, RoomWithBuilding } from '../../types';
import { AssetPicker, ModalActions } from './editor-shared';

export interface EntityEditorProps {
  modal: string;
  close: () => void;
  editingId: string;
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
}

/** Device, rack and model create/edit modals (the interface modal lives in InterfaceEditor). */
export function EntityEditor({ modal, close, editingId, form, setForm, rooms, racks, models, assets, ips, save }: EntityEditorProps) {
  if (!modal || modal === 'layout') return null;

  if (modal === 'device') return <Modal title={editingId ? 'Gerir equipamento' : 'Novo equipamento'} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    void save(editingId ? `/api/v1/devices/${editingId}` : '/api/v1/devices', {
      ...form.device,
      siteId: new URLSearchParams(location.search).get('siteId'),
      rackId: form.device.rackId || null,
      rackUnitStart: form.device.rackUnitStart ? Number(form.device.rackUnitStart) : null,
      rackUnitSize: Number(form.device.rackUnitSize),
      modelId: form.device.modelId || null,
      managementIpAddressId: form.device.managementIpAddressId || null,
      frontAssetId: form.device.frontAssetId || null,
    });
  }}>
    <label>Nome<input required value={form.device.name} onChange={(event) => setForm.device({ ...form.device, name: event.target.value })} /></label>
    <div className="form-row">
      <label>Tipo<select value={form.device.type} onChange={(event) => setForm.device({ ...form.device, type: event.target.value })}>{EQUIPMENT_TYPES.map((option) => <option key={option}>{option}</option>)}</select></label>
      <label>Estado<select value={form.device.status} onChange={(event) => setForm.device({ ...form.device, status: event.target.value })}>{['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'].map((option) => <option key={option}>{option}</option>)}</select></label>
    </div>
    <label>Hostname<input value={form.device.hostname} onChange={(event) => setForm.device({ ...form.device, hostname: event.target.value })} /></label>
    <div className="form-row">
      <label>IP de gestão<input value={form.device.managementIp} onChange={(event) => setForm.device({ ...form.device, managementIp: event.target.value })} /></label>
      <label>IPAM<select value={form.device.managementIpAddressId} onChange={(event) => setForm.device({ ...form.device, managementIpAddressId: event.target.value })}><option value="">Sem associação</option>{ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.address} · {ip.hostname || 'sem hostname'}</option>)}</select></label>
    </div>
    <label>Modelo<select required value={form.device.modelId} onChange={(event) => setForm.device({ ...form.device, modelId: event.target.value })}><option value="">Seleciona um modelo</option>{models.filter((model) => model.type === form.device.type).map((model) => <option key={model.id} value={model.id}>{model.manufacturer} {model.model}</option>)}</select></label>
    <label>Bastidor<select value={form.device.rackId} onChange={(event) => setForm.device({ ...form.device, rackId: event.target.value })}><option value="">Por localizar</option>{racks.map((rack) => <option key={rack.id} value={rack.id}>{rack.room?.name} / {rack.name}</option>)}</select></label>
    <div className="form-row">
      <label>U inicial<input type="number" min="1" value={form.device.rackUnitStart} onChange={(event) => setForm.device({ ...form.device, rackUnitStart: event.target.value })} /></label>
      <label>Tamanho U<input type="number" min="1" value={form.device.rackUnitSize} onChange={(event) => setForm.device({ ...form.device, rackUnitSize: event.target.value })} /></label>
    </div>
    <AssetPicker label="Imagem frontal" value={form.device.frontAssetId} assets={assets} onChange={(value) => setForm.device({ ...form.device, frontAssetId: value })} />
    <ModalActions close={close} />
  </form></Modal>;

  if (modal === 'rack') return <Modal title={editingId ? 'Editar bastidor' : 'Novo bastidor'} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    void save(editingId ? `/api/v1/racks/${editingId}` : '/api/v1/racks', { name: form.rack.name, roomId: form.rack.roomId });
  }}>
    <p className="form-help">Todos os bastidores usam o modelo padrão fixo de 42U.</p>
    <label>Nome<input required value={form.rack.name} onChange={(event) => setForm.rack({ ...form.rack, name: event.target.value })} /></label>
    <label>Sala<select required value={form.rack.roomId} onChange={(event) => setForm.rack({ ...form.rack, roomId: event.target.value })}>{rooms.map((room) => <option key={room.id} value={room.id}>{room.building.name} / {room.name}</option>)}</select></label>
    <ModalActions close={close} />
  </form></Modal>;

  return <Modal title={editingId ? 'Editar modelo' : 'Novo modelo'} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    void save(editingId ? `/api/v1/device-models/${editingId}` : '/api/v1/device-models', {
      ...form.model,
      networkPortCount: form.model.networkPortCount ? Number(form.model.networkPortCount) : null,
      frontAssetId: form.model.frontAssetId || null,
    });
  }}>
    <div className="form-row">
      <label>Fabricante<input required value={form.model.manufacturer} onChange={(event) => setForm.model({ ...form.model, manufacturer: event.target.value })} /></label>
      <label>Modelo<input required value={form.model.model} onChange={(event) => setForm.model({ ...form.model, model: event.target.value })} /></label>
    </div>
    <label>Tipo<select value={form.model.type} onChange={(event) => setForm.model({ ...form.model, type: event.target.value })}>{EQUIPMENT_TYPES.map((option) => <option key={option}>{option}</option>)}</select></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.model.supportsNetworkPorts} onChange={(event) => setForm.model({ ...form.model, supportsNetworkPorts: event.target.checked })} /> Tem portas de rede configuráveis</label>
    <label>Portas de rede<input type="number" min="1" value={form.model.networkPortCount} onChange={(event) => setForm.model({ ...form.model, networkPortCount: event.target.value })} /></label>
    <AssetPicker label="Imagem frontal" value={form.model.frontAssetId} assets={assets} onChange={(value) => setForm.model({ ...form.model, frontAssetId: value })} />
    <ModalActions close={close} />
  </form></Modal>;
}
