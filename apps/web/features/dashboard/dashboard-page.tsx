'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import Link from 'next/link';
import {
  Activity,
  Bell,
  ArrowUpRight,
  ClipboardCheck,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  AlertTriangle,
  SlidersHorizontal,
  Radar,
  CalendarClock,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { AppShell, ToolbarMore } from '@/components/layout/app-shell';
import { getDashboardSummary } from './api';
import { getDashboardEnvironment, getDashboardLayout, getDashboardWorkspaces, getOperationalSummary, saveDashboardLayout, saveDashboardPreference, type DashboardLayout, type DashboardWorkspace } from './api';
import { OperationsPanel } from '@/features/operations/operations-panel';
import { useSiteContext } from '@/lib/site-context';
import { useI18n } from '@/lib/i18n';
import { countProblemsBySeverity, type DashboardSeverity } from './severity';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { alertListHref, auditHref, changePlansHref, deviceListHref, discoveryJobsHref, qualityListHref, severityTileHref, subnetListHref, widgetLabel } from './drill-through';

const severityTiles: Array<{ severity: DashboardSeverity; labelKey: string }> = [
  { severity: 'CRITICAL', labelKey: 'dashboard.severity.critical' },
  { severity: 'HIGH', labelKey: 'dashboard.severity.high' },
  { severity: 'WARNING', labelKey: 'dashboard.severity.warning' },
  { severity: 'INFO', labelKey: 'dashboard.severity.info' },
];
/** Grid widgets in fixed priority order; the remaining widget ids render as KPI tiles. */
const gridWidgetOrder = ['active-alerts', 'quality-queue', 'service-health', 'recent-changes', 'inventory-summary', 'quick-actions'];
const kpiWidgetIds = new Set(['running-processes', 'discovery-review', 'snmp-drifts']);
/** The fit layout is a 3x2 grid on desktop: a half-width widget takes one cell, a full-width one a whole row. */
const FIT_COLUMNS = 3;
const FIT_CELLS = FIT_COLUMNS * 2;

/** A KPI tile; with `href` the whole tile is a link to the matching filtered list (drill-through). */
function KpiTile({ label, value, detail, icon: Icon, tone = '', ariaLabel, href }: { label: string; value: string; detail?: string; icon?: typeof Activity; tone?: string; ariaLabel?: string; href?: string }) {
  const className = `dashboard-kpi ${tone}`.trim();
  const content = <>
    <div className="dashboard-kpi-head"><span>{label}</span>{Icon && <Icon size={14} strokeWidth={1.8} aria-hidden="true" />}</div>
    <div className="dashboard-kpi-value">{value}</div>
    {detail && <small>{detail}</small>}
  </>;
  return href ? <Link className={className} href={href} aria-label={ariaLabel}>{content}</Link> : <article className={className} aria-label={ariaLabel}>{content}</article>;
}

export default function DashboardPage() {
  const { user, profile, hasRole } = useAuth();
  const { t } = useI18n();
  // Wait until the active site is resolved: an empty siteId before that is "not known yet", and
  // loading workspaces for it fetched them twice on every dashboard load (all sites, then the site).
  const { siteId, resolved: siteResolved = true } = useSiteContext();
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [workspacesStatus, setWorkspacesStatus] = useState<'loading' | 'ready' | 'error'>('loading');
  const [workspacesReload, setWorkspacesReload] = useState(0);
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
  /** The layout as it was when editing started, so Cancel can put it back without saving. */
  const [layoutBeforeEdit, setLayoutBeforeEdit] = useState<DashboardLayout | null>(null);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const canEditLayout = hasRole('ADMIN') || Boolean(workspace && (hasRole('NETWORK_OPERATOR') && workspace.role === 'NETWORK_OPERATOR' || hasRole('SYSTEMS_OPERATOR') && workspace.role === 'SYSTEMS_OPERATOR'));
  useEffect(() => {
    if (!siteResolved) return;
    let cancelled = false;
    void getDashboardWorkspaces(siteId || undefined).then((response) => {
      if (cancelled) return;
      const items = response.items ?? [];
      setWorkspaces(items);
      setWorkspaceId((current) => items.some((item) => item.id === current) ? current : (items.find((item) => item.selected)?.id ?? items[0]?.id ?? ''));
      setWorkspacesStatus('ready');
    }).catch(() => { if (!cancelled) setWorkspacesStatus('error'); });
    return () => { cancelled = true; };
  }, [siteId, siteResolved, workspacesReload]);
  useEffect(() => { if (!workspace) { setLayout(null); return; } void Promise.all([getDashboardLayout(workspace.siteId, workspace.role), saveDashboardPreference(workspace.siteId, workspace.role)]).then(([next]) => setLayout(next)).catch(() => undefined); }, [workspace]);
  const { data: summary = null, refetch: refetchSummary, isPending: summaryPending, isError: summaryError } = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: getDashboardSummary });
  const { data: operational, refetch: refetchOperational, isPending: operationalPending, isError: operationalError } = useQuery({ queryKey: ['dashboard', 'operational', workspace?.siteId, workspace?.role], queryFn: () => getOperationalSummary(workspace!.siteId, workspace!.role), enabled: Boolean(workspace) });
  const { data: environmentData, isPending: environmentPending, isError: environmentError } = useQuery({ queryKey: ['dashboard', 'environment'], queryFn: getDashboardEnvironment, staleTime: 30_000 });
  const displayName = profile?.firstName || user?.username || t('dashboard.userFallback');
  const canNetworkChange = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const canConfigureAlerts = hasRole('ADMIN');
  const canViewAudit = hasRole('ADMIN') || hasRole('AUDITOR');
  const canViewChanges = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'].some(hasRole);
  /** Drill-through links open the list in the dashboard's workspace Site. */
  const drillSiteId = workspace?.siteId || siteId || undefined;
  const operationalCount = operational ? operational.services.filter((item) => item.state === 'OPERATIONAL').length : 0;
  const operationalPercent = operational?.services.length ? Math.round(operationalCount / operational.services.length * 100) : 0;
  const environmentState = environmentData?.environment.state;
  const environmentStateLabel = environmentState === 'OPERATIONAL' ? t('dashboard.env.operational') : environmentState === 'DEGRADED' ? t('dashboard.env.degraded') : environmentState === 'UNAVAILABLE' || environmentError ? t('dashboard.env.unavailable') : t('dashboard.env.loading');
  const environmentStateTone = environmentState === 'OPERATIONAL' ? 'green' : environmentState === 'UNAVAILABLE' || environmentError ? 'red' : 'orange';

  const toggleLayoutEditing = () => {
    if (editingLayout) { setLayoutBeforeEdit(null); setEditingLayout(false); return; }
    setLayoutBeforeEdit(layout);
    setEditingLayout(true);
  };
  const cancelLayoutEditing = () => {
    if (layoutBeforeEdit) setLayout(layoutBeforeEdit);
    setLayoutBeforeEdit(null);
    setEditingLayout(false);
  };
  const refreshDashboard = () => { void refetchSummary(); if (workspacesStatus === 'error') { setWorkspacesStatus('loading'); setWorkspacesReload((value) => value + 1); } else void refetchOperational(); };
  /** The alerts/quality cards render only once the workspace is known, so they never flash global or all-site data. */
  const panelsReady = workspacesStatus === 'ready' && (Boolean(workspace) || workspaces.length === 0);
  const panelPlaceholder = (kind: 'alerts' | 'quality') => <article className="panel"><div className="panel-heading"><div><h2>{t(kind === 'alerts' ? 'dashboard.alertsTitle' : 'dashboard.qualityTitle')}</h2></div></div><div className="no-data" role="status">{t(workspacesStatus === 'error' ? 'dashboard.workspacesError' : 'dashboard.loading')}</div></article>;
  const visible = (id: string) => layout?.widgets.some((widget) => widget.id === id && widget.visible) ?? true;
  const isFull = (id: string) => (layout?.widgets.find((item) => item.id === id)?.w ?? 6) >= 9;
  const gridStyle = (id: string) => ({ order: gridWidgetOrder.indexOf(id) + 1, minWidth: 0 });
  const widgetClass = (id: string) => (isFull(id) ? 'dashboard-widget dashboard-widget--full' : 'dashboard-widget');
  const fitCells = gridWidgetOrder.filter((id) => visible(id)).reduce((cells, id) => cells + (isFull(id) ? FIT_COLUMNS : 1), 0);
  const fitOverflow = fitCells > FIT_CELLS;
  const updateWidget = (id: string, field: 'x' | 'y' | 'w' | 'h', value: number) => setLayout((current) => current ? ({ ...current, widgets: current.widgets.map((item) => {
    if (item.id !== id) return item;
    const next = Math.max(field === 'w' || field === 'h' ? 1 : 0, Math.floor(value || 0));
    if (field === 'x') return { ...item, x: Math.min(next, 11), w: Math.min(item.w, 12 - Math.min(next, 11)) };
    if (field === 'w') return { ...item, w: Math.min(next, 12 - item.x) };
    return { ...item, [field]: field === 'h' ? Math.min(next, 12) : next };
  }) }) : current);

  const counts = summary?.counts ? { ...summary.counts, ...(operational?.inventory ?? {}) } : undefined;
  const recentAudit = summary?.recentAudit ?? [];
  const inventoryBars: Array<{ label: string; value: number; color: string; href?: string }> = counts ? [
    { label: 'Sites', value: counts.sites, color: 'black' },
    { label: t('dashboard.inventory.devices'), value: counts.devices, color: 'blue', href: deviceListHref(drillSiteId) },
    { label: 'VLANs', value: counts.vlans, color: 'purple' },
    { label: 'Subnets', value: counts.subnets, color: 'green', href: subnetListHref(drillSiteId, { sort: 'utilization' }) },
    { label: 'IPs', value: counts.ips, color: 'orange' },
  ] : [];
  /** Drill-through shortcuts in "Acesso rápido": each opens a list already filtered. */
  const drillLinks: Array<{ label: string; href: string; icon: typeof Activity }> = [
    { label: t('dashboard.drill.criticalDevices'), href: deviceListHref(drillSiteId, { critical: true }), icon: ShieldCheck },
    { label: t('dashboard.drill.lifecycleOverdue'), href: deviceListHref(drillSiteId, { lifecycle: 'overdue' }), icon: AlertTriangle },
    { label: t('dashboard.drill.lifecycleDue90'), href: deviceListHref(drillSiteId, { lifecycle: 'due:90' }), icon: CalendarClock },
    { label: t('dashboard.drill.subnetsAbove80'), href: subnetListHref(drillSiteId, { band: 'WARNING,CRITICAL', sort: 'utilization' }), icon: Network },
    { label: t('dashboard.drill.openCriticalAlerts'), href: alertListHref(drillSiteId, { severity: 'CRITICAL', status: 'OPEN' }), icon: Bell },
    { label: t('dashboard.drill.criticalQuality'), href: qualityListHref(drillSiteId, { severity: 'CRITICAL' }), icon: ClipboardCheck },
    ...(canViewChanges ? [{ label: t('dashboard.drill.changesInReview'), href: changePlansHref(drillSiteId, { status: 'SUBMITTED' }), icon: CalendarClock }] : []),
    ...(canNetworkChange ? [{ label: t('dashboard.drill.failedDiscoveries'), href: discoveryJobsHref({ status: 'FAILED' }), icon: Radar }] : []),
  ];
  const problems = countProblemsBySeverity(operational?.alerts?.groups, operational?.quality?.groups);
  const operationalValue = (value: number | undefined) => operational && value !== undefined ? formatNumber(value) : operationalError || workspacesStatus === 'error' ? t('dashboard.error') : workspacesStatus === 'ready' && !workspace ? '—' : operationalPending || workspacesStatus === 'loading' ? '…' : '—';

  const dashboardToolbar = <label className="dashboard-workspace-control">Workspace<select className="context-toolbar-selector" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option value={item.id} key={item.id}>{item.siteName}{item.siteCode ? ` · ${item.siteCode}` : ''} · {item.role}</option>)}</select></label>;
  const dashboardActions = <>{canEditLayout && <button className="secondary-button" onClick={toggleLayoutEditing}>{editingLayout ? t('dashboard.finishEditing') : t('dashboard.editLayout')}</button>}<button className="secondary-button" onClick={refreshDashboard}><RefreshCw size={15} /> {t('common.refresh')}</button><button className="secondary-button" onClick={() => { window.location.href = '/definicoes'; }}><SlidersHorizontal size={15} /> {t('dashboard.settings')}</button>{canNetworkChange && <button className="primary-button" onClick={() => { window.location.href = '/descoberta?action=new'; }}><Radar size={15} /> {t('dashboard.newDiscovery')}</button>}{canNetworkChange && <ToolbarMore><Link className="secondary-button" href="/infraestrutura?action=new"><Server size={16} /> {t('dashboard.addDevice')}</Link></ToolbarMore>}</>;

  return (
    <AppShell section="Dashboard" globalSearch toolbar={dashboardToolbar} actions={dashboardActions}>
          <div className={`dashboard-content dashboard-fit${fitOverflow || editingLayout ? ' dashboard-fit--scroll' : ''}`}>
            {editingLayout && canEditLayout && layout && <section className="ipam-card dashboard-layout-editor"><div className="panel-heading"><div><h2>{t('dashboard.layout.title')}</h2><p className="panel-description">{t('dashboard.layout.description')}</p></div></div>{fitOverflow && <p className="dashboard-fit-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> {t('dashboard.fitOverflowWarning')}</p>}<div className="dashboard-layout-options">{layout.widgets.map((widget) => <div className="dashboard-layout-option" key={widget.id}><label><input type="checkbox" checked={widget.visible} onChange={(event) => setLayout((current) => current ? ({ ...current, widgets: current.widgets.map((item) => item.id === widget.id ? { ...item, visible: event.target.checked } : item) }) : current)} /> <strong>{widgetLabel(widget.id)}</strong></label>{kpiWidgetIds.has(widget.id) ? <span className="dashboard-layout-kpi-note">{t('dashboard.kpiWidget')}</span> : <label>{t('dashboard.layout.width')}<select value={widget.w >= 9 ? '12' : '6'} onChange={(event) => { const width = Number(event.target.value); updateWidget(widget.id, 'w', width); updateWidget(widget.id, 'x', 0); }}><option value="6">{t('dashboard.layout.half')}</option><option value="12">{t('dashboard.layout.full')}</option></select></label>}</div>)}</div><div className="dashboard-layout-actions"><button type="button" className="primary-button" onClick={() => void saveDashboardLayout(layout).then((saved) => { setLayout(saved); setLayoutBeforeEdit(null); setEditingLayout(false); })}>{t('dashboard.layout.save')}</button><button type="button" className="secondary-button" onClick={cancelLayoutEditing}>{t('common.cancel')}</button></div></section>}
            {workspacesStatus === 'error' && <p className="dashboard-fit-warning dashboard-load-error" role="alert"><AlertTriangle size={15} aria-hidden="true" /> {t('dashboard.workspacesError')} <button className="text-button" onClick={refreshDashboard}>{t('dashboard.retry')}</button></p>}
            {workspacesStatus === 'ready' && workspaces.length === 0 && <p className="dashboard-fit-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> {t('dashboard.noWorkspace')}</p>}
            <section className="hero-row dashboard-hero">
              <h1>{t('dashboard.greeting', undefined, { name: displayName })}</h1><p>{t('dashboard.heroSubtitle')}</p>
            </section>

            <section className="dashboard-kpi-strip" aria-label={t('dashboard.kpis')}>
              <KpiTile label={t('dashboard.assets')} value={operationalValue(operational?.inventory?.devices)} detail={t('dashboard.assetsDetail')} icon={Server} tone="assets" href={deviceListHref(drillSiteId)} />
              {severityTiles.map(({ severity, labelKey }) => { const count = problems[severity]; const label = t(labelKey); const detail = t('dashboard.severityDetail', undefined, { alerts: count.alerts, quality: count.quality }); return <KpiTile key={severity} label={label} value={operationalValue(count.total)} detail={detail} tone={`severity ${severity.toLowerCase()}${count.total ? '' : ' is-zero'}`} ariaLabel={operational ? `${label}: ${count.total} — ${detail}` : undefined} href={severityTileHref(drillSiteId, severity, count)} />; })}
              {visible('running-processes') && <KpiTile label={t('dashboard.runningProcesses')} value={operationalValue(operational?.processes.length)} icon={Activity} href={canNetworkChange ? discoveryJobsHref({ status: 'PENDING,RUNNING' }) : undefined} />}
              {visible('discovery-review') && <KpiTile label={t('dashboard.discoveryReview')} value={operationalValue(operational?.discovery)} icon={Search} href={canNetworkChange ? discoveryJobsHref({ status: 'FAILED' }) : undefined} />}
              {visible('snmp-drifts') && <KpiTile label={t('dashboard.snmpDrifts')} value={operationalValue(operational?.drifts)} icon={Network} href="/snmp" />}
            </section>

            <section className="dashboard-widget-grid" aria-label={t('dashboard.siteOperations')}>
              {visible('service-health') && <article className={`panel ipam-card health-panel ${widgetClass('service-health')}`} style={gridStyle('service-health')}>
                <div className="panel-heading"><div><h2>{t('dashboard.serviceHealth')}</h2></div></div>
                <div className="health-score"><div className="score-ring" style={{ background: operational ? `conic-gradient(#53ae79 0 ${operationalPercent}%, #ecf2ee ${operationalPercent}% 100%)` : '#ecf2ee' }} role="img" aria-label={operational ? t('dashboard.servicesRing', undefined, { operational: operationalCount, total: operational.services.length, percent: operationalPercent }) : t('dashboard.servicesUnavailable')}><span>{operational ? operationalCount : '—'}<span>{operational ? `/${operational.services.length}` : ''}</span></span></div><div className="environment-health-summary"><strong>{t('dashboard.environmentState')}</strong><span className={`status-pill ${environmentStateTone}`} role="status" aria-label={t('dashboard.environmentStateLabel', undefined, { state: environmentStateLabel })}>{environmentStateLabel}</span><p>{environmentData ? formatDateTime(environmentData.updatedAt) : environmentError ? t('dashboard.environmentLoadError') : environmentPending ? t('dashboard.servicesLoading') : t('dashboard.environmentEmpty')}</p></div></div>
                <div className="system-list dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.servicesList')}>{environmentData?.environment.services.map((service) => { const state = service.state.toUpperCase(); const tone = state === 'OPERATIONAL' ? 'green' : ['UNAVAILABLE', 'DOWN', 'OFFLINE', 'FAILED', 'ERROR'].includes(state) ? 'red' : 'orange'; return <div className="system-row" key={service.key}><span className="system-icon"><Activity size={16} /></span><span className="system-info"><strong>{service.label}</strong><small>{service.key}</small></span><span className={`status-pill ${tone}`}><i />{service.state}</span></div>; })}{environmentPending && <div className="no-data" role="status">{t('dashboard.servicesLoading')}</div>}{environmentError && <div className="no-data" role="status">{t('dashboard.servicesListError')}</div>}{!environmentPending && !environmentError && environmentData?.environment.services.length === 0 && <div className="no-data" role="status">{t('dashboard.servicesEmpty')}</div>}</div>
              </article>}

              {visible('inventory-summary') && <article className={`panel ipam-card trend-panel ${widgetClass('inventory-summary')}`} style={gridStyle('inventory-summary')}>
                <div className="panel-heading"><div><h2>{t('dashboard.inventoryTitle')}</h2></div><span className="data-badge">{t('dashboard.liveData')}</span></div>
                <div className="inventory-bars dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.inventoryList')}>{inventoryBars.length ? inventoryBars.map((item) => { const max = Math.max(...inventoryBars.map((bar) => bar.value), 1); return <div className="inventory-bar" key={item.label}><div>{item.href ? <Link className="text-button" href={item.href}>{item.label} <ArrowUpRight size={12} aria-hidden="true" /></Link> : <span>{item.label}</span>}<strong>{formatNumber(item.value)}</strong></div><div className="bar-track"><i className={item.color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 4 : 0)}%` }} /></div></div>; }) : <div className="no-data" role="status">{summaryError ? t('dashboard.inventoryLoadError') : t('dashboard.inventoryLoading')}</div>}</div>
              </article>}
              {visible('recent-changes') && <article className={`panel ipam-card activity-panel ${widgetClass('recent-changes')}`} style={gridStyle('recent-changes')}><div className="panel-heading"><div><h2>{t('dashboard.activityTitle')}</h2></div>{canViewAudit && <Link className="text-button" href="/auditoria">{t('dashboard.viewAudit')} <ArrowUpRight size={14} aria-hidden="true" /></Link>}</div><div className="activity-list dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.activityList')}>{summaryPending ? <div className="no-data" role="status">{t('dashboard.activityLoading')}</div> : summaryError ? <div className="no-data" role="status">{t('dashboard.activityError')}</div> : recentAudit.length ? recentAudit.map((entry) => <div className="activity-row" key={entry.id}><span className="activity-icon dark"><ShieldCheck size={16} /></span><span><strong>{entry.username} · {entry.action}</strong><small>{entry.entityType ?? t('dashboard.activityOperation')} · {formatDateTime(entry.createdAt)}</small></span>{canViewAudit ? <Link className="icon-button subtle" href={auditHref({ entityType: entry.entityType, event: entry.id })} aria-label={t('dashboard.openInAudit', undefined, { action: entry.action })}><ArrowUpRight size={15} /></Link> : <ArrowUpRight size={15} className="muted-icon" />}</div>) : <div className="no-data">{t('dashboard.activityEmpty')}</div>}</div></article>}
              {visible('quick-actions') && <article className={`panel ipam-card quick-panel ${widgetClass('quick-actions')}`} style={gridStyle('quick-actions')}><div className="panel-heading"><div><h2>{t('dashboard.quickTitle')}</h2></div></div><p className="dashboard-toolbar-hint">{t('dashboard.quickHint')}</p><nav className="dashboard-quick-links dashboard-scroll" aria-label={t('dashboard.quickNav')}>{canConfigureAlerts && <Link className="dashboard-quick-link" href="/alertas"><Bell size={17} /><span>{t('dashboard.quick.alertRules')}</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>}<Link className="dashboard-quick-link" href="/qualidade-inventario"><ClipboardCheck size={17} /><span>{t('dashboard.quick.inventoryQuality')}</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>{canNetworkChange && <Link className="dashboard-quick-link" href="/descoberta?action=new"><Radar size={17} /><span>{t('dashboard.quick.startDiscovery')}</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>}{drillLinks.map((item) => <Link className="dashboard-quick-link" href={item.href} key={item.href}><item.icon size={17} /><span>{item.label}</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>)}</nav></article>}
              {visible('active-alerts') && <div className={`dashboard-operations-widget ${widgetClass('active-alerts')}`} style={gridStyle('active-alerts')}>{panelsReady ? <OperationsPanel showAlerts showQuality={false} compact siteId={workspace?.siteId} /> : <section className="content-grid operations-compact">{panelPlaceholder('alerts')}</section>}</div>}
              {visible('quality-queue') && <div className={`dashboard-operations-widget ${widgetClass('quality-queue')}`} style={gridStyle('quality-queue')}>{panelsReady ? <OperationsPanel showAlerts={false} showQuality compact siteId={workspace?.siteId} /> : <section className="content-grid operations-compact">{panelPlaceholder('quality')}</section>}</div>}
            </section>

          </div>
    </AppShell>
  );
}
