/**
 * Pure helpers for the Alterações workspace: status tabs, search, overlapping
 * change windows (computed by the API), the month calendar and the activity
 * timeline. No React here.
 */
import type { TableStateConfig } from '@/components/data-table';
import type { CalendarChangePlan, CalendarMaintenanceWindow, ChangeActivity, ChangeCalendar, ChangeCandidate, ChangeEntityType, ChangePlan, ChangeStatus, CheckItemResult, ChecklistItem, CloseStatus, ConflictWarning, WindowKind } from './api';

/** Lifecycle order: drafting and review, then implementation and its outcome, cancelled last. */
export const changeStatuses: ChangeStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'IN_PROGRESS', 'COMPLETED', 'FAILED', 'ROLLED_BACK', 'CANCELLED'];
export const changeTypes: ChangeEntityType[] = ['DEVICE', 'INTERFACE', 'VLAN', 'SUBNET', 'IP_ADDRESS', 'HOST', 'SERVICE'];
export const typeLabels: Record<ChangeEntityType, string> = { DEVICE: 'Equipamento', INTERFACE: 'Interface', VLAN: 'VLAN', SUBNET: 'Subnet', IP_ADDRESS: 'Endereço IP', HOST: 'Host', SERVICE: 'Serviço' };
export const statusLabels: Record<ChangeStatus, string> = { DRAFT: 'Rascunho', SUBMITTED: 'Submetida para revisão', APPROVED: 'Aprovada', REJECTED: 'Devolvida para correção', CANCELLED: 'Cancelada', IN_PROGRESS: 'Em curso', COMPLETED: 'Concluída', FAILED: 'Falhou', ROLLED_BACK: 'Revertida' };
/** Short labels for the status tabs. */
export const statusTabLabels: Record<ChangeStatus, string> = { DRAFT: 'Rascunhos', SUBMITTED: 'Em revisão', APPROVED: 'Aprovadas', REJECTED: 'Devolvidas', CANCELLED: 'Canceladas', IN_PROGRESS: 'Em curso', COMPLETED: 'Concluídas', FAILED: 'Falhadas', ROLLED_BACK: 'Revertidas' };

// ── Implementation and close-out (Step 30) ──────────────────────────────────

export const closeStatuses: CloseStatus[] = ['COMPLETED', 'FAILED', 'ROLLED_BACK'];
export const closedStatuses: ReadonlySet<ChangeStatus> = new Set(closeStatuses);
/** Statuses where steps can still be added or removed (ticking needs IN_PROGRESS). */
export const checklistEditable: ReadonlySet<ChangeStatus> = new Set(['DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS']);
/** Statuses whose window can still clash with something, so the conflict check is worth showing. */
export const conflictRelevant: ReadonlySet<ChangeStatus> = new Set(['DRAFT', 'REJECTED', 'SUBMITTED', 'APPROVED', 'IN_PROGRESS']);
/** A failed or rolled-back change must say what happened. */
export const closingNoteRequired = (status: CloseStatus) => status !== 'COMPLETED';
export const closeLabels: Record<CloseStatus, string> = { COMPLETED: 'Concluída como planeado', FAILED: 'Falhou', ROLLED_BACK: 'Revertida' };

/** Checklist lines typed one per line: trimmed, at least 2 characters, at most 240, no duplicates in the same batch. */
export function parseChecklistLines(text: string): string[] {
  const lines: string[] = []; const seen = new Set<string>();
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim().slice(0, 240); const key = line.toLowerCase();
    if (line.length >= 2 && !seen.has(key)) { seen.add(key); lines.push(line); }
  }
  return lines;
}
export const checklistProgress = (items: readonly ChecklistItem[] = []) => ({ done: items.filter((item) => item.doneAt).length, total: items.length });

export const checkLabels: Record<CheckItemResult, string> = { AS_PLANNED: 'Como planeado', DIFFERENT: 'Diferente', NOT_COMPARABLE: 'Sem valores para comparar', TARGET_MISSING: 'Alvo já não existe' };
/** Badge tone per result, from the shared `.state-badge` palette. */
export const checkTone: Record<CheckItemResult, string> = { AS_PLANNED: 'occupied', DIFFERENT: 'excluded', NOT_COMPARABLE: '', TARGET_MISSING: 'excluded' };
/** A compared value as text ("—" when empty). */
export function checkValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  return typeof value === 'object' ? JSON.stringify(value) : String(value);
}

