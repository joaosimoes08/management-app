'use client';

import { Check } from 'lucide-react';
import type { AssetFile } from '../../types';
import { assetDisplayName } from '../../utils';

export function ModalActions({ close }: { close: () => void }) {
  return <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button"><Check size={14} /> Guardar</button></div>;
}

export function AssetPicker({ label, value, assets, onChange }: { label: string; value: string; assets: AssetFile[]; onChange: (value: string) => void }) {
  return <label>{label}<select value={value ?? ''} onChange={(event) => onChange(event.target.value)}><option value="">Seleciona um asset</option>{assets.map((asset) => <option key={asset.id} value={asset.id}>{assetDisplayName(asset)}</option>)}</select></label>;
}
