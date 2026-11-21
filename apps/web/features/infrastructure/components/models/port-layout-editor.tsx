'use client';

import { useEffect, useRef, useState } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { compactPortGrid, PORT_TYPES, portMappingStatus, RACK_FACES, type PortMappingStatus } from '../../utils';
import type { AssetFile, DeviceModel, PortLayout, PortLayoutPort, RackFace } from '../../types';
import { AssetImage } from '../asset-image';
import { useConfirm } from '@/components/ui/confirm-dialog';

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

const FACE_TEXT: Record<RackFace, { tab: string; image: string; select: string; alt: string }> = {
  front: { tab: 'Frente', image: 'Imagem frontal do modelo', select: 'Seleciona uma imagem frontal para posicionar as portas.', alt: 'Imagem frontal do modelo' },
  rear: { tab: 'Traseira', image: 'Imagem traseira do modelo', select: 'Seleciona uma imagem traseira para posicionar as portas.', alt: 'Imagem traseira do modelo' },
};

/**
 * Problems that block saving, mirroring the API: every listed port fully mapped; for a model with network ports
 * (supportsNetworkPorts and a count above 0) the mapped total must match; a model that supports network ports never
 * takes more than it declares; every face with ports needs its image. Otherwise the map is informational.
 */
export function portLayoutBlockers(model: DeviceModel | null, faces: PortLayoutFacesDraft | null, assetIds: PortLayoutAssetsDraft): string[] {
  if (!model || !faces) return [];
  const blockers: string[] = [];
  const status = portMappingStatus(model, faces);
  if (status.partial) blockers.push(status.partial === 1 ? '1 porta não está completamente mapeada (interface, posição e tamanho).' : `${status.partial} portas não estão completamente mapeadas (interface, posição e tamanho).`);
  if (status.required && status.mapped < status.expected) blockers.push(`Mapeamento incompleto: faltam ${status.expected - status.mapped} de ${status.expected} portas.`);
  if (status.extra) blockers.push(`Existem ${status.extra} portas a mais do que as ${status.expected} do modelo.`);
  for (const face of RACK_FACES) {
    if (faces[face].ports.length && !assetIds[face]) blockers.push(face === 'front' ? 'A frente tem portas mas não tem imagem.' : 'A traseira tem portas mas não tem imagem.');
  }
  return blockers;
}

/** Headline of the mapping total: "N de M" when the count is enforced, otherwise just what is mapped. */
export function portMappingTotal(status: PortMappingStatus): string {
  if (status.required || status.extra) return `${status.mapped} de ${status.expected} portas mapeadas`;
  return status.mapped === 1 ? '1 porta mapeada · sem contagem obrigatória' : `${status.mapped} portas mapeadas · sem contagem obrigatória`;
}

/** Short reason next to the disabled save button: how many ports are left, or a pointer to the warnings. */
export function portLayoutSaveHint(model: DeviceModel | null, faces: PortLayoutFacesDraft | null, blockers: string[]): string {
  if (!model || !faces || !blockers.length) return '';
  const status = portMappingStatus(model, faces);
  const left = status.required ? status.expected - status.mapped : 0;
  if (left === 1) return 'Falta 1 porta por mapear.';
  if (left > 1) return `Faltam ${left} portas por mapear.`;
  return 'Resolve os avisos acima para guardar.';
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

  return <div ref={canvas} className="port-preview" style={{ aspectRatio: ratio }} onPointerMove={updateFromPointer} onPointerUp={stopInteraction} onPointerCancel={stopInteraction} aria-label="Imagem do modelo com posições das portas">
    <AssetImage asset={asset} alt={alt} onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
    {ports.map((port, index) => <button type="button" className="port-hotspot-editor" key={`${port.portKey}-${index}`} onPointerDown={(event) => startInteraction(event, index, 'move')} onKeyDown={(event) => moveByKeyboard(event, index)} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} aria-label={`${port.label || port.portKey}, posição ${Math.round(port.x * 100)} por cento horizontal e ${Math.round(port.y * 100)} por cento vertical. Use as setas para mover; Alt mais setas para redimensionar.`} title={`${port.label} · arrastar para mover · setas para mover · Alt + setas para redimensionar`}><b>{port.label}</b><i className="port-resize-handle" aria-hidden="true" onPointerDown={(event) => startInteraction(event, index, 'resize')} /></button>)}
  </div>;
}

