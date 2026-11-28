'use client';

import { InfrastructurePermissions } from '../components/infrastructure-permissions';
import type { BuildingWithRooms } from '../types';
import { useUiText } from '@/components/ui/use-ui-text';

/** Permissões: access rules of the Site and its Buildings. */
export function PermissionsTab({ siteId, buildings }: { siteId: string; buildings: BuildingWithRooms[] }) {
  const ui = useUiText();
  return <div className="module-page infrastructure-workspace"><h1 className="topology-sr-only">{ui('infrastructure.permissionsTab.physicalMap')}</h1><InfrastructurePermissions siteId={siteId} buildings={buildings} /></div>;
}
