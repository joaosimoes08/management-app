'use client';

import { AssetList } from '../components/assets/asset-list';
import { deleteAsset as apiDeleteAsset } from '../api';
import { useInfrastructureWorkspace } from '../workspace-context';
import { matchesSearch } from './search';

type Asset = Parameters<typeof AssetList>[0]['assets'][number];

/** Assets: uploaded infrastructure images, filtered by the search box. */
export function AssetsTab({ assets }: { assets: Asset[] }) {
  const { navigation, access, askConfirm, setError, invalidateInfrastructure } = useInfrastructureWorkspace();
  const visibleAssets = assets.filter((asset) => matchesSearch(navigation.search, asset.filename, asset.kind, asset.mimeType));
  const deleteAsset = async (asset: { id: string; filename: string }) => {
    if (!(await askConfirm({ message: `Eliminar o asset “${asset.filename}”? As associações visuais serão removidas.`, destructive: true }))) return;
    try {
      await apiDeleteAsset(asset.id);
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar o asset.');
    }
  };
  return <AssetList assets={visibleAssets} onDelete={deleteAsset} canEdit={access.roleCanEdit} canDelete={access.roleCanEdit} />;
}
