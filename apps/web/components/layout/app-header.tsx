'use client';

import { isValidElement, useCallback, useEffect, useRef, useState, type ReactElement, type ReactNode } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, ChevronRight, Menu, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { SiteSwitcher } from './site-switcher';
import { isMissingConfigAlert, unavailableTopbarState, type TopbarState } from './topbar-state';
import { MissingConfigAlert } from './missing-config-alert';
import { readAllOperationalAlerts } from '@/features/operations/api';
import { useOperationalEvents } from '@/features/operations/use-operational-events';
import { ResponsiveTabNavigation } from './responsive-overflow';
import { useI18n } from '@/lib/i18n';
import { useAuth } from '@/lib/auth';

export interface AppHeaderProps {
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

function PopoverHeading({ eyebrow, title, action, onClose }: { eyebrow: string; title: string; action?: ReactNode; onClose: () => void }) {
  return <div className="popover-heading"><div><small>{eyebrow}</small><strong>{title}</strong></div><div className="popover-heading-actions">{action}<button onClick={onClose} aria-label="Fechar"><X size={14} /></button></div></div>;
}

/** Shared shell header: brand, active-module tabs and global tools. */
export function AppHeader({ section, moduleTabs, onOpenSidebar, onOpenGlobalSearch }: AppHeaderProps) {
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [topbarState, setTopbarState] = useState<TopbarState>(unavailableTopbarState);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const alertsRef = useRef<HTMLDivElement>(null);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  useOutsideClose(alertsRef, closeAlerts, alertsOpen);

  const loadTopbarState = useCallback(async () => { try { const state = await apiFetch<TopbarState>('/api/v1/dashboard/topbar-state'); setTopbarState(state); return state; } catch { const state = unavailableTopbarState(); setTopbarState(state); return state; } }, []);
  useOperationalEvents({ fallback: loadTopbarState, onEvent: (event) => { const alertId = (event.data as { alertId?: string } | null)?.alertId; if (alertId) setDismissedAlertIds((current) => { const next = new Set(current); next.delete(alertId); return next; }); void loadTopbarState(); } });
  useEffect(() => {
    loadTopbarState();
    const interval = window.setInterval(loadTopbarState, 30_000);
    const onFocus = () => loadTopbarState();
    window.addEventListener('focus', onFocus);
    return () => {
      window.clearInterval(interval);
      window.removeEventListener('focus', onFocus);
    };
  }, [loadTopbarState]);

  const nextStepsAlert = ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'].some(hasRole) ? {
    id: 'next-steps-ipam-setup', severity: 'INFO' as const, title: t('shell.nextSteps'),
    detail: t('shell.continueIpam'), href: '/ipam', occurredAt: new Date().toISOString(), persistent: true,
  } : null;
  // Missing-config alerts are persistent whatever the API says: only fixing the devices clears them.
  const alerts = [...(nextStepsAlert ? [nextStepsAlert] : []), ...topbarState.alerts.map((alert) => (isMissingConfigAlert(alert) ? { ...alert, persistent: true } : alert))];
  const visibleAlerts = alerts.filter((alert) => alert.persistent || !dismissedAlertIds.has(alert.id));
  const clearAlerts = () => {
    setDismissedAlertIds((current) => new Set([...current, ...alerts.filter((alert) => !alert.persistent).map((alert) => alert.id)]));
    void Promise.allSettled([readAllOperationalAlerts(), apiFetch('/api/v1/dashboard/notifications/read-all', { method: 'PATCH' })]);
  };

  return <header className="topbar global-topbar">
    <button className="mobile-menu icon-button" onClick={onOpenSidebar} aria-label="Abrir menu"><Menu size={19} /></button>
    <div className="global-site-switcher"><SiteSwitcher /></div>
    <div className="module-tabs-slot" aria-label={`Secções de ${section}`}>{isValidElement(moduleTabs) && moduleTabs.type === 'nav' ? <ResponsiveTabNavigation navigation={moduleTabs as ReactElement<{ children?: ReactNode; className?: string }>} /> : moduleTabs}</div>
    <div className="topbar-globals">
      <button className="topbar-search-trigger" onClick={onOpenGlobalSearch} aria-label="Pesquisar na aplicação ou neste separador"><Search size={15} /><span>Pesquisar</span><kbd>⌘ K</kbd></button>
      <div className="topbar-popover-anchor" ref={alertsRef}>
        <button className="icon-button alerts-trigger" onClick={() => setAlertsOpen((value) => !value)} aria-label={`${visibleAlerts.length} ${visibleAlerts.length === 1 ? 'alerta ativo' : 'alertas ativos'}`} aria-expanded={alertsOpen} aria-haspopup="dialog"><Bell size={17} />{visibleAlerts.length > 0 && <span className="alert-count">{visibleAlerts.length > 9 ? '9+' : visibleAlerts.length}</span>}</button>
        {alertsOpen && <section className="topbar-popover alerts-popover" role="dialog" aria-label="Centro de alertas"><PopoverHeading eyebrow="CENTRO DE ALERTAS" title={`${visibleAlerts.length} ${visibleAlerts.length === 1 ? 'ativo' : 'ativos'}`} onClose={closeAlerts} action={visibleAlerts.length ? <button className="clear-alerts-button" type="button" onClick={clearAlerts}>Limpar todos</button> : undefined} />{topbarState.processes.length > 0 && <div className="running-processes"><span><Activity size={13} /> Em execução</span>{topbarState.processes.map((process) => <a href={process.href} key={process.id}><i /><span><strong>{process.label}</strong><small>{process.detail} · {process.state}</small></span><ChevronRight size={13} /></a>)}</div>}<div className="alert-list">{visibleAlerts.length ? visibleAlerts.map((alert) => isMissingConfigAlert(alert) ? <MissingConfigAlert key={alert.id} alert={alert} /> : <a href={alert.href} className={`${alert.severity.toLowerCase()}${alert.persistent ? ' persistent' : ''}`} key={alert.id}><span className="alert-severity">{alert.severity === 'INFO' ? <Activity size={14} /> : <AlertTriangle size={14} />}</span><span><strong>{alert.title}</strong><small>{alert.detail}</small>{!alert.persistent && <time>{new Date(alert.occurredAt).toLocaleString('pt-PT')}</time>}</span><ChevronRight size={13} /></a>) : <div className="alerts-empty"><CheckCircle2 size={20} /><strong>Sem alertas ativos</strong><span>O ambiente não requer atenção.</span></div>}</div></section>}
      </div>
    </div>
  </header>;
}
