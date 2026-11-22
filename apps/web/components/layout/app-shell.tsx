'use client';

import { createContext, useContext, useEffect, useState, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { CircleHelp, MoreHorizontal } from 'lucide-react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import * as m from 'motion/react-m';
import { usePathname } from 'next/navigation';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { useUiText } from '@/components/ui/use-ui-text';
import { GlobalSearchPalette, type LocalSearchContext, type RackSearchContext } from './global-search';
import { UserMenu } from './user-menu';
import { ResponsiveToolbarActions } from './responsive-overflow';
import { helpArticle, helpArticleForPath } from '@/features/help/articles';

export type TopbarSearchConfig = LocalSearchContext;
export type AppShellProps = { children: ReactNode; section: string; context?: string[]; search?: TopbarSearchConfig; rackSearch?: RackSearchContext; globalSearch?: boolean; moduleTabs?: ReactNode; toolbar?: ReactNode; toolbarKey?: string; actions?: ReactNode; /** false when the page's own h1 already shows the section name, so the toolbar does not repeat it. */ showSectionTitle?: boolean; /** Help article slug for the "?" link when the path alone is not enough (e.g. a tab). */ helpTopic?: string };
const PageToolbarContext = createContext<HTMLElement | null>(null);

export function PageToolbarPortal({ children }: { children: ReactNode }) {
  const target = useContext(PageToolbarContext);
  return target ? createPortal(<div className="context-toolbar-contribution">{children}</div>, target) : <div className="context-toolbar-contribution">{children}</div>;
}

export function ToolbarMore({ children, label, className = '' }: { children: ReactNode; label?: string; className?: string }) {
  const ui = useUiText();
  return <details className={`context-toolbar-more ${className}`.trim()}><summary><MoreHorizontal size={16} /><span>{label ?? ui('ui.moreActions')}</span></summary><div className="context-toolbar-more-menu">{children}</div></details>;
}

/** Application chrome: sidebar + topbar + global search palette around page content. */
export function AppShell({ children, section, context, search, rackSearch, moduleTabs, toolbar, toolbarKey, actions, helpTopic, showSectionTitle = true }: AppShellProps) {
  const pathname = usePathname();
  // A breadcrumb that repeats the section title (Perfil · Perfil) adds nothing.
  const breadcrumb = context?.at(-1) && context.at(-1) !== section ? context.at(-1) : undefined;
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
  const help = (helpTopic ? helpArticle(helpTopic) : undefined) ?? helpArticleForPath(pathname);
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><main className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}><AppHeader section={section} moduleTabs={moduleTabs} onOpenSidebar={() => setSidebarOpen((value) => !value)} onOpenGlobalSearch={() => setGlobalSearchOpen(true)} /><div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label="Fechar menu" onClick={() => setSidebarOpen(false)} /><section className="content-area"><PageToolbarContext.Provider value={toolbarActionsElement}><div className={`context-toolbar ${section === 'Dashboard' ? 'dashboard-context-toolbar' : ''}`} aria-label="Controlos da página"><div className="context-toolbar-title">{showSectionTitle && <strong>{section}</strong>}{breadcrumb ? <span>{breadcrumb}</span> : null}{help && <a className="icon-button subtle" href={`/ajuda/${help.slug}`} aria-label={`Ajuda: ${help.title}`} title={`Ajuda: ${help.title}`}><CircleHelp size={14} /></a>}</div><m.div key={`${transitionKey}:navigation`} className="context-toolbar-navigation" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>{toolbar}</m.div><m.div key={`${transitionKey}:actions`} className="context-toolbar-actions" ref={setToolbarActionsElement} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}><ResponsiveToolbarActions>{actions}</ResponsiveToolbarActions></m.div></div><div className="app-shell-content">{children}</div></PageToolbarContext.Provider></section></div><GlobalSearchPalette open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} rackSearch={rackSearch} localSearch={search} /></main></LazyMotion></MotionConfig>;
}

export { UserMenu };
