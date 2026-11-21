export type WindowKind = 'CHANGE_PLAN' | 'MAINTENANCE_WINDOW';
export type CalendarWindow = { kind: WindowKind; id: string; startsAt: Date; endsAt: Date; active: boolean; targetKeys?: Set<string> };
export type WindowOverlap = { kind: WindowKind; id: string; overlapStartsAt: string; overlapEndsAt: string; sharedTargetCount: number };

/**
 * Finds every pair of windows whose half-open intervals [start, end) intersect.
 * Touching windows (one ends exactly when the next starts) do not overlap, which
 * matches the `startsAt < otherEnd && endsAt > otherStart` rule the impact preview uses.
 * A change plan is flagged `conflict` when it overlaps another *active* (submitted or
 * approved) change plan; overlapping a maintenance window is reported but not a conflict.
 */
export function computeOverlaps(windows: CalendarWindow[]) {
  const sorted = [...windows].sort((a, b) => a.startsAt.getTime() - b.startsAt.getTime() || a.id.localeCompare(b.id));
  const overlaps = new Map<string, WindowOverlap[]>(windows.map((item) => [`${item.kind}:${item.id}`, []]));
  for (let i = 0; i < sorted.length; i += 1) {
    const a = sorted[i];
    for (let j = i + 1; j < sorted.length; j += 1) {
      const b = sorted[j];
      if (b.startsAt >= a.endsAt) break;
      if (a.kind === 'MAINTENANCE_WINDOW' && b.kind === 'MAINTENANCE_WINDOW') continue;
      const start = new Date(Math.max(a.startsAt.getTime(), b.startsAt.getTime())).toISOString();
      const end = new Date(Math.min(a.endsAt.getTime(), b.endsAt.getTime())).toISOString();
      const shared = a.targetKeys && b.targetKeys ? [...a.targetKeys].filter((key) => b.targetKeys!.has(key)).length : 0;
      overlaps.get(`${a.kind}:${a.id}`)!.push({ kind: b.kind, id: b.id, overlapStartsAt: start, overlapEndsAt: end, sharedTargetCount: shared });
      overlaps.get(`${b.kind}:${b.id}`)!.push({ kind: a.kind, id: a.id, overlapStartsAt: start, overlapEndsAt: end, sharedTargetCount: shared });
    }
  }
  const byKey = new Map(windows.map((item) => [`${item.kind}:${item.id}`, item]));
  return new Map([...overlaps.entries()].map(([key, list]) => {
    const self = byKey.get(key)!;
    const conflict = self.kind === 'CHANGE_PLAN' && list.some((other) => other.kind === 'CHANGE_PLAN' && byKey.get(`CHANGE_PLAN:${other.id}`)?.active);
    return [key, { overlapsWith: list, conflict }];
  }));
}
