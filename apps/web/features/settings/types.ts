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
/** Raw AccessGroup row: what PATCH /settings/access-groups/:id answers. */
export type AccessGroupRecord = { id: string; name: string; description?: string | null; createdAt: string; updatedAt: string };
/** POST /settings/access-groups: the new group with its site assignments (no members yet). */
export type CreatedAccessGroup = AccessGroupRecord & { siteAssignments: AccessGroupSiteAssignment[] };
/** Raw AccessGroupMember row: what POST /settings/access-groups/:id/members answers. */
export type AccessGroupMemberRecord = { groupId: string; userId: string };
export type AccessGroupInput = { name: string; description?: string };
export type { BuildingWithRooms };
