/**
 * Pure helpers for the Alterações workspace: status tabs, search, overlapping
 * change windows, the month calendar and the activity timeline. No React here.
 */
import type { TableStateConfig } from '@/components/data-table';
import type { ChangeActivity, ChangeCandidate, ChangeEntityType, ChangePlan, ChangeStatus } from './api';

export const changeStatuses: ChangeStatus[] = ['DRAFT', 'SUBMITTED', 'APPROVED', 'REJECTED', 'CANCELLED'];
export const changeTypes: ChangeEntityType[] = ['DEVICE', 'INTERFACE', 'VLAN', 'SUBNET', 'IP_ADDRESS', 'HOST', 'SERVICE'];
export const typeLabels: Record<ChangeEntityType, string> = { DEVICE: 'Equipamento', INTERFACE: 'Interface', VLAN: 'VLAN', SUBNET: 'Subnet', IP_ADDRESS: 'Endereço IP', HOST: 'Host', SERVICE: 'Serviço' };
export const statusLabels: Record<ChangeStatus, string> = { DRAFT: 'Rascunho', SUBMITTED: 'Submetida para revisão', APPROVED: 'Aprovada', REJECTED: 'Devolvida para correção', CANCELLED: 'Cancelada' };
/** Short labels for the status tabs. */
export const statusTabLabels: Record<ChangeStatus, string> = { DRAFT: 'Rascunhos', SUBMITTED: 'Em revisão', APPROVED: 'Aprovadas', REJECTED: 'Devolvidas', CANCELLED: 'Canceladas' };

export type ChangeView = 'list' | 'calendar';
export type ChangeFilters = { status: string; type: string; view: string; month: string; changeId: string };
export const emptyChangeFilters: ChangeFilters = { status: '', type: '', view: '', month: '', changeId: '' };
/**
 * `?q=&status=&type=&view=calendar&month=2026-11&changeId=&sort=` — no sort
 * keeps the API order (latest planned start first).
 */
export const changeTableConfig: TableStateConfig<ChangeFilters> = { filters: emptyChangeFilters, sortable: ['title', 'status', 'window', 'targets', 'overlaps'] };

/** Cancelled plans never compete for a window; every other state still might run. */
export const occupiesWindow = (plan: Pick<ChangePlan, 'status'>) => plan.status !== 'CANCELLED';

const time = (value: string) => new Date(value).getTime();
/** Half-open windows: a change ending at 10:00 does not overlap one starting at 10:00. */
export const windowsOverlap = (a: Pick<ChangePlan, 'plannedStartAt' | 'plannedEndAt'>, b: Pick<ChangePlan, 'plannedStartAt' | 'plannedEndAt'>) => time(a.plannedStartAt) < time(b.plannedEndAt) && time(b.plannedStartAt) < time(a.plannedEndAt);

/** For every plan that occupies a window, the other plans whose windows overlap it (Site-wide, whatever the filters). */
export function overlapIndex(plans: readonly ChangePlan[]): Map<string, ChangePlan[]> {
  const active = plans.filter(occupiesWindow).sort((a, b) => time(a.plannedStartAt) - time(b.plannedStartAt));
  const index = new Map<string, ChangePlan[]>();
  for (let i = 0; i < active.length; i += 1) {
    for (let j = i + 1; j < active.length && time(active[j].plannedStartAt) < time(active[i].plannedEndAt); j += 1) {
      if (!windowsOverlap(active[i], active[j])) continue;
      index.set(active[i].id, [...(index.get(active[i].id) ?? []), active[j]]);
      index.set(active[j].id, [...(index.get(active[j].id) ?? []), active[i]]);
    }
  }
  return index;
}

export const candidateKey = (type: ChangeEntityType, id: string) => `${type}:${id}`;
export const candidateLabels = (candidates: readonly ChangeCandidate[]) => new Map(candidates.map((item) => [candidateKey(item.entityType, item.entityId), item.detail ? `${item.label} · ${item.detail}` : item.label]));
export const targetLabel = (labels: Map<string, string>, item: { entityType: ChangeEntityType; entityId: string }) => labels.get(candidateKey(item.entityType, item.entityId)) ?? item.entityId;
export const personName = (person?: { displayName?: string | null; username: string } | null) => (person ? person.displayName || person.username : '');

const normalize = (value: string) => value.normalize('NFD').replace(/[̀-ͯ]/g, '').toLowerCase();

/** Search matches the id, title, reason, people and every target (label, type and operation). */
export function matchesSearch(plan: ChangePlan, search: string, labels: Map<string, string>): boolean {
  const terms = normalize(search).split(/\s+/).filter(Boolean);
  if (!terms.length) return true;
  const haystack = normalize([
    plan.id, plan.title, plan.reason, statusLabels[plan.status], personName(plan.creator), personName(plan.reviewer),
    ...plan.items.flatMap((item) => [targetLabel(labels, item), typeLabels[item.entityType], item.operationSummary]),
  ].join(' '));
  return terms.every((term) => haystack.includes(term));
}

