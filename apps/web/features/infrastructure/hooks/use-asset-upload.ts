'use client';

import { useCallback, useState } from 'react';
import { createAsset, setDeviceModelFaceAsset } from '../api';
import type { RackFace } from '../types';
import { useUiText } from '@/components/ui/use-ui-text';

/**
 * State and actions of the asset upload modal: the chosen file, its name, the model and face it is for.
 * `onUploaded` runs after a successful upload; `onError` receives the message of a failed one.
 */
export function useAssetUpload({ openModal, onUploaded, onError }: { openModal: (modal: string) => void; onUploaded: () => Promise<unknown>; onError: (message: string) => void }) {
  const ui = useUiText();
  const [uploading, setUploading] = useState(false);
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [assetName, setAssetName] = useState('');
  const [uploadModelId, setUploadModelId] = useState('');
  const [uploadFace, setUploadFace] = useState<RackFace>('front');

  /** Clears the previous choice and opens the modal (stable while `openModal` is). */
  const openUpload = useCallback(() => { setPendingUpload(null); setAssetName(''); setUploadModelId(''); setUploadFace('front'); openModal('asset-upload'); }, [openModal]);

  const submitUpload = async () => {
    if (!pendingUpload || !assetName.trim() || !uploadModelId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(pendingUpload);
      });
      const asset = await createAsset({ filename: assetName.trim(), mimeType: pendingUpload.type, kind: 'INFRASTRUCTURE', contentBase64 });
      await setDeviceModelFaceAsset(uploadModelId, uploadFace, asset.id);
      openModal('');
      await onUploaded();
    } catch (cause) {
      onError(cause instanceof Error ? cause.message : ui('infrastructure.useAssetUpload.uploadFailed'));
    } finally {
      setUploading(false);
    }
  };

  const chooseUpload = (event: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    const transfer = 'dataTransfer' in event ? event.dataTransfer : null;
    const file = transfer?.files?.[0] ?? (event as React.ChangeEvent<HTMLInputElement>).target.files?.[0];
    if ('target' in event && (event.target as HTMLInputElement)?.type === 'file') (event.target as HTMLInputElement).value = '';
    if (!file) return;
    setPendingUpload(file);
    setAssetName((current) => current.trim() || file.name);
  };

  return { pendingUpload, assetName, setAssetName, uploadModelId, setUploadModelId, uploadFace, setUploadFace, uploading, openUpload, submitUpload, chooseUpload };
}
