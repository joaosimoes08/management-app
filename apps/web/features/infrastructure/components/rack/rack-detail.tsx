'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Check, Edit3, Minus, Plus, RotateCcw, Trash2 } from 'lucide-react';
import { FIXED_RACK_IMAGE, RACK_BOTH_MIN_WIDTH, RACK_UNITS, readRackView, writeRackView } from '../../utils';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import type { Device, Rack, RackEditDraft, RackFace, RackPlacementPlan, RackView } from '../../types';
import { RackDeviceZoom } from './rack-device-zoom';
import { RackEquipmentOverlay } from './rack-equipment-overlay';
import { RackFaceToggle, type RackFaceOption } from './rack-face-toggle';

const RACK_WIDTH = 304;
const RACK_HEIGHT = 820;
/** Space between the two faces in "Ambas". */
const FACE_GAP = 24;
/** Height of the "Frente"/"Traseira" caption above each rack in "Ambas". */
const FACE_CAPTION = 24;
const FACE_LABEL: Record<RackFace, string> = { front: 'Frente', rear: 'Traseira' };

function viewportWidth() {
  return typeof window === 'undefined' ? 0 : window.innerWidth;
}

/** True while the window is at least as wide as the "Ambas" breakpoint. */
function useWideRackViewport() {
  const [wide, setWide] = useState(() => viewportWidth() >= RACK_BOTH_MIN_WIDTH);
  useEffect(() => {
    if (typeof window.matchMedia !== 'function') return;
    const query = window.matchMedia(`(min-width: ${RACK_BOTH_MIN_WIDTH}px)`);
    const update = () => setWide(query.matches);
    update();
    query.addEventListener?.('change', update);
    return () => query.removeEventListener?.('change', update);
  }, []);
  return wide;
}

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
  const [zoomDevice, setZoomDevice] = useState<{ id: string; face: RackFace } | null>(null);
  const [view, setView] = useState<RackView>(() => readRackView(viewportWidth()));
  const wide = useWideRackViewport();
  const activeView: RackView = view === 'both' && !wide ? 'front' : view;
  const faces: RackFace[] = activeView === 'both' ? ['front', 'rear'] : [activeView];
  const both = faces.length > 1;
  const [draggingDeviceId, setDraggingDeviceId] = useState('');
  const [pending, setPending] = useState<RackPlacementPlan | null>(null);
  const [saving, setSaving] = useState(false);
  const [correctingUnit, setCorrectingUnit] = useState(false);
  const [correctedUnit, setCorrectedUnit] = useState('');
  const [adjustingUnit, setAdjustingUnit] = useState(false);
  const stageRef = useRef<HTMLDivElement>(null);
  const [fitWidth, setFitWidth] = useState(RACK_WIDTH);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      const availableWidth = stage.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const availableHeight = stage.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      // In "Ambas" both racks share the width and keep one U scale; each has a caption above it.
      const perRackWidth = both ? (availableWidth - FACE_GAP) / 2 : availableWidth;
      const rackHeight = availableHeight - (both ? FACE_CAPTION : 0);
      setFitWidth(Math.max(1, Math.min(RACK_WIDTH, perRackWidth, rackHeight * RACK_WIDTH / RACK_HEIGHT)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [both]);

  const changeView = (next: RackView) => {
    setView(next);
    writeRackView(next);
  };
  const viewOptions: RackFaceOption<RackView>[] = [
    { value: 'front', label: 'Frente' },
    { value: 'rear', label: 'Traseira' },
    ...(wide ? [{ value: 'both' as const, label: 'Ambas' }] : []),
  ];
  const rackWidth = fitWidth * zoom;
  const rackHeight = fitWidth * RACK_HEIGHT / RACK_WIDTH * zoom;

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
    <div className="rack-zoom-toolbar"><span>{rack.room?.building?.name} / {rack.room?.name} / <strong>{rack.name}</strong></span></div><PageToolbarPortal><div className="button-row rack-detail-actions"><button type="button" className="secondary-button" onClick={onOut}>Voltar aos bastidores</button>{onEdit && <button type="button" className="secondary-button" onClick={() => onEdit(rack)}><Edit3 size={14}/> Editar bastidor</button>}{onDelete && <button type="button" className="secondary-button danger-button" disabled={deleting} onClick={() => onDelete(rack)}><Trash2 size={14}/> {deleting ? 'A eliminar…' : 'Eliminar bastidor'}</button>}</div></PageToolbarPortal>
    <div className="panel-heading"><div><span className="section-kicker">BASTIDOR VISUAL</span><h2>{rack.name}</h2><p>{rack.devices?.length ?? 0} equipamentos · Bastidor padrão · 42U{canEdit ? <>{' · '}<span>Arrasta um equipamento para o mover</span></> : null}</p></div></div>
    <div className="rack-stage-wrap">
      <div className="rack-stage-controls" role="group" aria-label="Controlos do bastidor">
        <RackFaceToggle label="Face do bastidor" value={activeView} options={viewOptions} onChange={changeView} />
        <button type="button" className="icon-button subtle" aria-label="Diminuir zoom" disabled={zoom <= 1} onClick={() => setZoom((value) => Math.max(1, +(value - .2).toFixed(2)))}><Minus size={15} /></button>
        <span aria-live="polite">{Math.round(zoom * 100)}%</span>
        <button type="button" className="icon-button subtle" aria-label="Aumentar zoom" disabled={zoom >= 2.5} onClick={() => setZoom((value) => Math.min(2.5, +(value + .2).toFixed(2)))}><Plus size={15} /></button>
        <button type="button" className="secondary-button" onClick={() => { setZoom(1); if (stageRef.current) { stageRef.current.scrollTop = 0; stageRef.current.scrollLeft = 0; } }}><RotateCcw size={14} /> Ajustar</button>
      </div>
      <div className={`rack-stage${both ? ' rack-stage-both' : ''}`} ref={stageRef} data-view={activeView}>
        <div className="rack-stage-inner" style={{ width: `${both ? rackWidth * 2 + FACE_GAP : rackWidth}px`, height: `${rackHeight + (both ? FACE_CAPTION : 0)}px`, gap: both ? `${FACE_GAP}px` : undefined }}>
          {faces.map((face) => <figure className="rack-face" key={face} data-face={face} style={{ width: `${rackWidth}px` }}>
            {both && <figcaption className="rack-face-caption" style={{ height: `${FACE_CAPTION}px` }}>{FACE_LABEL[face]}</figcaption>}
            <div className="rack-frame" style={{ width: `${rackWidth}px` }}><img src={FIXED_RACK_IMAGE} alt={`Bastidor ${rack.name}, ${FACE_LABEL[face].toLowerCase()}`} draggable={false} /><RackEquipmentOverlay rack={displayRack} face={face} onSelect={(id) => setZoomDevice({ id, face })} onDropDevice={preview} draggingDeviceId={draggingDeviceId} onDragging={setDraggingDeviceId} canEdit={canEdit && !pending} pendingDeviceId={pending?.target?.id} /></div>
          </figure>)}
        </div>
        {zoomDevice && <RackDeviceZoom deviceId={zoomDevice.id} initialFace={zoomDevice.face} onBack={() => setZoomDevice(null)} onInterfaces={onDevice} onEditDevice={onEditDevice} />}
      </div>
    </div>
    {pending && <aside className="rack-placement-confirmation" aria-live="polite">
      <div className="rack-placement-summary"><span className="section-kicker">POSIÇÃO SNAPPED-IN</span><strong>{pending.target.name} ficou em U{pending.target.rackUnitStart}{pending.target.rackUnitSize > 1 ? `–U${pending.target.rackUnitStart + pending.target.rackUnitSize - 1}` : ''}</strong><small>{pending.changes.length > 1 ? `${pending.changes.length - 1} equipamento(s) também serão reposicionados para libertar espaço.` : 'A nova posição está livre.'}</small>{!correctingUnit && <button type="button" className="rack-placement-correction-trigger" disabled={saving} onClick={() => { setCorrectedUnit(String(pending.target.rackUnitStart)); setCorrectingUnit(true); }}>Calhou no U errado?</button>}{correctingUnit && <form className="rack-placement-correction" onSubmit={adjustUnit}><label htmlFor="corrected-rack-unit">Em que U deveria ficar?</label><div><span>U</span><input id="corrected-rack-unit" type="number" inputMode="numeric" min="1" max={maximumCorrectedUnit} required autoFocus value={correctedUnit} onChange={(event) => setCorrectedUnit(event.target.value)} aria-describedby="corrected-rack-unit-help" /><button type="submit" className="secondary-button" disabled={adjustingUnit || !correctedUnit}>{adjustingUnit ? 'A ajustar…' : 'Ajustar automaticamente'}</button></div><small id="corrected-rack-unit-help">Escolhe um valor entre U1 e U{maximumCorrectedUnit}.</small></form>}</div>
      <div className="button-row"><button type="button" className="secondary-button" disabled={saving || adjustingUnit} onClick={cancelPlacement}>Cancelar</button><button type="button" className="primary-button" disabled={saving || adjustingUnit || correctingUnit} onClick={confirm}><Check size={14} />{saving ? 'A guardar…' : 'Confirmar U'}</button></div>
    </aside>}
    {hasUnpositioned && <div className="no-data">Existem equipamentos por posicionar.</div>}
  </section>;
}
