'use client';

import { isValidElement, type ReactElement, type ReactNode } from 'react';
import { Menu, Search } from 'lucide-react';
import { SiteSwitcher } from './site-switcher';
import { NotificationsMenu } from './notifications-menu';
import { ResponsiveTabNavigation } from './responsive-overflow';
import { useUiText } from '@/components/ui/use-ui-text';

export interface AppHeaderProps {
  moduleTabs?: ReactNode;
  onOpenSidebar: () => void;
  onOpenGlobalSearch: () => void;
}

/** Shared shell header: brand, active-module tabs and global tools. */
export function AppHeader({ moduleTabs, onOpenSidebar, onOpenGlobalSearch }: AppHeaderProps) {
  const ui = useUiText();

  return <header className="topbar global-topbar">
    <button className="mobile-menu icon-button" onClick={onOpenSidebar} aria-label={ui('ui.openMenu')}><Menu size={19} /></button>
    <div className="global-site-switcher"><SiteSwitcher /></div>
    <div className="module-tabs-slot" aria-label={ui('topbar.moduleSections')}>{isValidElement(moduleTabs) && moduleTabs.type === 'nav' ? <ResponsiveTabNavigation navigation={moduleTabs as ReactElement<{ children?: ReactNode; className?: string }>} /> : moduleTabs}</div>
    <div className="topbar-globals">
      <button className="topbar-search-trigger" onClick={onOpenGlobalSearch} aria-label={ui('ui.searchApp')}><Search size={15} /><span>{ui('topbar.search')}</span><kbd>⌘ K</kbd></button>
      <NotificationsMenu />
    </div>
  </header>;
}
