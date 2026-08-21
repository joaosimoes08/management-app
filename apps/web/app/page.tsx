'use client';

import { useEffect, useState } from 'react';
import {
  Activity,
  ArrowUpRight,
  Bell,
  BookOpen,
  Boxes,
  Database,
  ExternalLink,
  Gauge,
  Network,
  Search,
  Server,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  TerminalSquare,
} from 'lucide-react';
import { useAuth } from '../lib/auth';
import { AppShell, UserMenu } from '../components/app-shell';

const systems = [
  { name: 'PostgreSQL', detail: 'Base de dados principal', status: 'Operacional', tone: 'green', icon: Database },
  { name: 'Keycloak', detail: 'Autenticação · COCiber', status: 'Operacional', tone: 'green', icon: ShieldCheck },
  { name: 'Redis', detail: 'Filas e cache', status: 'Operacional', tone: 'green', icon: Activity },
  { name: 'API NestJS', detail: 'v1 · localhost:3001', status: 'Operacional', tone: 'green', icon: TerminalSquare },
];

type DashboardSummary = {
  counts: { sites: number; devices: number; vlans: number; subnets: number; ips: number; occupiedIps: number; freeIps: number; applications: number };
  recentAudit: { id: string; action: string; entityType?: string | null; username: string; createdAt: string }[];
};
type SearchResult = { id: string; title: string; detail: string; type: string; href: string };