/** Port mapping editor: one tab per face, each over that face's image, with the mapped total checked against the model. */
export function PortLayoutEditor({ modal, close, layoutModel, faces, setFaces, face, setFace, assets, assetIds, setAssetId, detect, confirm, saving, error }: PortLayoutEditorProps) {
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
  const text = FACE_TEXT[face];
  const layout = faces[face];
  const ports = layout.ports;
  const dirty = baseline !== null && baseline !== draftSnapshot(faces, assetIds);
  const status = portMappingStatus(layoutModel, faces);
  const blockers = portLayoutBlockers(layoutModel, faces, assetIds);
  const saveHint = portLayoutSaveHint(layoutModel, faces, blockers);
  const otherFace: RackFace = face === 'front' ? 'rear' : 'front';
  const requestClose = async () => {
    if (dirty && !(await askConfirm({ title: 'Alterações por guardar', message: 'Existem alterações por guardar. Queres sair sem guardar?', confirmLabel: 'Sair sem guardar', cancelLabel: 'Continuar a editar', destructive: true }))) return;
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
    setLayout({ ...layout, ports: [...ports, { portKey: `ethernet1/${next}`, label: `Porta ${next}`, interfaceType: 'ETHERNET', x: .05, y: .05, width: .02, height: .16 }] });
  };
  const removePort = (index: number) => setLayout({ ...layout, ports: ports.filter((_, i) => i !== index) });
  const compactGrid = () => setLayout({ ...layout, ports: compactPortGrid(ports), warnings: ['Grelha geométrica compacta aplicada; confirma a posição sobre a imagem.'] });
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

  return <>{confirmDialog}<Modal title={`Mapear portas · ${layoutModel?.manufacturer} ${layoutModel?.model}`} close={requestClose}><div className="port-editor">
    <p className="form-help">Mapeia as portas em cada face do equipamento e associa-as à interface correspondente. Arrasta para mover; usa as setas para ajustes precisos. Alt + setas redimensiona. As posições são relativas à imagem de cada face.</p>
    <div className={`port-mapping-total${status.complete ? ' complete' : ' incomplete'}`} role="status" aria-live="polite">
      <strong>{portMappingTotal(status)}</strong>
      <span>{`Frente ${faces.front.ports.length} · Traseira ${faces.rear.ports.length}`}</span>
    </div>
    {blockers.length > 0 && <div className="ipam-alert warning port-mapping-warning" role="alert">{blockers.map((blocker) => <span key={blocker}>{blocker}</span>)}</div>}
    {dirty && <p className="port-editor-unsaved" role="status">Alterações por guardar</p>}
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    <div className="infra-menu port-face-tabs" role="tablist" aria-label="Face do equipamento" onKeyDown={moveTab}>
      {RACK_FACES.map((candidate) => <button key={candidate} ref={(element) => { tabs.current[candidate] = element; }} type="button" role="tab" id={`port-face-tab-${candidate}`} aria-controls="port-face-panel" aria-selected={face === candidate} tabIndex={face === candidate ? 0 : -1} className={face === candidate ? 'active' : ''} onClick={() => setFace(candidate)}>{FACE_TEXT[candidate].tab}<em>{faces[candidate].ports.length}</em></button>)}
    </div>
    <div className="port-face-panel" role="tabpanel" id="port-face-panel" aria-labelledby={`port-face-tab-${face}`}>
      <label>{text.image}<select value={assetIds[face]} onChange={(event) => setAssetId(face, event.target.value)}><option value="">Seleciona um asset</option>{assets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.filename}</option>)}</select></label>
      <div className="button-row"><button type="button" className="secondary-button" onClick={() => detect(face)} disabled={!assetIds[face]}><Plus size={14} /> Detetar grelha automaticamente</button><button type="button" className="secondary-button" onClick={compactGrid} disabled={!ports.length}>Alinhar e reduzir hotspots</button><button type="button" className="secondary-button" onClick={addPort}><Plus size={14} /> Adicionar porta</button><span className="form-help">Confiança: {layout.confidence ? `${Math.round(layout.confidence * 100)}%` : '—'}</span></div>
      {!ports.length && <p className="port-face-empty" role="status">0 portas nesta face. Podes guardar assim se todas as portas estiverem na outra face.</p>}
      {asset ? <InteractivePortCanvas asset={asset} alt={text.alt} ports={ports} ratio={ratio} onUpdate={updateCanvasPort} onDimensions={captureDimensions} /> : <div className="port-editor-empty" role="status">{text.select}</div>}
      <div className="port-table" role="list" aria-label={`Portas mapeadas · ${text.tab}`}>{ports.map((port, index) => <div className="port-editor-row" role="listitem" key={`${port.portKey}-${index}`}><label><span>Nome</span><input aria-label={`Nome da porta ${index + 1}`} value={port.label ?? ''} onChange={(event) => updatePort(index, 'label', event.target.value)} placeholder="Nome" /></label><label><span>Interface</span><input aria-label={`Chave da interface ${index + 1}`} value={port.portKey ?? ''} onChange={(event) => updatePort(index, 'portKey', event.target.value)} placeholder="portKey" /></label><label><span>Tipo</span><select aria-label={`Tipo da porta ${index + 1}`} value={port.interfaceType ?? 'ETHERNET'} onChange={(event) => updatePort(index, 'interfaceType', event.target.value)}>{PORT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}><span>{field === 'width' ? 'Largura' : field === 'height' ? 'Altura' : field.toUpperCase()}</span><input aria-label={`${field} da porta ${index + 1}`} type="number" min="0" max="1" step=".001" value={port[field] ?? 0} onChange={(event) => updatePort(index, field, event.target.value)} /></label>)}<button type="button" className="icon-button subtle" aria-label={`Remover porta ${port.label || index + 1}`} onClick={() => removePort(index)}><X size={14} /></button></div>)}</div>
    </div>
    <div className="modal-actions port-layout-actions">{saveHint && <small id="port-layout-save-hint" className="port-layout-save-hint" aria-live="polite">{saveHint}</small>}<button type="button" className="secondary-button" onClick={requestClose}>Cancelar</button><button type="button" className="primary-button" onClick={confirm} disabled={saving || !layoutModel || blockers.length > 0} aria-describedby={saveHint ? 'port-layout-save-hint' : undefined}>{saving ? 'A guardar…' : <><Check size={14} /> Guardar template</>}</button></div>
  </div></Modal></>;
}