export const warningTitles: Record<ConflictWarning['code'], string> = {
  OUTSIDE_MAINTENANCE_WINDOW: 'Fora das janelas de manutenção do Site',
  TIER1_CRITICAL_ASSET: 'Afeta ativos críticos de Tier 1',
  CRITICAL_ASSET: 'Afeta ativos críticos',
  OVERLAPS_APPROVED_CHANGE: 'Sobrepõe-se a outra alteração aprovada ou em curso nos mesmos alvos',
};

export type ChangeView = 'list' | 'calendar';
export type ChangeFilters = { status: string; type: string; from: string; to: string; view: string; month: string; changeId: string };
export const emptyChangeFilters: ChangeFilters = { status: '', type: '', from: '', to: '', view: '', month: '', changeId: '' };
/**
 * `?q=&status=&type=&from=2026-11-01&to=2026-11-30&view=calendar&month=2026-11&changeId=&sort=` — no sort
 * keeps the API order (latest planned start first).
 */
export const changeTableConfig: TableStateConfig<ChangeFilters> = { filters: emptyChangeFilters, sortable: ['title', 'status', 'window', 'targets', 'overlaps'] };

const time = (value: string) => new Date(value).getTime();
const DAY = 24 * 60 * 60 * 1000;

// ── Overlaps (from GET /change-plans/calendar) ──────────────────────────────

/** Plans and maintenance windows the API returned for one or more ranges, with their overlaps. */
export type OverlapData = { plans: Map<string, CalendarChangePlan>; windows: Map<string, CalendarMaintenanceWindow>; truncated: boolean };
export const emptyOverlapData = (): OverlapData => ({ plans: new Map(), windows: new Map(), truncated: false });

/** Splits `[from, to)` into calls the API accepts (at most `maxDays` each); beyond `maxChunks` the rest is left out. */
export function calendarChunks(from: Date, to: Date, maxDays = 120, maxChunks = 12): { from: string; to: string; complete: boolean }[] {
  const chunks: { from: string; to: string; complete: boolean }[] = [];
  let start = from.getTime(); const end = Math.max(to.getTime(), start + 1);
  while (start < end && chunks.length < maxChunks) {
    const stop = Math.min(end, start + maxDays * DAY);
    chunks.push({ from: new Date(start).toISOString(), to: new Date(stop).toISOString(), complete: true });
    start = stop;
  }
  if (start < end && chunks.length) chunks[chunks.length - 1].complete = false;
  return chunks;
}

/**
 * Merges calendar responses for adjacent ranges. A plan crossing a range edge
 * comes back in both; its overlap lists are joined without duplicates.
 */
export function mergeCalendars(results: readonly ChangeCalendar[], truncated = false): OverlapData {
  const data: OverlapData = { ...emptyOverlapData(), truncated };
  const join = <T extends { overlapsWith: CalendarChangePlan['overlapsWith']; conflict: boolean }>(map: Map<string, T>, item: T & { id: string }) => {
    const current = map.get(item.id);
    if (!current) { map.set(item.id, { ...item, overlapsWith: [...item.overlapsWith] }); return; }
    const seen = new Set(current.overlapsWith.map((other) => `${other.kind}:${other.id}`));
    map.set(item.id, { ...current, conflict: current.conflict || item.conflict, overlapsWith: [...current.overlapsWith, ...item.overlapsWith.filter((other) => !seen.has(`${other.kind}:${other.id}`))] });
  };
  for (const result of results) {
    data.truncated ||= result.truncated;
    for (const plan of result.changePlans) join(data.plans, plan);
    for (const window of result.maintenanceWindows) join(data.windows, window);
  }
  return data;
}

export type OverlapEntry = { kind: WindowKind; id: string; title: string; status?: ChangeStatus; startsAt: string; endsAt: string; sharedTargetCount: number };

