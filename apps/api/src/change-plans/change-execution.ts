/**
 * Step 30 — pure rules for running and closing a change plan. No database access here, so every
 * rule is unit-tested in change-execution.spec.ts.
 */

export const CLOSED_STATUSES = ['COMPLETED', 'FAILED', 'ROLLED_BACK'] as const;
export type CloseStatus = typeof CLOSED_STATUSES[number];
export type ExecutionAction = 'START' | 'CLOSE' | 'CHECKLIST_EDIT' | 'CHECKLIST_TICK' | 'LINK_SNMP';

/** Which statuses each execution action may start from. */
const ALLOWED_FROM: Record<ExecutionAction, string[]> = {
  START: ['APPROVED'],
  CLOSE: ['IN_PROGRESS'],
  // The checklist is prepared while the plan is still being written or reviewed, or once approved;
  // it is ticked only while the change is being carried out.
  CHECKLIST_EDIT: ['DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS'],
  CHECKLIST_TICK: ['IN_PROGRESS'],
  LINK_SNMP: ['APPROVED', 'IN_PROGRESS'],
};

const MESSAGES: Record<ExecutionAction, { code: string; message: string }> = {
  START: { code: 'CHANGE_PLAN_NOT_STARTABLE', message: 'Só podes iniciar uma alteração aprovada.' },
  CLOSE: { code: 'CHANGE_PLAN_NOT_CLOSABLE', message: 'Só podes encerrar uma alteração em curso.' },
  CHECKLIST_EDIT: { code: 'CHANGE_PLAN_CHECKLIST_LOCKED', message: 'A lista de passos já não pode ser alterada nesta alteração.' },
  CHECKLIST_TICK: { code: 'CHANGE_PLAN_NOT_IN_PROGRESS', message: 'Só podes marcar passos com a alteração em curso.' },
  LINK_SNMP: { code: 'CHANGE_PLAN_NOT_LINKABLE', message: 'Só podes associar escritas SNMP a uma alteração aprovada ou em curso.' },
};

/** Returns null when allowed, otherwise the error body to send with a 409. */
export function transitionError(status: string, action: ExecutionAction): { code: string; message: string } | null {
  return ALLOWED_FROM[action].includes(status) ? null : MESSAGES[action];
}

export function isCloseStatus(value: unknown): value is CloseStatus {
  return typeof value === 'string' && (CLOSED_STATUSES as readonly string[]).includes(value);
}

/** FAILED and ROLLED_BACK need a closing note saying what happened; COMPLETED may have one. */
export function closingNoteError(status: CloseStatus, note?: string | null) {
  if (status !== 'COMPLETED' && !note?.trim()) return { code: 'CHANGE_CLOSING_NOTE_REQUIRED', message: 'Indica o que aconteceu antes de encerrar como falhada ou revertida.' };
  return null;
}

// ---------------------------------------------------------------------------------------------
// Post-change check: what the plan said a target would look like vs what the inventory holds now.

export type FieldResult = { field: string; planned: unknown; current: unknown; before: unknown; matches: boolean };
export type ItemCheckResult = 'AS_PLANNED' | 'DIFFERENT' | 'NOT_COMPARABLE' | 'TARGET_MISSING';
export type ItemCheck = { entityType: string; entityId: string; operationSummary: string; result: ItemCheckResult; fields: FieldResult[] };
export type PostChangeCheck = { result: 'AS_PLANNED' | 'DIFFERENT' | 'NOT_COMPARABLE'; items: ItemCheck[]; counts: Record<ItemCheckResult, number> };

/** Comparable form of a value: dates as ISO, numbers and booleans as-is, empty strings as null. */
export function normalizeValue(value: unknown): unknown {
  if (value === undefined || value === null) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'string') { const trimmed = value.trim(); return trimmed === '' ? null : trimmed; }
  if (typeof value === 'bigint') return value.toString();
  if (Array.isArray(value)) return value.map(normalizeValue);
  if (typeof value === 'object') return Object.fromEntries(Object.entries(value as Record<string, unknown>).sort(([a], [b]) => a.localeCompare(b)).map(([k, v]) => [k, normalizeValue(v)]));
  return value;
}

function sameValue(a: unknown, b: unknown) {
  const left = normalizeValue(a); const right = normalizeValue(b);
  // "24" planned for a numeric vlanId of 24 is the same value; compare loosely only across string/number.
  if ((typeof left === 'number' && typeof right === 'string') || (typeof left === 'string' && typeof right === 'number')) return String(left) === String(right);
  // IP/CIDR/MAC text is compared without case.
  if (typeof left === 'string' && typeof right === 'string') return left.toLowerCase() === right.toLowerCase();
  return JSON.stringify(left) === JSON.stringify(right);
}

/**
 * Compares one item. Only fields named in proposedValue are checked; fields that do not exist on the
 * current record are reported as different (the plan expected something the record does not have).
 */
/** Fields never echoed by the post-change check, whatever a plan's proposedValue names. */
export const SENSITIVE_FIELD = /pass(word)?|secret|community|token|credential|private|apikey|api_key|authkey|privkey/i;

