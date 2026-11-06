'use client';

import { useEffect, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import {
  Activity,
  ArrowUpRight,
  BookOpen,
  ExternalLink,
  Network,
  RefreshCw,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
} from 'lucide-react';
import Link from 'next/link';
import { useAuth } from '@/lib/auth';
import { AppShell } from '@/components/layout/app-shell';
import { getDashboardSummary } from './api';
import { getDashboardLayout, getDashboardWorkspaces, getOperationalSummary, saveDashboardLayout, saveDashboardPreference, type DashboardLayout, type DashboardWorkspace } from './api';
import { OperationsPanel } from '@/features/operations/operations-panel';
import { useSiteContext } from '@/lib/site-context';
import { useI18n } from '@/lib/i18n';

function MetricCard({ label, value, change, icon: Icon, className = '' }: { label: string; value: string; change?: string; icon: typeof Activity; className?: string }) {
  return (
    <article className={`metric-card ${className}`}>
      <div className="metric-head">
        <span>{label}</span>
        <span className="icon-button subtle"><Icon size={16} strokeWidth={1.8} /></span>
      </div>
      <div className="metric-value">{value}</div>
      <div className="metric-foot">{change ? <span className="positive">↗ {change}</span> : <span>Dados atuais</span>}<span>{change ? 'vs. último período' : 'inventário manual'}</span></div>
      <div className="micro-bars" aria-hidden="true">
        {[24, 34, 28, 43, 36, 51, 46, 63, 55, 70, 61, 78].map((height, index) => <i key={index} style={{ height: `${height}%` }} />)}
      </div>
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
  const { data: operational, refetch: refetchOperational } = useQuery({ queryKey: ['dashboard', 'operational', workspace?.siteId, workspace?.role], queryFn: () => getOperationalSummary(workspace!.siteId, workspace!.role), enabled: Boolean(workspace) });
  const { data: healthResponse } = useQuery({
    queryKey: ['dashboard', 'health'],
    queryFn: async () => {
      const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
      const response = await fetch(`${apiUrl}/api/v1/health`, { cache: 'no-store' });
      return response.ok;
    },
    staleTime: 30_000,
  });
  const apiOnline: boolean | null = typeof healthResponse === 'boolean' ? healthResponse : null;
  const displayName = profile?.firstName || user?.username || 'Utilizador';
  const canNetworkChange = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');
  const canViewAudit = hasRole('ADMIN') || hasRole('AUDITOR');

  const refreshDashboard = () => { void refetchSummary(); void refetchOperational(); };
  const visible = (id: string) => layout?.widgets.some((widget) => widget.id === id && widget.visible) ?? true;
  const gridStyle = (id: string) => {
    const widget = layout?.widgets.find((item) => item.id === id);
    if (!widget) return undefined;
    const order: Record<string, number> = { 'inventory-summary': 1, 'recent-changes': 2, 'active-alerts': 3, 'quality-queue': 4, 'service-health': 5, 'running-processes': 6, 'discovery-review': 7, 'snmp-drifts': 8, 'quick-actions': 9 };
    return { gridColumn: `span ${widget.w >= 9 ? 2 : 1}`, order: order[id] ?? 10, minWidth: 0 };
  };
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

  return (
    <AppShell section="Dashboard" globalSearch actions={<button className="topbar-action secondary-button" onClick={refreshDashboard}><RefreshCw size={14} /> Atualizar</button>}>
          <div className="dashboard-content">
            <section className="infra-context-bar"><label>Workspace<select value={workspaceId} onChange={(event) => setWorkspaceId(event.target.value)}>{workspaces.map((item) => <option value={item.id} key={item.id}>{item.siteName}{item.siteCode ? ` · ${item.siteCode}` : ''} · {item.role}</option>)}</select></label>{canEditLayout && <button className="secondary-button" onClick={() => setEditingLayout((value) => !value)}>{editingLayout ? t('dashboard.finishEditing') : t('dashboard.editLayout')}</button>}</section>
            {editingLayout && canEditLayout && layout && <section className="ipam-card dashboard-layout-editor"><div className="panel-heading"><div><span className="section-kicker">PERSONALIZAÇÃO</span><h2>Widgets do dashboard</h2><p className="panel-description">Escolhe o que aparece e quais cartões ocupam a largura completa.</p></div></div><div className="dashboard-layout-options">{layout.widgets.map((widget) => <div className="dashboard-layout-option" key={widget.id}><label><input type="checkbox" checked={widget.visible} onChange={(event) => setLayout((current) => current ? ({ ...current, widgets: current.widgets.map((item) => item.id === widget.id ? { ...item, visible: event.target.checked } : item) }) : current)} /> <strong>{widget.id}</strong></label><label>Largura<select value={widget.w >= 9 ? '12' : '6'} onChange={(event) => { const width = Number(event.target.value); updateWidget(widget.id, 'w', width); updateWidget(widget.id, 'x', 0); }}><option value="6">Metade</option><option value="12">Completa</option></select></label></div>)}</div><button className="primary-button" onClick={() => void saveDashboardLayout(layout).then((saved) => { setLayout(saved); setEditingLayout(false); })}>Guardar layout</button></section>}
            <section className="hero-row">
              <div><div className="eyebrow"><span className="live-dot" /> SISTEMA OPERACIONAL</div><h1>Bom dia, {displayName} <span>👋</span></h1><p>Aqui está o estado atual da sua infraestrutura.</p></div>
              <div className="hero-actions"><button className="secondary-button" onClick={() => { window.location.href = '/definicoes'; }}><SlidersHorizontal size={15} /> Definições</button>{canNetworkChange && <button className="primary-button" onClick={() => { window.location.href = '/descoberta?action=new'; }}><Sparkles size={15} /> Nova descoberta</button>}</div>
            </section>

            <section className="dashboard-widget-grid" aria-label={t('dashboard.siteOperations')}>
              {visible('service-health') && <article className="panel health-panel" style={gridStyle('service-health')}>
                <div className="panel-heading"><div><span className="section-kicker">VISÃO GERAL</span><h2>Saúde dos serviços</h2></div></div>
                <div className="health-score"><div className="score-ring"><span>{operational?.services.filter((item) => item.state === 'OPERATIONAL').length ?? 0}<span>/{operational?.services.length ?? 0}</span></span></div><div><strong>Estado real dos serviços</strong><p>{operational ? new Date(operational.updatedAt).toLocaleString('pt-PT') : 'A carregar…'}</p></div></div>
                <div className="system-list">{operational?.services.map((service) => <div className="system-row" key={service.key}><span className="system-icon"><Activity size={16} /></span><span className="system-info"><strong>{service.label}</strong><small>{service.key}</small></span><span className={`status-pill ${service.state === 'OPERATIONAL' ? 'green' : 'orange'}`}><i />{service.state}</span></div>)}</div>
              </article>}

              {visible('inventory-summary') && <article className="panel trend-panel" style={gridStyle('inventory-summary')}>
                <div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO</span><h2>Distribuição atual</h2></div><span className="data-badge">dados reais</span></div>
                <div className="inventory-bars">{inventoryBars.length ? inventoryBars.map((item) => { const max = Math.max(...inventoryBars.map((bar) => bar.value), 1); return <div className="inventory-bar" key={item.label}><div><span>{item.label}</span><strong>{item.value.toLocaleString('pt-PT')}</strong></div><div className="bar-track"><i className={item.color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 4 : 0)}%` }} /></div></div>; }) : <div className="no-data">A carregar dados do inventário...</div>}</div>
              </article>}
              {visible('recent-changes') && <article className="panel activity-panel" style={gridStyle('recent-changes')}><div className="panel-heading"><div><span className="section-kicker">REGISTO</span><h2>Atividade recente</h2></div>{canViewAudit && <button className="text-button" onClick={() => { window.location.href = '/auditoria'; }}>Ver auditoria <ArrowUpRight size={14} /></button>}</div><div className="activity-list" aria-live="polite">{summaryPending ? <div className="no-data">A carregar atividade recente…</div> : summaryError ? <div className="no-data" role="status">Não foi possível carregar a atividade. Tenta atualizar o dashboard.</div> : recentAudit.length ? recentAudit.map((entry) => <div className="activity-row" key={entry.id}><span className="activity-icon dark"><ShieldCheck size={16} /></span><span><strong>{entry.username} · {entry.action}</strong><small>{entry.entityType ?? 'Operação'} · {new Date(entry.createdAt).toLocaleString('pt-PT')}</small></span><ArrowUpRight size={15} className="muted-icon" /></div>) : <div className="no-data">Ainda não existem ações registadas.</div>}</div></article>}
              {visible('quick-actions') && <article className="panel quick-panel" style={gridStyle('quick-actions')}><div className="panel-heading"><div><span className="section-kicker">ATALHOS</span><h2>Acesso rápido</h2></div></div><div className="quick-grid">{canNetworkChange && <a href="/infraestrutura?action=new"><Server size={18} /><span>Adicionar equipamento</span><ExternalLink size={14} /></a>}<a href="/ipam"><Network size={18} /><span>Explorar IPAM</span><ExternalLink size={14} /></a>{canNetworkChange && <a href="/descoberta?action=new"><Search size={18} /><span>Nova descoberta</span><ExternalLink size={14} /></a>}<Link href="/ajuda"><BookOpen size={18} /><span>Abrir documentação</span><ExternalLink size={14} /></Link></div></article>}
              {visible('running-processes') && <div style={gridStyle('running-processes')}><MetricCard label={t('dashboard.runningProcesses')} value={operational ? String(operational.processes.length) : '—'} icon={Activity} /></div>}
              {visible('discovery-review') && <div style={gridStyle('discovery-review')}><MetricCard label={t('dashboard.discoveryReview')} value={operational ? String(operational.discovery) : '—'} icon={Search} /></div>}
              {visible('snmp-drifts') && <div style={gridStyle('snmp-drifts')}><MetricCard label={t('dashboard.snmpDrifts')} value={operational ? String(operational.drifts) : '—'} icon={Network} /></div>}
              {visible('active-alerts') && <div style={gridStyle('active-alerts')}><OperationsPanel showAlerts showQuality={false} /></div>}
              {visible('quality-queue') && <div style={gridStyle('quality-queue')}><OperationsPanel showAlerts={false} showQuality /></div>}
            </section>

            <footer className="dashboard-footer"><span>COCiber Management Platform · Ambiente local</span><span className="footer-status"><i className={apiOnline === false ? 'offline' : ''} /> {apiOnline === false ? 'API indisponível' : apiOnline === true ? 'API ligada' : 'A verificar API'} · v0.1.0</span></footer>
          </div>
    </AppShell>
  );
}
