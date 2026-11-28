'use client';

import { useEffect, useState } from 'react';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { ChevronLeft, ChevronRight, Edit3, Filter, Plus } from 'lucide-react';
import { EquipmentTypeIcon } from '../equipment-type-icon';
import { EQUIPMENT_TYPES, portMappingStatus } from '../../utils';
import type { DeviceModel } from '../../types';
import { useUiText } from '@/components/ui/use-ui-text';
import { portugueseText, type InfrastructureText } from '../../infrastructure-text';

/** Port mapping status across both faces, for the model row. */
function mappingSummary(model: DeviceModel, ui: InfrastructureText = portugueseText): string {
  const status = portMappingStatus(model);
  if (!status.expected && !status.mapped) return ui('infrastructure.modelList.noNetworkPorts');
  if (!status.required && !status.extra && status.complete) return ui('infrastructure.modelList.portsMapped', undefined, { mapped: status.mapped });
  if (status.complete) return ui('infrastructure.modelList.portsMappedOf', undefined, { mapped: status.mapped, expected: status.expected });
  return ui('infrastructure.modelList.mappingIncomplete', undefined, { mapped: status.mapped, expected: status.expected });
}

export interface ModelListProps {
  models: DeviceModel[];
  onEdit: (model: DeviceModel) => void;
  onLayout: (model: DeviceModel) => void;
  canEdit: boolean;
}

const modelPageSize = 20;

/** Device model catalog with type filter and pagination. */
export function ModelList({ models, onEdit, onLayout, canEdit }: ModelListProps) {
  const ui = useUiText();
  const [equipmentType, setEquipmentType] = useState('ALL');
  const [modelPage, setModelPage] = useState(0);
  const create = () => window.dispatchEvent(new Event('model-create-request'));
  const filteredModels = equipmentType === 'ALL' ? models : models.filter((model) => (model.type ?? 'OTHER') === equipmentType);
  const pageCount = Math.max(1, Math.ceil(filteredModels.length / modelPageSize));
  const activePage = Math.min(modelPage, pageCount - 1);
  const visibleModels = filteredModels.slice(activePage * modelPageSize, (activePage + 1) * modelPageSize);
  useEffect(() => setModelPage((current) => Math.min(current, pageCount - 1)), [pageCount]);

  return <section className="ipam-card model-catalog">
    <div className="panel-heading"><div><h2>{ui('infrastructure.modelList.models')}</h2></div></div><PageToolbarPortal><div className="model-catalog-toolbar"><label className={`model-type-filter${equipmentType === 'ALL' ? '' : ' active'}`}><Filter size={14} /><select aria-label={ui('infrastructure.modelList.filterModelsByEquipmentType')} value={equipmentType} onChange={(event) => { setEquipmentType(event.target.value); setModelPage(0); }}><option value="ALL">{ui('infrastructure.modelList.allTypes')}</option>{EQUIPMENT_TYPES.map((type) => <option key={type} value={type}>{type}</option>)}</select></label>{canEdit && <button className="primary-button" type="button" onClick={create}><Plus size={14} /> {ui('infrastructure.modelList.newModel')}</button>}</div></PageToolbarPortal>
    {visibleModels.map((model) => <div className="host-row" key={model.id}>
      <span className="host-icon equipment-type-icon-frame"><EquipmentTypeIcon type={model.type} /></span>
      <span><strong>{model.manufacturer} {model.model}</strong><small>{model.type ?? 'OTHER'} · {mappingSummary(model, ui)} · {model.frontAsset ? ui('infrastructure.modelList.withFrontImage') : ui('infrastructure.modelList.noFrontImage')} · {model.backAsset ? ui('infrastructure.modelList.withRearImage') : ui('infrastructure.modelList.noRearImage')}</small></span>
      {canEdit && <span className="row-actions"><button type="button" className="icon-button subtle" aria-label={ui('infrastructure.modelList.editModel', undefined, { manufacturer: model.manufacturer, model: model.model })} title={ui('infrastructure.modelList.editModel')} onClick={() => onEdit(model)}><Edit3 size={14} aria-hidden="true" /></button><button className="secondary-button compact-button map-ports-button" onClick={() => onLayout(model)}>{ui('infrastructure.modelList.mapPorts')}</button></span>}
    </div>)}
    {!filteredModels.length && <div className="no-data">{ui('infrastructure.modelList.thereAreNoModelsMatching')}</div>}
    {filteredModels.length > 0 && <div className="model-pagination"><span aria-live="polite"><span key={`${activePage}-${pageCount}`}>{ui('ui.pageOf', undefined, { page: activePage + 1, total: pageCount })}</span></span><div><button type="button" className="icon-button subtle" aria-label={ui('ui.previousPage')} disabled={activePage === 0} onClick={() => setModelPage(activePage - 1)}><ChevronLeft size={14} /></button><button type="button" className="icon-button subtle" aria-label={ui('ui.nextPage')} disabled={activePage >= pageCount - 1} onClick={() => setModelPage(activePage + 1)}><ChevronRight size={14} /></button></div></div>}
  </section>;
}
