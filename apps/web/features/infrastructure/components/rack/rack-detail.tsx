'use client';

import { useMemo, useState } from 'react';
import { Check, Edit3, Trash2 } from 'lucide-react';
import { RACK_UNITS } from '../../utils';
import type { Device, Rack, RackEditDraft, RackPlacementPlan } from '../../types';
import { RackDeviceZoom } from './rack-device-zoom';
import { RackEquipmentOverlay } from './rack-equipment-overlay';

export interface RackDetailProps {
  rack: Rack;
  onOut: () => void;
  onDevice: (device: Device) => void;
  onEdit?: (rack: RackEditDraft) => void;
  onDelete?: (rack: Rack) => void;
  deleting?: boolean;
  canEdit: boolean;
  onPreviewPlacement: (deviceId: string, rackId: string, rackUnitStart: number) => Promise<RackPlacementPlan>;
  onPlaceDevice: (deviceId: string, rackId: string, rackUnitStart: number) => Promise<unknown>;
  onEditDevice: (device: Device) => void;
}

/** Full 42U view of one rack, including placement preview/confirmation. */
export function RackDetail({ rack, onOut, onDevice, onEdit, onDelete, deleting, canEdit, onPreviewPlacement, onPlaceDevice, onEditDevice }: RackDetailProps) {
  const [zoomDeviceId, setZoomDeviceId] = useState('');
  const [draggingDeviceId, setDraggingDeviceId] = useState('');
  const [pending, setPending] = useState<RackPlacementPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [correctingUnit, setCorrectingUnit] = useState(false);
  const [correctedUnit, setCorrectedUnit] = useState('');
  const [adjustingUnit, setAdjustingUnit] = useState(false);

  const displayRack = useMemo<Rack>(() => {
    if (!pending) return rack;
    const changes = new Map(pending.changes.map((change) => [change.id, change]));
    return {
      ...rack,
      devices: (rack.devices ?? [])
        .map((device) => (changes.has(device.id) ? { ...device, ...changes.get(device.id) } : device))
        .filter((device) => device.rackId === rack.id),
    };
  }, [rack, pending]);

  const hasUnpositioned = (rack.devices ?? []).some((device) => {
    const start = Number(device.rackUnitStart);
    const size = Math.max(1, Number(device.rackUnitSize) || 1);
    return !Number.isFinite(start) || start < 1 || start + size - 1 > RACK_UNITS;
  });

  const preview = async (deviceId: string, rackUnitStart: number) => {
    try {
      const next = await onPreviewPlacement(deviceId, rack.id, rackUnitStart);
      setPending(next);
      setCorrectingUnit(false);
      setCorrectedUnit(String(next.target.rackUnitStart));
    } catch {
      setPending(null);
    }
  };

  const adjustUnit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!pending) return;
    const requestedUnit = Number(correctedUnit);
    const maximumStart = (rack.units ?? RACK_UNITS) - pending.target.rackUnitSize + 1;
    if (!Number.isInteger(requestedUnit) || requestedUnit < 1 || requestedUnit > maximumStart) return;
    setAdjustingUnit(true);
    try {
      const next = await onPreviewPlacement(pending.target.id, rack.id, requestedUnit);
      setPending(next);
      setCorrectedUnit(String(next.target.rackUnitStart));
      setCorrectingUnit(false);
    } catch {
      // O workspace apresenta o erro e mantém o valor para o utilizador corrigir.
    } finally {
      setAdjustingUnit(false);
    }
  };

  const confirm = async () => {
    if (!pending) return;
    setSaving(true);
    try {
      await onPlaceDevice(pending.target.id, pending.target.rackId, pending.target.rackUnitStart);
      setPending(null);
      setCorrectingUnit(false);
    } finally {
      setSaving(false);
    }
  };

  const cancelPlacement = () => {
    setPending(null);
    setCorrectingUnit(false);
    setCorrectedUnit('');
  };

  const maximumCorrectedUnit = pending ? (rack.units ?? RACK_UNITS) - pending.target.rackUnitSize + 1 : RACK_UNITS;

  return <section className="ipam-card rack-view">
    <div className="rack-zoom-toolbar"><button className="secondary-button" onClick={onOut}>Voltar aos bastidores</button><span>{rack.room?.building?.name} / {rack.room?.name} / <strong>{rack.name}</strong></span><div className="button-row rack-detail-actions">{onEdit && <button type="button" className="secondary-button" onClick={() => onEdit(rack)}><Edit3 size={14}/> Editar bastidor</button>}{onDelete && <button type="button" className="secondary-button danger-button" disabled={deleting} onClick={() => onDelete(rack)}><Trash2 size={14}/> {deleting ? 'A eliminar…' : 'Eliminar bastidor'}</button>}</div></div>
    <div className="panel-heading"><div><span className="section-kicker">BASTIDOR VISUAL</span><h2>{rack.name}</h2><p>{rack.devices?.length ?? 0} equipamentos · Bastidor padrão · 42U{canEdit ? <>{' · '}<span>Arrasta um equipamento para o mover</span></> : null}</p></div></div>
    <div className="rack-stage"><div className="rack-frame"><img src="/assets/rack-empty-42u.png" alt={`Bastidor ${rack.name}`} draggable={false} /><RackEquipmentOverlay rack={displayRack} onSelect={setZoomDeviceId} onDropDevice={preview} draggingDeviceId={draggingDeviceId} onDragging={setDraggingDeviceId} canEdit={canEdit && !pending} pendingDeviceId={pending?.target?.id} /></div>{zoomDeviceId && <RackDeviceZoom deviceId={zoomDeviceId} onBack={() => setZoomDeviceId('')} onInterfaces={onDevice} onEditDevice={onEditDevice} />}</div>
    {pending && <aside className="rack-placement-confirmation" aria-live="polite">
      <div className="rack-placement-summary"><span className="section-kicker">POSIÇÃO SNAPPED-IN</span><strong>{pending.target.name} ficou em U{pending.target.rackUnitStart}{pending.target.rackUnitSize > 1 ? `–U${pending.target.rackUnitStart + pending.target.rackUnitSize - 1}` : ''}</strong><small>{pending.changes.length > 1 ? `${pending.changes.length - 1} equipamento(s) também serão reposicionados para libertar espaço.` : 'A nova posição está livre.'}</small>{!correctingUnit && <button type="button" className="rack-placement-correction-trigger" disabled={saving} onClick={() => { setCorrectedUnit(String(pending.target.rackUnitStart)); setCorrectingUnit(true); }}>Calhou no U errado?</button>}{correctingUnit && <form className="rack-placement-correction" onSubmit={adjustUnit}><label htmlFor="corrected-rack-unit">Em que U deveria ficar?</label><div><span>U</span><input id="corrected-rack-unit" type="number" inputMode="numeric" min="1" max={maximumCorrectedUnit} required autoFocus value={correctedUnit} onChange={(event) => setCorrectedUnit(event.target.value)} aria-describedby="corrected-rack-unit-help" /><button type="submit" className="secondary-button" disabled={adjustingUnit || !correctedUnit}>{adjustingUnit ? 'A ajustar…' : 'Ajustar automaticamente'}</button></div><small id="corrected-rack-unit-help">Escolhe um valor entre U1 e U{maximumCorrectedUnit}.</small></form>}</div>
      <div className="button-row"><button type="button" className="secondary-button" disabled={saving || adjustingUnit} onClick={cancelPlacement}>Cancelar</button><button type="button" className="primary-button" disabled={saving || adjustingUnit || correctingUnit} onClick={confirm}><Check size={14} />{saving ? 'A guardar…' : 'Confirmar U'}</button></div>
    </aside>}
    {hasUnpositioned && <div className="no-data">Existem equipamentos por posicionar.</div>}
  </section>;
}
