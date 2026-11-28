'use client';

import { useCallback, useRef, useState } from 'react';
import { ApiRequestError } from '@/lib/api/errors';
import { detectDeviceModelPortLayout, getDeviceModelPortLayoutFaces, saveDeviceModelPortLayoutFaces } from '../api';
import { buildFacesSave, EMPTY_FACE_LAYOUT, type PortLayoutAssetsDraft, type PortLayoutFacesDraft } from '../components/models/port-layout-editor';
import type { DeviceModel, RackFace } from '../types';
import { expectedPortCount, primaryPortFace } from '../utils';
import { useUiText } from '@/components/ui/use-ui-text';

/**
 * State and actions of the model port-layout editor (Modelos → template). `openModal('layout')` shows it;
 * `onSaved` runs after a successful save (the workspace closes the modal and refreshes Infrastructure).
 */
export function usePortLayoutEditor({ openModal, onSaved }: { openModal: (modal: string) => void; onSaved: () => Promise<unknown> }) {
  const ui = useUiText();
  const [layoutModel, setLayoutModel] = useState<DeviceModel | null>(null);
  const [layoutFaces, setLayoutFaces] = useState<PortLayoutFacesDraft | null>(null);
  const [layoutFace, setLayoutFace] = useState<RackFace>('rear');
  const [layoutAssetIds, setLayoutAssetIds] = useState<PortLayoutAssetsDraft>({ front: '', rear: '' });
  const savedLayoutFaces = useRef('');
  const layoutRevision = useRef('');
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');

  const openLayout = useCallback(async (model: DeviceModel | null) => {
    if (!model) return;
    setLayoutError('');
    const { response, faces } = await getDeviceModelPortLayoutFaces(model.id);
    layoutRevision.current = response.revision ?? '';
    const draft: PortLayoutFacesDraft = { front: faces.front ?? { ...EMPTY_FACE_LAYOUT }, rear: faces.rear ?? { ...EMPTY_FACE_LAYOUT } };
    savedLayoutFaces.current = JSON.stringify(draft);
    setLayoutModel(model);
    setLayoutFaces(draft);
    setLayoutAssetIds({ front: model.frontAssetId ?? model.frontAsset?.id ?? '', rear: model.backAssetId ?? model.backAsset?.id ?? '' });
    // Open on the face that already has ports; the rear when neither has.
    setLayoutFace(primaryPortFace({ portLayout: { version: 2, faces } }));
    openModal('layout');
  }, [openModal]);

  const detectLayout = async (face: RackFace) => {
    if (!layoutModel || !layoutFaces) return;
    const current = layoutFaces[face];
    const other = layoutFaces[face === 'front' ? 'rear' : 'front'];
    const expected = expectedPortCount(layoutModel);
    try {
      const proposal = await detectDeviceModelPortLayout(layoutModel.id, {
        assetId: layoutAssetIds[face],
        // Ports already mapped on the other face are not proposed again.
        portCount: Math.max(0, expected - other.ports.length) || expected || null,
        imageWidth: current.imageWidth,
        imageHeight: current.imageHeight,
      }, face);
      setLayoutFaces({ ...layoutFaces, [face]: { ...current, ...proposal, ports: Array.isArray(proposal?.ports) ? proposal.ports : [] } });
    } catch (cause) {
      setLayoutError(cause instanceof Error ? cause.message : ui('infrastructure.usePortLayoutEditor.detectionFailed'));
    }
  };

  const confirmLayout = async () => {
    if (!layoutModel || !layoutFaces) return;
    setLayoutSaving(true);
    setLayoutError('');
    try {
      const saved = JSON.parse(savedLayoutFaces.current || '{}') as Partial<PortLayoutFacesDraft>;
      const initialAssets = { front: layoutModel.frontAssetId ?? layoutModel.frontAsset?.id ?? '', rear: layoutModel.backAssetId ?? layoutModel.backAsset?.id ?? '' };
      // One transactional PUT for both faces, guarded by the revision read when the editor opened.
      const faces = buildFacesSave(saved, layoutFaces, initialAssets, layoutAssetIds, new Date().toISOString());
      if (faces) {
        const result = await saveDeviceModelPortLayoutFaces(layoutModel.id, { revision: layoutRevision.current, faces });
        layoutRevision.current = result.revision ?? '';
        savedLayoutFaces.current = JSON.stringify(layoutFaces);
      }
      openModal('');
      setLayoutFaces(null);
      await onSaved();
    } catch (cause) {
      setLayoutError(cause instanceof ApiRequestError && cause.code === 'PORT_LAYOUT_CONFLICT' ? ui('infrastructure.usePortLayoutEditor.changedBySomeoneElseReload') : cause instanceof Error ? cause.message : ui('infrastructure.usePortLayoutEditor.couldNotSaveTheTemplate'));
    } finally {
      setLayoutSaving(false);
    }
  };

  return {
    layoutModel, layoutFaces, setLayoutFaces, layoutFace, setLayoutFace, layoutAssetIds,
    setLayoutAssetId: (face: RackFace, id: string) => setLayoutAssetIds((current) => ({ ...current, [face]: id })),
    layoutSaving, layoutError, openLayout, detectLayout, confirmLayout,
  };
}
