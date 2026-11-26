'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { isValidElement, useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactElement, type ReactNode } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, ChevronRight, ListChecks, Menu, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { SiteSwitcher } from './site-switcher';
import { isMissingConfigAlert, unavailableTopbarState, type TopbarState } from './topbar-state';
import { readAllOperationalAlerts } from '@/features/operations/api';
import { useOperationalEvents } from '@/features/operations/use-operational-events';
import { ResponsiveTabNavigation } from './responsive-overflow';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { markNotificationRead, markNotificationsRead, NOTIFICATIONS_CHANGED } from '@/features/profile/api';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';

export interface AppHeaderProps {
  /** The page section; kept for callers, the tab group label is generic so it reads in every language. */
  section: string;
  moduleTabs?: ReactNode;
  onOpenSidebar: () => void;
  onOpenGlobalSearch: () => void;
}

function useOutsideClose(ref: React.RefObject<HTMLElement | null>, close: () => void, active: boolean) {
  useEffect(() => {
    if (!active) return;
    const handler = (event: MouseEvent) => {
      if (ref.current && !ref.current.contains(event.target as Node)) close();
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [active, close, ref]);
}

function PopoverHeading({ eyebrow, title, action, onClose, closeLabel }: { eyebrow: string; title: string; action?: ReactNode; onClose: () => void; closeLabel: string }) {
  return <div className="popover-heading"><div><small>{eyebrow}</small><strong>{title}</strong></div><div className="popover-heading-actions">{action}<button onClick={onClose} aria-label={closeLabel}><X size={14} /></button></div></div>;
}

/** Shared shell header: brand, active-module tabs and global tools. */
export function AppHeader({ moduleTabs, onOpenSidebar, onOpenGlobalSearch }: AppHeaderProps) {
  const ui = useUiText();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [topbarState, setTopbarState] = useState<TopbarState>(unavailableTopbarState);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const alertsRef = useRef<HTMLDivElement>(null);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  useOutsideClose(alertsRef, closeAlerts, alertsOpen);
  useEscapeClose(closeAlerts, alertsOpen);

  const requestVersion = useRef(0);
  const inFlight = useRef<Promise<TopbarState> | null>(null);
  // Mount, the 30 s timer, focus and the events fallback poll can all ask at once (on page load the
  // fallback poll and the mount effect did); they share one request in flight. An operational event
  // passes fresh=true, because a request that started before the event may predate the change.
  const loadTopbarState = useCallback(async (fresh = false) => {
    if (!fresh && inFlight.current) return inFlight.current;
    const version = ++requestVersion.current;
    const request = apiFetch<TopbarState>('/api/v1/dashboard/topbar-state').catch(unavailableTopbarState);
    inFlight.current = request;
    const state = await request.finally(() => { if (inFlight.current === request) inFlight.current = null; });
    if (version === requestVersion.current) setTopbarState(state);
    return state;
  }, []);
  useOperationalEvents({ fallback: () => loadTopbarState(), onEvent: (event) => { const alertId = (event.data as { alertId?: string } | null)?.alertId; if (alertId) setDismissedAlertIds((current) => { const next = new Set(current); next.delete(alertId); return next; }); void loadTopbarState(true); } });
  useEffect(() => {
    void loadTopbarState();
    const interval = window.setInterval(() => void loadTopbarState(), 30_000);
    const onFocus = () => loadTopbarState();
    window.addEventListener('focus', onFocus);
    window.addEventListener(NOTIFICATIONS_CHANGED, onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
      window.removeEventListener(NOTIFICATIONS_CHANGED, onFocus);
    };
  }, [loadTopbarState]);

  const nextStepsAlert = ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'].some(hasRole) ? {
    id: 'next-steps-ipam-setup', severity: 'INFO' as const, title: t('shell.nextSteps'),
    detail: t('shell.continueIpam'), href: '/ipam', occurredAt: new Date().toISOString(), persistent: true,
  } : null;
  // Setup to-dos (next steps, devices missing a required config) are not alerts: they have their own
  // section and never count in the bell. Missing-config to-dos are persistent whatever the API says:
  // only fixing the devices clears them.
  const todos = [...(nextStepsAlert ? [nextStepsAlert] : []), ...topbarState.alerts.filter(isMissingConfigAlert).map((alert) => ({ ...alert, persistent: true }))];
  const alerts = topbarState.alerts.filter((alert) => !isMissingConfigAlert(alert));
  const visibleAlerts = alerts.filter((alert) => alert.persistent || !dismissedAlertIds.has(alert.id));
  const alertCount = topbarState.notificationUnreadCount === undefined
    ? visibleAlerts.length
    : topbarState.notificationUnreadCount + visibleAlerts.filter((alert) => !alert.id.startsWith('notification-')).length;
  const activeAlertsLabel = ui('topbar.activeAlerts', undefined, { count: alertCount });
  const bellLabel = todos.length ? ui('topbar.bellWithTodos', undefined, { alerts: activeAlertsLabel, todos: ui('topbar.setupTaskCount', undefined, { count: todos.length }) }) : activeAlertsLabel;
  const openAlert = (event: ReactMouseEvent<HTMLAnchorElement>, id: string, href: string) => {
    if (!id.startsWith('notification-')) return;
    const read = markNotificationRead(id.slice('notification-'.length), true).catch(() => undefined);
    if (event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
    event.preventDefault();
    void read.then(() => window.location.assign(href));
  };
  const clearAlerts = () => {
    setDismissedAlertIds((current) => new Set([...current, ...alerts.filter((alert) => !alert.persistent).map((alert) => alert.id)]));
    void Promise.allSettled([readAllOperationalAlerts(), markNotificationsRead()]);
  };

  return <header className="topbar global-topbar">
    <button className="mobile-menu icon-button" onClick={onOpenSidebar} aria-label={ui('ui.openMenu')}><Menu size={19} /></button>
    <div className="global-site-switcher"><SiteSwitcher /></div>
    <div className="module-tabs-slot" aria-label={ui('topbar.moduleSections')}>{isValidElement(moduleTabs) && moduleTabs.type === 'nav' ? <ResponsiveTabNavigation navigation={moduleTabs as ReactElement<{ children?: ReactNode; className?: string }>} /> : moduleTabs}</div>
    <div className="topbar-globals">
      <button className="topbar-search-trigger" onClick={onOpenGlobalSearch} aria-label={ui('ui.searchApp')}><Search size={15} /><span>{ui('topbar.search')}</span><kbd>⌘ K</kbd></button>
      <div className="topbar-popover-anchor" ref={alertsRef}>
        <button className="icon-button alerts-trigger" onClick={() => setAlertsOpen((value) => !value)} aria-label={bellLabel} aria-expanded={alertsOpen} aria-haspopup="dialog"><Bell size={17} />{alertCount > 0 ? <span className="alert-count">{alertCount > 9 ? '9+' : alertCount}</span> : todos.length > 0 && <span className="alert-todo-dot" aria-hidden="true" />}</button>
        {alertsOpen && <section className="topbar-popover alerts-popover" role="dialog" aria-label={ui('topbar.alertCenter')}><PopoverHeading eyebrow={ui('topbar.alertCenterEyebrow')} title={ui('topbar.activeCount', undefined, { count: alertCount })} onClose={closeAlerts} closeLabel={ui('ui.close')} action={visibleAlerts.length ? <button className="clear-alerts-button" type="button" onClick={clearAlerts}>{ui('topbar.clearAll')}</button> : undefined} />{topbarState.processes.length > 0 && <div className="running-processes"><span><Activity size={13} /> {ui('topbar.running')}</span>{topbarState.processes.map((process) => <a href={process.href} key={process.id}><i /><span><strong>{process.label}</strong><small>{process.detail} · {process.state}</small></span><ChevronRight size={13} /></a>)}</div>}<div className="alert-list">{visibleAlerts.length ? visibleAlerts.map((alert) => <a href={alert.href} onClick={(event) => openAlert(event, alert.id, alert.href)} className={`${alert.severity.toLowerCase()}${alert.persistent ? ' persistent' : ''}`} data-kind={'kind' in alert ? alert.kind : undefined} key={alert.id}><span className="alert-severity">{alert.severity === 'INFO' ? <Activity size={14} /> : <AlertTriangle size={14} />}</span><span><strong>{alert.title}</strong><small>{alert.detail}</small>{!alert.persistent && <time>{formatDateTime(alert.occurredAt)}</time>}</span><ChevronRight size={13} /></a>) : <div className="alerts-empty"><CheckCircle2 size={20} /><strong>{ui('topbar.noAlerts')}</strong><span>{ui('topbar.noAlertsHint')}</span></div>}</div>{todos.length > 0 && <div className="alert-list alert-setup-list" role="group" aria-label={ui('topbar.setupTasks')}><span className="alert-setup-heading"><ListChecks size={13} /> {ui('topbar.setupTasks')}</span>{todos.map((todo) => <a href={todo.href} className={`${todo.severity.toLowerCase()} persistent${isMissingConfigAlert(todo) ? ' missing-config' : ''}`} data-kind={'kind' in todo ? todo.kind : undefined} key={todo.id}><span className="alert-severity"><ListChecks size={14} /></span><span><strong>{todo.title}</strong><small>{todo.detail}</small></span><ChevronRight size={13} /></a>)}</div>}</section>}
      </div>
    </div>
  </header>;
}
