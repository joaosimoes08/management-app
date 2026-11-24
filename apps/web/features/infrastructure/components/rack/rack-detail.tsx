'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { Activity, ArrowLeft, Check, Edit3, Trash2 } from 'lucide-react';
import { ImpactDialog } from '@/features/topology/impact-panel';
import { FIXED_RACK_IMAGE, RACK_BOTH_MIN_WIDTH, RACK_IMAGE, RACK_UNITS, readRackView, writeRackView } from '../../utils';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useI18n } from '@/lib/i18n';
import type { Device, Rack, RackEditDraft, RackFace, RackPlacementPlan, RackView } from '../../types';
import { formatWatts, PDU_IMAGE_ASPECT, pduView, rackPowerTotals, sortedPdus } from '../../power';
import { PDU_COMPACT_WIDTH, PDU_THIN_WIDTH, RackPduStrip } from './rack-pdu-strip';
import { RackDeviceZoom } from './rack-device-zoom';
import { RackEquipmentOverlay } from './rack-equipment-overlay';
import { RackViewPicker } from './rack-view-picker';
import { usePowerDefaults } from '../../use-power-defaults';
import { RackZoomPicker } from './rack-zoom-picker';
import { RackPowerSummaryStrip, RackPowerThresholdsModal, readPowerThresholds, summaryDeviceLevels, summaryPduLevels, useRackPowerSummary } from './rack-power-summary';
import type { RackPowerThresholds } from '../../api';

const RACK_WIDTH = RACK_IMAGE.width;
const RACK_HEIGHT = RACK_IMAGE.height;
/** Space between the two faces in "Ambas". */
const FACE_GAP = 24;
/** Height of the "Frente"/"Traseira" caption above each rack in "Ambas". */
const FACE_CAPTION = 24;
const FACE_LABEL: Record<RackFace, string> = { front: 'Frente', rear: 'Traseira' };
/** Space between a PDU strip and the rack beside it. */
const PDU_GAP = 10;
/** PDU strip width as a share of the rack width: both are drawn at the rack's height. */
const PDU_WIDTH_RATIO = (RACK_HEIGHT / RACK_WIDTH) * PDU_IMAGE_ASPECT;

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
  /** ADMIN / SYSTEMS_OPERATOR: may disconnect devices from a PDU. */
  canEditPower?: boolean;
  /** Desligar on a PDU card: frees the device's outlets on that PDU. */
  onDisconnectPdu?: (rackId: string, pduId: string, deviceId: string) => Promise<void>;
}

