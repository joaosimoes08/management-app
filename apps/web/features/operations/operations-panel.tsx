'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AlertTriangle, Check, RefreshCw } from 'lucide-react';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { acknowledgeOperationalAlert, getInventoryQuality, getInventoryQualityItems, listOperationalAlerts, readAllOperationalAlerts, resolveOperationalAlert, snoozeOperationalAlert, type InventoryFinding, type InventoryQuality, type OperationalAlert } from './api';
import { useOperationalEvents } from './use-operational-events';
import { alertNextStep, alertTargetHref } from './alert-meta';
import { OPERATOR_ROLES, ReadOnlyAlertNote, SnoozeSelect } from './alert-actions';
import { SeverityLegend, SeverityTag } from './alert-severity';

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
type LoadResults = [
  PromiseSettledResult<{ items?: OperationalAlert[]; total?: number } | undefined>,
  PromiseSettledResult<InventoryQuality | undefined>,
  PromiseSettledResult<{ items?: InventoryFinding[] } | undefined>,
];

export function OperationsPanel({ showAlerts = true, showQuality = true, compact = false, siteId: scopedSiteId }: { showAlerts?: boolean; showQuality?: boolean; compact?: boolean; siteId?: string }) {
  const { siteId: contextSiteId } = useSiteContext(); const { hasRole } = useAuth();
  const siteId = scopedSiteId || contextSiteId;
  const [alerts, setAlerts] = useState<OperationalAlert[]>([]); const [alertTotal, setAlertTotal] = useState(0); const [quality, setQuality] = useState<InventoryQuality>(); const [findings, setFindings] = useState<InventoryFinding[]>();
  const [loaded, setLoaded] = useState(false); const [loadError, setLoadError] = useState(false); const [qualityError, setQualityError] = useState(false);
  const canEdit = OPERATOR_ROLES.some((role) => hasRole(role));
  const { confirm, confirmDialog } = useConfirm();
  const requestRef = useRef(0);
  // A new scope must never show the previous site's numbers, not even while loading or after a failed request.
  useEffect(() => { setAlerts([]); setAlertTotal(0); setQuality(undefined); setFindings(undefined); setLoaded(false); setLoadError(false); setQualityError(false); }, [siteId]);
  const inFlight = useRef<{ key: string; results: Promise<LoadResults> } | null>(null);
  // The mount effect and the events fallback poll (which starts at once when the event stream is
  // unavailable) both load on page load; they share one set of requests for the same scope.
  // Events and actions pass fresh=true, because an older request may predate the change.
  const load = useCallback(async (fresh = false) => {
    const request = ++requestRef.current; // ignore a slower response for a previous site scope
    const scope = siteId || undefined;
    const key = JSON.stringify([scope ?? null, showAlerts, showQuality, compact]);
    let results: Promise<LoadResults>;
    if (!fresh && inFlight.current?.key === key) results = inFlight.current.results;
    else {
      // allSettled: one failing card must not drop the other card's update.
      results = Promise.allSettled([
        showAlerts ? (compact ? listProblemAlerts(scope) : listOperationalAlerts(scope)) : Promise.resolve(undefined),
        showQuality ? getInventoryQuality(scope) : Promise.resolve(undefined),
        showQuality && compact ? getInventoryQualityItems(scope) : Promise.resolve(undefined),
      ]);
      const entry = { key, results };
      inFlight.current = entry;
      void results.finally(() => { if (inFlight.current === entry) inFlight.current = null; });
    }
    const [alertsResult, qualityResult, findingsResult] = await results;
    if (request !== requestRef.current) return;
    if (alertsResult.status === 'fulfilled' && alertsResult.value) { setAlerts(alertsResult.value.items ?? []); setAlertTotal(alertsResult.value.total ?? alertsResult.value.items?.length ?? 0); }
    if (qualityResult.status === 'fulfilled' && qualityResult.value) setQuality(qualityResult.value);
    if (findingsResult.status === 'fulfilled' && findingsResult.value) setFindings(findingsResult.value.items ?? []);
    setLoadError(alertsResult.status === 'rejected');
    setQualityError(qualityResult.status === 'rejected' || findingsResult.status === 'rejected');
    setLoaded(true);
  }, [siteId, showAlerts, showQuality, compact]);
  useEffect(() => { void load(); }, [load]);
  useOperationalEvents({ fallback: () => load(), onEvent: (event) => { if (event.event !== 'heartbeat') void load(true); } });
  const act = async (fn: () => Promise<unknown>) => { await fn(); await load(true); };
  const resolve = async (alert: OperationalAlert) => {
    if (!await confirm({ title: 'Resolver alertas', message: `Resolver o alerta "${alert.title}"?\nSai da lista de alertas ativos; se o problema voltar a ocorrer, abre um novo alerta.`, confirmLabel: 'Resolver' })) return;
    await act(() => resolveOperationalAlert(alert.id));
  };
  // Global alerts (no Site) can only be changed by ADMIN, as the API enforces.
  const canEditAlert = (alert: OperationalAlert) => canEdit && (alert.siteId != null || hasRole('ADMIN'));
  const alertRows = alerts.map((alert) => {
    const href = alertTargetHref(alert);
    return <div className={`alert-row ${alert.severity.toLowerCase()}`} key={alert.id}><AlertTriangle size={15} aria-hidden="true" /><span><strong>{compact && <SeverityTag severity={alert.severity} />}{href ? <a href={href}>{alert.title}</a> : alert.title}</strong>{alert.detail && <small>{alert.detail}</small>}<small className="alert-next-step">{alertNextStep(alert)}</small></span>{canEditAlert(alert) && <span className="button-row">{alert.status !== 'ACKNOWLEDGED' && <button className="secondary-button" onClick={() => void act(() => acknowledgeOperationalAlert(alert.id))} aria-label={`Reconhecer ${alert.title}`}>Reconhecer</button>}<SnoozeSelect compact label={`Adiar ${alert.title}`} onPick={(hours) => void act(() => snoozeOperationalAlert(alert.id, hours))} /><button className="secondary-button" onClick={() => void resolve(alert)} aria-label={`Resolver ${alert.title}`}><Check size={13} /> Resolver</button></span>}</div>;
  });
  const alertError = <div className="no-data panel-load-error" role="alert">{alerts.length ? 'Não foi possível atualizar os alertas. A lista pode estar desatualizada.' : 'Não foi possível carregar os alertas. Tenta atualizar.'}</div>;
  const alertEmpty = !loaded ? <div className="no-data" role="status">A carregar alertas…</div> : loadError ? null : <div className="no-data">Sem alertas ativos.</div>;
  return <section className={`content-grid ${compact ? 'operations-compact' : ''}`.trim()} aria-label="Operações">{confirmDialog}{showAlerts && <article className="panel"><div className="panel-heading"><div>{!compact && <span className="section-kicker">OPERAÇÕES</span>}<h2>Alertas ativos{compact && alertTotal > 0 ? <span className="panel-count"> · {alertTotal > alerts.length ? `${alerts.length} de ${alertTotal}` : alertTotal}</span> : null}</h2></div><span className="button-row"><a className="text-button" href={siteId ? `/alertas?siteId=${encodeURIComponent(siteId)}` : '/alertas'}>{compact ? 'Ver tudo' : 'Lista de alertas'}</a>{!compact && hasRole('ADMIN') && <a className="text-button" href="/alertas#regras">Regras</a>}<button className="icon-button subtle" onClick={() => void load()} aria-label="Atualizar alertas"><RefreshCw size={16} /></button></span></div>{loadError && alertError}{compact && <p className="panel-description alert-card-note">Adiados não aparecem aqui. <a href={siteId ? `/alertas?siteId=${encodeURIComponent(siteId)}&status=SNOOZED` : '/alertas?status=SNOOZED'}>Ver adiados</a></p>}{!canEdit && alerts.length > 0 && <ReadOnlyAlertNote />}<SeverityLegend />{alerts.length ? (compact ? <div className="alert-list dashboard-scroll" tabIndex={0} role="region" aria-label="Lista de alertas ativos">{alertRows}</div> : <div className="alert-list">{alertRows}</div>) : alertEmpty}{alerts.length > 0 && <button className="text-button" onClick={() => void readAllOperationalAlerts().then(() => load())}>Marcar tudo como lido</button>}</article>}{showQuality && <InventoryQualityCard quality={quality} findings={compact ? findings : undefined} compact={compact} error={qualityError} />}</section>;
}

