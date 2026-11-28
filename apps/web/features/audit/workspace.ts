/**
 * Pure helpers for the Auditoria workspace: URL filters → API query, links to
 * the changed record and readable before/after values. No React here.
 */
import type { TableStateConfig } from '@/components/data-table';
import type { EntityRef } from '@/lib/routes';
import type { AuditPageEvent, AuditQuery } from './api';
import { portugueseText, type UiText } from '@/components/ui/use-ui-text';

/**
 * `?q=&action=&entityType=&actor=&from=YYYY-MM-DD&to=YYYY-MM-DD&http=1&event=<id>`.
 * Rows keep the server order (newest first) so paging never reorders what is
 * already on screen: no sortable columns.
 */
export type AuditFilters = { action: string; entityType: string; actor: string; from: string; to: string; http: string; event: string };
export const emptyAuditFilters: AuditFilters = { action: '', entityType: '', actor: '', from: '', to: '', http: '', event: '' };
export const auditTableConfig: TableStateConfig<AuditFilters> = { filters: emptyAuditFilters, sortable: [] };

const dayPattern = /^\d{4}-\d{2}-\d{2}$/;
/** Start or end of a local calendar day as ISO, or undefined for an empty/invalid value. */
export function dayBoundary(day: string, edge: 'start' | 'end'): string | undefined {
  if (!dayPattern.test(day)) return undefined;
  const [year, month, date] = day.split('-').map(Number);
  const value = edge === 'start' ? new Date(year, month - 1, date, 0, 0, 0, 0) : new Date(year, month - 1, date, 23, 59, 59, 999);
  return Number.isNaN(value.getTime()) ? undefined : value.toISOString();
}

/** The server query for the current URL state. HTTP request noise is hidden unless `http=1`. */
export function auditQueryFrom(search: string, filters: AuditFilters): AuditQuery {
  return {
    q: search.trim() || undefined,
    action: filters.action || undefined,
    entityType: filters.entityType || undefined,
    actorId: filters.actor || undefined,
    from: dayBoundary(filters.from, 'start'),
    to: dayBoundary(filters.to, 'end'),
    excludeHttp: filters.http === '1' ? undefined : true,
  };
}

/** Filters that narrow the list (the HTTP toggle and the open event do not count). */
export const hasAuditFilters = (search: string, filters: AuditFilters) => Boolean(search.trim() || filters.action || filters.entityType || filters.actor || filters.from || filters.to);

const text = (value: unknown) => (typeof value === 'string' && value.trim() ? value : undefined);

/**
 * The record an event changed, when it has a page today: devices (and their
 * interfaces/connections through `metadata.deviceId`), subnets, IPs and
 * change plans. Everything else shows its id without a link.
 */
export function auditEntityRef(event: Pick<AuditPageEvent, 'entityType' | 'entityId' | 'metadata'>): EntityRef | null {
  const id = event.entityId ?? '';
  const metadata = event.metadata ?? {};
  const siteId = text(metadata.siteId) ?? null;
  const label = text(metadata.name) ?? text(metadata.deviceName) ?? text(metadata.title) ?? text(metadata.cidr) ?? text(metadata.address) ?? id;
  switch (event.entityType) {
    case 'Device': return id ? { kind: 'device', id, label, siteId } : null;
    case 'DeviceInterface':
    case 'DeviceConnection': {
      const deviceId = text(metadata.deviceId);
      return deviceId ? { kind: 'device', id: deviceId, label: text(metadata.deviceName) ?? label, siteId } : null;
    }
    case 'Subnet': return id ? { kind: 'subnet', id, label, siteId } : null;
    case 'IpAddress': return id ? { kind: 'ip', id, label, siteId, subnetId: text(metadata.subnetId) ?? null } : null;
    case 'ChangePlan': return id ? { kind: 'change', id, label: id, siteId } : null;
    default: return null;
  }
}

/** Display form of a before/after or metadata value. */
export function formatAuditValue(value: unknown): string {
  if (value === null || value === undefined || value === '') return '—';
  if (Array.isArray(value)) return value.length ? value.map((item) => (typeof item === 'object' && item !== null ? JSON.stringify(item) : String(item))).join(', ') : '—';
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/** Metadata entries for the detail panel, minus the before/after keys already shown as a diff. */
export function metadataEntries(metadata: AuditPageEvent['metadata'], hideDiffKeys: boolean): Array<[string, string]> {
  const diffKeys = /^(previous|next|before|after|observed)/i;
  return Object.entries(metadata ?? {})
    .filter(([key]) => !(hideDiffKeys && diffKeys.test(key)))
    .map(([key, value]) => [key, formatAuditValue(value)]);
}

export const actorName = (event: Pick<AuditPageEvent, 'user'>, text: UiText = portugueseText) => event.user?.displayName || event.user?.username || text('audit.system');
