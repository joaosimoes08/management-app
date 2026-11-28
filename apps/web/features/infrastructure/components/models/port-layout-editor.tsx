'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { compactPortGrid, PORT_TYPES, portMappingStatus, RACK_FACES, type PortMappingStatus } from '../../utils';
import type { AssetFile, DeviceModel, PortLayout, PortLayoutPort, RackFace } from '../../types';
import { AssetImage } from '../asset-image';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useUiText } from '@/components/ui/use-ui-text';
import { portugueseText, type InfrastructureText } from '../../infrastructure-text';

/** Editor state: one layout and one image per face. */
export type PortLayoutFacesDraft = Record<RackFace, PortLayout>;
export type PortLayoutAssetsDraft = Record<RackFace, string>;

export interface PortLayoutEditorProps {
  modal: boolean | string;
  close: () => void;
  layoutModel: DeviceModel | null;
  faces: PortLayoutFacesDraft | null;
  setFaces: (faces: PortLayoutFacesDraft) => void;
  face: RackFace;
  setFace: (face: RackFace) => void;
  assets: AssetFile[];
  assetIds: PortLayoutAssetsDraft;
  setAssetId: (face: RackFace, id: string) => void;
  detect: (face: RackFace) => void;
  confirm: () => void;
  saving: boolean;
  error: string;
}

export const EMPTY_FACE_LAYOUT: PortLayout = { imageWidth: 1000, imageHeight: 300, ports: [] };

/** Comparable form of a face: a face without ports is just empty, whatever its measured image size. */
export function faceSnapshot(layout: PortLayout | undefined): string {
  return layout?.ports?.length ? JSON.stringify(layout) : '[]';
}

/** Body of PUT device-models/:id/port-layout/faces: an object replaces a face, null clears its map, absent leaves it. */
export interface FaceSaveBody {
  imageWidth: number;
  imageHeight: number;
  viewport: PortLayout['viewport'] | null;
  ports: PortLayoutPort[];
  assetId?: string;
  confirmedAt?: string;
}
export type FacesSave = Partial<Record<RackFace, FaceSaveBody | null>>;

const cleanPort = (port: PortLayoutPort, index: number): PortLayoutPort => ({
  ...port,
  portKey: String(port.portKey || `ethernet1/${index + 1}`),
  label: String(port.label || port.portKey || `Porta ${index + 1}`),
  x: Math.max(0, Math.min(1, Number(port.x) || 0)),
  y: Math.max(0, Math.min(1, Number(port.y) || 0)),
  width: Math.max(.005, Math.min(1, Number(port.width) || .03)),
  height: Math.max(.005, Math.min(1, Number(port.height) || .3)),
});

/**
 * Faces to send in one atomic save: only the faces whose ports or image changed.
 * A face emptied of ports with the same image is sent as null (map removed, image kept);
 * an image is sent only when it changed to another image. Null when nothing changed.
 */
export function buildFacesSave(saved: Partial<Record<RackFace, PortLayout>>, next: Record<RackFace, PortLayout>, savedAssets: PortLayoutAssetsDraft, assetIds: PortLayoutAssetsDraft, confirmedAt?: string): FacesSave | null {
  const faces: FacesSave = {};
  for (const face of RACK_FACES) {
    const imageChanged = savedAssets[face] !== assetIds[face] && Boolean(assetIds[face]);
    if (faceSnapshot(saved[face]) === faceSnapshot(next[face]) && !imageChanged) continue;
    const layout = next[face];
    const ports = (layout.ports ?? []).map(cleanPort);
    // An empty face only differs from its snapshot when it had ports: clear the map, keep the image.
    if (!ports.length && !imageChanged) { faces[face] = null; continue; }
    faces[face] = {
      imageWidth: Math.max(1, Math.round(layout.imageWidth ?? 1000)),
      imageHeight: Math.max(1, Math.round(layout.imageHeight ?? 300)),
      viewport: layout.viewport ?? null,
      ports,
      ...(imageChanged ? { assetId: assetIds[face] } : {}),
      ...(confirmedAt ? { confirmedAt } : {}),
    };
  }
  return Object.keys(faces).length ? faces : null;
}

