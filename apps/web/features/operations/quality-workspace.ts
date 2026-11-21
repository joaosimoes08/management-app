/**
 * Pure helpers for the Qualidade work queue: URL filters → API query, labels,
 * grouping by rule, snooze lengths and bulk results. No React here.
 */
import type { TableStateConfig } from '@/components/data-table';
import type { BulkFindingResponse, FindingFacets, FindingQuery, FindingSeverity, FindingStatus, InventoryFinding } from './api';

export const findingStatuses: FindingStatus[] = ['OPEN', 'ACKNOWLEDGED', 'SNOOZED', 'RESOLVED'];
export const findingSeverities: FindingSeverity[] = ['CRITICAL', 'HIGH', 'WARNING', 'INFO'];
export const statusTabLabels: Record<FindingStatus, string> = { OPEN: 'Abertos', ACKNOWLEDGED: 'Reconhecidos', SNOOZED: 'Adiados', RESOLVED: 'Resolvidos' };
export const statusLabels: Record<FindingStatus, string> = { OPEN: 'Aberto', ACKNOWLEDGED: 'Reconhecido', SNOOZED: 'Adiado', RESOLVED: 'Resolvido' };
export const severityLabels: Record<FindingSeverity, string> = { CRITICAL: 'Crítico', HIGH: 'Alto', WARNING: 'Aviso', INFO: 'Info' };
export const severityRank: Record<FindingSeverity, number> = { CRITICAL: 0, HIGH: 1, WARNING: 2, INFO: 3 };

/** Rules the API detects today; unknown rules show their code. */
export const ruleLabels: Record<string, string> = {
  DEVICE_MISSING_SITE: 'Equipamento sem Site',
  DEVICE_MISSING_LOCATION: 'Equipamento sem localização',
  DEVICE_MISSING_MODEL: 'Equipamento sem modelo',
  NETWORK_DEVICE_MISSING_MANAGEMENT_IP: 'Equipamento de rede sem IP de gestão',
  INTERFACE_MISSING_MODE: 'Interface sem modo',
  ACCESS_INTERFACE_MISSING_VLAN: 'Interface access sem VLAN',
  TRUNK_INTERFACE_MISSING_VLANS: 'Interface trunk sem VLANs permitidas',
  NETWORK_MODEL_MISSING_PORT_MAP: 'Mapeamento de portas em falta',
  DEVICE_MODEL_MISSING_FRONT_IMAGE: 'Modelo sem vista frontal',
  STALE_SNMP_OBSERVATION: 'Observação SNMP desatualizada',
  STALE_SNMP_DRIFT: 'Divergência SNMP por resolver',
  DUPLICATE_IP_ROUTING_DOMAIN: 'IP duplicado no domínio de routing',
};
export const ruleLabel = (rule: string) => ruleLabels[rule] ?? rule;

/**
 * The device a finding is about, for the Device 360 link: the entity itself for
 * Device findings, otherwise the `deviceId` the fix link already carries
 * (interfaces, SNMP drifts). Null when the finding has no device.
 */
export function findingDeviceId(finding: Pick<InventoryFinding, 'entityType' | 'entityId' | 'actionHref'>): string | null {
  if (finding.entityType === 'Device') return finding.entityId;
  if (!finding.actionHref) return null;
  try { return new URL(finding.actionHref, 'http://local').searchParams.get('deviceId') || null; } catch { return null; }
}

/** Snooze lengths offered in bulk; the API accepts 1–720 hours. */
export const snoozeOptions: Array<{ hours: number; label: string }> = [
  { hours: 1, label: '1 hora' }, { hours: 4, label: '4 horas' }, { hours: 24, label: '24 horas' },
  { hours: 72, label: '3 dias' }, { hours: 168, label: '7 dias' }, { hours: 720, label: '30 dias' },
];
export const DEFAULT_SNOOZE_HOURS = 24;
export const BULK_LIMIT = 200;

