'use client';

import { useEffect, useState } from 'react';
import { ArrowUpRight, Boxes, ChevronDown, CircleHelp, ExternalLink, LayoutDashboard, Menu, Network, PanelLeftClose, PanelLeftOpen, Search, Settings, ShieldCheck, Sparkles, Table2, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from '../lib/auth';

const navigation = [
  { label: 'Dashboard', href: '/', icon: LayoutDashboard },
  { label: 'Infraestrutura', href: '/infraestrutura', icon: Boxes },
  { label: 'Portal interno', href: '/portal', icon: ExternalLink },
  { label: 'IPAM', href: '/ipam', icon: Network },
  { label: 'Descoberta', href: '/descoberta', icon: Search },
  { label: 'Auditoria', href: '/auditoria', icon: Table2, audit: true },
];

export function UserMenu({ compact = false }: { compact?: boolean }) {
  const { user, profile, logout } = useAuth();
  const router = useRouter();
  const [open, setOpen] = useState(false);
  const displayName = profile?.firstName || user?.username || 'Utilizador';
  const roleLabel = user?.roles.includes('ADMIN') ? 'Administrador' : user?.roles[0] ?? 'Utilizador';
  return <div className={`user-menu ${compact ? 'compact' : ''}`}>
    <button className={compact ? 'top-user profile-button' : 'profile-mini profile-button'} onClick={() => setOpen((value) => !value)} aria-expanded={open} aria-haspopup="menu">
      <div className="profile-avatar">{displayName.charAt(0).toUpperCase()}</div><div className="user-menu-label"><strong>{displayName}</strong><span>{roleLabel}</span></div><ChevronDown size={compact ? 14 : 15} />
    </button>
    {open && <div className="user-dropdown" role="menu"><div className="user-dropdown-head"><strong>{displayName}</strong><small>{user?.username}</small></div><button onClick={() => { setOpen(false); router.push('/definicoes'); }}>Definições da conta</button><button onClick={() => { setOpen(false); router.push('/ajuda'); }}>Ajuda</button><button className="danger" onClick={() => void logout()}>Terminar sessão</button></div>}
  </div>;
}

export function AppSidebar({ collapsed, onToggle, onClose }: { collapsed: boolean; onToggle: () => void; onClose?: () => void }) {
  const pathname = usePathname(); const router = useRouter(); const { hasRole, apiFetch } = useAuth(); const [sites, setSites] = useState<{ id: string; name: string; code: string }[]>([]); const [siteId, setSiteId] = useState(''); const [brandName, setBrandName] = useState('COCiber');
  useEffect(() => { void apiFetch<{ items: { id: string; name: string; code: string }[] }>('/api/v1/sites?pageSize=100').then((result) => { setSites(result.items); const querySite = new URLSearchParams(window.location.search).get('siteId'); const stored = window.localStorage.getItem('cociber.siteId'); const next = querySite && result.items.some((site) => site.id === querySite) ? querySite : stored && result.items.some((site) => site.id === stored) ? stored : result.items.length === 1 ? result.items[0].id : ''; setSiteId(next); }).catch(() => undefined); }, [apiFetch]);
  useEffect(() => { void apiFetch<{ settings?: { organizationCode?: string | null; organizationName?: string | null } }>('/api/v1/settings/organization').then((result) => { const settings = result.settings; setBrandName(settings?.organizationCode?.trim() || settings?.organizationName?.trim() || 'COCiber'); }).catch(() => undefined); }, [apiFetch]);
  const selectSite = (next: string) => { setSiteId(next); window.localStorage.setItem('cociber.siteId', next); const query = new URLSearchParams(window.location.search); if (next) query.set('siteId', next); else query.delete('siteId'); router.push(`${pathname}${query.toString() ? `?${query}` : ''}`); };
  const selectedSite = sites.find((site) => site.id === siteId);
  return <aside className={`sidebar app-sidebar ${collapsed ? 'sidebar-collapsed' : ''}`} aria-label="Menu principal">
    <div className="brand-block"><div className="brand-mark"><ShieldCheck size={20} /></div><div><strong>{brandName}</strong><span>Infrastructure center</span></div></div>
    <button className="sidebar-collapse-toggle icon-button subtle" onClick={onToggle} title={collapsed ? 'Fixar menu aberto' : 'Recolher menu'} aria-label={collapsed ? 'Fixar menu aberto' : 'Recolher menu'}>{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button>
    <label className="workspace-switcher"><div className="workspace-avatar">C</div><div><span>Site ativo</span><strong>{selectedSite?.name ?? 'Todos os Sites'}</strong><select aria-label="Selecionar Site" value={siteId} onChange={(event) => selectSite(event.target.value)}><option value="">Todos os Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}</select></div><ChevronDown size={15} /></label>
    <nav className="primary-nav" aria-label="Navegação principal">{navigation.filter((item) => !item.audit || hasRole('ADMIN') || hasRole('AUDITOR')).map(({ label, href, icon: Icon }) => <button key={href} className={`nav-item ${pathname === href || (href !== '/' && pathname.startsWith(`${href}/`)) ? 'active' : ''}`} onClick={() => { router.push(href); onClose?.(); }} title={collapsed ? label : undefined}><Icon size={17} strokeWidth={1.8} /><span className="nav-item-label">{label}</span>{label === 'Descoberta' && <span className="nav-badge">3</span>}</button>)}</nav>
    <div className="sidebar-spacer" /><button className="sidebar-note sidebar-note-button" onClick={() => router.push('/ipam')}><Sparkles size={17} /><span><strong>Próximos passos</strong><small>{selectedSite ? `A trabalhar em ${selectedSite.name}` : 'Continue a configurar o inventário IPAM.'}</small></span><ArrowUpRight size={15} /></button><button className="nav-item" onClick={() => router.push('/definicoes')}><Settings size={17} strokeWidth={1.8} /><span className="nav-item-label">Definições</span></button><button className="nav-item" onClick={() => router.push('/ajuda')}><CircleHelp size={17} strokeWidth={1.8} /><span className="nav-item-label">Ajuda e suporte</span></button><UserMenu />
    <button className="mobile-close icon-button" onClick={() => onClose?.()} aria-label="Fechar menu"><X size={17} /></button>
  </aside>;
}

export function AppShell({ children, section, topbarContent }: { children: React.ReactNode; section?: string; topbarContent?: React.ReactNode }) {
  const pathname = usePathname(); const [sidebarOpen, setSidebarOpen] = useState(false); const [collapsed, setCollapsed] = useState(false); const [activeSite, setActiveSite] = useState<string | null>(null);
  useEffect(() => { setCollapsed(window.localStorage.getItem('cociber.sidebar.collapsed') === 'true'); }, []);
  useEffect(() => { setActiveSite(window.localStorage.getItem('cociber.siteId')); }, []);
  useEffect(() => { const close = (event: KeyboardEvent) => { if (event.key === 'Escape') setSidebarOpen(false); }; window.addEventListener('keydown', close); return () => window.removeEventListener('keydown', close); }, []);
  const toggleCollapsed = () => setCollapsed((value) => { const next = !value; window.localStorage.setItem('cociber.sidebar.collapsed', String(next)); return next; });
  const title = section ?? navigation.find((item) => item.href === pathname)?.label ?? 'Operações';
  return <main className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} /><section className="content-area"><header className="topbar"><button className="mobile-menu icon-button" onClick={() => setSidebarOpen((value) => !value)} aria-label="Abrir menu"><Menu size={19} /></button><div className="breadcrumbs"><span>Operações</span><b>/</b><strong>{title}</strong>{activeSite && <><b>/</b><span className="topbar-context">Site selecionado</span></>}</div><div className="top-actions">{topbarContent ?? <span className="topbar-status"><i /> Ambiente operacional</span>}</div></header><div className="app-shell-content">{children}</div></section></div></main>;
}
