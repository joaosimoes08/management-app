'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { DeviceModel } from '../../types';

export interface AssetUploadModalProps {
  modal: boolean | string;
  close: () => void;
  file: File | null;
  name: string;
  setName: (name: string) => void;
  modelId: string;
  setModelId: (id: string) => void;
  models: DeviceModel[];
  choose: (event: ChangeEvent<HTMLInputElement> | DragEvent) => void;
  submit: () => void;
  busy: boolean;
}

/** Drag-and-drop upload of a device model front image. */
export function AssetUploadModal({ modal, close, file, name, setName, modelId, setModelId, models, choose, submit, busy }: AssetUploadModalProps) {
  const [dragging, setDragging] = useState(false);
  const dragDepth = useRef(0);
  useEffect(() => {
    if (!modal) {
      dragDepth.current = 0;
      setDragging(false);
    }
  }, [modal]);
  if (!modal) return null;
  const extension = file?.name?.includes('.') ? `.${file.name.split('.').pop()}` : '';
  const dragEnter = (event: DragEvent) => { event.preventDefault(); dragDepth.current += 1; setDragging(true); };
  const dragOver = (event: DragEvent) => { event.preventDefault(); event.dataTransfer.dropEffect = 'copy'; };
  const dragLeave = (event: DragEvent) => { event.preventDefault(); dragDepth.current = Math.max(0, dragDepth.current - 1); if (!dragDepth.current) setDragging(false); };
  const drop = (event: DragEvent) => { event.preventDefault(); dragDepth.current = 0; setDragging(false); choose(event); };

  return <Modal title="Adicionar asset visual" close={close}><div className="modal-form"><p className="form-help">O ficheiro original será guardado sem conversão. Cada imagem deve ficar associada a um modelo para não criar assets órfãos.</p><label>Modelo associado<select required value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">Seleciona o modelo</option>{models.map((model) => <option key={model.id} value={model.id}>{model.manufacturer} {model.model} · {model.type}</option>)}</select></label><label>Nome do asset<input required value={name} onChange={(event) => setName(event.target.value)} placeholder={`ex.: Cisco-C9300-frontal${extension}`} /></label><label className={`upload-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop}><Upload size={18} /><strong>{dragging ? 'Largar imagem aqui' : file ? 'Escolher outro ficheiro' : 'Escolher imagem'}</strong><small>PNG, JPEG, WebP ou SVG · máximo 10 MB</small><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={choose} /></label>{file && <div className="upload-file-summary"><Upload size={18} /><span><strong>{file.name}</strong><small>{`${(file.size / 1024).toFixed(0)} KB · ${file.type || 'imagem'}`}</small></span></div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="button" className="primary-button" disabled={busy || !file || !name.trim() || !modelId} onClick={submit}>{busy ? 'A guardar…' : 'Guardar e associar'}</button></div></div></Modal>;
}