function draftSnapshot(faces: PortLayoutFacesDraft | null, assetIds: PortLayoutAssetsDraft): string {
  return JSON.stringify({ front: faceSnapshot(faces?.front), rear: faceSnapshot(faces?.rear), assetIds });
}


/**
 * Problems that block saving, mirroring the API: every listed port fully mapped; for a model with network ports
 * (supportsNetworkPorts and a count above 0) the mapped total must match; a model that supports network ports never
 * takes more than it declares; every face with ports needs its image. Otherwise the map is informational.
 */
export function portLayoutBlockers(model: DeviceModel | null, faces: PortLayoutFacesDraft | null, assetIds: PortLayoutAssetsDraft, ui: InfrastructureText = portugueseText): string[] {
  if (!model || !faces) return [];
  const blockers: string[] = [];
  const status = portMappingStatus(model, faces);
  if (status.partial) blockers.push(ui('infrastructure.portLayoutEditor.blocker.partial', undefined, { count: status.partial }));
  if (status.required && status.mapped < status.expected) blockers.push(ui('infrastructure.portLayoutEditor.blocker.missing', undefined, { missing: status.expected - status.mapped, expected: status.expected }));
  if (status.extra) blockers.push(ui('infrastructure.portLayoutEditor.blocker.extra', undefined, { extra: status.extra, expected: status.expected }));
  for (const face of RACK_FACES) {
    if (faces[face].ports.length && !assetIds[face]) blockers.push(ui(face === 'front' ? 'infrastructure.portLayoutEditor.blocker.frontImage' : 'infrastructure.portLayoutEditor.blocker.rearImage'));
  }
  return blockers;
}

/** Headline of the mapping total: "N de M" when the count is enforced, otherwise just what is mapped. */
export function portMappingTotal(status: PortMappingStatus, ui: InfrastructureText = portugueseText): string {
  if (status.required || status.extra) return ui('infrastructure.portLayoutEditor.total.ofExpected', undefined, { mapped: status.mapped, expected: status.expected });
  return ui('infrastructure.portLayoutEditor.total.free', undefined, { count: status.mapped });
}

/** Short reason next to the disabled save button: how many ports are left, or a pointer to the warnings. */
export function portLayoutSaveHint(model: DeviceModel | null, faces: PortLayoutFacesDraft | null, blockers: string[], ui: InfrastructureText = portugueseText): string {
  if (!model || !faces || !blockers.length) return '';
  const status = portMappingStatus(model, faces);
  const left = status.required ? status.expected - status.mapped : 0;
  if (left > 0) return ui('infrastructure.portLayoutEditor.saveHint.left', undefined, { count: left });
  return ui('infrastructure.portLayoutEditor.saveHint.resolve');
}

interface InteractivePortCanvasProps {
  asset: AssetFile;
  alt: string;
  ports: PortLayoutPort[];
  ratio: number;
  onUpdate: (index: number, patch: Partial<PortLayoutPort>) => void;
  onDimensions: (width: number, height: number) => void;
}

type Interaction = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; port: PortLayoutPort };

