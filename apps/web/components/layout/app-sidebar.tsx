'use client';

import { CircleHelp, PanelLeftClose, PanelLeftOpen, Settings, X } from 'lucide-react';
import Link from 'next/link';
import { usePathname } from 'next/navigation';
import { useEffect, useRef, useState } from 'react';
import { useReducedMotion } from 'motion/react';
import * as m from 'motion/react-m';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { navigation, settingsNavigation, helpNavigation } from './navigation';
import { UserMenu } from './user-menu';
import { useUiText } from '@/components/ui/use-ui-text';

/** Same rule the main items used for the `active` class: exact match, or a sub-route of a non-root entry. */
function isActivePath(pathname: string, href: string) {
  return pathname === href || (href !== '/' && pathname.startsWith(`${href}/`));
}

export interface AppSidebarProps {
  collapsed: boolean;
  onToggle: () => void;
  onClose?: () => void;
}

/** Application sidebar: role-filtered global navigation and profile utilities. */
export function AppSidebar({ collapsed, onToggle, onClose }: AppSidebarProps) {
  const ui = useUiText();
  const pathname = usePathname();
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
      aria-label={ui('ui.mainMenu')}
      initial={false}
      animate={{ width: collapsed && !focusWithin ? 70 : expandedWidth }}
      whileHover={collapsed ? { width: expandedWidth } : undefined}
      transition={sidebarTransition}
      onFocusCapture={() => { if (keyboardNavigation.current) setFocusWithin(true); }}
      onBlurCapture={(event) => { if (!event.currentTarget.contains(event.relatedTarget as Node | null)) setFocusWithin(false); }}
    >
      <nav className="primary-nav" aria-label={ui('ui.mainNavigation')}>
        {visibleNavigation.map(({ label, key, href, icon: Icon }) => {
          const translated = t(key, label);
          const active = isActivePath(pathname, href);
          return (
            <Link key={href} href={href} className={`nav-item ${active ? 'active' : ''}`} aria-current={active ? 'page' : undefined} onClick={() => onClose?.()} title={collapsed ? translated : undefined}>
              <Icon size={17} strokeWidth={1.8} /><span className="nav-item-label">{translated}</span>
            </Link>
          );
        })}
        {(hasRole('ADMIN') || hasRole('AUDITOR')) && (
          <Link href={settingsNavigation.href} className="nav-item sidebar-settings-link" aria-current={isActivePath(pathname, settingsNavigation.href) ? 'page' : undefined}>
            <Settings size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(settingsNavigation.key)}</span>
          </Link>
        )}
        <Link href={helpNavigation.href} className="nav-item sidebar-help-link" aria-current={isActivePath(pathname, helpNavigation.href) ? 'page' : undefined}>
          <CircleHelp size={17} strokeWidth={1.8} /><span className="nav-item-label">{t(helpNavigation.key)}</span>
        </Link>
      </nav>
      <div className="sidebar-spacer" />
      <div className="sidebar-bottom-row">
        <div className="sidebar-account-controls"><div className="sidebar-profile-control"><UserMenu /></div></div>
        <button className="sidebar-collapse-toggle icon-button subtle" onClick={onToggle} title={collapsed ? 'Fixar menu aberto' : 'Recolher menu'} aria-label={collapsed ? 'Fixar menu aberto' : 'Recolher menu'}>
          {collapsed ? <PanelLeftOpen size={15} /> : <PanelLeftClose size={15} />}
        </button>
      </div>
      <small className="sidebar-copyright" title={t('shell.copyright')}><span className="sidebar-copyright-full">{t('shell.copyright')}</span><span className="sidebar-copyright-short" aria-hidden="true">{t('shell.copyrightShort')}</span></small>
      <button className="mobile-close icon-button" onClick={() => onClose?.()} aria-label={ui('ui.closeMenu')}><X size={17} /></button>
    </m.aside>
  );
}