export const ALL = 'ALL';
/**
 * `?q=&status=ALL|ACKNOWLEDGED…&severity=&rule=&assignee=me|unassigned|<id>&group=rule&sort=`.
 * The queue opens on open findings (`status` default `OPEN`).
 */
export type QualityFilters = { status: string; severity: string; rule: string; assignee: string; group: string };
export const emptyQualityFilters: QualityFilters = { status: 'OPEN', severity: '', rule: '', assignee: '', group: '' };
export const qualityTableConfig: TableStateConfig<QualityFilters> = { filters: emptyQualityFilters, sortable: ['severity', 'title', 'rule', 'status', 'assignee', 'detected'] };

const oneOf = <T extends string>(values: readonly T[], value: string): T | undefined => (values as readonly string[]).includes(value) ? value as T : undefined;

export function findingQueryFrom(siteId: string, search: string, filters: QualityFilters): FindingQuery {
  return {
    siteId,
    status: oneOf(findingStatuses, filters.status),
    severity: oneOf(findingSeverities, filters.severity),
    rule: filters.rule || undefined,
    search: search.trim() || undefined,
    assignee: filters.assignee || undefined,
  };
}

/** Search, severity, rule and assignee narrow the queue; the status tab and grouping do not. */
export const hasQualityFilters = (search: string, filters: QualityFilters) => Boolean(search.trim() || filters.severity || filters.rule || filters.assignee);

/** Rows grouped by rule, groups in first-appearance order (so the current sort decides it). */
export function groupByRule(rows: readonly InventoryFinding[]): Array<{ rule: string; rows: InventoryFinding[] }> {
  const groups = new Map<string, InventoryFinding[]>();
  for (const row of rows) groups.set(row.rule, [...(groups.get(row.rule) ?? []), row]);
  return [...groups].map(([rule, items]) => ({ rule, rows: items }));
}

/** Resolved findings cannot be acted on; everything else can. */
export const isActionable = (finding: Pick<InventoryFinding, 'status'>) => finding.status !== 'RESOLVED';

/** Selected ids that are still visible and actionable; bulk only ever sends these. */
export function visibleSelection(selected: ReadonlySet<string>, rows: readonly InventoryFinding[]): string[] {
  return rows.filter((row) => isActionable(row) && selected.has(row.id)).map((row) => row.id);
}

export const personName = (person?: { displayName?: string | null; username?: string | null } | null) => (person ? person.displayName || person.username || '' : '');

/** Status tab count; `ALL` is the sum, so it matches the tabs. */
export function statusCount(facets: FindingFacets | undefined, status: FindingStatus | typeof ALL): number {
  if (!facets) return 0;
  if (status === ALL) return findingStatuses.reduce((sum, item) => sum + (facets.byStatus[item] ?? 0), 0);
  return facets.byStatus[status] ?? 0;
}

export type BulkOutcome = { action: BulkFindingResponse['action']; succeeded: number; failed: number; snoozedUntil?: string; items: Array<{ id: string; title: string; ok: boolean; message: string }> };
const failureLabels: Record<string, string> = { NOT_FOUND: 'Não encontrado ou sem acesso', FORBIDDEN: 'Sem permissão neste Site', INVALID: 'Pedido inválido', ERROR: 'Erro inesperado' };

/** Per-item results with the finding title (ids the page no longer shows keep their id). */
export function bulkOutcome(response: BulkFindingResponse, titles: ReadonlyMap<string, string>): BulkOutcome {
  return {
    action: response.action,
    succeeded: response.succeeded,
    failed: response.failed,
    snoozedUntil: response.snoozedUntil,
    items: response.results.map((result) => ({
      id: result.id,
      title: titles.get(result.id) ?? result.id,
      ok: result.ok,
      message: result.ok ? 'Aplicado' : failureLabels[result.code] ?? result.message ?? result.code,
    })),
  };
}