function InteractivePortCanvas({ asset, alt, ports, ratio, onUpdate, onDimensions }: InteractivePortCanvasProps) {
  const ui = useUiText();
  const canvas = useRef<HTMLDivElement | null>(null);
  const interaction = useRef<Interaction | null>(null);
  const updateFromPointer = (event: React.PointerEvent) => {
    const active = interaction.current;
    const element = canvas.current;
    if (!active || !element) return;
    const rect = element.getBoundingClientRect();
    const dx = (event.clientX - active.startX) / rect.width;
    const dy = (event.clientY - active.startY) / rect.height;
    const original = active.port;
    const patch = active.mode === 'move'
      ? { x: Math.max(0, Math.min(1 - original.width, original.x + dx)), y: Math.max(0, Math.min(1 - original.height, original.y + dy)) }
      : { width: Math.max(.005, Math.min(1 - original.x, original.width + dx)), height: Math.max(.005, Math.min(1 - original.y, original.height + dy)) };
    onUpdate(active.index, patch);
  };
  const stopInteraction = (event: React.PointerEvent) => {
    if (interaction.current && canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    interaction.current = null;
  };
  const startInteraction = (event: React.PointerEvent, index: number, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    canvas.current?.setPointerCapture(event.pointerId);
    interaction.current = { index, mode, startX: event.clientX, startY: event.clientY, port: { ...ports[index] } };
  };
  const moveByKeyboard = (event: React.KeyboardEvent, index: number) => {
    const step = event.shiftKey ? .02 : .005;
    const port = ports[index];
    let patch: Partial<PortLayoutPort> | undefined;
    if (event.key === 'ArrowLeft') patch = event.altKey ? { width: Math.max(.005, port.width - step) } : { x: Math.max(0, port.x - step) };
    if (event.key === 'ArrowRight') patch = event.altKey ? { width: Math.min(1 - port.x, port.width + step) } : { x: Math.min(1 - port.width, port.x + step) };
    if (event.key === 'ArrowUp') patch = event.altKey ? { height: Math.max(.005, port.height - step) } : { y: Math.max(0, port.y - step) };
    if (event.key === 'ArrowDown') patch = event.altKey ? { height: Math.min(1 - port.y, port.height + step) } : { y: Math.min(1 - port.height, port.y + step) };
    if (patch) { event.preventDefault(); onUpdate(index, patch); }
  };

  return <div ref={canvas} className="port-preview" style={{ aspectRatio: ratio }} onPointerMove={updateFromPointer} onPointerUp={stopInteraction} onPointerCancel={stopInteraction} aria-label={ui('infrastructure.portLayoutEditor.modelImageWithPortPositions')}>
    <AssetImage asset={asset} alt={alt} onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
    {ports.map((port, index) => <button type="button" className="port-hotspot-editor" key={`${port.portKey}-${index}`} onPointerDown={(event) => startInteraction(event, index, 'move')} onKeyDown={(event) => moveByKeyboard(event, index)} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} aria-label={ui('infra.ports.canvasPortLabel', undefined, { port: port.label || port.portKey, x: Math.round(port.x * 100), y: Math.round(port.y * 100) })} title={ui('infra.ports.canvasPortTitle', undefined, { port: port.label ?? '' })}><b>{port.label}</b><i className="port-resize-handle" aria-hidden="true" onPointerDown={(event) => startInteraction(event, index, 'resize')} /></button>)}
  </div>;
}

