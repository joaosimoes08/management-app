'use client';

import { useAuth } from '@/lib/auth';
import { useEffect, useState, type ImgHTMLAttributes } from 'react';
import { assetFileUrl } from '../utils';
import type { AssetFile } from '../types';

type AssetImageProps = Omit<ImgHTMLAttributes<HTMLImageElement>, 'src'> & {
  asset?: AssetFile | null;
  alt: string;
};

/** Renders an authenticated asset image as an object URL (assets require a Bearer token). */
export function AssetImage({ asset, alt, className, loading = 'lazy', ...props }: AssetImageProps) {
  const { token } = useAuth();
  const [src, setSrc] = useState('');

  useEffect(() => {
    let active = true;
    let objectUrl = '';
    if (!asset?.id || !token) {
      setSrc('');
      return () => undefined;
    }
    fetch(assetFileUrl(asset), { headers: { Authorization: `Bearer ${token}` } })
      .then((response) => (response.ok ? response.blob() : Promise.reject(new Error('Asset indisponível'))))
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
  }, [asset?.id, token]);

  return src
    ? <img src={src} alt={alt} className={className} loading={loading} {...props} />
    : <span className="asset-image-placeholder" aria-label={alt}>Imagem indisponível</span>;
}
