'use client';

import { Upload, X } from 'lucide-react';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import type { AssetFile } from '../../types';
import { assetDisplayName } from '../../utils';
import { AssetImage } from '../asset-image';
import { BookStackContextLink } from '@/features/runbooks/bookstack-context-link';
import { useUiText } from '@/components/ui/use-ui-text';

export interface AssetListProps {
  assets: AssetFile[];
  onDelete: (asset: AssetFile) => void;
  onUpload?: () => void;
  canEdit: boolean;
  canDelete?: boolean;
}

/** Visual asset gallery (device front images). */
export function AssetList({ assets, onDelete, onUpload, canEdit, canDelete = canEdit }: AssetListProps) {
  const ui = useUiText();
  const upload = onUpload ?? (() => window.dispatchEvent(new Event('asset-upload-request')));
  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>{ui('infrastructure.assetList.deviceFrontImagesUsedFor')}</h2></div></div>{canEdit && <PageToolbarPortal><div className="asset-list-toolbar"><button className="secondary-button" type="button" onClick={upload}><Upload size={14} /> {ui('infrastructure.assetList.importImage')}</button></div></PageToolbarPortal>}
    <div className="asset-grid">{assets.map((asset) => <article className="asset-card" key={asset.id}>
      <AssetImage asset={asset} alt={assetDisplayName(asset, ui)} />
      <strong>{assetDisplayName(asset, ui)}</strong>
      <small>{asset.mimeType} · {asset.license || ui('infrastructure.assetList.internalAsset')}</small>
      <BookStackContextLink type="asset" id={asset.id} />
      {canDelete && <button type="button" className="danger-button compact-button" onClick={() => onDelete(asset)}><X size={13} /> {ui('infrastructure.assetList.deleteImage')}</button>}
    </article>)}</div>
    {!assets.length && <div className="no-data">{ui('infrastructure.assetList.thereAreNoVisualAssets')}</div>}
  </section>;
}