/** What a plan's window overlaps, with titles, change plans first and then maintenance windows. */
export function overlapsFor(data: OverlapData, planId: string): OverlapEntry[] {
  const entries = (data.plans.get(planId)?.overlapsWith ?? []).map((other): OverlapEntry => {
    if (other.kind === 'CHANGE_PLAN') {
      const plan = data.plans.get(other.id);
      return { kind: other.kind, id: other.id, title: plan?.title ?? other.id, status: plan?.status, startsAt: plan?.plannedStartAt ?? other.overlapStartsAt, endsAt: plan?.plannedEndAt ?? other.overlapEndsAt, sharedTargetCount: other.sharedTargetCount };
    }
    const window = data.windows.get(other.id);
    return { kind: other.kind, id: other.id, title: window?.name ?? other.id, startsAt: window?.startsAt ?? other.overlapStartsAt, endsAt: window?.endsAt ?? other.overlapEndsAt, sharedTargetCount: other.sharedTargetCount };
  });
  return entries.sort((a, b) => (a.kind === b.kind ? time(a.startsAt) - time(b.startsAt) : a.kind === 'CHANGE_PLAN' ? -1 : 1));
}

/** The range covered by the plans that can overlap anything (cancelled plans never do). */
export function spanOf(plans: readonly Pick<ChangePlan, 'plannedStartAt' | 'plannedEndAt' | 'status'>[]): { from: Date; to: Date } | null {
  const active = plans.filter((plan) => plan.status !== 'CANCELLED');
  if (!active.length) return null;
  return { from: new Date(Math.min(...active.map((plan) => time(plan.plannedStartAt)))), to: new Date(Math.max(...active.map((plan) => time(plan.plannedEndAt)))) };
}

export const candidateKey = (type: ChangeEntityType, id: string) => `${type}:${id}`;
export const candidateLabels = (candidates: readonly ChangeCandidate[]) => new Map(candidates.map((item) => [candidateKey(item.entityType, item.entityId), item.detail ? `${item.label} · ${item.detail}` : item.label]));
export const targetLabel = (labels: Map<string, string>, item: { entityType: ChangeEntityType; entityId: string }) => labels.get(candidateKey(item.entityType, item.entityId)) ?? item.entityId;
export const personName = (person?: { displayName?: string | null; username: string } | null) => (person ? person.displayName || person.username : '');

/**
 * The API's `q` matches title, reason and operations (case-insensitive). The
 * same rule client-side, for the rows fetched without `q` because a target
 * matched the search.
 */
export function matchesText(plan: ChangePlan, search: string): boolean {
  const term = search.trim().toLowerCase();
  return !term || [plan.title, plan.reason, ...plan.items.map((item) => item.operationSummary)].some((value) => value.toLowerCase().includes(term));
}

/**
 * Client-side part of the list filters: the target type (the API has no type
 * filter) and, when the search matched targets, plans touching those targets.
 */
export function filterPlans(plans: readonly ChangePlan[], options: { search: string; type: string; targetKeys?: ReadonlySet<string> | null }): ChangePlan[] {
  return plans.filter((plan) => (!options.type || plan.items.some((item) => item.entityType === options.type))
    && (!options.targetKeys || matchesText(plan, options.search) || plan.items.some((item) => options.targetKeys!.has(candidateKey(item.entityType, item.entityId)))));
}

/** `YYYY-MM-DD` (date input) → ISO start of that local day; `endOfDay` gives the start of the next day. */
export function dayBoundary(value: string, endOfDay = false): string | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const date = new Date(Number(match[1]), Number(match[2]) - 1, Number(match[3]) + (endOfDay ? 1 : 0));
  return Number.isFinite(date.getTime()) ? date.toISOString() : undefined;
}

// ── Calendar ────────────────────────────────────────────────────────────────

/** `YYYY-MM` of a local date. */
export const monthKey = (date: Date) => `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
/** First local day of `YYYY-MM`; an invalid value falls back to `fallback`'s month. */
export function parseMonth(value: string, fallback: Date = new Date()): Date {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  const month = match ? Number(match[2]) : 0;
  if (!match || month < 1 || month > 12) return new Date(fallback.getFullYear(), fallback.getMonth(), 1);
  return new Date(Number(match[1]), month - 1, 1);
}
export const shiftMonth = (month: Date, delta: number) => new Date(month.getFullYear(), month.getMonth() + delta, 1);

type Windowed = { plannedStartAt: string; plannedEndAt: string };
export type CalendarDay<P extends Windowed = CalendarChangePlan> = { date: Date; key: string; inMonth: boolean; plans: P[]; windows: CalendarMaintenanceWindow[] };

const dayKey = (date: Date) => `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());
/** A window ending exactly at midnight does not spill into the next day; a zero-length one still shows. */
const touchesDay = (start: string, end: string, dayStart: number, dayEnd: number) => time(start) < dayEnd && Math.max(time(end), time(start) + 1) > dayStart;

