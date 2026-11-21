import { BadRequestException } from '@nestjs/common';

export type AuditCursor = { createdAt: Date; id: string };
export type AuditDiffEntry = { field: string; before: unknown; after: unknown };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** Opaque, URL-safe cursor over the (createdAt desc, id desc) order. */
export function encodeAuditCursor(entry: AuditCursor) {
  return Buffer.from(`${entry.createdAt.toISOString()}|${entry.id}`, 'utf8').toString('base64url');
}

export function decodeAuditCursor(value?: string): AuditCursor | undefined {
  if (!value) return undefined;
  const raw = Buffer.from(value, 'base64url').toString('utf8');
  const [iso, id, extra] = raw.split('|');
  const createdAt = new Date(iso ?? '');
  if (extra !== undefined || !id || !UUID.test(id) || !Number.isFinite(createdAt.getTime()) || createdAt.toISOString() !== iso) {
    throw new BadRequestException({ code: 'AUDIT_CURSOR_INVALID', message: 'Cursor de paginação inválido.' });
  }
  return { createdAt, id };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function same(a: unknown, b: unknown) { return JSON.stringify(a) === JSON.stringify(b); }

function objectDiff(before: Record<string, unknown>, after: Record<string, unknown>) {
  const keys = [...new Set([...Object.keys(before), ...Object.keys(after)])].sort();
  return keys.filter((key) => !same(before[key], after[key])).map((key) => ({ field: key, before: before[key] ?? null, after: after[key] ?? null }));
}

/**
 * Reads the before/after values an audit event already stores. Only shapes that the
 * services actually write are recognised; nothing is reconstructed from other events.
 * - `before` / `after` objects
 * - `beforeValues` / `observedValues` objects (topology proposals)
 * - `previousX` / `nextX` pairs (role changes, retention policy)
 * Returns null when the event stored no before/after.
 */
export function deriveAuditDiff(metadata: unknown): AuditDiffEntry[] | null {
  if (!isRecord(metadata)) return null;
  if (isRecord(metadata.before) && isRecord(metadata.after)) return objectDiff(metadata.before, metadata.after);
  if (isRecord(metadata.beforeValues) && isRecord(metadata.observedValues)) return objectDiff(metadata.beforeValues, metadata.observedValues);
  const pairs: AuditDiffEntry[] = [];
  for (const key of Object.keys(metadata).sort()) {
    const match = /^previous([A-Z].*)$/.exec(key);
    if (!match) continue;
    const nextKey = `next${match[1]}`;
    if (!(nextKey in metadata)) continue;
    pairs.push({ field: match[1].charAt(0).toLowerCase() + match[1].slice(1), before: metadata[key] ?? null, after: metadata[nextKey] ?? null });
  }
  return pairs.length ? pairs : null;
}

function csvCell(value: unknown) {
  if (value === null || value === undefined) return '';
  let text = typeof value === 'string' ? value : value instanceof Date ? value.toISOString() : JSON.stringify(value);
  // Neutralise spreadsheet formula injection.
  if (/^[=+\-@\t\r]/.test(text)) text = `'${text}`;
  return /[",\n\r]/.test(text) ? `"${text.replace(/"/g, '""')}"` : text;
}

export function auditCsv(rows: { id: string; createdAt: Date; action: string; entityType: string | null; entityId: string | null; ipAddress: string | null; metadata: unknown; user: { username: string; displayName: string | null } | null }[]) {
  const header = ['id', 'createdAt', 'actor', 'actorName', 'action', 'entityType', 'entityId', 'ipAddress', 'metadata'];
  const lines = rows.map((row) => [row.id, row.createdAt, row.user?.username ?? '', row.user?.displayName ?? '', row.action, row.entityType, row.entityId, row.ipAddress, row.metadata ?? null].map(csvCell).join(','));
  return `${[header.join(','), ...lines].join('\r\n')}\r\n`;
}