/** Full 42U view of one rack, including placement preview/confirmation. */
export function RackDetail({ rack, onOut, onDevice, onEdit, onDelete, deleting, canEdit, onPreviewPlacement, onPlaceDevice, onEditDevice, canEditPower = false, onDisconnectPdu }: RackDetailProps) {
  const { t, locale } = useI18n();
  const powerDefaults = usePowerDefaults();
  const [thresholds, setThresholds] = useState<RackPowerThresholds>(readPowerThresholds);
  const [editingThresholds, setEditingThresholds] = useState(false);
  const [impactOpen, setImpactOpen] = useState(false);
  const { summary: powerStatus, error: powerStatusError, setSummary: setPowerStatus } = useRackPowerSummary(rack, thresholds);
  const pduLevels = useMemo(() => summaryPduLevels(powerStatus), [powerStatus]);
  const devicePowerLevels = useMemo(() => summaryDeviceLevels(powerStatus), [powerStatus]);
  // Supplier PDU left of the racks, UPS PDU right; each is drawn once, also in Ambas. The summary's levels (with the
  // chosen thresholds) win over the levels the rack payload carries.
  const pdus = useMemo(() => sortedPdus(rack).map((pdu) => {
    const view = pduView(pdu, rack, powerDefaults);
    const level = pduLevels.get(pdu.id);
    return level ? { ...view, level } : view;
  }), [rack, powerDefaults, pduLevels]);
  const supplierPdu = pdus.find((view) => view.pdu.source === 'SUPPLIER');
  const upsPdu = pdus.find((view) => view.pdu.source === 'UPS');
  const pduCount = (supplierPdu ? 1 : 0) + (upsPdu ? 1 : 0);
  const totals = useMemo(() => rackPowerTotals(rack), [rack]);
  /** Visible label, aria-label and tooltip of the delete action stay in step while deleting. */
  const deleteLabel = deleting ? t('rack.deleting') : t('rack.delete');
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
  const [fitWidth, setFitWidth] = useState<number>(RACK_WIDTH);
  const [zoom, setZoom] = useState(1);

  useEffect(() => {
    const stage = stageRef.current;
    if (!stage) return;
    const measure = () => {
      const style = getComputedStyle(stage);
      const availableWidth = stage.clientWidth - (parseFloat(style.paddingLeft) || 0) - (parseFloat(style.paddingRight) || 0);
      const availableHeight = stage.clientHeight - (parseFloat(style.paddingTop) || 0) - (parseFloat(style.paddingBottom) || 0);
      // In "Ambas" both racks share the width and keep one U scale; each has a caption above it. PDU strips take
      // their share of the width beside the outer racks.
      const racks = both ? 2 : 1;
      const perRackWidth = (availableWidth - (both ? FACE_GAP : 0) - pduCount * PDU_GAP) / (racks + pduCount * PDU_WIDTH_RATIO);
      const rackHeight = availableHeight - (both ? FACE_CAPTION : 0);
      setFitWidth(Math.max(1, Math.min(RACK_WIDTH, perRackWidth, rackHeight * RACK_WIDTH / RACK_HEIGHT)));
    };
    measure();
    const observer = new ResizeObserver(measure);
    observer.observe(stage);
    return () => observer.disconnect();
  }, [both, pduCount]);

  const changeView = (next: RackView) => {
    setView(next);
    writeRackView(next);
  };
  const fitToStage = () => {
    setZoom(1);
    if (stageRef.current) { stageRef.current.scrollTop = 0; stageRef.current.scrollLeft = 0; }
  };
  /**
   * Face shown in the device focus. It starts on the face the device was clicked on (the rack's face, or the clicked
   * side in "Ambas") and from then on belongs to the focus only: the rack view and its stored preference stay as they were.
   */
  const focusFace: RackFace | undefined = zoomDevice?.face;
  const changeFocusFace = (next: RackView) => {
    if (next === 'both') return;
    setZoomDevice((current) => (current ? { ...current, face: next } : current));
  };
  const rackWidth = fitWidth * zoom;
  const rackHeight = fitWidth * RACK_HEIGHT / RACK_WIDTH * zoom;
  const pduWidth = rackHeight * PDU_IMAGE_ASPECT;
  // Zoomed out or on a small screen the strip collapses to a thin bar with only the badge.
  const pduDrawnWidth = pduWidth < PDU_COMPACT_WIDTH ? PDU_THIN_WIDTH : pduWidth;
  const innerWidth = (both ? rackWidth * 2 + FACE_GAP : rackWidth) + pduCount * (pduDrawnWidth + PDU_GAP);
  const powerSummary = pdus.length ? t('rack.power.total', '{total} estimado ({parts})', {
    total: formatWatts(totals.total, locale),
    parts: pdus.map((view) => t('rack.power.part', '{source} {watts}', { source: t(`rack.pdu.source.${view.pdu.source}`, view.pdu.source === 'UPS' ? 'UPS' : 'Rede'), watts: formatWatts(totals.bySource[view.pdu.source] ?? 0, locale) })).join(' · '),
  }) : '';
  const pduStrip = (view: (typeof pdus)[number] | undefined, side: 'left' | 'right') => view && <div className="rack-pdu-column" data-side={side} style={{ paddingTop: both ? `${FACE_CAPTION}px` : undefined, [side === 'left' ? 'marginRight' : 'marginLeft']: `${PDU_GAP}px` }}>
    <RackPduStrip view={view} side={side} width={pduWidth} height={rackHeight} canDisconnect={canEditPower} onDisconnect={onDisconnectPdu ? (pduId, deviceId) => onDisconnectPdu(rack.id, pduId, deviceId) : undefined} />
  </div>;

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
    <div className="rack-zoom-toolbar"><span>{rack.room?.building?.name} / {rack.room?.name} / <strong>{rack.name}</strong></span></div><PageToolbarPortal><div className="rack-view-tools" role="group" aria-label="Vista do bastidor">
      {focusFace ? <RackViewPicker value={focusFace} onChange={changeFocusFace} allowBoth={wide} focused /> : <RackViewPicker value={activeView} onChange={changeView} allowBoth={wide} />}
      <RackZoomPicker zoom={zoom} onZoom={setZoom} onFit={fitToStage} />
    </div></PageToolbarPortal><PageToolbarPortal><div className="button-row rack-detail-actions"><button type="button" className="secondary-button" onClick={onOut} aria-label={t('rack.back')} title={t('rack.back')}><ArrowLeft size={14} aria-hidden="true"/><span className="rack-action-label">{t('rack.back')}</span></button><button type="button" className="secondary-button" onClick={() => setImpactOpen(true)} aria-label="Impacto do bastidor ou de uma PDU" title="Impacto do bastidor ou de uma PDU"><Activity size={14} aria-hidden="true"/><span className="rack-action-label">Impacto</span></button>{onEdit && <button type="button" className="secondary-button" onClick={() => onEdit(rack)} aria-label={t('rack.edit')} title={t('rack.edit')}><Edit3 size={14} aria-hidden="true"/><span className="rack-action-label">{t('rack.edit')}</span></button>}{onDelete && <button type="button" className="secondary-button danger-button" disabled={deleting} onClick={() => onDelete(rack)} aria-label={deleteLabel} title={deleteLabel}><Trash2 size={14} aria-hidden="true"/><span className="rack-action-label">{deleteLabel}</span></button>}</div></PageToolbarPortal>
    {impactOpen && <ImpactDialog title="Impacto" siteId={rack.room?.building?.siteId} close={() => setImpactOpen(false)} targets={[{ kind: 'RACK', id: rack.id, label: rack.name }, ...sortedPdus(rack).map((pdu) => ({ kind: 'PDU' as const, id: pdu.id, label: pdu.name?.trim() || (pdu.source === 'UPS' ? 'PDU UPS' : 'PDU Rede') }))]} />}
    <div className="rack-overview-row">
      <div className="panel-heading"><div><h2>{rack.name}</h2><p>{rack.devices?.length ?? 0} equipamentos · Bastidor padrão · 42U{canEdit ? <>{' · '}<span>Arrasta um equipamento para o mover</span></> : null}</p>{powerSummary && <p className="rack-power-summary" data-testid="rack-power-summary">{powerSummary}</p>}</div></div>
      <RackPowerSummaryStrip summary={powerStatus} error={powerStatusError} onEditThresholds={() => setEditingThresholds(true)} />
    </div>
    {editingThresholds && <RackPowerThresholdsModal rackId={rack.id} value={{ warningPercent: thresholds.warningPercent ?? powerStatus?.thresholds.warningPercent ?? 80, criticalPercent: thresholds.criticalPercent ?? powerStatus?.thresholds.criticalPercent ?? 90 }} close={() => setEditingThresholds(false)} onSaved={(next, nextSummary) => { setThresholds(next); setPowerStatus(nextSummary); setEditingThresholds(false); }} />}
    <div className="rack-stage-wrap">
      <div className={`rack-stage${both ? ' rack-stage-both' : ''}`} ref={stageRef} data-view={activeView}>
        <div className="rack-stage-inner" style={{ width: `${innerWidth}px`, height: `${rackHeight + (both ? FACE_CAPTION : 0)}px` }}>
          {pduStrip(supplierPdu, 'left')}
          {faces.map((face, index) => <figure className="rack-face" key={face} data-face={face} style={{ width: `${rackWidth}px`, marginLeft: index > 0 ? `${FACE_GAP}px` : undefined }}>
            {both && <figcaption className="rack-face-caption" style={{ height: `${FACE_CAPTION}px` }}>{FACE_LABEL[face]}</figcaption>}
            <div className="rack-frame" style={{ width: `${rackWidth}px` }}><img src={FIXED_RACK_IMAGE} alt={`Bastidor ${rack.name}, ${FACE_LABEL[face].toLowerCase()}`} draggable={false} /><RackEquipmentOverlay rack={displayRack} face={face} onSelect={(id) => setZoomDevice({ id, face })} onDropDevice={preview} draggingDeviceId={draggingDeviceId} onDragging={setDraggingDeviceId} canEdit={canEdit && !pending} pendingDeviceId={pending?.target?.id} powerLevels={devicePowerLevels} /></div>
          </figure>)}
          {pduStrip(upsPdu, 'right')}
        </div>
        {zoomDevice && focusFace && <RackDeviceZoom deviceId={zoomDevice.id} face={focusFace} onBack={() => setZoomDevice(null)} onInterfaces={onDevice} onEditDevice={onEditDevice} />}
      </div>
    </div>
    {pending && <aside className="rack-placement-confirmation" aria-live="polite">
      <div className="rack-placement-summary"><strong>{pending.target.name} ficou em U{pending.target.rackUnitStart}{pending.target.rackUnitSize > 1 ? `–U${pending.target.rackUnitStart + pending.target.rackUnitSize - 1}` : ''}</strong><small>{pending.changes.length > 1 ? `${pending.changes.length - 1} equipamento(s) também serão reposicionados para libertar espaço.` : 'A nova posição está livre.'}</small>{!correctingUnit && <button type="button" className="rack-placement-correction-trigger" disabled={saving} onClick={() => { setCorrectedUnit(String(pending.target.rackUnitStart)); setCorrectingUnit(true); }}>Calhou no U errado?</button>}{correctingUnit && <form className="rack-placement-correction" onSubmit={adjustUnit}><label htmlFor="corrected-rack-unit">Em que U deveria ficar?</label><div><span>U</span><input id="corrected-rack-unit" type="number" inputMode="numeric" min="1" max={maximumCorrectedUnit} required autoFocus value={correctedUnit} onChange={(event) => setCorrectedUnit(event.target.value)} aria-describedby="corrected-rack-unit-help" /><button type="submit" className="secondary-button" disabled={adjustingUnit || !correctedUnit}>{adjustingUnit ? 'A ajustar…' : 'Ajustar automaticamente'}</button></div><small id="corrected-rack-unit-help">Escolhe um valor entre U1 e U{maximumCorrectedUnit}.</small></form>}</div>
      <div className="button-row"><button type="button" className="secondary-button" disabled={saving || adjustingUnit} onClick={cancelPlacement}>Cancelar</button><button type="button" className="primary-button" disabled={saving || adjustingUnit || correctingUnit} onClick={confirm}><Check size={14} />{saving ? 'A guardar…' : 'Confirmar U'}</button></div>
    </aside>}
    {hasUnpositioned && <div className="no-data">Existem equipamentos por posicionar.</div>}
  </section>;
}
