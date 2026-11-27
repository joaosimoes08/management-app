'use client';

import { InfrastructurePermissions } from '../components/infrastructure-permissions';
import type { BuildingWithRooms } from '../types';

/** Permissões: access rules of the Site and its Buildings. */
export function PermissionsTab({ siteId, buildings }: { siteId: string; buildings: BuildingWithRooms[] }) {
  return <div className="module-page infrastructure-workspace"><h1 className="topology-sr-only">Mapa físico</h1><InfrastructurePermissions siteId={siteId} buildings={buildings} /></div>;
}