/** Port mapping editor: one tab per face, each over that face's image, with the mapped total checked against the model. */
export function PortLayoutEditor({ modal, close, layoutModel, faces, setFaces, face, setFace, assets, assetIds, setAssetId, detect, confirm, saving, error }: PortLayoutEditorProps) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const [baseline, setBaseline] = useState<string | null>(null);
  const wasOpen = useRef(false);
  const tabs = useRef<Partial<Record<RackFace, HTMLButtonElement | null>>>({});
  useEffect(() => {
    const isOpen = Boolean(modal) && Boolean(faces);
    if (isOpen && !wasOpen.current) setBaseline(draftSnapshot(faces, assetIds));
    if (!isOpen) setBaseline(null);
    wasOpen.current = isOpen;
  }, [modal, faces, assetIds]);
  if (!modal || !faces) return null;
  const faceText = (candidate: RackFace) => ({ tab: ui(`infra.ports.${candidate}.tab`), image: ui(`infra.ports.${candidate}.image`), select: ui(`infra.ports.${candidate}.select`), alt: ui(`infra.ports.${candidate}.image`) });
  const text = faceText(face);
  const layout = faces[face];
  const ports = layout.ports;
  const dirty = baseline !== null && baseline !== draftSnapshot(faces, assetIds);
  const status = portMappingStatus(layoutModel, faces);
  const blockers = portLayoutBlockers(layoutModel, faces, assetIds, ui);
  const saveHint = portLayoutSaveHint(layoutModel, faces, blockers, ui);
  const otherFace: RackFace = face === 'front' ? 'rear' : 'front';
  const requestClose = async () => {
    if (dirty && !(await askConfirm({ title: ui('infrastructure.portLayoutEditor.unsavedChanges'), message: ui('infrastructure.portLayoutEditor.thereAreUnsavedChangesLeave'), confirmLabel: ui('infrastructure.portLayoutEditor.leaveWithoutSaving'), cancelLabel: ui('infrastructure.portLayoutEditor.keepEditing'), destructive: true }))) return;
    close();
  };
  const setLayout = (next: PortLayout) => setFaces({ ...faces, [face]: next });
  const allPorts = RACK_FACES.flatMap((candidate) => faces[candidate].ports);
  const updatePort = (index: number, field: keyof PortLayoutPort, value: string) => setLayout({
    ...layout,
    ports: ports.map((port, i) => i === index ? { ...port, [field]: ['x', 'y', 'width', 'height'].includes(field) ? Number(value) : value } : port),
  });
  const updateCanvasPort = (index: number, patch: Partial<PortLayoutPort>) => setLayout({ ...layout, ports: ports.map((port, i) => i === index ? { ...port, ...patch } : port) });
  const addPort = () => {
    const used = new Set(allPorts.map((port) => port.portKey));
    let next = allPorts.length + 1;
    while (used.has(`ethernet1/${next}`)) next += 1;
    setLayout({ ...layout, ports: [...ports, { portKey: `ethernet1/${next}`, label: ui('infra.portNamed', undefined, { port: next }), interfaceType: 'ETHERNET', x: .05, y: .05, width: .02, height: .16 }] });
  };
  const removePort = (index: number) => setLayout({ ...layout, ports: ports.filter((_, i) => i !== index) });
  const compactGrid = () => setLayout({ ...layout, ports: compactPortGrid(ports), warnings: [ui('infrastructure.portLayoutEditor.compactGeometricGridAppliedConfirm')] });
  const captureDimensions = (width: number, height: number) => {
    if (layout.imageWidth !== width || layout.imageHeight !== height) setLayout({ ...layout, imageWidth: width, imageHeight: height });
  };
  const ratio = layout.imageWidth && layout.imageHeight ? layout.imageWidth / layout.imageHeight : 9.32;
  const asset = assets.find((candidate) => candidate.id === assetIds[face]);
  const moveTab = (event: React.KeyboardEvent) => {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const next = event.key === 'Home' ? 'front' : event.key === 'End' ? 'rear' : otherFace;
    setFace(next);
    tabs.current[next]?.focus();
  };

  return <>{confirmDialog}<Modal title={ui('infra.ports.mapTitle', undefined, { manufacturer: layoutModel?.manufacturer ?? '', model: layoutModel?.model ?? '' })} close={requestClose}><div className="port-editor">
    <p className="form-help">{ui('infrastructure.portLayoutEditor.mapThePortsOnEach')}</p>
    <div className={`port-mapping-total${status.complete ? ' complete' : ' incomplete'}`} role="status" aria-live="polite">
      <strong>{portMappingTotal(status, ui)}</strong>
      <span>{ui('infrastructure.portLayoutEditor.faceCounts', undefined, { front: faces.front.ports.length, rear: faces.rear.ports.length })}</span>
    </div>
    {blockers.length > 0 && <div className="ipam-alert warning port-mapping-warning" role="alert">{blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}</div>}
    {dirty && <p className="port-editor-unsaved" role="status">{ui('infrastructure.portLayoutEditor.unsavedChanges')}</p>}
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    <div className="infra-menu port-face-tabs" role="tablist" aria-label={ui('infrastructure.portLayoutEditor.deviceFace')} onKeyDown={moveTab}>
      {RACK_FACES.map((candidate) => <button key={candidate} ref={(element) => { tabs.current[candidate] = element; }} type="button" role="tab" id={`port-face-tab-${candidate}`} aria-controls="port-face-panel" aria-selected={face === candidate} tabIndex={face === candidate ? 0 : -1} className={face === candidate ? 'active' : ''} onClick={() => setFace(candidate)}>{faceText(candidate).tab}<em>{faces[candidate].ports.length}</em></button>)}
    </div>
    <div className="port-face-panel" role="tabpanel" id="port-face-panel" aria-labelledby={`port-face-tab-${face}`}>
      <label>{text.image}<select value={assetIds[face]} onChange={(event) => setAssetId(face, event.target.value)}><option value="">{ui('infrastructure.portLayoutEditor.selectAnAsset')}</option>{assets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.filename}</option>)}</select></label>
      <div className="button-row"><button type="button" className="secondary-button" onClick={() => detect(face)} disabled={!assetIds[face]}><Plus size={14} /> {ui('infrastructure.portLayoutEditor.detectGridAutomatically')}</button><button type="button" className="secondary-button" onClick={compactGrid} disabled={!ports.length}>{ui('infrastructure.portLayoutEditor.alignAndShrinkHotspots')}</button><button type="button" className="secondary-button" onClick={addPort}><Plus size={14} /> {ui('infrastructure.portLayoutEditor.addPort')}</button><span className="form-help">{ui('infrastructure.portLayoutEditor.confidence')} {layout.confidence ? `${Math.round(layout.confidence * 100)}%` : '—'}</span></div>
      {!ports.length && <p className="port-face-empty" role="status">{ui('infrastructure.portLayoutEditor.0PortsOnThisFace')}</p>}
      {asset ? <InteractivePortCanvas asset={asset} alt={text.alt} ports={ports} ratio={ratio} onUpdate={updateCanvasPort} onDimensions={captureDimensions} /> : <div className="port-editor-empty" role="status">{text.select}</div>}
      <div className="port-table" role="list" aria-label={ui('infra.ports.mapped', undefined, { face: text.tab })}>{ports.map((port, index) => <div className="port-editor-row" role="listitem" key={`${port.portKey}-${index}`}><label><span>{ui('infrastructure.portLayoutEditor.name')}</span><input aria-label={ui('infra.ports.nameOf', undefined, { index: index + 1 })} value={port.label ?? ''} onChange={(event) => updatePort(index, 'label', event.target.value)} placeholder={ui('infrastructure.portLayoutEditor.name')} /></label><label><span>Interface</span><input aria-label={ui('infra.ports.keyOf', undefined, { index: index + 1 })} value={port.portKey ?? ''} onChange={(event) => updatePort(index, 'portKey', event.target.value)} placeholder="portKey" /></label><label><span>{ui('infrastructure.portLayoutEditor.type')}</span><select aria-label={ui('infra.ports.typeOf', undefined, { index: index + 1 })} value={port.interfaceType ?? 'ETHERNET'} onChange={(event) => updatePort(index, 'interfaceType', event.target.value)}>{PORT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}><span>{field === 'width' ? ui('infra.ports.width') : field === 'height' ? ui('infra.ports.height') : field.toUpperCase()}</span><input aria-label={ui('infra.ports.fieldOf', undefined, { field, index: index + 1 })} type="number" min="0" max="1" step=".001" value={port[field] ?? 0} onChange={(event) => updatePort(index, field, event.target.value)} /></label>)}<button type="button" className="icon-button subtle" aria-label={ui('infra.ports.removeNamed', undefined, { port: port.label || index + 1 })} onClick={() => removePort(index)}><X size={14} /></button></div>)}</div>
    </div>
    <div className="modal-actions port-layout-actions">{saveHint && <small id="port-layout-save-hint" className="port-layout-save-hint" aria-live="polite">{saveHint}</small>}<button type="button" className="secondary-button" onClick={requestClose}>{ui('infrastructure.portLayoutEditor.cancel')}</button><button type="button" className="primary-button" onClick={confirm} disabled={saving || !layoutModel || blockers.length > 0} aria-describedby={saveHint ? 'port-layout-save-hint' : undefined}>{saving ? ui('infrastructure.portLayoutEditor.saving') : <><Check size={14} /> {ui('infrastructure.portLayoutEditor.saveTemplate')}</>}</button></div>
  </div></Modal></>;
}