/**
 * Keys the plan editor writes to describe a change in free text rather than name a record field
 * (the UI saves `{ summary: '…' }` for proposed values). They are skipped unless the target record
 * really has a field of that name, so a typed description never shows up as "Diferente".
 */
export const DESCRIPTION_KEYS = ['summary'] as const;
function isDescriptionOnly(field: string, current: Record<string, unknown>) {
  return (DESCRIPTION_KEYS as readonly string[]).includes(field) && !Object.prototype.hasOwnProperty.call(current, field);
}

export function checkItem(item: { entityType: string; entityId: string; operationSummary: string; currentValue?: unknown; proposedValue?: unknown }, current: Record<string, unknown> | null): ItemCheck {
  const base = { entityType: item.entityType, entityId: item.entityId, operationSummary: item.operationSummary };
  if (!current) return { ...base, result: 'TARGET_MISSING', fields: [] };
  const planned = item.proposedValue && typeof item.proposedValue === 'object' && !Array.isArray(item.proposedValue) ? item.proposedValue as Record<string, unknown> : null;
  const comparable = planned ? Object.keys(planned).filter((field) => !SENSITIVE_FIELD.test(field) && !isDescriptionOnly(field, current)) : [];
  if (!planned || !comparable.length) return { ...base, result: 'NOT_COMPARABLE', fields: [] };
  const before = item.currentValue && typeof item.currentValue === 'object' && !Array.isArray(item.currentValue) ? item.currentValue as Record<string, unknown> : {};
  const fields = comparable.sort().map((field) => {
    const now = Object.prototype.hasOwnProperty.call(current, field) ? current[field] : undefined;
    return { field, planned: normalizeValue(planned[field]), current: normalizeValue(now), before: normalizeValue(before[field]), matches: now !== undefined && sameValue(planned[field], now) };
  });
  return { ...base, result: fields.every((f) => f.matches) ? 'AS_PLANNED' : 'DIFFERENT', fields };
}

export function summarizeCheck(items: ItemCheck[]): PostChangeCheck {
  const counts: Record<ItemCheckResult, number> = { AS_PLANNED: 0, DIFFERENT: 0, NOT_COMPARABLE: 0, TARGET_MISSING: 0 };
  for (const item of items) counts[item.result] += 1;
  const result = counts.DIFFERENT || counts.TARGET_MISSING ? 'DIFFERENT' : counts.AS_PLANNED ? 'AS_PLANNED' : 'NOT_COMPARABLE';
  return { result, items, counts };
}

// ---------------------------------------------------------------------------------------------
// Conflict warnings.

export type Interval = { startsAt: Date; endsAt: Date };

/** Parts of [start, end) that no maintenance window covers (half-open intervals, merged). */
export function uncoveredIntervals(start: Date, end: Date, windows: Interval[]): { startsAt: string; endsAt: string }[] {
  const sorted = windows.filter((w) => w.endsAt > start && w.startsAt < end).sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime());
  const gaps: { startsAt: string; endsAt: string }[] = [];
  let cursor = start.getTime();
  for (const window of sorted) {
    const s = window.startsAt.getTime(); const e = window.endsAt.getTime();
    if (s > cursor) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: new Date(Math.min(s, end.getTime())).toISOString() });
    cursor = Math.max(cursor, e);
    if (cursor >= end.getTime()) break;
  }
  if (cursor < end.getTime()) gaps.push({ startsAt: new Date(cursor).toISOString(), endsAt: end.toISOString() });
  return gaps;
}

/**
 * Step 28b replaces Device.isCritical with tiers but is not merged yet. Detect a tier column by name
 * so this code works before and after it lands. Returns the field name, or null when tiers do not exist.
 */
export const TIER_FIELD_CANDIDATES = ['criticalityTier', 'criticalTier', 'tier'] as const;
export function detectTierField(deviceFields: readonly string[]): string | null {
  return TIER_FIELD_CANDIDATES.find((name) => deviceFields.includes(name)) ?? null;
}
/** Tier 1 in whatever shape 28b stores it: 1, '1', 'TIER_1', 'T1'. */
export function isTierOne(value: unknown) {
  if (value === 1) return true;
  if (typeof value !== 'string') return false;
  return ['1', 'TIER_1', 'TIER1', 'T1'].includes(value.trim().toUpperCase());
}

export type ConflictWarning =
  | { code: 'OUTSIDE_MAINTENANCE_WINDOW'; message: string; uncovered: { startsAt: string; endsAt: string }[]; maintenanceWindowCount: number }
  | { code: 'TIER1_CRITICAL_ASSET'; message: string; devices: { id: string; name: string }[] }
  | { code: 'CRITICAL_ASSET'; message: string; devices: { id: string; name: string }[] }
  | { code: 'OVERLAPS_APPROVED_CHANGE'; message: string; plans: { id: string; title: string; status: string; plannedStartAt: string; plannedEndAt: string; sharedTargetCount: number }[] };
