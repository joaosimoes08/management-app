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
  Sparkles,
} from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { AppShell, ToolbarMore } from '@/components/layout/app-shell';
import { getDashboardSummary } from './api';
import { getDashboardEnvironment, getDashboardLayout, getDashboardWorkspaces, getOperationalSummary, saveDashboardLayout, saveDashboardPreference, type DashboardLayout, type DashboardWorkspace } from './api';
import { OperationsPanel } from '@/features/operations/operations-panel';
import { useSiteContext } from '@/lib/site-context';
import { useI18n } from '@/lib/i18n';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import { countProblemsBySeverity, type DashboardSeverity } from './severity';

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

function KpiTile({ label, value, detail, icon: Icon, tone = '', ariaLabel }: { label: string; value: string; detail?: string; icon?: typeof Activity; tone?: string; ariaLabel?: string }) {
  return (
    <article className={`dashboard-kpi ${tone}`.trim()} aria-label={ariaLabel}>
      <div className="dashboard-kpi-head"><span>{label}</span>{Icon && <Icon size={14} strokeWidth={1.8} aria-hidden="true" />}</div>
      <div className="dashboard-kpi-value">{value}</div>
      {detail && <small>{detail}</small>}
    </article>
  );
}

export default function DashboardPage() {
  const { user, profile, hasRole } = useAuth();
  const { t } = useI18n();
  const { siteId } = useSiteContext();
  const [workspaces, setWorkspaces] = useState<DashboardWorkspace[]>([]);
  const [workspaceId, setWorkspaceId] = useState('');
  const [layout, setLayout] = useState<DashboardLayout | null>(null);
  const [editingLayout, setEditingLayout] = useState(false);
  const workspace = workspaces.find((item) => item.id === workspaceId);
  const canEditLayout = hasRole('ADMIN') || Boolean(workspace && (hasRole('NETWORK_OPERATOR') && workspace.role === 'NETWORK_OPERATOR' || hasRole('SYSTEMS_OPERATOR') && workspace.role === 'SYSTEMS_OPERATOR'));
  useEffect(() => { void getDashboardWorkspaces(siteId || undefined).then((response) => { const items = response.items ?? []; setWorkspaces(items); setWorkspaceId((current) => items.some((item) => item.id === current) ? current : (items.find((item) => item.selected)?.id ?? items[0]?.id ?? '')); }).catch(() => undefined); }, [siteId]);
  useEffect(() => { if (!workspace) { setLayout(null); return; } void Promise.all([getDashboardLayout(workspace.siteId, workspace.role), saveDashboardPreference(workspace.siteId, workspace.role)]).then(([next]) => setLayout(next)).catch(() => undefined); }, [workspace]);
  const { data: summary = null, refetch: refetchSummary, isPending: summaryPending, isError: summaryError } = useQuery({ queryKey: ['dashboard', 'summary'], queryFn: getDashboardSummary });
  const { data: operational, refetch: refetchOperational, isPending: operationalPending, isError: operationalError } = useQuery({ queryKey: ['dashboard', 'operational', workspace?.siteId, workspace?.role], queryFn: () => getOperationalSummary(workspace!.siteId, workspace!.role), enabled: Boolean(workspace) });
  const { data: environmentData, isPending: environmentPending, isError: environmentError } = useQuery({ queryKey: ['dashboard', 'environment'], queryFn: getDashboardEnvironment, staleTime: 30_000 });
  const { data: healthResponse } = useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: async () => {
      const apiUrl = getPublicRuntimeConfig().apiUrl;
      const response = await fetch(`${apiUrl}/api/v1/health`, { cache: 'no-store' });
      return response.ok;
    },
    staleTime: 30_000,
  });
  const apiOnline: boolean | null = typeof healthResponse === 'boolean' ? healthResponse : null;
  const displayName = profile?.firstName || user?.username || 'Utilizador';
  const canNetworkChange = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const canConfigureAlerts = hasRole('ADMIN');
  const canViewAudit = hasRole('ADMIN') || hasRole('AUDITOR');
  const operationalPercent = operational?.services.length
    ? Math.round(operational.services.filter((item) => item.state === 'OPERATIONAL').length / operational.services.length * 100)
    : 0;
  const environmentState = environmentData?.environment.state;
  const environmentStateLabel = environmentState === 'OPERATIONAL' ? 'Operacional' : environmentState === 'DEGRADED' ? 'Degradado' : environmentState === 'UNAVAILABLE' || environmentError ? 'Indisponível' : 'A carregar';
  const environmentStateTone = environmentState === 'OPERATIONAL' ? 'green' : environmentState === 'UNAVAILABLE' || environmentError ? 'red' : 'orange';

  const refreshDashboard = () => { void refetchSummary(); void refetchOperational(); };
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
  const inventoryBars = counts ? [
    { label: 'Sites', value: counts.sites, color: 'black' },
    { label: 'Equipamentos', value: counts.devices, color: 'blue' },
    { label: 'VLANs', value: counts.vlans, color: 'purple' },
    { label: 'Subnets', value: counts.subnets, color: 'green' },
    { label: 'IPs', value: counts.ips, color: 'orange' },
  ] : [];
  const problems = countProblemsBySeverity(operational?.alerts?.groups, operational?.quality?.groups);
  const operationalValue = (value: number | undefined) => operational && value !== undefined ? value.toLocaleString('pt-PT') : operationalError ? t('dashboard.error') : operationalPending ? '…' : '—';

  const dashboardToolbar = <label className="dashboard-workspace-control">Workspace<select className="context-toolbar-selector" value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option value={item.id} key={item.id}>{item.siteName}{item.siteCode ? ` · ${item.siteCode}` : ''} · {item.role}</option>)}</select></label>;
  const dashboardActions = <>{canEditLayout && <button className="secondary-button" onClick={() => setEditingLayout((value) => !value)}>{editingLayout ? t('dashboard.finishEditing') : t('dashboard.editLayout')}</button>}<button className="secondary-button" onClick={refreshDashboard}><RefreshCw size={15} /> Atualizar</button><button className="secondary-button" onClick={() => { window.location.href = '/definicoes'; }}><SlidersHorizontal size={15} /> Definições</button>{canNetworkChange && <button className="primary-button" onClick={() => { window.location.href = '/descoberta?action=new'; }}><Sparkles size={15} /> Nova descoberta</button>}{canNetworkChange && <ToolbarMore><Link className="secondary-button" href="/infraestrutura?action=new"><Server size={16} /> Adicionar equipamento</Link></ToolbarMore>}</>;

  return (
    <AppShell section="Dashboard" globalSearch toolbar={dashboardToolbar} actions={dashboardActions}>
          <div className={`dashboard-content dashboard-fit${fitOverflow || editingLayout ? ' dashboard-fit--scroll' : ''}`}>
            {editingLayout && canEditLayout && layout && <section className="ipam-card dashboard-layout-editor"><div className="panel-heading"><div><span className="section-kicker">PERSONALIZAÇÃO</span><h2>Widgets do dashboard</h2><p className="panel-description">Escolhe o que aparece e quais cartões ocupam a largura completa.</p></div></div>{fitOverflow && <p className="dashboard-fit-warning" role="status"><AlertTriangle size={15} aria-hidden="true" /> {t('dashboard.fitOverflowWarning')}</p>}<div className="dashboard-layout-options">{layout.widgets.map((widget) => <div className="dashboard-layout-option" key={widget.id}><label><input type="checkbox" checked={widget.visible} onChange={(event) => setLayout((current) => current ? ({ ...current, widgets: current.widgets.map((item) => item.id === widget.id ? { ...item, visible: event.target.checked } : item) }) : current)} /> <strong>{widget.id}</strong></label>{kpiWidgetIds.has(widget.id) ? <span className="dashboard-layout-kpi-note">{t('dashboard.kpiWidget')}</span> : <label>Largura<select value={widget.w >= 9 ? '12' : '6'} onChange={(event) => { const width = Number(event.target.value); updateWidget(widget.id, 'w', width); updateWidget(widget.id, 'x', 0); }}><option value="6">Metade</option><option value="12">Completa</option></select></label>}</div>)}</div><button className="primary-button" onClick={() => void saveDashboardLayout(layout).then((saved) => { setLayout(saved); setEditingLayout(false); })}>Guardar layout</button></section>}
            <section className="hero-row dashboard-hero">
              <h1>Bom dia, {displayName}</h1><p>Aqui está o estado atual da sua infraestrutura.</p>
            </section>

            <section className="dashboard-kpi-strip" aria-label={t('dashboard.kpis')}>
              <KpiTile label={t('dashboard.assets')} value={operationalValue(operational?.inventory?.devices)} detail={t('dashboard.assetsDetail')} icon={Server} tone="assets" />
              {severityTiles.map(({ severity, labelKey }) => { const count = problems[severity]; const label = t(labelKey); const detail = t('dashboard.severityDetail', undefined, { alerts: count.alerts, quality: count.quality }); return <KpiTile key={severity} label={label} value={operationalValue(count.total)} detail={detail} tone={`severity ${severity.toLowerCase()}${count.total ? '' : ' is-zero'}`} ariaLabel={operational ? `${label}: ${count.total} — ${detail}` : undefined} />; })}
              {visible('running-processes') && <KpiTile label={t('dashboard.runningProcesses')} value={operationalValue(operational?.processes.length)} icon={Activity} />}
              {visible('discovery-review') && <KpiTile label={t('dashboard.discoveryReview')} value={operationalValue(operational?.discovery)} icon={Search} />}
              {visible('snmp-drifts') && <KpiTile label={t('dashboard.snmpDrifts')} value={operationalValue(operational?.drifts)} icon={Network} />}
            </section>

            <section className="dashboard-widget-grid" aria-label={t('dashboard.siteOperations')}>
              {visible('service-health') && <article className={`panel ipam-card health-panel ${widgetClass('service-health')}`} style={gridStyle('service-health')}>
                <div className="panel-heading"><div><span className="section-kicker">VISÃO GERAL</span><h2>Saúde dos serviços</h2></div></div>
                <div className="health-score"><div className="score-ring" style={{ background: operational ? `conic-gradient(#53ae79 0 ${operationalPercent}%, #ecf2ee ${operationalPercent}% 100%)` : '#ecf2ee' }} aria-label={operational ? `${operationalPercent}% dos serviços operacionais` : t('dashboard.servicesUnavailable')}><span>{operational ? operational.services.filter((item) => item.state === 'OPERATIONAL').length : '—'}<span>{operational ? `/${operational.services.length}` : ''}</span></span></div><div className="environment-health-summary"><strong>Estado do ambiente</strong><span className={`status-pill ${environmentStateTone}`} role="status" aria-label={`Estado do ambiente: ${environmentStateLabel}`}>{environmentStateLabel}</span><p>{environmentData ? new Date(environmentData.updatedAt).toLocaleString('pt-PT') : environmentError ? 'Não foi possível carregar o estado dos serviços.' : environmentPending ? 'A carregar estado dos serviços…' : 'Sem estado dos serviços disponível.'}</p></div></div>
                <div className="system-list dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.servicesList')}>{environmentData?.environment.services.map((service) => { const state = service.state.toUpperCase(); const tone = state === 'OPERATIONAL' ? 'green' : ['UNAVAILABLE', 'DOWN', 'OFFLINE', 'FAILED', 'ERROR'].includes(state) ? 'red' : 'orange'; return <div className="system-row" key={service.key}><span className="system-icon"><Activity size={16} /></span><span className="system-info"><strong>{service.label}</strong><small>{service.key}</small></span><span className={`status-pill ${tone}`}><i />{service.state}</span></div>; })}{environmentPending && <div className="no-data" role="status">A carregar estado dos serviços…</div>}{environmentError && <div className="no-data" role="status">Não foi possível carregar os serviços. Tenta atualizar.</div>}{!environmentPending && !environmentError && environmentData?.environment.services.length === 0 && <div className="no-data" role="status">Sem serviços para apresentar.</div>}</div>
              </article>}

              {visible('inventory-summary') && <article className={`panel ipam-card trend-panel ${widgetClass('inventory-summary')}`} style={gridStyle('inventory-summary')}>
                <div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO</span><h2>Distribuição atual</h2></div><span className="data-badge">dados reais</span></div>
                <div className="inventory-bars dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.inventoryList')}>{inventoryBars.length ? inventoryBars.map((item) => { const max = Math.max(...inventoryBars.map((bar) => bar.value), 1); return <div className="inventory-bar" key={item.label}><div><span>{item.label}</span><strong>{item.value.toLocaleString('pt-PT')}</strong></div><div className="bar-track"><i className={item.color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 4 : 0)}%` }} /></div></div>; }) : <div className="no-data" role="status">{summaryError ? t('dashboard.inventoryLoadError') : t('dashboard.inventoryLoading')}</div>}</div>
              </article>}
              {visible('recent-changes') && <article className={`panel ipam-card activity-panel ${widgetClass('recent-changes')}`} style={gridStyle('recent-changes')}><div className="panel-heading"><div><span className="section-kicker">REGISTO</span><h2>Atividade recente</h2></div>{canViewAudit && <button className="text-button" onClick={() => { window.location.href = '/auditoria'; }}>Ver auditoria <ArrowUpRight size={14} /></button>}</div><div className="activity-list dashboard-scroll" tabIndex={0} role="region" aria-label={t('dashboard.activityList')} aria-live="polite">{summaryPending ? <div className="no-data">A carregar atividade recente…</div> : summaryError ? <div className="no-data" role="status">Não foi possível carregar a atividade. Tenta atualizar o dashboard.</div> : recentAudit.length ? recentAudit.map((entry) => <div className="activity-row" key={entry.id}><span className="activity-icon dark"><ShieldCheck size={16} /></span><span><strong>{entry.username} · {entry.action}</strong><small>{entry.entityType ?? 'Operação'} · {new Date(entry.createdAt).toLocaleString('pt-PT')}</small></span><ArrowUpRight size={15} className="muted-icon" /></div>) : <div className="no-data">Ainda não existem ações registadas.</div>}</div></article>}
              {visible('quick-actions') && <article className={`panel ipam-card quick-panel ${widgetClass('quick-actions')}`} style={gridStyle('quick-actions')}><div className="panel-heading"><div><span className="section-kicker">ATALHOS</span><h2>Acesso rápido</h2></div></div><p className="dashboard-toolbar-hint">Aceda às próximas áreas de operação.</p><nav className="dashboard-quick-links dashboard-scroll" aria-label="Atalhos para outras áreas">{canConfigureAlerts && <Link className="dashboard-quick-link" href="/alertas"><Bell size={17} /><span>Regras de alertas</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>}<Link className="dashboard-quick-link" href="/qualidade-inventario"><ClipboardCheck size={17} /><span>Qualidade do inventário</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>{canNetworkChange && <Link className="dashboard-quick-link" href="/descoberta?action=new"><Sparkles size={17} /><span>Iniciar descoberta</span><ArrowUpRight size={15} className="dashboard-quick-link-arrow" /></Link>}</nav></article>}
              {visible('active-alerts') && <div className={`dashboard-operations-widget ${widgetClass('active-alerts')}`} style={gridStyle('active-alerts')}><OperationsPanel showAlerts showQuality={false} compact /></div>}
              {visible('quality-queue') && <div className={`dashboard-operations-widget ${widgetClass('quality-queue')}`} style={gridStyle('quality-queue')}><OperationsPanel showAlerts={false} showQuality compact /></div>}
            </section>

            <footer className="dashboard-footer"><span>COCiber Management Platform · Ambiente local</span><span className="footer-status"><i className={apiOnline === false ? 'offline' : ''} /> {apiOnline === false ? 'API indisponível' : apiOnline === true ? 'API ligada' : 'A verificar API'} · v0.1.0</span></footer>
          </div>
    </AppShell>
  );
}
