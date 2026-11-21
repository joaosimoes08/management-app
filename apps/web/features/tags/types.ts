/** Step 36: site-scoped tags on devices and subnets. Mirrors apps/api/src/tags. */
export const TAG_COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'purple'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
export const TAG_NAME_MAX_LENGTH = 40;
export const TAGS_PER_ITEM_LIMIT = 20;

export interface TagSummary {
  id: string;
  name: string;
  color: TagColor | string;
}

export interface Tag extends TagSummary {
  siteId: string;
  deviceCount: number;
  subnetCount: number;
  createdAt?: string;
  updatedAt?: string;
}

export interface TagInput {
  siteId: string;
  name: string;
  color?: TagColor;
}

export function tagColorClass(color: string | undefined): TagColor {
  return (TAG_COLORS as readonly string[]).includes(color ?? '') ? (color as TagColor) : 'gray';
}

/** Tag filter values are comma lists of tag ids (AND). */
export function parseTagFilterValue(value: string | undefined | null): string[] {
  return (value ?? '').split(',').map((part) => part.trim()).filter(Boolean);
}

export function hasAllTags(item: { tags?: TagSummary[] }, filter: string | undefined | null): boolean {
  const wanted = parseTagFilterValue(filter);
  if (!wanted.length) return true;
  const own = new Set((item.tags ?? []).map((tag) => tag.id));
  return wanted.every((id) => own.has(id));
}

/** Mirrors TAG_CATALOG_ROLES in the API: creating, renaming, recolouring and deleting tags is ADMIN / SYSTEMS_OPERATOR only. */
export const TAG_CATALOG_ROLES = ['ADMIN', 'SYSTEMS_OPERATOR'] as const;
export function canManageTagCatalog(hasRole: (role: string) => boolean) {
  return TAG_CATALOG_ROLES.some((role) => hasRole(role));
}
