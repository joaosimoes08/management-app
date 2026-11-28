/**
 * Dashboard drill-through: links from KPI tiles and widgets to the matching
 * filtered list. Parameter names match each page's list URL state
 * (`useTableUrlState` configs), so the target opens already filtered.
 * Pure helpers, no React.
 */
import type { DashboardSeverity } from './severity';
import { portugueseText, type UiText } from '@/components/ui/use-ui-text';

type Params = Record<string, string | number | boolean | null | undefined>;

/** Builds `path?a=1&b=2`, leaving out empty values. */
export function hrefWith(path: string, params: Params = {}): string {
  const query = new URLSearchParams();
  for (const [key, value] of Object.entries(params)) {
    if (value === undefined || value === null || value === '' || value === false) continue;
    query.set(key, String(value));
  }
  const text = query.toString();
  return text ? `${path}?${text}` : path;
}

/** `lifecycle` on GET /devices: `overdue`, or `due:N` (1–3650 days). */
export type LifecycleFilter = 'overdue' | `due:${number}`;
export type DeviceDrill = { status?: string; critical?: boolean; lifecycle?: LifecycleFilter; lifecycleKind?: string };
/** Infraestrutura → Equipamentos, filtered through GET /devices. */
export const deviceListHref = (siteId: string | undefined, filters: DeviceDrill = {}) =>
  hrefWith('/infraestrutura', { siteId, tab: 'devices', status: filters.status, critical: filters.critical ? 'true' : undefined, lifecycle: filters.lifecycle, lifecycleKind: filters.lifecycleKind });

export type SubnetDrill = { band?: string; minUtilization?: number; sort?: string };
/** IPAM → Subnets, filtered through GET /subnets. */
export const subnetListHref = (siteId: string | undefined, filters: SubnetDrill = {}) =>
  hrefWith('/ipam', { siteId, tab: 'subnets', band: filters.band, minUtilization: filters.minUtilization, sort: filters.sort });

export type AlertDrill = { severity?: string; status?: string; source?: string; scope?: 'all' };
/** Alertas → active alert list (GET /operations/alerts filters). */
export const alertListHref = (siteId: string | undefined, filters: AlertDrill = {}) =>
  hrefWith('/alertas', { siteId: filters.scope === 'all' ? undefined : siteId, severity: filters.severity, status: filters.status, source: filters.source, scope: filters.scope });

/** Qualidade work queue (`status,severity,rule,assignee,group,q`; status defaults to OPEN there). */
export const qualityListHref = (siteId: string | undefined, filters: { status?: string; severity?: string; rule?: string } = {}) =>
  hrefWith('/qualidade-inventario', { siteId, status: filters.status, severity: filters.severity, rule: filters.rule });

/** Alterações workspace (`status,type,from,to,view,month,changeId`). */
export const changePlansHref = (siteId: string | undefined, filters: { status?: string } = {}) =>
  hrefWith('/alteracoes', { siteId, status: filters.status });

/** Descoberta → executions; `status` is a comma list on GET /discovery/jobs. */
export const discoveryJobsHref = (filters: { status?: string } = {}) => hrefWith('/descoberta', { status: filters.status });

/** Auditoria workspace (`action,entityType,actor,from,to,http,event`). */
export const auditHref = (filters: { entityType?: string | null; event?: string } = {}) =>
  hrefWith('/auditoria', { entityType: filters.entityType ?? undefined, event: filters.event });

/**
 * A severity tile counts open alerts and quality findings together. It opens
 * the alert list unless only quality findings have that severity.
 */
export function severityTileHref(siteId: string | undefined, severity: DashboardSeverity, count: { alerts: number; quality: number }): string {
  return count.alerts > 0 || count.quality === 0 ? alertListHref(siteId, { severity }) : qualityListHref(siteId, { severity });
}

/** Widgets with a readable name (`dashboard.widget.<id>`) in the layout editor; unknown ids (added later by the API) show their id. */
export const namedWidgetIds: ReadonlySet<string> = new Set(['active-alerts', 'quality-queue', 'service-health', 'recent-changes', 'inventory-summary', 'quick-actions', 'running-processes', 'discovery-review', 'snmp-drifts']);
export const widgetLabel = (id: string, text: UiText = portugueseText) => (namedWidgetIds.has(id) ? text(`dashboard.widget.${id}`) : id);
