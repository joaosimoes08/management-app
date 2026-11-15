'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { MoreHorizontal } from 'lucide-react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import * as m from 'motion/react-m';
import { usePathname } from 'next/navigation';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { GlobalSearchPalette, type LocalSearchContext, type RackSearchContext } from './global-search';
import { UserMenu } from './user-menu';
import { ResponsiveToolbarActions } from './responsive-overflow';

export type TopbarSearchConfig = LocalSearchContext;
export type AppShellProps = { children: ReactNode; section: string; context?: string[]; search?: TopbarSearchConfig; rackSearch?: RackSearchContext; globalSearch?: boolean; moduleTabs?: ReactNode; toolbar?: ReactNode; toolbarKey?: string; actions?: ReactNode };
const PageToolbarContext = createContext<HTMLElement | null>(null);

export function PageToolbarPortal({ children }: { children: ReactNode }) {
  const target = useContext(PageToolbarContext);
  return target ? createPortal(<div className="context-toolbar-contribution">{children}</div>, target) : <div className="context-toolbar-contribution">{children}</div>;
}

export function ToolbarMore({ children, label = 'Mais ações' }: { children: ReactNode; label?: string }) {
  return <details className="context-toolbar-more"><summary><MoreHorizontal size={16} /><span>{label}</span></summary><div className="context-toolbar-more-menu">{children}</div></details>;
}

/** Application chrome: sidebar + topbar + global search palette around page content. */
export function AppShell({ children, section, context, search, rackSearch, moduleTabs, toolbar, toolbarKey, actions }: AppShellProps) {
  const pathname = usePathname();
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [toolbarActionsElement, setToolbarActionsElement] = useState<HTMLDivElement | null>(null);

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

  const transitionKey = `${pathname}:${toolbarKey ?? ''}`;
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><main className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}><AppHeader section={section} moduleTabs={moduleTabs} onOpenSidebar={() => setSidebarOpen((value) => !value)} onOpenGlobalSearch={() => setGlobalSearchOpen(true)} /><div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} /><section className="content-area"><PageToolbarContext.Provider value={toolbarActionsElement}><div className={`context-toolbar ${section === 'Dashboard' ? 'dashboard-context-toolbar' : ''}`} aria-label="Controlos da página"><div className="context-toolbar-title"><strong>{section}</strong>{context?.length ? <span>{context.at(-1)}</span> : null}</div><m.div key={`${transitionKey}:navigation`} className="context-toolbar-navigation" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>{toolbar}</m.div><m.div key={`${transitionKey}:actions`} className="context-toolbar-actions" ref={setToolbarActionsElement} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}><ResponsiveToolbarActions>{actions}</ResponsiveToolbarActions></m.div></div><div className="app-shell-content">{children}</div></PageToolbarContext.Provider></section></div><GlobalSearchPalette open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} rackSearch={rackSearch} localSearch={search} /></main></LazyMotion></MotionConfig>;
}

export { UserMenu };
