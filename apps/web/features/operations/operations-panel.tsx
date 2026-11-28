'use client';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { acknowledgeOperationalAlert, getInventoryQuality, operationsKeys, getInventoryQualityItems, listOperationalAlerts, readAllOperationalAlerts, resolveOperationalAlert, snoozeOperationalAlert, type InventoryFinding, type InventoryQuality, type OperationalAlert } from './api';
import { useOperationalEvents } from './use-operational-events';
import { alertNextStep, alertTargetHref } from './alert-meta';
import { OPERATOR_ROLES, ReadOnlyAlertNote, SnoozeSelect } from './alert-actions';
import { SeverityLegend, SeverityTag } from './alert-severity';
import { useUiText } from '@/components/ui/use-ui-text';
import { localizeServerText } from '@/lib/i18n/server-text';

export { SeverityTag };
const severityRank: Record<string, number> = { CRITICAL: 0, HIGH: 1, MEDIUM: 2, WARNING: 2, LOW: 3, INFO: 3 };

/** Dashboard alert list: only what still needs attention (OPEN + ACKNOWLEDGED), matching the severity tiles. SNOOZED is excluded. */
async function listProblemAlerts(siteId: string | undefined): Promise<{ items: OperationalAlert[]; total: number }> {
  const [open, acknowledged] = await Promise.all([listOperationalAlerts(siteId, 25, 1, 'OPEN'), listOperationalAlerts(siteId, 25, 1, 'ACKNOWLEDGED')]);
  const items = [...(open.items ?? []), ...(acknowledged.items ?? [])].sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9)).slice(0, 25);
  return { items, total: (open.total ?? open.items?.length ?? 0) + (acknowledged.total ?? acknowledged.items?.length ?? 0) };
}

/**
 * Alerts and inventory-quality cards. `compact` is the dashboard variant: lists scroll inside the card
 * (keyboard-focusable, labelled) so the card can live in a fixed-height grid cell, and the alert list/count
 * excludes SNOOZED so it adds up with the dashboard severity tiles.
 * `siteId` scopes the cards to one site (the dashboard passes its workspace site); when omitted or empty
 * the cards follow the global site selector, as before.
 */
