'use client';

import { useEffect, useRef, useState, type ChangeEvent, type DragEvent } from 'react';
import { Upload } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { DeviceModel, RackFace } from '../../types';
import { RackFaceToggle } from '../rack/rack-face-toggle';
import { useUiText } from '@/components/ui/use-ui-text';

export interface AssetUploadModalProps {
  modal: boolean | string;
  close: () => void;
  file: File | null;
  name: string;
  setName: (name: string) => void;
  modelId: string;
  setModelId: (id: string) => void;
  /** Model face the uploaded image becomes. */
  face: RackFace;
  setFace: (face: RackFace) => void;
  models: DeviceModel[];
  choose: (event: ChangeEvent<HTMLInputElement> | DragEvent) => void;
  submit: () => void;
  busy: boolean;
}

/** Drag-and-drop upload of a device model front or rear image. */
export function AssetUploadModal({ modal, close, file, name, setName, modelId, setModelId, face, setFace, models, choose, submit, busy }: AssetUploadModalProps) {
  const ui = useUiText();
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

  return <Modal title={ui('infrastructure.assetUploadModal.addVisualAsset')} close={close}><div className="modal-form"><p className="form-help">{ui('infrastructure.assetUploadModal.theOriginalFileIsStored')}</p><label>{ui('infrastructure.assetUploadModal.linkedModel')}<select required value={modelId} onChange={(event) => setModelId(event.target.value)}><option value="">{ui('infrastructure.assetUploadModal.selectTheModel')}</option>{models.map((model) => <option key={model.id} value={model.id}>{model.manufacturer} {model.model} · {model.type}</option>)}</select></label><div className="upload-face-field"><span aria-hidden="true">{ui('infrastructure.assetUploadModal.imageFace')}</span><RackFaceToggle label={ui('infrastructure.assetUploadModal.imageFace')} value={face} options={[{ value: 'front', label: ui('infrastructure.assetUploadModal.front') }, { value: 'rear', label: ui('infrastructure.assetUploadModal.rear') }]} onChange={setFace} /></div><label>{ui('infrastructure.assetUploadModal.assetName')}<input required value={name} onChange={(event) => setName(event.target.value)} placeholder={ui(`infra.assets.namePlaceholder.${face === 'rear' ? 'rear' : 'front'}`, undefined, { extension })} /></label><label className={`upload-dropzone${dragging ? ' is-dragging' : ''}`} onDragEnter={dragEnter} onDragOver={dragOver} onDragLeave={dragLeave} onDrop={drop}><Upload size={18} /><strong>{dragging ? ui('infrastructure.assetUploadModal.dropImageHere') : file ? ui('infrastructure.assetUploadModal.chooseAnotherFile') : ui('infrastructure.assetUploadModal.chooseImage')}</strong><small>{ui('infrastructure.assetUploadModal.pngJpegWebpOrSvg')}</small><input type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden onChange={choose} /></label>{file && <div className="upload-file-summary"><Upload size={18} /><span><strong>{file.name}</strong><small>{`${(file.size / 1024).toFixed(0)} KB · ${file.type || 'imagem'}`}</small></span></div>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{ui('infrastructure.assetUploadModal.cancel')}</button><button type="button" className="primary-button" disabled={busy || !file || !name.trim() || !modelId} onClick={submit}>{busy ? ui('infrastructure.assetUploadModal.saving') : ui('infrastructure.assetUploadModal.saveAndLink')}</button></div></div></Modal>;
}
