'use client';

import type { SnmpHealthSummaryItem } from '@/features/snmp/health/health-api';
import { useEffect, useState } from 'react';
import { Check, ChevronLeft, ChevronRight, GripVertical, MapPinned, Plus, X } from 'lucide-react';
import type { Device, Rack, RackEditDraft, RackPlacementPlan, RoomWithBuilding } from '../../types';
import { FIXED_RACK_IMAGE } from '../../utils';
import { PageToolbarPortal } from '@/components/layout/app-shell';

import { RackDetail } from './rack-detail';
import { RackEquipmentPreview } from './rack-equipment-preview';
import { useUiText } from '@/components/ui/use-ui-text';

export interface RackWorkspaceProps {
  rooms: RoomWithBuilding[];
  roomId: string;
  buildingId: string;
  racks: Rack[];
  allRoomRacks: Rack[];
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
  onReorderRacks: (roomId: string, rackIds: string[]) => Promise<unknown>;
  onEditDevice: (device: Device) => void;
  canReorderRacks: boolean;
  /** ADMIN / SYSTEMS_OPERATOR: may disconnect devices from a PDU. */
  canEditPower?: boolean;
  onDisconnectPdu?: (rackId: string, pduId: string, deviceId: string) => Promise<void>;
  /** SNMP Phase 2 step 10: health per device id, drawn on the rack equipment. */
  health?: ReadonlyMap<string, SnmpHealthSummaryItem>;
}

