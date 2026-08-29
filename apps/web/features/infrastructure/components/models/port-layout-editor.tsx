'use client';

import { useRef } from 'react';
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

type Interaction = {
  index: number;
  mode: 'move' | 'resize';
  startX: number;
  startY: number;
  port: PortLayoutPort;
};

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
    let patch: Partial<PortLayoutPort> = {};
    if (active.mode === 'move') {
      patch = { x: Math.max(0, Math.min(1 - original.width, original.x + dx)), y: Math.max(0, Math.min(1 - original.height, original.y + dy)) };
    } else {
      patch = { width: Math.max(.005, Math.min(1 - original.x, original.width + dx)), height: Math.max(.005, Math.min(1 - original.y, original.height + dy)) };
    }
    onUpdate(active.index, patch);
  };

  const stopInteraction = (event: React.PointerEvent) => {
    if (interaction.current && canvas.current?.hasPointerCapture(event.pointerId)) canvas.current.releasePointerCapture(event.pointerId);
    interaction.current = null;
  };

  const startInteraction = (event: React.PointerEvent, index: number, mode: 'move' | 'resize') => {
    event.preventDefault();
    event.stopPropagation();
    const element = canvas.current;
    if (!element) return;
    element.setPointerCapture(event.pointerId);
    interaction.current = { index, mode, startX: event.clientX, startY: event.clientY, port: { ...ports[index] } };
  };

  return <div ref={canvas} className="port-preview" style={{ aspectRatio: ratio }} onPointerMove={updateFromPointer} onPointerUp={stopInteraction} onPointerCancel={stopInteraction}><AssetImage asset={asset} alt="Preview do modelo" onLoad={(event) => onDimensions(event.currentTarget.naturalWidth, event.currentTarget.naturalHeight)} />{ports.map((port, index) => <span className="port-hotspot-editor" key={`${port.portKey}-${index}`} onPointerDown={(event) => startInteraction(event, index, 'move')} style={{ left: `${port.x * 100}%`, top: `${port.y * 100}%`, width: `${port.width * 100}%`, height: `${port.height * 100}%` }} title={`${port.label} · arrastar para mover`}><b>{port.label}</b><i className="port-resize-handle" onPointerDown={(event) => startInteraction(event, index, 'resize')} title="Redimensionar porta" /></span>)}</div>;
}

/** Port mapping editor over the model front image. */
export function PortLayoutEditor({ modal, close, layoutModel, layout, setLayout, assets, assetId, setAssetId, detect, confirm, saving, error }: PortLayoutEditorProps) {
  if (!modal) return null;
  const ports = layout?.ports ?? [];
  const updatePort = (index: number, field: keyof PortLayoutPort, value: string) => setLayout({
    ...(layout as PortLayout),
    ports: ports.map((port, i) => i === index ? { ...port, [field]: ['x', 'y', 'width', 'height'].includes(field) ? Number(value) : value } : port),
  });
  const updateCanvasPort = (index: number, patch: Partial<PortLayoutPort>) => setLayout({ ...(layout as PortLayout), ports: ports.map((port, i) => i === index ? { ...port, ...patch } : port) });
  const addPort = () => setLayout({ ...(layout as PortLayout), ports: [...ports, { portKey: `ethernet1/${ports.length + 1}`, label: `Port ${ports.length + 1}`, interfaceType: 'ETHERNET', x: .05, y: .05, width: .02, height: .16 }] });
  const removePort = (index: number) => setLayout({ ...(layout as PortLayout), ports: ports.filter((_, i) => i !== index) });
  const compactGrid = () => setLayout({ ...(layout as PortLayout), ports: compactPortGrid(ports), warnings: ['Grelha geométrica compacta aplicada; confirma a posição sobre a imagem.'] });
  const ratio = layout?.imageWidth && layout?.imageHeight ? layout.imageWidth / layout.imageHeight : 9.32;
  const captureDimensions = (width: number, height: number) => setLayout({ ...(layout as PortLayout), imageWidth: width, imageHeight: height });
  const asset = assets.find((candidate) => candidate.id === assetId);

  return <Modal title={`Mapear portas · ${layoutModel?.manufacturer} ${layoutModel?.model}`} close={close}><div className="port-editor"><p className="form-help">A proposta pode ser revista antes de guardar. Arrasta a porta para mover. Os hotspots começam compactos e podem ser alinhados em grelha.</p>{error && <div className="ipam-alert error">{error}</div>}<label>Imagem frontal do modelo<select value={assetId} onChange={(event) => setAssetId(event.target.value)}><option value="">Seleciona um asset</option>{assets.map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.filename}</option>)}</select></label><div className="button-row"><button type="button" className="secondary-button" onClick={detect}><Plus size={14} /> Detetar grelha automaticamente</button><button type="button" className="secondary-button" onClick={compactGrid}>Alinhar e reduzir hotspots</button><button type="button" className="secondary-button" onClick={addPort}><Plus size={14} /> Adicionar porta</button><span className="form-help">Confiança: {layout?.confidence ? `${Math.round(layout.confidence * 100)}%` : '—'}</span></div>{asset && <InteractivePortCanvas asset={asset} ports={ports} ratio={ratio} onUpdate={updateCanvasPort} onDimensions={captureDimensions} />}<div className="port-table">{ports.map((port, index) => <div className="port-editor-row" key={`${port.portKey}-${index}`}><input value={port.label ?? ''} onChange={(event) => updatePort(index, 'label', event.target.value)} placeholder="Nome" /><input value={port.portKey ?? ''} onChange={(event) => updatePort(index, 'portKey', event.target.value)} placeholder="portKey" /><select value={port.interfaceType ?? 'ETHERNET'} onChange={(event) => updatePort(index, 'interfaceType', event.target.value)}>{PORT_TYPES.map((type) => <option key={type}>{type}</option>)}</select><input type="number" step=".001" value={port.x ?? 0} onChange={(event) => updatePort(index, 'x', event.target.value)} placeholder="x" /><input type="number" step=".001" value={port.y ?? 0} onChange={(event) => updatePort(index, 'y', event.target.value)} placeholder="y" /><input type="number" step=".001" value={port.width ?? .02} onChange={(event) => updatePort(index, 'width', event.target.value)} placeholder="w" /><input type="number" step=".001" value={port.height ?? .16} onChange={(event) => updatePort(index, 'height', event.target.value)} placeholder="h" /><button type="button" className="icon-button subtle" onClick={() => removePort(index)}><X size={14} /></button></div>)}</div><div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="button" className="primary-button" onClick={confirm} disabled={saving || !layoutModel || !layout}>{saving ? 'A guardar…' : <><Check size={14} /> Confirmar template</>}</button></div></div></Modal>;
}
