export const DASHBOARD_SEVERITIES = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const;
export type DashboardSeverity = typeof DASHBOARD_SEVERITIES[number];

/** One `{status, severity, _count}` row as returned in `alerts.groups` / `quality.groups` of the operational summary. */
export interface SeverityGroup { status: string; severity: string; _count?: { _all?: number } }
export interface SeverityCount { alerts: number; quality: number; total: number }
export type SeverityCounts = Record<DashboardSeverity, SeverityCount>;

/** A "problem" is anything still needing attention: OPEN or ACKNOWLEDGED. SNOOZED and RESOLVED are excluded. */
const PROBLEM_STATUSES = new Set(['OPEN', 'ACKNOWLEDGED']);
const isSeverity = (value: string): value is DashboardSeverity => (DASHBOARD_SEVERITIES as readonly string[]).includes(value);

function addGroups(counts: SeverityCounts, groups: SeverityGroup[] | undefined, field: 'alerts' | 'quality') {
  for (const group of groups ?? []) {
    const status = String(group.status ?? '').toUpperCase();
    const severity = String(group.severity ?? '').toUpperCase();
    if (!PROBLEM_STATUSES.has(status) || !isSeverity(severity)) continue;
    const amount = Number(group._count?._all ?? 0);
    if (!Number.isFinite(amount) || amount <= 0) continue;
    counts[severity][field] += amount;
    counts[severity].total += amount;
  }
}

export function countProblemsBySeverity(alertGroups?: SeverityGroup[], qualityGroups?: SeverityGroup[]): SeverityCounts {
  const counts = Object.fromEntries(DASHBOARD_SEVERITIES.map((severity) => [severity, { alerts: 0, quality: 0, total: 0 }])) as SeverityCounts;
  addGroups(counts, alertGroups, 'alerts');
  addGroups(counts, qualityGroups, 'quality');
  return counts;
}
