'use client';

import { useEffect, useRef } from 'react';
import { Check, Plus, X } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import { compactPortGrid, PORT_TYPES } from '../../utils';
import type { AssetFile, DeviceModel, PortLayout, PortLayoutPort } from '../../types';
import { AssetImage } from '../asset-image';

export interface PortLayoutEditorProps {
  modal: boolean | string;
  close: () => void;
  layoutModel: DeviceModel | null;
  layout: PortLayout | null;
  setLayout: (layout: PortLayout | null) => void;
  assets: AssetFile[];
  assetId: string;
  setAssetId: (id: string) => void;
  detect: () => void;
  confirm: () => void;
  saving: boolean;
  error: string;
}

interface InteractivePortCanvasProps {
  asset: AssetFile;
  ports: PortLayoutPort[];
  ratio: number;
  onUpdate: (index: number, patch: Partial<PortLayoutPort>) => void;
  onDimensions: (width: number, height: number) => void;
}

type Interaction = { index: number; mode: 'move' | 'resize'; startX: number; startY: number; port: PortLayoutPort };

function InteractivePortCanvas({ asset, ports, ratio, onUpdate, onDimensions }: InteractivePortCanvasProps) {
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
    <AssetImage asset={asset} alt="Imagem frontal do modelo" onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />
    {ports.map((port, index) => <button type="button" className="port-hotspot-editor" key={`${port.portKey}-${index}`} onPointerDown={(event) => startInteraction(event, index, 'move')} onKeyDown={(event) => moveByKeyboard(event, index)} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} aria-label={`${port.label || port.portKey}, posição ${Math.round(port.x * 100)} por cento horizontal e ${Math.round(port.y * 100)} por cento vertical. Use as setas para mover; Alt mais setas para redimensionar.`} title={`${port.label} · arrastar para mover · setas para mover · Alt + setas para redimensionar`}><b>{port.label}</b><i className="port-resize-handle" aria-hidden="true" onPointerDown={(event) => startInteraction(event, index, 'resize')} /></button>)}
  </div>;
}

/** Port mapping editor over the model front image. */
export function PortLayoutEditor({ modal, close, layoutModel, layout, setLayout, assets, assetId, setAssetId, detect, confirm, saving, error }: PortLayoutEditorProps) {
  const baseline = useRef('');
  const wasOpen = useRef(false);
  useEffect(() => {
    const isOpen = Boolean(modal);
    if (isOpen && !wasOpen.current) baseline.current = JSON.stringify({ layout, assetId });
    wasOpen.current = isOpen;
  }, [modal, layout, assetId]);
  if (!modal) return null;
  const ports = layout?.ports ?? [];
  const dirty = baseline.current !== JSON.stringify({ layout, assetId });
  const requestClose = () => {
    if (dirty && !window.confirm('Existem alterações por guardar. Queres sair sem guardar?')) return;
    close();
  };
  const updatePort = (index: number, field: keyof PortLayoutPort, value: string) => setLayout({
    ...(layout as PortLayout),
    ports: ports.map((port, i) => i === index ? { ...port, [field]: ['x', 'y', 'width', 'height'].includes(field) ? Number(value) : value } : port),
  });
  const updateCanvasPort = (index: number, patch: Partial<PortLayoutPort>) => setLayout({ ...(layout as PortLayout), ports: ports.map((port, i) => i === index ? { ...port, ...patch } : port) });
  const addPort = () => setLayout({ ...(layout as PortLayout), ports: [...ports, { portKey: `ethernet1/${ports.length + 1}`, label: `Porta ${ports.length + 1}`, interfaceType: 'ETHERNET', x: .05, y: .05, width: .02, height: .16 }] });
  const removePort = (index: number) => setLayout({ ...(layout as PortLayout), ports: ports.filter((_, i) => i !== index) });
  const compactGrid = () => setLayout({ ...(layout as PortLayout), ports: compactPortGrid(ports), warnings: ['Grelha geométrica compacta aplicada; confirma a posição sobre a imagem.'] });
  const captureDimensions = (width: number, height: number) => {
    if (layout && (layout.imageWidth !== width || layout.imageHeight !== height)) setLayout({ ...layout, imageWidth: width, imageHeight: height });
  };
  const ratio = layout?.imageWidth && layout?.imageHeight ? layout.imageWidth / layout.imageHeight : 9.32;
  const asset = assets.find((candidate) => candidate.id === assetId);

  return <Modal title={`Mapear portas · ${layoutModel?.manufacturer} ${layoutModel?.model}`} close={requestClose}><div className="port-editor">
    <p className="form-help">Coloca cada zona de porta sobre a imagem e associa-a à interface correspondente. Arrasta para mover; usa as setas para ajustes precisos. Alt + setas redimensiona. As posições são relativas à imagem e mantêm-se em ecrãs de qualquer tamanho.</p>
    {dirty && <p className="port-editor-unsaved" role="status">Alterações por guardar</p>}
    {error && <div className="ipam-alert error" role="alert">{error}</div>}
    <label>Imagem frontal do modelo<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Seleciona um asset</option>{assets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.filename}</option>)}</select></label>
    <div className="button-row"><button type="button" className="secondary-button" onClick={detect} disabled={!assetId}><Plus size={14} /> Detetar grelha automaticamente</button><button type="button" className="secondary-button" onClick={compactGrid} disabled={!ports.length}>Alinhar e reduzir hotspots</button><button type="button" className="secondary-button" onClick={addPort}><Plus size={14} /> Adicionar porta</button><span className="form-help">Confiança: {layout?.confidence ? `${Math.round(layout.confidence * 100)}%` : '—'}</span></div>
    {asset ? <InteractivePortCanvas asset={asset} ports={ports} ratio={ratio} onUpdate={updateCanvasPort} onDimensions={captureDimensions} /> : <div className="port-editor-empty" role="status">Seleciona uma imagem frontal para posicionar as portas.</div>}
    <div className="port-table" role="list" aria-label="Portas mapeadas">{ports.map((port, index) => <div className="port-editor-row" role="listitem" key={`${port.portKey}-${index}`}><label><span>Nome</span><input aria-label={`Nome da porta ${index + 1}`} value={port.label ?? ''} onChange={(event) => updatePort(index, 'label', event.target.value)} placeholder="Nome" /></label><label><span>Interface</span><input aria-label={`Chave da interface ${index + 1}`} value={port.portKey ?? ''} onChange={(event) => updatePort(index, 'portKey', event.target.value)} placeholder="portKey" /></label><label><span>Tipo</span><select aria-label={`Tipo da porta ${index + 1}`} value={port.interfaceType ?? 'ETHERNET'} onChange={(event) => updatePort(index, 'interfaceType', event.target.value)}>{PORT_TYPES.map((type) => <option key={type}>{type}</option>)}</select></label>{(['x', 'y', 'width', 'height'] as const).map((field) => <label key={field}><span>{field === 'width' ? 'Largura' : field === 'height' ? 'Altura' : field.toUpperCase()}</span><input aria-label={`${field} da porta ${index + 1}`} type="number" min="0" max="1" step=".001" value={port[field] ?? 0} onChange={(event) => updatePort(index, field, event.target.value)} /></label>)}<button type="button" className="icon-button subtle" aria-label={`Remover porta ${port.label || index + 1}`} onClick={() => removePort(index)}><X size={14} /></button></div>)}</div>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={requestClose}>Cancelar</button><button type="button" className="primary-button" onClick={confirm} disabled={saving || !layoutModel || !layout || !assetId}>{saving ? 'A guardar…' : <><Check size={14} /> Guardar template</>}</button></div>
  </div></Modal>;
}