export function OperationsPanel({ showAlerts = true, showQuality = true, compact = false, siteId: scopedSiteId }: { showAlerts?: boolean; showQuality?: boolean; compact?: boolean; siteId?: string }) {
  const tx = useUiText();
  const { siteId: contextSiteId } = useSiteContext(); const { hasRole } = useAuth();
  const siteId = scopedSiteId || contextSiteId;
  const scope = siteId || undefined;
  const canEdit = OPERATOR_ROLES.some((role) => hasRole(role));
  const { confirm, confirmDialog } = useConfirm();
  // One query per card, keyed by Site scope: a new scope never shows the previous Site's numbers, not even
  // while loading or after a failed request. Each card loads on every visit and keeps its last numbers when
  // a refresh fails (one failing card never drops the other's update). No retries, as before.
  const cardQuery = { retry: false, staleTime: 0, refetchOnReconnect: false } as const;
  const queryClient = useQueryClient();
  const alertsKey = operationsKeys.panelAlerts(scope ?? null, compact);
  const qualityKey = operationsKeys.panelQuality(scope ?? null);
  const findingsKey = operationsKeys.panelFindings(scope ?? null);
  const alertsQuery = useQuery({ queryKey: alertsKey, queryFn: () => (compact ? listProblemAlerts(scope) : listOperationalAlerts(scope)), enabled: showAlerts, ...cardQuery });
  const qualityQuery = useQuery({ queryKey: qualityKey, queryFn: () => getInventoryQuality(scope), enabled: showQuality, ...cardQuery });
  const findingsQuery = useQuery({ queryKey: findingsKey, queryFn: () => getInventoryQualityItems(scope), enabled: showQuality && compact, ...cardQuery });
  const cardEntries = [showAlerts && { query: alertsQuery, key: alertsKey }, showQuality && { query: qualityQuery, key: qualityKey }, showQuality && compact && { query: findingsQuery, key: findingsKey }].filter((entry) => entry !== false);
  const cards = cardEntries.map((entry) => entry.query);
  const alerts: OperationalAlert[] = alertsQuery.data?.items ?? [];
  const alertTotal = alertsQuery.data ? (alertsQuery.data.total ?? alertsQuery.data.items?.length ?? 0) : 0;
  const quality: InventoryQuality | undefined = qualityQuery.data;
  const findings: InventoryFinding[] | undefined = findingsQuery.data ? (findingsQuery.data.items ?? []) : undefined;
  const loaded = cards.every((query) => !query.isPending);
  const loadError = alertsQuery.isError;
  const qualityError = qualityQuery.isError || findingsQuery.isError;
  // The mount, the refresh button and the events fallback poll share a request already in flight for the
  // same scope. Events and actions pass fresh=true: an older request may predate the change, so it is
  // cancelled and a new one starts (React Query alone would reuse it while the card has no data yet).
  const load = async (fresh = false) => {
    await Promise.all(cardEntries.map(async ({ query, key }) => {
      if (fresh) await queryClient.cancelQueries({ queryKey: key, exact: true });
      await query.refetch({ cancelRefetch: fresh });
    }));
  };
  useOperationalEvents({ fallback: () => load(), onEvent: (event) => { if (event.event !== 'heartbeat') void load(true); } });
  const act = async (fn: () => Promise<unknown>) => { await fn(); await load(true); };
  const resolve = async (alert: OperationalAlert) => {
    if (!await confirm({ title: tx('operations.alerts.resolveTitle'), message: tx('groupB.alerts.resolveOne', undefined, { title: alert.title }), confirmLabel: tx('operations.alerts.resolve') })) return;
    await act(() => resolveOperationalAlert(alert.id));
  };
  // Global alerts (no Site) can only be changed by ADMIN, as the API enforces.
  const canEditAlert = (alert: OperationalAlert) => canEdit && (alert.siteId != null || hasRole('ADMIN'));
  const alertRows = alerts.map((alert) => {
    const href = alertTargetHref(alert);
    return <div className={`alert-row ${alert.severity.toLowerCase()}`} key={alert.id}><AlertTriangle size={15} aria-hidden="true" /><span><strong>{compact && <SeverityTag severity={alert.severity} />}{href ? <a href={href}>{localizeServerText(tx, alert.title)}</a> : localizeServerText(tx, alert.title)}</strong>{alert.detail && <small>{localizeServerText(tx, alert.detail)}</small>}<small className="alert-next-step">{alertNextStep(alert, tx)}</small></span>{canEditAlert(alert) && <span className="button-row">{alert.status !== 'ACKNOWLEDGED' && <button className="secondary-button" onClick={() => void act(() => acknowledgeOperationalAlert(alert.id))} aria-label={tx('operations.alerts.acknowledgeNamed', undefined, { title: alert.title })}>{tx('operations.alerts.acknowledge')}</button>}<SnoozeSelect compact label={tx('operations.alerts.snoozeNamed', undefined, { title: alert.title })} onPick={(hours) => void act(() => snoozeOperationalAlert(alert.id, hours))} /><button className="secondary-button" onClick={() => void resolve(alert)} aria-label={tx('operations.alerts.resolveNamed', undefined, { title: alert.title })}><Check size={13} /> {tx('operations.alerts.resolve')}</button></span>}</div>;
  });
  const alertError = <div className="no-data panel-load-error" role="alert">{alerts.length ? tx('operations.panel.refreshError') : tx('operations.panel.loadError')}</div>;
  const alertEmpty = !loaded ? <div className="no-data" role="status">{tx('operations.panel.loading')}</div> : loadError ? null : <div className="no-data">{tx('operations.alerts.empty')}</div>;
  return <section className={`content-grid ${compact ? 'operations-compact' : ''}`.trim()} aria-label={tx('operations.panel.label')}>{confirmDialog}{showAlerts && <article className="panel"><div className="panel-heading"><div><h2>{tx('operations.alerts.active')}{compact && alertTotal > 0 ? <span className="panel-count"> · {alertTotal > alerts.length ? tx('groupB.common.countOf', undefined, { shown: alerts.length, total: alertTotal }) : alertTotal}</span> : null}</h2></div><span className="button-row"><a className="text-button" href={siteId ? `/alertas?siteId=${encodeURIComponent(siteId)}` : '/alertas'}>{compact ? tx('operations.panel.viewAll') : tx('operations.panel.alertList')}</a>{!compact && hasRole('ADMIN') && <a className="text-button" href="/alertas#regras">{tx('operations.panel.rules')}</a>}<button className="icon-button subtle" onClick={() => void load()} aria-label={tx('operations.panel.refreshAlerts')}><RefreshCw size={16} /></button></span></div>{loadError && alertError}{compact && <p className="panel-description alert-card-note">{tx('operations.panel.snoozedHidden')} <a href={siteId ? `/alertas?siteId=${encodeURIComponent(siteId)}&status=SNOOZED` : '/alertas?status=SNOOZED'}>{tx('operations.panel.viewSnoozed')}</a></p>}{!canEdit && alerts.length > 0 && <ReadOnlyAlertNote />}<SeverityLegend />{alerts.length ? (compact ? <div className="alert-list dashboard-scroll" tabIndex={0} role="region" aria-label={tx('operations.panel.activeList')}>{alertRows}</div> : <div className="alert-list">{alertRows}</div>) : alertEmpty}{alerts.length > 0 && <button className="text-button" onClick={() => void readAllOperationalAlerts().then(() => load())}>{tx('operations.panel.markAllRead')}</button>}</article>}{showQuality && <InventoryQualityCard quality={quality} findings={compact ? findings : undefined} compact={compact} error={qualityError} />}</section>;
}

