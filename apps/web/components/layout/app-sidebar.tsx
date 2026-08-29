'use client';

import { ArrowUpRight, CircleHelp, PanelLeftClose, PanelLeftOpen, Settings, ShieldCheck, Sparkles, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useState } from 'react';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api/client';
import { useI18n } from '@/lib/i18n';
import { navigation, settingsNavigation, helpNavigation } from './navigation';
import { SiteSwitcher } from './site-switcher';
import { UserMenu } from './user-menu';

export interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
}

/** Application sidebar: brand, site switcher, role-filtered navigation and user menu. */
export function AppSidebar({ collapsed, onToggle, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const [brandName, setBrandName] = useState('COCiber');

  useEffect(() => {
    void apiFetch<{ settings?: { organizationCode?: string | null; organizationName?: string | null } }>('/api/v1/settings/organization')
      .then((result) => {
        const settings = result.settings;
        setBrandName(settings?.organizationCode?.trim() || settings?.organizationName?.trim() || 'COCiber');
      })
      .catch(() => undefined);
  }, []);

  const canUseIpam = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('AUDITOR') || hasRole('READ_ONLY');

  return <aside className={`sidebar app-sidebar ${collapsed ? 'sidebar-collapsed' : ''}`} aria-label="Menu principal"><div className="brand-block"><div className="brand-mark"><ShieldCheck size={20} /></div><div><strong>{brandName}</strong><span>Infrastructure center</span></div></div><button className="sidebar-collapse-toggle icon-button subtle" onClick={onToggle} title={collapsed ? 'Fixar menu aberto' : 'Recolher menu'} aria-label={collapsed ? 'Fixar menu aberto' : 'Recolher menu'}>{collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}</button><SiteSwitcher /><nav className="primary-nav" aria-label="Navegação principal">{navigation.filter((item) => (!item.audit || hasRole('ADMIN') || hasRole('AUDITOR')) && (!item.ipam || canUseIpam) && (!item.discovery || hasRole('ADMIN') || hasRole('NETWORK_OPERATOR'))).map(({ label, key, href, icon: Icon }) => { const translated = t(key, label); return <button key={href} className={`nav-item ${pathname === href || (href !== '/' && pathname.startsWith(`${href}/`)) ? 'active' : ''}`} onClick={() => { router.push(href); onClose?.(); }} title={collapsed ? translated : undefined}><Icon size={17} strokeWidth={1.8} /><span className="nav-item-label">{translated}</span>{label === 'Descoberta' && <span className="nav-badge">3</span>}</button>; })}</nav><div className="sidebar-spacer" />{canUseIpam && <button className="sidebar-note sidebar-note-button" onClick={() => router.push('/ipam')}><Sparkles size={17} /><span><strong>{t('shell.nextSteps')}</strong><small>{t('shell.continueIpam')}</small></span><ArrowUpRight size={15} /></button>}{(hasRole('ADMIN') || hasRole('AUDITOR')) && <button className="nav-item" onClick={() => router.push(settingsNavigation.href)}><Settings size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(settingsNavigation.key)}</span></button>}<button className="nav-item" onClick={() => router.push(helpNavigation.href)}><CircleHelp size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(helpNavigation.key)}</span></button><UserMenu /><button className="mobile-close icon-button" onClick={() => onClose?.()} aria-label="Fechar menu"><X size={17} /></button></aside>;
}