/** Rack gallery of the selected room, or the full detail view of the selected rack. */
export function RackWorkspace({ rooms, roomId, buildingId, racks, allRoomRacks, selected, setRack, onOut, onDevice, onEdit, onDelete, deletingRackId, canEdit, onPreviewPlacement, onPlaceDevice, onReorderRacks, onEditDevice, canReorderRacks, canEditPower = false, onDisconnectPdu, health }: RackWorkspaceProps) {
  const ui = useUiText();
  const racksPerPage = 5;
  const [firstVisibleRack, setFirstVisibleRack] = useState(0);
  const [reordering, setReordering] = useState(false);
  const [reorderingRacks, setReorderingRacks] = useState(false);
  const [draftRacks, setDraftRacks] = useState<Rack[]>([]);
  const [draggedRackId, setDraggedRackId] = useState('');
  const [dragTargetId, setDragTargetId] = useState('');
  const [savingRackOrder, setSavingRackOrder] = useState(false);
  const [movingDeviceId, setMovingDeviceId] = useState('');
  const [savingPlacement, setSavingPlacement] = useState(false);
  const lastPossibleStart = Math.max(0, racks.length - racksPerPage);
  const visibleStart = Math.min(firstVisibleRack, lastPossibleStart);
  const visibleRacks = reorderingRacks ? draftRacks : reordering ? racks : racks.slice(visibleStart, visibleStart + racksPerPage);

  useEffect(() => {
    setFirstVisibleRack(0);
    setReordering(false);
    setReorderingRacks(false);
    setDraftRacks([]);
    setDraggedRackId('');
    setDragTargetId('');
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
  const startRackReordering = () => {
    setDraftRacks([...allRoomRacks]);
    setReorderingRacks(true);
    setFirstVisibleRack(0);
  };
  const cancelRackReordering = () => {
    setDraftRacks([]);
    setReorderingRacks(false);
    setDraggedRackId('');
    setDragTargetId('');
  };
  const moveRackTo = (rackId: string, targetId: string, afterTarget: boolean) => {
    if (!rackId || rackId === targetId) return;
    setDraftRacks((current) => {
      const from = current.findIndex((rack) => rack.id === rackId);
      if (from < 0) return current;
      const next = [...current];
      const [movedRack] = next.splice(from, 1);
      const target = next.findIndex((rack) => rack.id === targetId);
      if (target < 0) return current;
      next.splice(target + (afterTarget ? 1 : 0), 0, movedRack);
      return next;
    });
  };
  const moveRackBy = (rackId: string, offset: number) => {
    setDraftRacks((current) => {
      const from = current.findIndex((rack) => rack.id === rackId);
      const to = Math.max(0, Math.min(current.length - 1, from + offset));
      if (from < 0 || from === to) return current;
      const next = [...current];
      const [movedRack] = next.splice(from, 1);
      next.splice(to, 0, movedRack);
      return next;
    });
  };
  const saveRackOrder = async () => {
    setSavingRackOrder(true);
    try {
      await onReorderRacks(roomId, draftRacks.map((rack) => rack.id));
      setReorderingRacks(false);
      setDraftRacks([]);
      setFirstVisibleRack(0);
    } catch {
      // Keep the draft order available so the user can retry after the workspace reports the error.
    } finally {
      setSavingRackOrder(false);
    }
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

  if (selected) return <RackDetail rack={selected} health={health} onOut={() => {
    onOut();
    const url = new URL(location.href);
    url.searchParams.delete('rackId');
    history.replaceState({}, '', `${url.pathname}${url.search}`);
  }} onDevice={onDevice} onEdit={onEdit} onDelete={onDelete} deleting={deletingRackId === selected.id} canEdit={canEdit} onPreviewPlacement={onPreviewPlacement} onPlaceDevice={onPlaceDevice} onEditDevice={onEditDevice} canEditPower={canEditPower} onDisconnectPdu={onDisconnectPdu} />;
  if (!activeBuildingId) return <section className="ipam-card empty-context"><MapPinned size={28} /><strong>{ui('infrastructure.rackWorkspace.selectABuildingToView')}</strong></section>;
  if (!roomId) return <section className="ipam-card empty-context"><MapPinned size={28} /><strong>{ui('infrastructure.rackWorkspace.selectARoomToSee')}</strong></section>;

  return <section className="ipam-card rack-room-section">
    <div className="panel-heading"><div><h2>{ui('infrastructure.rackWorkspace.racks')}</h2>{reorderingRacks ? <p>{ui('infrastructure.rackWorkspace.dragTheRacksHorizontallyTo')}</p> : reordering && <p>{ui('infrastructure.rackWorkspace.dragDevicesToAnotherRack')}</p>}</div><PageToolbarPortal><div className="rack-order-actions">{reorderingRacks ? <><button type="button" className="secondary-button" disabled={savingRackOrder} onClick={cancelRackReordering}><X size={14} /> {ui('infrastructure.rackWorkspace.cancel')}</button><button type="button" className="primary-button" disabled={savingRackOrder} onClick={() => void saveRackOrder()}><Check size={14} /> {savingRackOrder ? ui('infrastructure.rackWorkspace.saving') : ui('infrastructure.rackWorkspace.saveOrder')}</button></> : reordering ? <button type="button" className="primary-button" disabled={savingPlacement} onClick={cancelReordering}><Check size={14} /> {savingPlacement ? ui('infrastructure.rackWorkspace.refreshing') : ui('infrastructure.rackWorkspace.finishReordering')}</button> : <>{canReorderRacks && allRoomRacks.length > 1 && <button type="button" className="secondary-button" onClick={startRackReordering}><GripVertical size={14} /> {ui('infra.rack.reorderRacks')}</button>}{canEdit && racks.length > 0 && <button type="button" className="secondary-button" onClick={startReordering}><GripVertical size={14} /> {ui('infra.rack.reorderDevices')}</button>}{canEdit && <button className="primary-button" onClick={() => onEdit({ name: '', room: { id: roomId }, roomId })}><Plus size={14} /> {ui('infrastructure.rackWorkspace.addRack')}</button>}</>}</div></PageToolbarPortal></div>


    <div className={`rack-figure-grid${visibleRacks.length === 1 ? ' single-rack' : ''}${reorderingRacks ? ' reordering' : reordering ? ' reordering equipment-reordering' : ''}`}>{visibleRacks.map((rack) => <figure className={`rack-figure${reorderingRacks ? ` reorderable${draggedRackId === rack.id ? ' dragging' : ''}${dragTargetId === rack.id ? ' drag-target' : ''}` : reordering ? ' equipment-reorderable' : ''}`} key={rack.id} draggable={reorderingRacks} tabIndex={reorderingRacks ? 0 : undefined} aria-label={reorderingRacks ? ui('infra.rack.reorderRackNamed', undefined, { name: rack.name }) : undefined} onKeyDown={(event) => { if (!reorderingRacks) return; if (event.key === 'ArrowLeft') { event.preventDefault(); moveRackBy(rack.id, -1); } if (event.key === 'ArrowRight') { event.preventDefault(); moveRackBy(rack.id, 1); } }} onDragStart={(event) => { if (!reorderingRacks) return; setDraggedRackId(rack.id); event.dataTransfer.effectAllowed = 'move'; event.dataTransfer.setData('text/plain', rack.id); }} onDragOver={(event) => { if (!reorderingRacks) return; event.preventDefault(); event.dataTransfer.dropEffect = 'move'; setDragTargetId(rack.id); }} onDragLeave={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node)) setDragTargetId(''); }} onDrop={(event) => { if (!reorderingRacks) return; event.preventDefault(); const rackId = draggedRackId || event.dataTransfer.getData('text/plain'); const bounds = event.currentTarget.getBoundingClientRect(); moveRackTo(rackId, rack.id, event.clientX > bounds.left + bounds.width / 2); setDraggedRackId(''); setDragTargetId(''); }} onDragEnd={() => { setDraggedRackId(''); setDragTargetId(''); }}>
      {(reorderingRacks || reordering) && <span className="rack-drag-handle" aria-hidden="true"><GripVertical size={14} /> {reorderingRacks ? ui('infrastructure.rackWorkspace.dragRack') : ui('infrastructure.rackWorkspace.equipment')}</span>}
      <div className="rack-figure-image" role={reordering || reorderingRacks ? 'group' : 'button'} tabIndex={reordering || reorderingRacks ? undefined : 0} onClick={() => { if (!reordering && !reorderingRacks) setRack(rack); }} onKeyDown={(event) => { if (!reordering && !reorderingRacks && (event.key === 'Enter' || event.key === ' ')) { event.preventDefault(); setRack(rack); } }} aria-label={ui(`infra.rack.cardAria.${reordering ? 'rearrange' : reorderingRacks ? 'reorder' : 'open'}`, undefined, { name: rack.name, count: rack.devices?.length ?? 0 })}>
        <img src={FIXED_RACK_IMAGE} alt="" draggable={false} />
        <RackEquipmentPreview rack={rack} racks={racks} reordering={reordering && !reorderingRacks} movingDeviceId={movingDeviceId} onMove={moveDevice} onMoving={setMovingDeviceId} />
      </div>
      <figcaption><strong>{rack.name}</strong><small>{ui('infra.rack.cardSummary', undefined, { count: rack.devices?.length ?? 0 })}</small></figcaption>
    </figure>)}</div>
    {!reordering && !reorderingRacks && racks.length > racksPerPage && <nav className="rack-gallery-navigation" aria-label={ui('infrastructure.rackWorkspace.rackNavigation')}>
      <button type="button" className="icon-button subtle" aria-label={ui('infrastructure.rackWorkspace.showPreviousRack')} disabled={visibleStart === 0} onClick={() => setFirstVisibleRack(Math.max(0, visibleStart - 1))}><ChevronLeft size={16} /></button>
      <span aria-live="polite">{ui('infra.rack.rangeOf', undefined, { start: visibleStart + 1, end: Math.min(visibleStart + racksPerPage, racks.length), total: racks.length })}</span>
      <button type="button" className="icon-button subtle" aria-label={ui('infrastructure.rackWorkspace.showNextRack')} disabled={visibleStart === lastPossibleStart} onClick={() => setFirstVisibleRack(Math.min(lastPossibleStart, visibleStart + 1))}><ChevronRight size={16} /></button>
    </nav>}
    {!racks.length && <div className="empty-context"><strong>{ui('infrastructure.rackWorkspace.thisRoomHasNoRacks')}</strong></div>}
  </section>;
}
