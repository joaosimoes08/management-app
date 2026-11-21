export const ALERT_SEVERITY_RANK: Record<string, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };

export type PolicyRule = { id?: string; source: string; siteId: string | null; minSeverity: string; enabled?: boolean };
export type PolicyWindow = { siteId: string | null; startsAt?: Date; endsAt?: Date };
export type PolicyAlert = { source: string; siteId: string | null; severity: string };

/** The enabled rule that governs an alert: site-specific beats global, then the stricter threshold. */
export function effectiveAlertRule<R extends PolicyRule>(rules: R[], alert: PolicyAlert): R | undefined {
  return rules
    .filter((candidate) => candidate.enabled !== false && candidate.source === alert.source && (candidate.siteId === null || candidate.siteId === alert.siteId))
    .sort((left, right) => Number(right.siteId === alert.siteId) - Number(left.siteId === alert.siteId) || (ALERT_SEVERITY_RANK[right.minSeverity] ?? 2) - (ALERT_SEVERITY_RANK[left.minSeverity] ?? 2))[0];
}

/** Why an alert is shown or hidden. Critical alerts always bypass thresholds and maintenance quiet periods. */
export function alertPolicyDecision(rules: PolicyRule[], activeWindows: PolicyWindow[], alert: PolicyAlert): 'SHOWN' | 'MAINTENANCE' | 'BELOW_THRESHOLD' {
  if (alert.severity === 'CRITICAL') return 'SHOWN';
  if (activeWindows.some((window) => window.siteId === null || window.siteId === alert.siteId)) return 'MAINTENANCE';
  const rule = effectiveAlertRule(rules, alert);
  return !rule || (ALERT_SEVERITY_RANK[alert.severity] ?? 99) <= (ALERT_SEVERITY_RANK[rule.minSeverity] ?? 2) ? 'SHOWN' : 'BELOW_THRESHOLD';
}
