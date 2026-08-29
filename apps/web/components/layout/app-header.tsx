'use client';

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react';
import { Activity, AlertTriangle, Bell, CheckCircle2, ChevronRight, Clock3, Menu, MoreHorizontal, Search, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { useI18n } from '@/lib/i18n';
import type { TopbarSearchConfig } from './app-shell';
import { unavailableTopbarState, type TopbarState } from './topbar-state';

export interface AppHeaderProps {
  section: string;
  context?: string[];
  search?: TopbarSearchConfig;
  globalSearch?: boolean;
  actions?: ReactNode;
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

/** Topbar: identity, context search, environment status, alerts center and page actions. */
export function AppHeader({ section, context = [], search, globalSearch = false, actions, onOpenSidebar, onOpenGlobalSearch }: AppHeaderProps) {
  const { t } = useI18n();
  const [statusOpen, setStatusOpen] = useState(false);
  const [alertsOpen, setAlertsOpen] = useState(false);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const [mobileSearchOpen, setMobileSearchOpen] = useState(false);
  const [topbarState, setTopbarState] = useState<TopbarState>(unavailableTopbarState);
  const [dismissedAlertIds, setDismissedAlertIds] = useState<Set<string>>(() => new Set());
  const statusRef = useRef<HTMLDivElement>(null);
  const alertsRef = useRef<HTMLDivElement>(null);
  const overflowRef = useRef<HTMLDivElement>(null);
  const closeStatus = useCallback(() => setStatusOpen(false), []);
  const closeAlerts = useCallback(() => setAlertsOpen(false), []);
  const closeOverflow = useCallback(() => setOverflowOpen(false), []);
  useOutsideClose(statusRef, closeStatus, statusOpen);
  useOutsideClose(alertsRef, closeAlerts, alertsOpen);
  useOutsideClose(overflowRef, closeOverflow, overflowOpen);

  const loadTopbarState = useCallback(() => void apiFetch<TopbarState>('/api/v1/dashboard/topbar-state').then(setTopbarState).catch(() => setTopbarState(unavailableTopbarState())), []);
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

  const stateLabel = topbarState.environment.state === 'OPERATIONAL' ? t('shell.operational') : topbarState.environment.state === 'DEGRADED' ? t('shell.degraded') : t('shell.unavailable');
  const openGlobalSearch = () => {
    setMobileSearchOpen(false);
    onOpenGlobalSearch();
  };
  const toggleContextSearch = () => {
    if (globalSearch) openGlobalSearch();
    else setMobileSearchOpen((value) => !value);
  };
  const visibleAlerts = topbarState.alerts.filter((alert) => !dismissedAlertIds.has(alert.id));
  const clearAlerts = () => {
    setDismissedAlertIds((current) => new Set([...current, ...topbarState.alerts.map((alert) => alert.id)]));
    void apiFetch('/api/v1/dashboard/notifications/read-all', { method: 'PATCH' }).catch(() => undefined);
  };

  return <header className={`topbar ${mobileSearchOpen ? 'mobile-search-visible' : ''}`}><button className="mobile-menu icon-button" onClick={onOpenSidebar} aria-label="Abrir menu"><Menu size={19} /></button><div className="topbar-identity"><strong>{section}</strong>{context.length > 0 && <div className="topbar-breadcrumbs" aria-label="Contexto atual">{context.map((item, index) => <span key={`${item}-${index}`}><b>/</b>{item}</span>)}</div>}</div><div className="topbar-workspace">{globalSearch ? <button className="topbar-search-trigger" onClick={openGlobalSearch}><Search size={15} /><span>Pesquisar em toda a plataforma</span><kbd>⌘ K</kbd></button> : search ? <label className="topbar-context-search"><Search size={15} /><input value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder} aria-label={search.ariaLabel ?? search.placeholder} />{search.value && <button type="button" onClick={() => search.onChange('')} aria-label="Limpar pesquisa"><X size={13} /></button>}</label> : null}{actions && <div className="topbar-page-actions">{actions}</div>}</div>{(search || globalSearch) && <button className="topbar-mobile-search icon-button" onClick={toggleContextSearch} aria-expanded={mobileSearchOpen} aria-label="Pesquisar"><Search size={17} /></button>}<div className="topbar-globals"><div className="topbar-popover-anchor" ref={statusRef}><button className={`environment-trigger ${topbarState.environment.state.toLowerCase()}`} onClick={() => { setStatusOpen((value) => !value); setAlertsOpen(false); }} aria-expanded={statusOpen} aria-haspopup="dialog"><i /><span>{stateLabel}</span></button>{statusOpen && <section className="topbar-popover status-popover" role="dialog" aria-label="Estado do ambiente"><PopoverHeading eyebrow="ESTADO GLOBAL" title={stateLabel} onClose={closeStatus} /><div className="service-list">{topbarState.environment.services.map((service) => <div key={service.key}><span className={service.state.toLowerCase()}>{service.state === 'OPERATIONAL' ? <CheckCircle2 size={14} /> : <AlertTriangle size={14} />}</span><strong>{service.label}</strong><small>{service.state === 'OPERATIONAL' ? 'Operacional' : service.state === 'UNKNOWN' ? 'Estado desconhecido' : 'Indisponível'}</small></div>)}</div><div className="popover-updated"><Clock3 size={12} /> Atualizado {new Date(topbarState.updatedAt).toLocaleTimeString('pt-PT', { hour: '2-digit', minute: '2-digit' })}</div></section>}</div><div className="topbar-popover-anchor" ref={alertsRef}><button className="icon-button alerts-trigger" onClick={() => { setAlertsOpen((value) => !value); setStatusOpen(false); }} aria-label={`${visibleAlerts.length} alertas ativos`} aria-expanded={alertsOpen} aria-haspopup="dialog"><Bell size={17} />{visibleAlerts.length > 0 && <span className="alert-count">{visibleAlerts.length > 9 ? '9+' : visibleAlerts.length}</span>}</button>{alertsOpen && <section className="topbar-popover alerts-popover" role="dialog" aria-label="Centro de alertas"><PopoverHeading eyebrow="CENTRO DE ALERTAS" title={`${visibleAlerts.length} ativo${visibleAlerts.length === 1 ? '' : 's'}`} onClose={closeAlerts} action={visibleAlerts.length ? <button className="clear-alerts-button" type="button" onClick={clearAlerts}>Limpar todos</button> : undefined} />{topbarState.processes.length > 0 && <div className="running-processes"><span><Activity size={13} /> Em execução</span>{topbarState.processes.map((process) => <a href={process.href} key={process.id}><i /><span><strong>{process.label}</strong><small>{process.detail} · {process.state}</small></span><ChevronRight size={13} /></a>)}</div>}<div className="alert-list">{visibleAlerts.length ? visibleAlerts.map((alert) => <a href={alert.href} className={alert.severity.toLowerCase()} key={alert.id}><span className="alert-severity">{alert.severity === 'INFO' ? <Activity size={14} /> : <AlertTriangle size={14} />}</span><span><strong>{alert.title}</strong><small>{alert.detail}</small><time>{new Date(alert.occurredAt).toLocaleString('pt-PT')}</time></span><ChevronRight size={13} /></a>) : <div className="alerts-empty"><CheckCircle2 size={20} /><strong>Sem alertas ativos</strong><span>O ambiente não requer atenção.</span></div>}</div></section>}</div>{actions && <div className="topbar-popover-anchor mobile-overflow" ref={overflowRef}><button className="icon-button" onClick={() => setOverflowOpen((value) => !value)} aria-label="Mais ações" aria-expanded={overflowOpen}><MoreHorizontal size={18} /></button>{overflowOpen && <section className="topbar-popover overflow-popover" role="menu">{actions}</section>}</div>}</div>{mobileSearchOpen && search && <label className="mobile-context-search"><Search size={15} /><input autoFocus value={search.value} onChange={(event) => search.onChange(event.target.value)} placeholder={search.placeholder} aria-label={search.ariaLabel ?? search.placeholder} /><button type="button" onClick={() => setMobileSearchOpen(false)} aria-label="Fechar pesquisa"><X size={15} /></button></label>}</header>;
}
