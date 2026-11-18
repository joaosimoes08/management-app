'use client';

import { CircleHelp, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import { usePathname, useRouter } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { navigation, settingsNavigation, helpNavigation } from './navigation';
import { UserMenu } from './user-menu';

export interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
}

/** Application sidebar: role-filtered global navigation and profile utilities. */
export function AppSidebar({ collapsed, onToggle, onClose }: AppSidebarProps) {
  const pathname = usePathname();
  const router = useRouter();
  const { t } = useI18n();
  const { hasRole } = useAuth();
  const prefersReducedMotion = useReducedMotion();
  const [expandedWidth, setExpandedWidth] = useState(248);
  const [focusWithin, setFocusWithin] = useState(false);
  const keyboardNavigation = useRef(false);

  useEffect(() => {
    const updateWidth = () => setExpandedWidth(window.innerWidth <= 780 ? 245 : window.innerWidth <= 1100 ? 205 : 248);
    updateWidth();
    window.addEventListener('resize', updateWidth);
    return () => window.removeEventListener('resize', updateWidth);
  }, []);

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => { if (event.key === 'Tab') keyboardNavigation.current = true; };
    const onPointerDown = () => { keyboardNavigation.current = false; setFocusWithin(false); };
    window.addEventListener('keydown', onKeyDown, true);
    window.addEventListener('pointerdown', onPointerDown, true);
    return () => {
      window.removeEventListener('keydown', onKeyDown, true);
      window.removeEventListener('pointerdown', onPointerDown, true);
    };
  }, []);

  const canUseIpam = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('AUDITOR') || hasRole('READ_ONLY');
  const visibleNavigation = navigation.filter((item) => (!item.audit || hasRole('ADMIN') || hasRole('AUDITOR')) && (!item.ipam || canUseIpam) && (!item.discovery || hasRole('ADMIN') || hasRole('NETWORK_OPERATOR')) && (!item.snmp || canUseIpam) && (!item.netapp || ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'].some(hasRole)) && (!item.changes || ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'].some(hasRole)) && (!item.criticalAssets || ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR'].some(hasRole)));
  const sidebarTransition = prefersReducedMotion ? { duration: 0 } : { duration: 0.18, ease: [0.22, 0.61, 0.36, 1] as const };

  return (
    <m.aside
      className={`sidebar app-sidebar ${collapsed ? 'sidebar-collapsed' : ''} ${focusWithin ? 'keyboard-focus-expanded' : ''}`}
      aria-label="Menu principal"
      initial={false}
      animate={{ width: collapsed && !focusWithin ? 70 : expandedWidth }}
      whileHover={collapsed ? { width: expandedWidth } : undefined}
      transition={sidebarTransition}
      onFocusCapture={() => { if (keyboardNavigation.current) setFocusWithin(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false); }}
    >
      <nav className="primary-nav" aria-label="Navegação principal">
        {visibleNavigation.map(({ label, key, href, icon: Icon }) => {
          const translated = t(key, label);
          return (
            <button key={href} className={`nav-item ${pathname === href || (href !== '/' && pathname.startsWith(`${href}/`)) ? 'active' : ''}`} onClick={() => { router.push(href); onClose?.(); }} title={collapsed ? translated : undefined}>
              <Icon size={17} strokeWidth={1.8} /><span className="nav-item-label">{translated}</span>
            </button>
          );
        })}
        {(hasRole('ADMIN') || hasRole('AUDITOR')) && (
          <button className="nav-item sidebar-settings-link" onClick={() => router.push(settingsNavigation.href)}>
            <Settings size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(settingsNavigation.key)}</span>
          </button>
        )}
        <button className="nav-item sidebar-help-link" onClick={() => router.push(helpNavigation.href)}>
          <CircleHelp size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(helpNavigation.key)}</span>
        </button>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom-row">
        <div className="sidebar-account-controls"><div className="sidebar-profile-control"><UserMenu /></div></div>
        <button className="sidebar-collapse-toggle icon-button subtle" onClick={onToggle} title={collapsed ? 'Fixar menu aberto' : 'Recolher menu'} aria-label={collapsed ? 'Fixar menu aberto' : 'Recolher menu'}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      <button className="mobile-close icon-button" onClick={() => onClose?.()} aria-label="Fechar menu"><X size={17} /></button>
    </m.aside>
  );
}
