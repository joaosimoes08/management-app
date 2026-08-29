'use client';

import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, GripVertical, MapPinned, Plus } from 'lucide-react';
import type { Device, Rack, RackEditDraft, RackPlacementPlan, RoomWithBuilding } from '../../types';
import { FIXED_RACK_IMAGE } from '../../utils';

import { RackDetail } from './rack-detail';
import { RackEquipmentPreview } from './rack-equipment-preview';

export interface RackWorkspaceProps {
  rooms: RoomWithBuilding[];
  roomId: string;
  buildingId: string;
  racks: Rack[];
  selected: Rack | undefined;
  setRack: (rack: Rack) => void;
  onOut: () => void;
  onDevice: (device: Device) => void;
  onEdit: (rack: RackEditDraft) => void;
  onDelete?: (rack: Rack) => void;
  deletingRackId: string;
  canEdit: boolean;
  onPreviewPlacement: (deviceId: string, rackId: string, rackUnitStart: number) => Promise<RackPlacementPlan>;
  onPlaceDevice: (deviceId: string, rackId: string, rackUnitStart: number) => Promise<unknown>;
  onEditDevice: (device: Device) => void;
}

/** Rack gallery of the selected room, or the full detail view of the selected rack. */
export function RackWorkspace({ rooms, roomId, buildingId, racks, selected, setRack, onOut, onDevice, onEdit, onDelete, deletingRackId, canEdit, onPreviewPlacement, onPlaceDevice, onEditDevice }: RackWorkspaceProps) {
  const racksPerPage = 5;
  const [firstVisibleRack, setFirstVisibleRack] = useState(0);
  const [reordering, setReordering] = useState(false);
  const [movingDeviceId, setMovingDeviceId] = useState('');
  const [savingPlacement, setSavingPlacement] = useState(false);
  const lastPossibleStart = Math.max(0, racks.length - racksPerPage);
  const visibleStart = Math.min(firstVisibleRack, lastPossibleStart);
  const visibleRacks = reordering ? racks : racks.slice(visibleStart, visibleStart + racksPerPage);

  useEffect(() => {
    setFirstVisibleRack(0);
    setReordering(false);
  }, [roomId]);
  useEffect(() => {
    setFirstVisibleRack((current) => Math.min(current, lastPossibleStart));
  }, [lastPossibleStart]);

  const startReordering = () => {
    setReordering(true);
    setFirstVisibleRack(0);
  };
  const cancelReordering = () => {
    setReordering(false);
    setMovingDeviceId('');
  };
  const moveDevice = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    setSavingPlacement(true);
    try {
      await onPlaceDevice(deviceId, targetRackId, rackUnitStart);
    } catch {
      // O workspace apresenta o erro e o modo de reorganização permanece ativo.
    } finally {
      setSavingPlacement(false);
    }
  };

  const activeBuildingId = buildingId
    || rooms.find((room) => room.id === roomId)?.building?.id
    || racks.find((rack) => (rack.room?.id ?? rack.roomId) === roomId)?.room?.building?.id
    || new URLSearchParams(location.search).get('buildingId')
    || '';

  if (selected) return <RackDetail rack={selected} onOut={() => {
    onOut();
    const url = new URL(location.href);
    url.searchParams.delete('rackId');
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }} onDevice={onDevice} onEdit={onEdit} onDelete={onDelete} deleting={deletingRackId === selected.id} canEdit={canEdit} onPreviewPlacement={onPreviewPlacement} onPlaceDevice={onPlaceDevice} onEditDevice={onEditDevice} />;
  if (!activeBuildingId) return <section className="ipam-card empty-context"><MapPinned size={28} /><strong>Seleciona um edifício para ver as salas</strong></section>;
  if (!roomId) return <section className="ipam-card empty-context"><MapPinned size={28} /><strong>Seleciona uma sala para ver os bastidores</strong></section>;

  return <section className="ipam-card rack-room-section">
    <div className="panel-heading"><div><span className="section-kicker">SALA SELECIONADA</span><h2>Bastidores</h2>{reordering && <p>Arrasta os equipamentos para outro bastidor ou U. Cada movimento é guardado automaticamente.</p>}</div><div className="rack-order-actions">{reordering ? <button type="button" className="primary-button" disabled={savingPlacement} onClick={cancelReordering}><Check size={14} /> {savingPlacement ? 'A atualizar…' : 'Concluir reorganização'}</button> : <>{canEdit && racks.length > 0 && <button type="button" className="secondary-button" onClick={startReordering}><GripVertical size={14} /> Reorganizar</button>}{canEdit && <button className="primary-button" onClick={() => onEdit({ name: '', room: { id: roomId }, roomId })}><Plus size={14} /> Adicionar bastidor</button>}</>}</div></div>
    <div className={`rack-figure-grid${reordering ? ' reordering equipment-reordering' : ''}`}>{visibleRacks.map((rack) => <figure className={`rack-figure${reordering ? ' equipment-reorderable' : ''}`} key={rack.id}>
      {reordering && <span className="rack-drag-handle" aria-hidden="true"><GripVertical size={14} /> Equipamentos</span>}
      <div className="rack-figure-image" role={reordering ? 'group' : 'button'} tabIndex={reordering ? undefined : 0} onClick={() => { if (!reordering) setRack(rack); }} onKeyDown={(event) => { if (!reordering && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setRack(rack); } }} aria-label={`${reordering ? 'Reorganizar equipamentos no' : 'Abrir'} bastidor ${rack.name}, ${rack.devices?.length ?? 0} equipamentos`}>
        <img src={FIXED_RACK_IMAGE} alt="" draggable={false} />
        <RackEquipmentPreview rack={rack} racks={racks} reordering={reordering} movingDeviceId={movingDeviceId} onMove={moveDevice} onMoving={setMovingDeviceId} />
      </div>
      <figcaption><strong>{rack.name}</strong><small>Bastidor padrão · 42U · {rack.devices?.length ?? 0} equipamentos</small></figcaption>
    </figure>)}</div>
    {!reordering && racks.length > racksPerPage && <nav className="rack-gallery-navigation" aria-label="Navegação dos bastidores">
      <button type="button" className="icon-button subtle" aria-label="Mostrar bastidor anterior" disabled={visibleStart === 0} onClick={() => setFirstVisibleRack(Math.max(0, visibleStart - 1))}><ChevronLeft size={16} /></button>
      <span aria-live="polite">{visibleStart + 1}–{Math.min(visibleStart + racksPerPage, racks.length)} de {racks.length}</span>
      <button type="button" className="icon-button subtle" aria-label="Mostrar bastidor seguinte" disabled={visibleStart === lastPossibleStart} onClick={() => setFirstVisibleRack(Math.min(lastPossibleStart, visibleStart + 1))}><ChevronRight size={16} /></button>
    </nav>}
    {!racks.length && <div className="empty-context"><strong>Esta sala ainda não tem bastidores</strong></div>}
  </section>;
}