/** pt-PT count phrase: singular for exactly 1, plural otherwise. */
export function countLabel(count: number, singular: string, plural: string): string {
  return `${count} ${count === 1 ? singular : plural}`;
}

export function InventoryQualityCard({ quality, findings, compact = false, error = false }: { quality?: InventoryQuality; findings?: InventoryFinding[]; compact?: boolean; error?: boolean }) {
  const queue = (findings ?? []).filter((item) => item.status === 'OPEN' || item.status === 'ACKNOWLEDGED').sort((a, b) => (severityRank[a.severity] ?? 9) - (severityRank[b.severity] ?? 9));
  return <article className="panel"><div className="panel-heading"><div>{!compact && <span className="section-kicker">INVENTÁRIO</span>}<h2>Qualidade dos dados</h2></div><a className="text-button" href="/qualidade-inventario">{compact ? 'Ver tudo' : 'Abrir fila'}</a></div>{error && <div className="no-data panel-load-error" role="alert">Não foi possível carregar a qualidade dos dados. Tenta atualizar.</div>}<div className="health-score"><div className="score-ring"><span>{quality?.score ?? '—'}<span>{quality?.score === undefined ? '' : '%'}</span></span></div><div><strong>{countLabel(quality?.validDeviceCount ?? quality?.valid ?? 0, 'dispositivo sem problemas', 'dispositivos sem problemas')}</strong><p>{countLabel(quality?.affectedDeviceCount ?? quality?.invalid ?? 0, 'dispositivo afetado', 'dispositivos afetados')} · {countLabel(quality?.staleFindingCount ?? quality?.stale ?? 0, 'finding desatualizado', 'findings desatualizados')}</p></div></div>{compact && findings && (queue.length ? <ul className="quality-queue dashboard-scroll" tabIndex={0} aria-label="Fila de qualidade dos dados">{queue.map((item) => <li key={item.id}><a href={item.actionHref || '/qualidade-inventario'}><SeverityTag severity={item.severity} /><span><strong>{item.title}</strong><small>{item.detail}</small></span></a></li>)}</ul> : <div className="no-data">Sem findings em aberto.</div>)}</article>;
}
