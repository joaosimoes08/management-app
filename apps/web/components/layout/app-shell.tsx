'use client';

import { useEffect, useState, type ReactNode } from 'react';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { GlobalSearchPalette } from './global-search';
import { UserMenu } from './user-menu';

export type TopbarSearchConfig = { value: string; onChange: (value: string) => void; placeholder: string; ariaLabel?: string };
export type AppShellProps = { children: ReactNode; section: string; context?: string[]; search?: TopbarSearchConfig; globalSearch?: boolean; actions?: ReactNode };

/** Application chrome: sidebar + topbar + global search palette around page content. */
export function AppShell({ children, section, context, search, globalSearch = false, actions }: AppShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);

  useEffect(() => {
    setCollapsed(window.localStorage.getItem('cociber.sidebar.collapsed') === 'true');
  }, []);

  useEffect(() => {
    const close = (event: KeyboardEvent) => {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setGlobalSearchOpen(true);
        return;
      }
      if (event.key === 'Escape') {
        setSidebarOpen(false);
        setGlobalSearchOpen(false);
      }
    };
    window.addEventListener('keydown', close);
    return () => window.removeEventListener('keydown', close);
  }, []);

  const toggleCollapsed = () => setCollapsed((value) => {
    const next = !value;
    window.localStorage.setItem('cociber.sidebar.collapsed', String(next));
    return next;
  });

  return <main className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}><div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} /><section className="content-area"><AppHeader section={section} context={context} search={search} globalSearch={globalSearch} actions={actions} onOpenSidebar={() => setSidebarOpen((value) => !value)} onOpenGlobalSearch={() => setGlobalSearchOpen(true)} /><div className="app-shell-content">{children}</div></section><GlobalSearchPalette open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} /></div></main>;
}

export { UserMenu };
