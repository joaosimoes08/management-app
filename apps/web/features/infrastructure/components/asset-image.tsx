'use client';

import { apiBlob } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { useEffect, useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import type { AssetFile } from '../types';

type AssetImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  asset?: AssetFile | null;
  alt: string;
  fallback?: ReactNode;
};

/**
 * One download per asset for the whole page. Asset bytes never change after upload, so the blob is kept by asset id:
 * a rack that shows the same model image on many devices, or a token refresh that re-runs every effect, no longer
 * refetches anything. A failed download is dropped so the next render can retry. The API also sends long-lived
 * Cache-Control and an ETag, so a page reload is served from the browser cache.
 */
const MAX_CACHED_ASSETS = 300;
const assetBlobs = new Map<string, Promise<Blob>>();

export function loadAssetBlob(asset: Pick<AssetFile, 'id'>): Promise<Blob> {
  const cached = assetBlobs.get(asset.id);
  if (cached) return cached;
  // The API client adds the bearer token itself, so this component never handles a token.
  const request = apiBlob(`/api/v1/assets/${encodeURIComponent(asset.id)}/file`);
  request.catch(() => { if (assetBlobs.get(asset.id) === request) assetBlobs.delete(asset.id); });
  assetBlobs.set(asset.id, request);
  if (assetBlobs.size > MAX_CACHED_ASSETS) assetBlobs.delete(assetBlobs.keys().next().value as string);
  return request;
}

/** Test hook: forget every cached asset. */
export function clearAssetBlobCache() { assetBlobs.clear(); }

/** Renders an authenticated asset image as an object URL (assets require a Bearer token). */
export function AssetImage({ asset, alt, className, loading = 'lazy', fallback, ...props }: AssetImageProps) {
  const { authenticated } = useAuth();
  const [src, setSrc] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (!asset?.id || !authenticated) {
      setSrc('');
      return () => undefined;
    }
    loadAssetBlob(asset)
      .then((blob) => {
        if (active) {
          objectUrl = URL.createObjectURL(blob);
          setSrc(objectUrl);
        }
      })
      .catch(() => {
        if (active) setSrc('');
      });
    return () => {
      active = false;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [asset?.id, authenticated]);

  return src
    ? <img src={src} alt={alt} className={className} loading={loading} {...props} />
    : fallback ?? <span className="asset-image-placeholder" aria-label={alt}>Imagem indisponível</span>;
}