/** Search and target type, but not status: the tab counts use this. */
export function filterPlans(plans: readonly ChangePlan[], search: string, filters: Pick<ChangeFilters, 'type'>, labels: Map<string, string>): ChangePlan[] {
  return plans.filter((plan) => (!filters.type || plan.items.some((item) => item.entityType === filters.type)) && matchesSearch(plan, search, labels));
}

export function countByStatus(plans: readonly ChangePlan[]): Record<ChangeStatus | 'ALL', number> {
  const counts = { ALL: plans.length, DRAFT: 0, SUBMITTED: 0, APPROVED: 0, REJECTED: 0, CANCELLED: 0 };
  for (const plan of plans) counts[plan.status] += 1;
  return counts;
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

export type CalendarDay = { date: Date; key: string; inMonth: boolean; plans: ChangePlan[] };

const dayKey = (date: Date) => `${monthKey(date)}-${String(date.getDate()).padStart(2, '0')}`;
const startOfDay = (date: Date) => new Date(date.getFullYear(), date.getMonth(), date.getDate());

/**
 * Monday-first weeks covering `month`. A plan appears on every local day its
 * window touches (a window ending exactly at midnight does not spill over).
 */
export function calendarWeeks(month: Date, plans: readonly ChangePlan[]): CalendarDay[][] {
  const first = new Date(month.getFullYear(), month.getMonth(), 1);
  const offset = (first.getDay() + 6) % 7;
  const start = new Date(first.getFullYear(), first.getMonth(), 1 - offset);
  const last = new Date(month.getFullYear(), month.getMonth() + 1, 0);
  const days = Math.ceil((offset + last.getDate()) / 7) * 7;
  const weeks: CalendarDay[][] = [];
  for (let index = 0; index < days; index += 1) {
    const date = new Date(start.getFullYear(), start.getMonth(), start.getDate() + index);
    const dayStart = date.getTime();
    const dayEnd = new Date(date.getFullYear(), date.getMonth(), date.getDate() + 1).getTime();
    const onDay = plans
      .filter((plan) => time(plan.plannedStartAt) < dayEnd && Math.max(time(plan.plannedEndAt), time(plan.plannedStartAt) + 1) > dayStart)
      .sort((a, b) => time(a.plannedStartAt) - time(b.plannedStartAt));
    if (index % 7 === 0) weeks.push([]);
    weeks[weeks.length - 1].push({ date, key: dayKey(date), inMonth: date.getMonth() === month.getMonth(), plans: onDay });
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
};
export const activityTone: Record<string, string> = { CHANGE_PLAN_SUBMITTED: 'pending', CHANGE_PLAN_APPROVED: 'approved', CHANGE_PLAN_REJECTED: 'rejected', CHANGE_PLAN_CANCELLED: 'excluded' };

const newestFirst = (a: TimelineEntry, b: TimelineEntry) => time(b.at) - time(a.at);

/** The full activity log when the API provides one; otherwise the milestones recorded on the plan itself. */
export function buildTimeline(plan: ChangePlan, activity: readonly ChangeActivity[] | null): TimelineEntry[] {
  if (activity) return activity.map((entry) => ({ id: entry.id, action: entry.action, at: entry.at, actor: personName(entry.actor), note: entry.note, revision: entry.revision })).sort(newestFirst);
  const entries: TimelineEntry[] = [];
  if (plan.createdAt) entries.push({ id: 'created', action: 'CHANGE_PLAN_CREATED', at: plan.createdAt, actor: personName(plan.creator) });
  if (plan.previewedAt) entries.push({ id: 'previewed', action: 'CHANGE_PLAN_IMPACT_PREVIEWED', at: plan.previewedAt, actor: '', revision: plan.previewRevision });
  if (plan.submittedAt) entries.push({ id: 'submitted', action: 'CHANGE_PLAN_SUBMITTED', at: plan.submittedAt, actor: '' });
  if (plan.reviewedAt && (plan.status === 'APPROVED' || plan.status === 'REJECTED')) entries.push({ id: 'reviewed', action: plan.status === 'APPROVED' ? 'CHANGE_PLAN_APPROVED' : 'CHANGE_PLAN_REJECTED', at: plan.reviewedAt, actor: personName(plan.reviewer), note: plan.reviewNote });
  if (plan.status === 'CANCELLED' && plan.updatedAt) entries.push({ id: 'cancelled', action: 'CHANGE_PLAN_CANCELLED', at: plan.updatedAt, actor: '' });
  return entries.sort(newestFirst);
}
