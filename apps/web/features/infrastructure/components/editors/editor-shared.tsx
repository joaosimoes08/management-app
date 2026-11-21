'use client';

import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Check, Upload } from 'lucide-react';
import { createAsset } from '../../api';
import type { AssetFile } from '../../types';
import { assetDisplayName } from '../../utils';

const MAX_IMAGE_BYTES = 10 * 1024 * 1024;

function readAsDataUrl(file: File): Promise<string> {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result));
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

export function ModalActions({ close }: { close: () => void }) {
  return <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button"><Check size={14} /> Guardar</button></div>;
}

export function AssetPicker({ label, value, assets, onChange, required = false, emptyLabel = 'Seleciona um asset', id, invalid = false, describedBy }: { label: string; value: string; assets: AssetFile[]; onChange: (value: string) => void; required?: boolean; emptyLabel?: string; id?: string; invalid?: boolean; describedBy?: string }) {
  return <label htmlFor={id}>{label}<select id={id} value={value ?? ''} required={required} aria-required={required || undefined} aria-invalid={invalid || undefined} aria-describedby={describedBy} onChange={(event) => onChange(event.target.value)}><option value="">{emptyLabel}</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{assetDisplayName(asset)}</option>)}</select></label>;
}

/** Asset picker with an upload button: the uploaded image is created as an asset and selected. */
export function AssetUploadPicker({ label, value, assets, onChange, required = false, help, warning }: { label: string; value: string; assets: AssetFile[]; onChange: (value: string) => void; required?: boolean; help?: string; warning?: string }) {
  const queryClient = useQueryClient();
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [uploadError, setUploadError] = useState('');
  const [uploaded, setUploaded] = useState<AssetFile[]>([]);
  const options = [...assets, ...uploaded.filter((asset) => !assets.some((candidate) => candidate.id === asset.id))];
  const upload = async (event: React.ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0];
    event.target.value = '';
    if (!file) return;
    if (file.size > MAX_IMAGE_BYTES) { setUploadError('A imagem não pode exceder 10 MB.'); return; }
    setBusy(true);
    setUploadError('');
    try {
      const asset = await createAsset({ filename: file.name, mimeType: file.type, kind: 'INFRASTRUCTURE', contentBase64: await readAsDataUrl(file) });
      setUploaded((current) => [...current, asset]);
      onChange(asset.id);
      await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'assets'] });
    } catch (cause) {
      setUploadError(cause instanceof Error ? cause.message : 'Upload falhou.');
    } finally {
      setBusy(false);
    }
  };
  return <div className="asset-upload-picker">
    <AssetPicker label={label} value={value} assets={options} onChange={onChange} required={required} emptyLabel={required ? 'Seleciona ou carrega uma imagem' : 'Sem imagem'} />
    <button type="button" className="secondary-button asset-upload-picker-button" disabled={busy} aria-label={`Carregar ${label.toLowerCase()}`} onClick={() => input.current?.click()}><Upload size={14} aria-hidden="true" /> {busy ? 'A carregar…' : 'Carregar imagem'}</button>
    <input ref={input} type="file" accept="image/png,image/jpeg,image/webp,image/svg+xml" hidden tabIndex={-1} onChange={(event) => void upload(event)} />
    {help && <small className="form-help">{help}</small>}
    {warning && <small className="form-warning" role="status">{warning}</small>}
    {uploadError && <small className="form-error" role="alert">{uploadError}</small>}
  </div>;
}

/** Error returned by the API for the open form, shown inside it. */
export function FormError({ message }: { message?: string }) {
  if (!message) return null;
  return <div className="ipam-alert error form-error-banner" role="alert">{message}</div>;
}
