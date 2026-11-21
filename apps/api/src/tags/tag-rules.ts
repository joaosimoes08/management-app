import { BadRequestException } from '@nestjs/common';
import { Prisma } from '@simoes/database';

/** Step 36 — tag rules shared by the tags API and the device/subnet list filters. */
export const TAG_COLORS = ['gray', 'blue', 'green', 'amber', 'red', 'purple'] as const;
export type TagColor = (typeof TAG_COLORS)[number];
/** Roles that may create, rename, recolour and delete a Site's tags: those that can update every kind of device. */
export const TAG_CATALOG_ROLES = ['ADMIN', 'SYSTEMS_OPERATOR'] as const;
export const TAG_NAME_MAX_LENGTH = 40;
/** Most tags one device or subnet can carry. */
export const TAGS_PER_ITEM_LIMIT = 20;
/** Most tags one list filter can combine. */
export const TAG_FILTER_LIMIT = 10;

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
export const isUuid = (value: unknown): value is string => typeof value === 'string' && UUID.test(value);

function invalid(code: string, message: string): never {
  throw new BadRequestException({ code, message });
}

/** Trimmed name with inner whitespace collapsed; 1..40 characters. */
export function normalizeTagName(value: unknown): string {
  const name = typeof value === 'string' ? value.trim().replace(/\s+/g, ' ') : '';
  if (!name) invalid('TAG_NAME_REQUIRED', 'Indica o nome da etiqueta.');
  if (name.length > TAG_NAME_MAX_LENGTH) invalid('TAG_NAME_TOO_LONG', `O nome da etiqueta tem no máximo ${TAG_NAME_MAX_LENGTH} caracteres.`);
  return name;
}

export function normalizeTagColor(value: unknown, fallback: TagColor = 'gray'): TagColor {
  if (value === undefined || value === null || value === '') return fallback;
  if (typeof value !== 'string' || !(TAG_COLORS as readonly string[]).includes(value)) invalid('TAG_COLOR_INVALID', `Cor inválida. Usa ${TAG_COLORS.join(', ')}.`);
  return value as TagColor;
}

/** Distinct tag ids for PUT …/tags: an array of up to 20 UUIDs (empty clears every tag). */
export function normalizeTagIds(value: unknown): string[] {
  if (!Array.isArray(value)) invalid('TAG_IDS_INVALID', 'tagIds deve ser uma lista de etiquetas.');
  if (value.some((id) => !isUuid(id))) invalid('TAG_IDS_INVALID', 'tagIds só aceita identificadores de etiquetas.');
  const ids = [...new Set(value.map((id: string) => id.toLowerCase()))];
  if (ids.length > TAGS_PER_ITEM_LIMIT) invalid('TAG_IDS_TOO_MANY', `Cada item pode ter no máximo ${TAGS_PER_ITEM_LIMIT} etiquetas.`);
  return ids;
}

/** `?tag=<id>,<id>` on GET /devices and GET /subnets: rows must carry every listed tag (AND). Empty or absent: no filter. */
export function parseTagFilter(value: string | undefined): string[] {
  if (value === undefined || value.trim() === '') return [];
  const ids = [...new Set(value.split(',').map((item) => item.trim().toLowerCase()).filter(Boolean))];
  if (!ids.length || ids.some((id) => !isUuid(id))) invalid('TAG_FILTER_INVALID', 'tag deve ser uma lista de identificadores de etiquetas separados por vírgulas.');
  if (ids.length > TAG_FILTER_LIMIT) invalid('TAG_FILTER_TOO_MANY', `Filtra por no máximo ${TAG_FILTER_LIMIT} etiquetas.`);
  return ids;
}

export const deviceTagWhere = (ids: string[]): Prisma.DeviceWhereInput[] => ids.map((tagId) => ({ tags: { some: { tagId } } }));
export const subnetTagWhere = (ids: string[]): Prisma.SubnetWhereInput[] => ids.map((tagId) => ({ tags: { some: { tagId } } }));

/** Prisma include for the tags of a device or subnet. */
export const tagsInclude = { tags: { select: { tag: { select: { id: true, name: true, color: true } } } } } as const;
export type TagSummary = { id: string; name: string; color: string };

/** Replaces the join rows (`tags: [{ tag }]`) with the tags themselves, sorted by name. */
export function withFlatTags<T extends { tags?: Array<{ tag: TagSummary }> }>(item: T): Omit<T, 'tags'> & { tags: TagSummary[] } {
  const tags = (item.tags ?? []).map((row) => row.tag).sort((a, b) => a.name.localeCompare(b.name, 'pt', { sensitivity: 'base' }));
  return { ...item, tags };
}
