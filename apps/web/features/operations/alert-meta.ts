/**
 * Plain-language meaning of alert severities and sources, shared by the dashboard card,
 * the /alertas list and the rule form. Codes stay as secondary text so operators can still
 * match them with rules and logs.
 */
import { entityHref } from '@/lib/routes';

export const SEVERITY_ORDER = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'] as const;

/** t() from useUiText(): the active language inside the provider, Portuguese outside it. */
export type Translate = (key: string, fallback?: string, params?: Record<string, string | number>) => string;

export const ALERT_STATUSES = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED'] as const;
const KNOWN_SEVERITIES = ['CRITICAL', 'HIGH', 'MEDIUM', 'WARNING', 'LOW', 'INFO'];
const has = (values: readonly string[], value: string) => values.includes(value);

/** Status label; unknown statuses show their code. */
export const alertStatusLabel = (status: string, t: Translate) => (has(ALERT_STATUSES, status) ? t(`operations.alerts.status.${status}`) : status);

export const severityName = (severity: string, t: Translate) => {
  const key = severity.toUpperCase();
  return has(KNOWN_SEVERITIES, key) ? t(`operations.severity.${key}`) : severity;
};

/** What each severity means for the operator, in one line; undefined for other severities. */
export const severityMeaning = (severity: string, t: Translate) => (has(SEVERITY_ORDER, severity) ? t(`operations.severityMeaning.${severity}`) : undefined);

/** Sources the back end raises. Unknown sources show their code. */
export const ALERT_SOURCES = ['SNMP_TRAP', 'SNMP_TRAP_SOURCE', 'SNMP_INTERFACE', 'SNMP_POLL', 'SNMP_DRIFT', 'CAPACITY', 'DISCOVERY', 'INVENTORY_QUALITY', 'SYSTEM_HEALTH', 'SNMP_HEALTH'];
export const isKnownAlertSource = (source: string) => has(ALERT_SOURCES, source);

export const alertSourceLabel = (source: string, t: Translate) => (isKnownAlertSource(source) ? t(`operations.alerts.source.${source}`) : source);

/** The one next step for an alert of unknown kind. */
export const defaultNextStep = (t: Translate) => t('operations.alerts.nextStep.default');

/**
 * Alerts that share a source but need a different next step. The device-unreachable alert (#145) is an SNMP_POLL
 * alert whose dedup key is `snmp:unreachable:<deviceId>`; alert rules still match it as SNMP_POLL.
 */
export const UNREACHABLE_DEDUP_PREFIX = 'snmp:unreachable:';
type Kinded = { source?: string | null; dedupKey?: string | null };
export const isUnreachableAlert = (alert: Kinded) => alert.source === 'SNMP_POLL' && Boolean(alert.dedupKey?.startsWith(UNREACHABLE_DEDUP_PREFIX));

/** Plain label for one alert: its source, or the more specific kind (device unreachable). */
export const alertKindLabel = (alert: Kinded & { source: string }, t: Translate) => (isUnreachableAlert(alert) ? t('operations.alerts.kind.unreachable') : alertSourceLabel(alert.source, t));

/** Next step for a source, or for one alert when given the alert (so the unreachable alert gets its own). */
export function alertNextStep(alert: string | Kinded | null | undefined, t: Translate): string {
  if (!alert) return defaultNextStep(t);
  if (typeof alert !== 'string' && isUnreachableAlert(alert)) return t('operations.alerts.nextStep.unreachable');
  const source = typeof alert === 'string' ? alert : alert.source;
  return source && isKnownAlertSource(source) ? t(`operations.alerts.nextStep.${source}`) : defaultNextStep(t);
}

type Linkable = { source?: string | null; actionHref?: string | null; href?: string | null; relatedDeviceId?: string | null; siteId?: string | null };

/**
 * Where the alert title leads. Trap alerts, and alerts with no link of their own, open the
 * device (Device 360) when it is known; other alerts keep their own, more specific link
 * (a drift, a job). A trap from an unknown device keeps its link (usually /snmp).
 */
export function alertTargetHref(alert: Linkable): string | null {
  const own = alert.actionHref ?? alert.href ?? null;
  if (alert.relatedDeviceId && (alert.source === 'SNMP_TRAP' || !own)) return deviceHref(alert.relatedDeviceId, alert.siteId);
  return own;
}

export const deviceHref = (deviceId: string, siteId?: string | null) => entityHref({ kind: 'device', id: deviceId, siteId: siteId ?? undefined });

/** Snooze choices offered by the row and bulk actions. */
export const SNOOZE_CHOICES = [1, 4, 24] as const;

/** "1 hora", "4 horas"… in the active language. */
export const snoozeHoursLabel = (hours: number, t: Translate) => t('operations.snooze.hours', undefined, { count: hours });
