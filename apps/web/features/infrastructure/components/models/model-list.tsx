'use client';

import { useEffect, useState } from 'react';
import { ChevronLeft, ChevronRight, Edit3, Filter, Plus } from 'lucide-react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { EQUIPMENT_TYPES, modelPortLayoutCount } from '../../utils';
import type { DeviceModel } from '../../types';

export interface ModelListProps {
  models: DeviceModel[];
  onEdit: (model: DeviceModel) => void;
  onLayout: (model: DeviceModel) => void;
  canEdit: boolean;
}

const modelPageSize = 20;

/** Device model catalog with type filter and pagination. */
export function ModelList({ models, onEdit, onLayout, canEdit }: ModelListProps) {
  const [equipmentType, setEquipmentType] = useState('ALL');
  const [modelPage, setModelPage] = useState(0);
  const create = () => window.dispatchEvent(new Event('model-create-request'));
  const filteredModels = equipmentType === 'ALL' ? models : models.filter((model) => (model.type ?? 'OTHER') === equipmentType);
  const pageCount = Math.max(1, Math.ceil(filteredModels.length / modelPageSize));
  const activePage = Math.min(modelPage, pageCount - 1);
  const visibleModels = filteredModels.slice(activePage * modelPageSize, (activePage + 1) * modelPageSize);
  useEffect(() => setModelPage((current) => Math.min(current, pageCount - 1)), [pageCount]);

  return <section className="ipam-card model-catalog">
    <div className="panel-heading"><div><span className="section-kicker">CATÁLOGO</span><h2>Modelos</h2></div><div className="model-catalog-toolbar"><label className={`model-type-filter${equipmentType === 'ALL' ? '' : ' active'}`}><Filter size={14} /><select aria-label="Filtrar modelos por tipo de equipamento" value={equipmentType} onChange={(event) => { setEquipmentType(event.target.value); setModelPage(0); }}><option value="ALL">Todos os tipos</option>{EQUIPMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>{canEdit && <button className="primary-button" type="button" onClick={create}><Plus size={14} /> Novo modelo</button>}</div></div>
    {visibleModels.map((model) => <div className="host-row" key={model.id}>
      <span className="host-icon equipment-type-icon-frame"><EquipmentTypeIcon type={model.type} /></span>
      <span><strong>{model.manufacturer} {model.model}</strong><small>{model.type ?? 'OTHER'} · {modelPortLayoutCount(model) > 0 ? `${modelPortLayoutCount(model)} portas mapeadas` : 'sem portas mapeadas'} · {model.frontAsset ? 'imagem configurada' : 'aguarda imagem'}</small></span>
      {canEdit && <span className="row-actions"><button className="icon-button subtle" onClick={() => onEdit(model)}><Edit3 size={14} /></button><button className="secondary-button compact-button map-ports-button" onClick={() => onLayout(model)}>Mapear portas</button></span>}
    </div>)}
    {!filteredModels.length && <div className="no-data">Não existem modelos para os filtros selecionados.</div>}
    {filteredModels.length > 0 && <div className="model-pagination"><span aria-live="polite"><span key={`${activePage}-${pageCount}`}>{`Página ${activePage + 1} de ${pageCount}`}</span></span><div><button type="button" className="icon-button subtle" aria-label="Página anterior" disabled={activePage === 0} onClick={() => setModelPage(activePage - 1)}><ChevronLeft size={14} /></button><button type="button" className="icon-button subtle" aria-label="Página seguinte" disabled={activePage >= pageCount - 1} onClick={() => setModelPage(activePage + 1)}><ChevronRight size={14} /></button></div></div>}
  </section>;
}