const activity = [
  { title: 'João iniciou sessão', meta: 'há 4 min · ADMIN', icon: ShieldCheck, tone: 'dark' },
  { title: 'Sincronização de switch concluída', meta: 'há 18 min · SW-CORE-01', icon: Network, tone: 'blue' },
  { title: 'Nova subnet registada', meta: 'há 42 min · 10.20.40.0/24', icon: Boxes, tone: 'purple' },
];

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
  const [apiOnline, setApiOnline] = useState<boolean | null>(null);
  const { user, profile, apiFetch } = useAuth();
  const [summary, setSummary] = useState<DashboardSummary | null>(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [searchResults, setSearchResults] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const displayName = profile?.firstName || user?.username || 'Utilizador';

  useEffect(() => {
    const apiUrl = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';
    fetch(`${apiUrl}/api/v1/health`, { cache: 'no-store' })
      .then((response) => setApiOnline(response.ok))
      .catch(() => setApiOnline(false));
  }, []);

  useEffect(() => {
    void apiFetch<DashboardSummary>('/api/v1/dashboard/summary').then(setSummary).catch(() => setSummary(null));
  }, [apiFetch]);

  useEffect(() => {
    const query = searchQuery.trim();
    if (query.length < 2) { setSearchResults([]); setSearching(false); return undefined; }
    let active = true;
    const timer = window.setTimeout(() => {
      setSearching(true);
      void Promise.all([
        apiFetch<{ items: { id: string; name: string; code: string }[] }>('/api/v1/sites?pageSize=100'),
        apiFetch<{ items: { id: string; vlanId: number; name: string }[] }>('/api/v1/vlans?pageSize=100'),
        apiFetch<{ items: { id: string; cidr: string; purpose?: string | null }[] }>('/api/v1/subnets?pageSize=100'),
        apiFetch<{ items: { id: string; address: string; hostname?: string | null; subnetId: string }[] }>(`/api/v1/ip-addresses?search=${encodeURIComponent(query)}&pageSize=100`),
      ]).then(([sites, vlans, subnets, ips]) => {
        if (!active) return;
        const normalized = query.toLowerCase();
        const results: SearchResult[] = [
          ...sites.items.filter((item) => `${item.name} ${item.code}`.toLowerCase().includes(normalized)).map((item) => ({ id: item.id, title: item.name, detail: `Site · ${item.code}`, type: 'Site', href: `/ipam?siteId=${item.id}` })),
          ...vlans.items.filter((item) => `${item.vlanId} ${item.name}`.toLowerCase().includes(normalized)).map((item) => ({ id: item.id, title: `VLAN ${item.vlanId} · ${item.name}`, detail: 'VLAN', type: 'VLAN', href: `/ipam?vlanId=${item.id}` })),
          ...subnets.items.filter((item) => `${item.cidr} ${item.purpose ?? ''}`.toLowerCase().includes(normalized)).map((item) => ({ id: item.id, title: item.cidr, detail: `Subnet · ${item.purpose ?? 'sem finalidade'}`, type: 'Subnet', href: `/ipam?subnetId=${item.id}` })),
          ...ips.items.map((item) => ({ id: item.id, title: item.address, detail: `IP · ${item.hostname ?? 'hostname desconhecido'}`, type: 'IP', href: `/ipam?subnetId=${item.subnetId}&tab=ips` })),
        ].slice(0, 8);
        setSearchResults(results); setSearching(false);
      }).catch(() => { if (active) { setSearchResults([]); setSearching(false); } });
    }, 250);
    return () => { active = false; window.clearTimeout(timer); };
  }, [apiFetch, searchQuery]);

  const counts = summary?.counts;
  const recentAudit = summary?.recentAudit ?? [];
  const inventoryBars = counts ? [
    { label: 'Sites', value: counts.sites, color: 'black' },
    { label: 'Equipamentos', value: counts.devices, color: 'blue' },
    { label: 'VLANs', value: counts.vlans, color: 'purple' },
    { label: 'Subnets', value: counts.subnets, color: 'green' },
    { label: 'IPs', value: counts.ips, color: 'orange' },
  ] : [];

  return (
    <AppShell section="Dashboard" topbarContent={<>
              <div className="dashboard-search"><div className="search-field"><Search size={16} /><input aria-label="Pesquisar" placeholder="Pesquisar sites, VLANs, subnets ou IPs..." value={searchQuery} onChange={(event) => setSearchQuery(event.target.value)} /><kbd>⌘ K</kbd></div>{searchQuery.trim().length >= 2 && <div className="search-results">{searching ? <div className="search-empty">A pesquisar...</div> : searchResults.length ? searchResults.map((result) => <a href={result.href} key={`${result.type}-${result.id}`}><span className="search-result-icon"><Network size={14} /></span><span><strong>{result.title}</strong><small>{result.detail}</small></span><ArrowUpRight size={14} /></a>) : <div className="search-empty">Sem resultados para “{searchQuery}”.</div>}</div>}</div>
              <button className="icon-button" aria-label="Ver atividade" onClick={() => { window.location.href = '/auditoria'; }}><Bell size={18} /><i className="notification-dot" /></button>
              <UserMenu compact />
            </>}>
          <div className="dashboard-content">
            <section className="hero-row">
              <div><div className="eyebrow"><span className="live-dot" /> SISTEMA OPERACIONAL</div><h1>Bom dia, {displayName} <span>👋</span></h1><p>Aqui está o estado atual da sua infraestrutura.</p></div>
              <div className="hero-actions"><button className="secondary-button" onClick={() => { window.location.href = '/definicoes'; }}><SlidersHorizontal size={15} /> Definições</button><button className="primary-button" onClick={() => { window.location.href = '/descoberta?action=new'; }}><Sparkles size={15} /> Nova descoberta</button></div>
            </section>

            <section className="metric-grid" aria-label="Resumo da infraestrutura">
              <MetricCard label="Sites" value={counts ? String(counts.sites).padStart(2, '0') : '—'} icon={Boxes} />
              <MetricCard label="Equipamentos" value={counts ? String(counts.devices) : '—'} icon={Server} />
              <MetricCard label="IPs registados" value={counts ? counts.ips.toLocaleString('pt-PT') : '—'} icon={Network} />
              <MetricCard label="Aplicações" value={counts ? String(counts.applications).padStart(2, '0') : '—'} icon={Gauge} className="accent-card" />
            </section>

            <section className="content-grid">
              <article className="panel health-panel">
                <div className="panel-heading"><div><span className="section-kicker">VISÃO GERAL</span><h2>Saúde dos serviços</h2></div><button className="icon-button subtle" aria-label="Abrir detalhes"><ArrowUpRight size={17} /></button></div>
                <div className="health-score"><div className="score-ring"><span>99<span>.98</span>%</span></div><div><strong>Todos os sistemas operacionais</strong><p>Última verificação há 2 minutos</p></div></div>
                <div className="system-list">{systems.map(({ name, detail, status, tone, icon: Icon }) => <div className="system-row" key={name}><span className="system-icon"><Icon size={16} /></span><span className="system-info"><strong>{name}</strong><small>{detail}</small></span><span className={`status-pill ${tone}`}><i />{status}</span></div>)}</div>
              </article>

              <article className="panel trend-panel">
                <div className="panel-heading"><div><span className="section-kicker">INVENTÁRIO</span><h2>Distribuição atual</h2></div><span className="data-badge">dados reais</span></div>
                <div className="inventory-bars">{inventoryBars.length ? inventoryBars.map((item) => { const max = Math.max(...inventoryBars.map((bar) => bar.value), 1); return <div className="inventory-bar" key={item.label}><div><span>{item.label}</span><strong>{item.value.toLocaleString('pt-PT')}</strong></div><div className="bar-track"><i className={item.color} style={{ width: `${Math.max(item.value / max * 100, item.value ? 4 : 0)}%` }} /></div></div>; }) : <div className="no-data">A carregar dados do inventário...</div>}</div>
              </article>
            </section>

            <section className="bottom-grid">
              <article className="panel activity-panel"><div className="panel-heading"><div><span className="section-kicker">REGISTO</span><h2>Atividade recente</h2></div><button className="text-button" onClick={() => { window.location.href = '/auditoria'; }}>Ver auditoria <ArrowUpRight size={14} /></button></div><div className="activity-list">{recentAudit.length ? recentAudit.map((entry) => <div className="activity-row" key={entry.id}><span className="activity-icon dark"><ShieldCheck size={16} /></span><span><strong>{entry.username} · {entry.action}</strong><small>{entry.entityType ?? 'Operação'} · {new Date(entry.createdAt).toLocaleString('pt-PT')}</small></span><ArrowUpRight size={15} className="muted-icon" /></div>) : <div className="no-data">Ainda não existem ações registadas.</div>}</div></article>
              <article className="panel quick-panel"><div className="panel-heading"><div><span className="section-kicker">ATALHOS</span><h2>Acesso rápido</h2></div></div><div className="quick-grid"><a href="/infraestrutura?action=new"><Server size={18} /><span>Adicionar equipamento</span><ExternalLink size={14} /></a><a href="/ipam"><Network size={18} /><span>Explorar IPAM</span><ExternalLink size={14} /></a><a href="/descoberta?action=new"><Search size={18} /><span>Nova descoberta</span><ExternalLink size={14} /></a><a href="/ajuda"><BookOpen size={18} /><span>Abrir documentação</span><ExternalLink size={14} /></a></div></article>
            </section>

            <footer className="dashboard-footer"><span>COCiber Management Platform · Ambiente local</span><span className="footer-status"><i className={apiOnline === false ? 'offline' : ''} /> {apiOnline === false ? 'API indisponível' : apiOnline === true ? 'API ligada' : 'A verificar API'} · v0.1.0</span></footer>
          </div>
    </AppShell>
  );
}