/** First and last (exclusive) instants of the Monday-first grid that shows `month`. */
export function calendarRange(month: Date): { from: Date; to: Date; days: number } {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = Math.ceil((offset + last.getDate()) / 7) * 7;
  return { from: new Date(first.getFullYear(), first.getMonth(), 1 - offset), to: new Date(first.getFullYear(), first.getMonth(), 1 - offset + days), days };
}

/** Monday-first weeks covering `month`; plans and maintenance windows appear on every local day they touch. */
export function calendarWeeks<P extends Windowed>(month: Date, plans: readonly P[], windows: readonly CalendarMaintenanceWindow[] = []): CalendarDay<P>[][] {
  const { from: start, days } = calendarRange(month);
  const weeks: CalendarDay<P>[][] = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const dayStart = date.getTime();
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const onDay = plans.filter((plan) => touchesDay(plan.plannedStartAt, plan.plannedEndAt, dayStart, dayEnd)).sort((a, b) => time(a.plannedStartAt) - time(b.plannedStartAt));
    const windowsOnDay = windows.filter((item) => touchesDay(item.startsAt, item.endsAt, dayStart, dayEnd)).sort((a, b) => time(a.startsAt) - time(b.startsAt));
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date, key: dayKey(date), inMonth: date.getMonth() === month.getMonth(), plans: onDay, windows: windowsOnDay });
  }
  return weeks;
}

export const isToday = (date: Date, now: Date = new Date()) => startOfDay(date).getTime() === startOfDay(now).getTime();

// ── Activity timeline ───────────────────────────────────────────────────────

export type TimelineEntry = { id: string; action: ChangeActivity['action']; at: string; actor: string; note?: string | null; revision?: number | null };

export const activityLabels: Record<string, string> = {
  CHANGE_PLAN_CREATED: 'Rascunho criado',
  CHANGE_PLAN_UPDATED: 'Rascunho editado',
  CHANGE_PLAN_IMPACT_PREVIEWED: 'Pré-visualização calculada',
  CHANGE_PLAN_SUBMITTED: 'Submetida para revisão',
  CHANGE_PLAN_APPROVED: 'Aprovada',
  CHANGE_PLAN_REJECTED: 'Devolvida para correção',
  CHANGE_PLAN_CANCELLED: 'Cancelada',
  CHANGE_PLAN_STARTED: 'Implementação iniciada',
  CHANGE_PLAN_COMPLETED: 'Concluída',
  CHANGE_PLAN_FAILED: 'Falhou',
  CHANGE_PLAN_ROLLED_BACK: 'Revertida',
  CHANGE_PLAN_CHECKLIST_ADDED: 'Passos adicionados à lista',
  CHANGE_PLAN_CHECKLIST_TICKED: 'Passo concluído',
  CHANGE_PLAN_CHECKLIST_UNTICKED: 'Passo desmarcado',
  CHANGE_PLAN_CHECKLIST_REMOVED: 'Passo removido',
  CHANGE_PLAN_SNMP_WRITE_LINKED: 'Escrita SNMP associada',
  CHANGE_PLAN_SNMP_WRITE_UNLINKED: 'Escrita SNMP desassociada',
};
export const activityTone: Record<string, string> = { CHANGE_PLAN_SUBMITTED: 'pending', CHANGE_PLAN_APPROVED: 'approved', CHANGE_PLAN_REJECTED: 'rejected', CHANGE_PLAN_CANCELLED: 'excluded', CHANGE_PLAN_STARTED: 'pending', CHANGE_PLAN_COMPLETED: 'approved', CHANGE_PLAN_FAILED: 'rejected', CHANGE_PLAN_ROLLED_BACK: 'rejected' };

const newestFirst = (a: TimelineEntry, b: TimelineEntry) => time(b.at) - time(a.at);

/** The plan's audit trail, newest first. */
export function buildTimeline(activity: readonly ChangeActivity[]): TimelineEntry[] {
  return activity.map((entry) => ({ id: entry.id, action: entry.action, at: entry.at, actor: personName(entry.actor), note: entry.note, revision: entry.revision })).sort(newestFirst);
}