/** pt-PT count phrase: singular for exactly 1, plural otherwise. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function InventoryQualityCard({ quality, findings, compact = false, error = false }: { quality?: InventoryQuality; findings?: InventoryFinding[]; compact?: boolean; error?: boolean }) {
  const t = useUiText();
  const queue = (findings ?? []).filter((item) => item.status === 'OPEN' || item.status === 'ACKNOWLEDGED').sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));
  return <article className="panel"><div className="panel-heading"><div><h2>{t('operations.panel.quality.title')}</h2></div><a className="text-button" href="/qualidade-inventario">{compact ? t('operations.panel.viewAll') : t('operations.panel.quality.openQueue')}</a></div>{error && <div className="no-data panel-load-error" role="alert">{t('operations.panel.quality.loadError')}</div>}<div className="health-score"><div className="score-ring"><span>{quality?.score ?? '—'}<span>{quality?.score === undefined ? '' : '%'}</span></span></div><div><strong>{t('operations.panel.quality.valid', undefined, { count: quality?.validDeviceCount ?? quality?.valid ?? 0 })}</strong><p>{t('operations.panel.quality.affected', undefined, { count: quality?.affectedDeviceCount ?? quality?.invalid ?? 0 })} · {t('operations.panel.quality.stale', undefined, { count: quality?.staleFindingCount ?? quality?.stale ?? 0 })}</p></div></div>{compact && findings && (queue.length ? <ul className="quality-queue dashboard-scroll" tabIndex={0} aria-label={t('operations.panel.quality.queue')}>{queue.map((item) => <li key={item.id}><a href={item.actionHref || '/qualidade-inventario'}><SeverityTag severity={item.severity} /><span><strong>{localizeServerText(t, item.title)}</strong><small>{localizeServerText(t, item.detail)}</small></span></a></li>)}</ul> : <div className="no-data">{t('operations.panel.quality.noOpen')}</div>)}</article>;
}
