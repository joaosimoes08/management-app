'use client';

import { ModelList } from '../components/models/model-list';
import type { DeviceModel } from '../types';
import { useInfrastructureWorkspace } from '../workspace-context';
import { matchesSearch } from './search';

/** Modelos: the device model catalogue, filtered by the search box. */
export function ModelsTab({ models, onEdit, onLayout }: { models: DeviceModel[]; onEdit: (model: DeviceModel) => void; onLayout: (model: DeviceModel | null) => void }) {
  const { navigation, access } = useInfrastructureWorkspace();
  const visibleModels = models.filter((model) => matchesSearch(navigation.search, model.manufacturer, model.model, model.type));
  return <ModelList models={visibleModels} onEdit={onEdit} onLayout={onLayout} canEdit={access.roleCanEdit} />;
}
