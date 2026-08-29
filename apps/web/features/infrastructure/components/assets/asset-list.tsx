'use client';

import { Upload, X } from 'lucide-react';
import type { AssetFile } from '../../types';
import { assetDisplayName } from '../../utils';
import { AssetImage } from '../asset-image';

export interface AssetListProps {
  assets: AssetFile[];
  onDelete: (asset: AssetFile) => void;
  onUpload?: () => void;
  canEdit: boolean;
  canDelete?: boolean;
}

/** Visual asset gallery (device front images). */
export function AssetList({ assets, onDelete, onUpload, canEdit, canDelete = canEdit }: AssetListProps) {
  const upload = onUpload ?? (() => window.dispatchEvent(new Event('asset-upload-request')));
  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>Assets visuais</h2><p className="form-help">Imagens de frente dos equipamentos usadas no mapeamento de portas.</p></div>{canEdit && <button className="secondary-button" type="button" onClick={upload}><Upload size={14} /> Importar imagem</button>}</div>
    <div className="asset-grid">{assets.map((asset) => <article className="asset-card" key={asset.id}>
      <AssetImage asset={asset} alt={assetDisplayName(asset)} />
      <strong>{assetDisplayName(asset)}</strong>
      <small>{asset.mimeType} · {asset.license || 'Asset interno'}</small>
      {canDelete && <button type="button" className="danger-button compact-button" onClick={() => onDelete(asset)}><X size={13} /> Eliminar imagem</button>}
    </article>)}</div>
    {!assets.length && <div className="no-data">Ainda não existem assets visuais. Usa “Importar imagem” para adicionar a primeira imagem.</div>}
  </section>;
}
