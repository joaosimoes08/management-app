/**
 * Small type guards for data the app does not control: browser storage (written by older builds, other tabs or the
 * person) and public responses. Each reader returns a safe default instead of trusting `JSON.parse(...) as X`.
 */

/** A plain JSON object (not null, not an array). */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/** `JSON.parse` that returns undefined for missing or malformed text instead of throwing. */
export function parseJson(raw: string | null | undefined): unknown {
  if (raw == null || raw === '') return undefined;
  try { return JSON.parse(raw) as unknown; } catch { return undefined; }
}

export const isString = (value: unknown): value is string => typeof value === 'string';
export const isFiniteNumber = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);

/** An in-app path such as `/ipam?siteId=…`: never another origin (`//host`) or a `javascript:` URL. */
export const isAppPath = (value: unknown): value is string => isString(value) && value.startsWith('/') && !value.startsWith('//') && !value.startsWith('/\\');
