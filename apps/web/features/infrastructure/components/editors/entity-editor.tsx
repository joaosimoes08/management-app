'use client';

import { Modal } from '@/components/ui/modal';
import { useAuth } from '@/lib/auth';
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
  const { hasRole } = useAuth();
  const admin = hasRole('ADMIN');
  if (!modal || modal === 'layout') return null;

  if (modal === 'device') return <Modal title={editingId ? 'Gerir equipamento' : 'Novo equipamento'} close={close}><form className="modal-form" onSubmit={(event) => {
    event.preventDefault();
    const { snmpEnabled, snmpVersion, snmpReadUsername, snmpReadCommunity, snmpReadAuthKey, snmpReadPrivKey, snmpTrapEnabled, snmpTrapUsername, snmpTrapCommunity, snmpTrapAuthKey, snmpTrapPrivKey, snmpAuthProtocol, snmpPrivProtocol, snmpCompatibilitySha1, snmpPort, snmpIntervalMinutes, snmpTimeoutMs, snmpRetries, ...devicePayload } = form.device;
    if (!editingId && snmpEnabled) {
      const version = snmpVersion ?? 'V3'; const protocols = { authProtocol: snmpAuthProtocol ?? 'SHA256', privProtocol: snmpPrivProtocol ?? 'AES128' };
      const readCredential = version === 'V2C' ? { version, community: snmpReadCommunity } : { version, username: snmpReadUsername, authKey: snmpReadAuthKey, privKey: snmpReadPrivKey, ...protocols };
      const trapCredential = !snmpTrapEnabled ? undefined : version === 'V2C' ? { version, community: snmpTrapCommunity } : { version, username: snmpTrapUsername, authKey: snmpTrapAuthKey, privKey: snmpTrapPrivKey, ...protocols };
      void save('/api/v1/snmp/onboarding/devices', { siteId: new URLSearchParams(location.search).get('siteId'), name: devicePayload.name, type: devicePayload.type, hostname: devicePayload.hostname || undefined, managementIp: devicePayload.managementIp, modelId: devicePayload.modelId || undefined, frontAssetId: devicePayload.frontAssetId || undefined, rackId: devicePayload.rackId || undefined, rackUnitStart: devicePayload.rackId && devicePayload.rackUnitStart ? Number(devicePayload.rackUnitStart) : undefined, rackUnitSize: devicePayload.rackId ? Number(devicePayload.rackUnitSize || 1) : undefined, config: { enabled: true, port: Number(snmpPort || 161), intervalMinutes: Number(snmpIntervalMinutes || 15), timeoutMs: Number(snmpTimeoutMs || 5000), retries: Number(snmpRetries || 2), compatibilitySha1: !!snmpCompatibilitySha1 }, readCredential, trapCredential }, 'POST'); return;
    }
    void save(editingId ? `/api/v1/devices/${editingId}` : '/api/v1/devices', {
      ...devicePayload,
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
      <label>IP de gestão<input required={!!form.device.snmpEnabled} value={form.device.managementIp} onChange={(event) => setForm.device({ ...form.device, managementIp: event.target.value })} /></label>
      <label>IPAM<select value={form.device.managementIpAddressId} onChange={(event) => setForm.device({ ...form.device, managementIpAddressId: event.target.value })}><option value="">Sem associação</option>{ips.map((ip) => <option key={ip.id} value={ip.id}>{ip.address} · {ip.hostname || 'sem hostname'}</option>)}</select></label>
    </div>
    <label>Modelo (opcional)<select value={form.device.modelId} onChange={(event) => setForm.device({ ...form.device, modelId: event.target.value })}><option value="">Sem modelo — usar ícone genérico</option>{models.filter((model) => model.type === form.device.type).map((model) => <option key={model.id} value={model.id}>{model.manufacturer} {model.model}</option>)}</select></label>
    <label>Bastidor<select value={form.device.rackId} onChange={(event) => setForm.device({ ...form.device, rackId: event.target.value })}><option value="">Por localizar</option>{racks.map((rack) => <option key={rack.id} value={rack.id}>{rack.room?.name} / {rack.name}</option>)}</select></label>
    <div className="form-row">
      <label>U inicial<input type="number" min="1" value={form.device.rackUnitStart} onChange={(event) => setForm.device({ ...form.device, rackUnitStart: event.target.value })} /></label>
      <label>Tamanho U<input type="number" min="1" value={form.device.rackUnitSize} onChange={(event) => setForm.device({ ...form.device, rackUnitSize: event.target.value })} /></label>
    </div>
    <AssetPicker label="Imagem frontal" value={form.device.frontAssetId} assets={assets} onChange={(value) => setForm.device({ ...form.device, frontAssetId: value })} />
    {admin && !editingId && <fieldset className="snmp-onboarding-section"><legend>SNMP (opcional)</legend>
      <label className="checkbox-label"><input type="checkbox" checked={!!form.device.snmpEnabled} onChange={(event) => setForm.device({ ...form.device, snmpEnabled: event.target.checked })} /> Configurar polling e credenciais SNMP</label>
      {form.device.snmpEnabled && <><p className="form-help">READ é obrigatória; TRAP é opcional e tem de usar um segredo diferente.</p>
        <div className="form-row"><label>Versão<select value={form.device.snmpVersion ?? 'V3'} onChange={(event) => setForm.device({ ...form.device, snmpVersion: event.target.value as 'V2C' | 'V3' })}><option value="V3">SNMPv3 authPriv</option><option value="V2C">SNMPv2c</option></select></label><label>Porta<input type="number" min="1" max="65535" value={form.device.snmpPort ?? '161'} onChange={(event) => setForm.device({ ...form.device, snmpPort: event.target.value })} /></label></div>
        <div className="form-row"><label>Intervalo (min)<input type="number" min="5" value={form.device.snmpIntervalMinutes ?? '15'} onChange={(event) => setForm.device({ ...form.device, snmpIntervalMinutes: event.target.value })} /></label><label>Timeout (ms)<input type="number" min="500" value={form.device.snmpTimeoutMs ?? '5000'} onChange={(event) => setForm.device({ ...form.device, snmpTimeoutMs: event.target.value })} /></label></div>
        <label>Retries<input type="number" min="0" max="5" value={form.device.snmpRetries ?? '2'} onChange={(event) => setForm.device({ ...form.device, snmpRetries: event.target.value })} /></label>
        {form.device.snmpVersion === 'V2C' ? <label>Comunidade READ<input required minLength={8} type="password" value={form.device.snmpReadCommunity ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpReadCommunity: event.target.value })} autoComplete="new-password" /></label> : <><div className="form-row"><label>Auth<select value={form.device.snmpAuthProtocol ?? 'SHA256'} onChange={(event) => setForm.device({ ...form.device, snmpAuthProtocol: event.target.value as DeviceForm['snmpAuthProtocol'] })}><option>SHA256</option><option>SHA384</option><option>SHA512</option>{form.device.snmpCompatibilitySha1 && <option>SHA1</option>}</select></label><label>Privacidade<select value={form.device.snmpPrivProtocol ?? 'AES128'} onChange={(event) => setForm.device({ ...form.device, snmpPrivProtocol: event.target.value as DeviceForm['snmpPrivProtocol'] })}><option>AES128</option><option>AES256</option></select></label></div><label className="checkbox-label"><input type="checkbox" checked={!!form.device.snmpCompatibilitySha1} onChange={(event) => setForm.device({ ...form.device, snmpCompatibilitySha1: event.target.checked, snmpAuthProtocol: event.target.checked ? form.device.snmpAuthProtocol : form.device.snmpAuthProtocol === 'SHA1' ? 'SHA256' : form.device.snmpAuthProtocol })} /> Permitir compatibilidade SHA-1</label><label>Username READ<input required value={form.device.snmpReadUsername ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpReadUsername: event.target.value })} /></label><label>Auth key READ<input required minLength={8} type="password" value={form.device.snmpReadAuthKey ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpReadAuthKey: event.target.value })} autoComplete="new-password" /></label><label>Privacy key READ<input required minLength={8} type="password" value={form.device.snmpReadPrivKey ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpReadPrivKey: event.target.value })} autoComplete="new-password" /></label></>}
        <label className="checkbox-label"><input type="checkbox" checked={!!form.device.snmpTrapEnabled} onChange={(event) => setForm.device({ ...form.device, snmpTrapEnabled: event.target.checked })} /> Configurar também credencial TRAP distinta</label>
        {form.device.snmpTrapEnabled && (form.device.snmpVersion === 'V2C' ? <label>Comunidade TRAP<input required minLength={8} type="password" value={form.device.snmpTrapCommunity ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpTrapCommunity: event.target.value })} autoComplete="new-password" /></label> : <><label>Username TRAP<input required value={form.device.snmpTrapUsername ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpTrapUsername: event.target.value })} /></label><label>Auth key TRAP<input required minLength={8} type="password" value={form.device.snmpTrapAuthKey ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpTrapAuthKey: event.target.value })} autoComplete="new-password" /></label><label>Privacy key TRAP<input required minLength={8} type="password" value={form.device.snmpTrapPrivKey ?? ''} onChange={(event) => setForm.device({ ...form.device, snmpTrapPrivKey: event.target.value })} autoComplete="new-password" /></label></>)}
      </>}
    </fieldset>}
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
