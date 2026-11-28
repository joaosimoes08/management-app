'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useCallback, useEffect, useRef, useState, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, ChevronRight, ListChecks, X } from 'lucide-react';
import { isMissingConfigAlert } from './topbar-state';
import { useTopbarState } from './use-topbar-state';
import { readAllOperationalAlerts } from '@/features/operations/api';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';
import { markNotificationRead, markNotificationsRead } from '@/features/profile/api';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { localizeServerText } from '@/lib/i18n/server-text';

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

/** Header bell: active alerts, running processes and setup to-dos, with the unread count on the button. */
export function NotificationsMenu() {
  const ui = useUiText();
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const alertsRef = useRef<HTMLDivElement>(null);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  useOutsideClose(alertsRef, closeAlerts, alertsOpen);
  useEscapeClose(closeAlerts, alertsOpen);

  // An operational event about an alert shows it again even if it was cleared here.
  const topbarState = useTopbarState({ onAlertEvent: (alertId) => setDismissedAlertIds((current) => { const next = new Set(current); next.delete(alertId); return next; }) });

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

  return <div className="topbar-popover-anchor" ref={alertsRef}>
    <button className="icon-button alerts-trigger" onClick={() => setAlertsOpen((value) => !value)} aria-label={bellLabel} aria-expanded={alertsOpen} aria-haspopup="dialog"><Bell size={17} />{alertCount > 0 ? <span className="alert-count">{alertCount > 9 ? '9+' : alertCount}</span> : todos.length > 0 && <span className="alert-todo-dot" aria-hidden="true" />}</button>
    {alertsOpen && <section className="topbar-popover alerts-popover" role="dialog" aria-label={ui('topbar.alertCenter')}><PopoverHeading eyebrow={ui('topbar.alertCenterEyebrow')} title={ui('topbar.activeCount', undefined, { count: alertCount })} onClose={closeAlerts} closeLabel={ui('ui.close')} action={visibleAlerts.length ? <button className="clear-alerts-button" type="button" onClick={clearAlerts}>{ui('topbar.clearAll')}</button> : undefined} />{topbarState.processes.length > 0 && <div className="running-processes"><span><Activity size={13} /> {ui('topbar.running')}</span>{topbarState.processes.map((process) => <a href={process.href} key={process.id}><i /><span><strong>{process.label}</strong><small>{process.detail} · {process.state}</small></span><ChevronRight size={13} /></a>)}</div>}<div className="alert-list">{visibleAlerts.length ? visibleAlerts.map((alert) => <a href={alert.href} onClick={(event) => openAlert(event, alert.id, alert.href)} className={`${alert.severity.toLowerCase()}${alert.persistent ? ' persistent' : ''}`} data-kind={'kind' in alert ? alert.kind : undefined} key={alert.id}><span className="alert-severity">{alert.severity === 'INFO' ? <Activity size={14} /> : <AlertTriangle size={14} />}</span><span><strong>{localizeServerText(ui, alert.title)}</strong><small>{localizeServerText(ui, alert.detail)}</small>{!alert.persistent && <time>{formatDateTime(alert.occurredAt)}</time>}</span><ChevronRight size={13} /></a>) : <div className="alerts-empty"><CheckCircle2 size={20} /><strong>{ui('topbar.noAlerts')}</strong><span>{ui('topbar.noAlertsHint')}</span></div>}</div>{todos.length > 0 && <div className="alert-list alert-setup-list" role="group" aria-label={ui('topbar.setupTasks')}><span className="alert-setup-heading"><ListChecks size={13} /> {ui('topbar.setupTasks')}</span>{todos.map((todo) => <a href={todo.href} className={`${todo.severity.toLowerCase()} persistent${isMissingConfigAlert(todo) ? ' missing-config' : ''}`} data-kind={'kind' in todo ? todo.kind : undefined} key={todo.id}><span className="alert-severity"><ListChecks size={14} /></span><span><strong>{localizeServerText(ui, todo.title)}</strong><small>{localizeServerText(ui, todo.detail)}</small></span><ChevronRight size={13} /></a>)}</div>}</section>}
  </div>;
}
