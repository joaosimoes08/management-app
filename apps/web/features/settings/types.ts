import type { BuildingWithRooms, InfrastructureAction } from '@/features/infrastructure/types';

export type IpamAction = InfrastructureAction | 'DISCOVER' | 'IMPORT';
export type AccessGroupUser = { id: string; username: string; displayName?: string | null; email?: string | null };
export type AccessGroupMember = { userId: string; user: AccessGroupUser };
export type AccessGroupSiteAssignment = { siteId: string; site?: { id: string; name: string; code: string }; permissions: { permission: IpamAction }[] };
export type AccessGroup = {
  id: string;
  name: string;
  description?: string | null;
  siteAssignments: AccessGroupSiteAssignment[];
  members: AccessGroupMember[];
  infrastructurePermissions: InfrastructurePermission[];
};
export type InfrastructurePermission = {
  id: string;
  scopeType: 'SITE' | 'BUILDING' | 'ROOM';
  scopeId: string;
  permission: InfrastructureAction;
  group?: { id: string; name: string };
};
export type SettingsMutation = { path: string; method: string; body?: unknown };
export type { BuildingWithRooms };
