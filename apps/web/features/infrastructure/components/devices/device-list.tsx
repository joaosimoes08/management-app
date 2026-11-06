'use client';

import { useState } from 'react';
import { Edit3, Plus, Server } from 'lucide-react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { AssetImage } from '../asset-image';
import type { Device } from '../../types';
import type { DeviceModel, Rack } from '../../types';

export interface DeviceListProps {
  devices: Device[];
  search: string;
  onSelect: (device: Device) => void;
  onEdit: (device: Device) => void;
  onNew: () => void;
  canEdit: boolean;
  selectedId?: string;
  models?: DeviceModel[];
  racks?: Rack[];
  onImport?: () => void;
  canImport?: boolean;
  onBulkUpdate?: (ids: string[], changes: { status?: string; modelId?: string | null; rackId?: string | null }) => void;
}

/** Active device inventory of the site. */
export function DeviceList({ devices, search, onSelect, onEdit, onNew, canEdit, selectedId, models = [], racks = [], onImport, canImport = canEdit, onBulkUpdate }: DeviceListProps) {
  const [selected, setSelected] = useState<string[]>([]);
  const [status, setStatus] = useState('');
  const [modelId, setModelId] = useState('');
  const [rackId, setRackId] = useState('');
  const [error, setError] = useState('');
  const visibleIds = devices.map((item) => item.id);
  const allVisible = visibleIds.length > 0 && visibleIds.every((id) => selected.includes(id));
  async function applyBulk() {
    const changes: { status?: string; modelId?: string | null; rackId?: string | null } = {};
    if (status) changes.status = status;
    if (modelId) changes.modelId = modelId === '__none__' ? null : modelId;
    if (rackId) changes.rackId = rackId === '__unplaced__' ? null : rackId;
    if (!Object.keys(changes).length) { setError('Seleciona pelo menos um campo para alterar.'); return; }
    const summary = Object.entries(changes).map(([key, value]) => `${key}: ${value ?? 'sem valor'}`).join('\n');
    if (!window.confirm(`Atualizar ${selected.length} equipamentos com os seguintes campos?\n\n${summary}`)) return;
    setError(''); onBulkUpdate?.(selected, changes); setSelected([]);
  }
  return <section className="ipam-card">
    <div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO OPERACIONAL</span><h2>Equipamentos ativos</h2></div>{(canEdit || canImport) && <div style={{ display: 'flex', gap: 8 }}>{canImport && <button className="secondary-button" onClick={onImport}>Importar CSV</button>}{canEdit && <button className="primary-button" onClick={onNew}><Plus size={14} /> Adicionar equipamento</button>}</div>}</div>
    {canEdit && <label style={{ display: 'flex', gap: 8, alignItems: 'center', padding: '8px 0' }}><input type="checkbox" checked={allVisible} onChange={(event) => setSelected(event.target.checked ? [...new Set([...selected, ...visibleIds])] : selected.filter((id) => !visibleIds.includes(id)))} /> Selecionar equipamentos visíveis</label>}
    {canEdit && selected.length > 0 && <div className="ipam-card" style={{ display: 'flex', flexWrap: 'wrap', gap: 10, alignItems: 'end' }}><strong>{selected.length} selecionados</strong><label>Estado<select value={status} onChange={(event) => setStatus(event.target.value)}><option value="">Sem alteração</option>{['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN'].map((item) => <option key={item}>{item}</option>)}</select></label><label>Modelo<select value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Sem alteração</option><option value="__none__">Sem modelo</option>{models.map((item) => <option key={item.id} value={item.id}>{item.manufacturer} {item.model}</option>)}</select></label><label>Localização (bastidor)<select value={rackId} onChange={(event) => setRackId(event.target.value)}><option value="">Sem alteração</option><option value="__unplaced__">Sem bastidor</option>{racks.map((item) => <option key={item.id} value={item.id}>{item.room?.building?.name} / {item.room?.name} / {item.name}</option>)}</select></label><button className="primary-button" onClick={() => void applyBulk()}>Aplicar alterações</button><button className="secondary-button" onClick={() => setSelected([])}>Limpar seleção</button>{error && <small role="alert">{error}</small>}</div>}
    {devices.map((device) => <div className={`host-row infra-device-row ${selectedId === device.id ? 'selected' : ''}`} key={device.id} onClick={() => onSelect(device)} aria-current={selectedId === device.id ? 'true' : undefined}>
      {canEdit && <input type="checkbox" aria-label={`Selecionar ${device.name}`} checked={selected.includes(device.id)} onClick={(event) => event.stopPropagation()} onChange={(event) => setSelected(event.target.checked ? [...selected, device.id] : selected.filter((id) => id !== device.id))} />}
      <span className="host-icon equipment-type-icon-frame">{device.frontAsset ?? device.model?.frontAsset ? <AssetImage asset={device.frontAsset ?? device.model?.frontAsset} alt={`${device.name} — imagem frontal`} className="catalog-icon" fallback={<EquipmentTypeIcon type={device.type} />} /> : <EquipmentTypeIcon type={device.type} />}</span>
      <span><strong>{device.name}</strong><small>{device.type} · {device.model ? `${device.model.manufacturer} ${device.model.model}` : 'Sem modelo'} · {device.managementIp || 'Sem IP de gestão'} · {device.rack ? `${device.rack.name} / ${device.rackUnitStart ?? '?'}U` : 'Por localizar'}</small></span>
      <em className="status-active">{device.status}</em>
      {canEdit && <button className="icon-button subtle" onClick={(event) => { event.stopPropagation(); onEdit(device); }}><Edit3 size={14} /></button>}
    </div>)}
    {!devices.length && <div className="empty-context"><Server size={26} /><strong>{search ? 'Sem equipamentos correspondentes' : 'Não existem equipamentos ativos neste Site'}</strong></div>}
  </section>;
}
