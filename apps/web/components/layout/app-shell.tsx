'use client';

import { createContext, useContext, useEffect, useId, useLayoutEffect, useRef, useState, type MouseEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { ChevronDown, CircleHelp, MoreHorizontal, SlidersHorizontal } from 'lucide-react';
import { LazyMotion, MotionConfig, domAnimation } from 'motion/react';
import * as m from 'motion/react-m';
import { usePathname } from 'next/navigation';
import Link from 'next/link';
import { AppHeader } from './app-header';
import { AppSidebar } from './app-sidebar';
import { useUiText } from '@/components/ui/use-ui-text';
import { GlobalSearchPalette, type LocalSearchContext, type RackSearchContext } from './global-search';
import { UserMenu } from './user-menu';
import { ResponsiveToolbarActions } from './responsive-overflow';
import { useToolbarFit } from './use-toolbar-fit';
import { helpArticle, helpArticleForPath } from '@/features/help/articles';
import { useI18n } from '@/lib/i18n';
import { STORAGE_KEYS, getLocalItem } from '@/lib/storage-keys';

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

/** Page-specific shell settings: everything AppShellProps holds except the page content. */
export type PageShellConfig = Omit<AppShellProps, 'children'>;
const PageShellConfigContext = createContext<((config: PageShellConfig | null) => void) | null>(null);

/**
 * Slot a page uses to hand its shell settings (title, breadcrumb, module tabs, toolbar, actions, search) to the
 * AppShellFrame that the (authenticated) route-group layout renders once. It renders its children as they are, so
 * the page content stays a direct child of the shell's single <main>.
 */
export function PageShell({ children, ...config }: AppShellProps) {
  const publish = useContext(PageShellConfigContext);
  // Runs after every render of the page, before paint, so the frame always shows the page's current settings.
  useLayoutEffect(() => { publish?.(config); });
  useLayoutEffect(() => () => publish?.(null), [publish]);
  return <>{children}</>;
}

/**
 * Application chrome: sidebar + topbar + page toolbar + global search palette around the page content.
 * Rendered once by app/(authenticated)/layout.tsx, so it stays mounted while the user moves between pages.
 */
export function AppShellFrame({ children }: { children: ReactNode }) {
  const [config, setConfig] = useState<PageShellConfig | null>(null);
  const { section = '', context, search, rackSearch, moduleTabs, toolbar, toolbarKey, actions, helpTopic, showSectionTitle = true } = config ?? {};
  const pathname = usePathname();
  const { t } = useI18n();
  // A breadcrumb that repeats the section title (Perfil · Perfil) adds nothing.
  const breadcrumb = context?.at(-1) && context.at(-1) !== section ? context.at(-1) : undefined;
  const [sidebarOpen, setSidebarOpen] = useState(false);
  const [collapsed, setCollapsed] = useState(false);
  const [globalSearchOpen, setGlobalSearchOpen] = useState(false);
  const [toolbarActionsElement, setToolbarActionsElement] = useState<HTMLDivElement | null>(null);
  const toolbarRef = useRef<HTMLDivElement>(null);
  const controlsId = useId();
  const { compact: toolbarCompact, controlsOpen, setControlsOpen } = useToolbarFit(toolbarRef);

  // The frame persists across pages, so per-page UI state is reset on navigation (it used to remount with each page).
  useEffect(() => { setControlsOpen(false); setSidebarOpen(false); setGlobalSearchOpen(false); }, [pathname, setControlsOpen]);

  useEffect(() => {
    if (!controlsOpen) return;
    const toolbar = toolbarRef.current;
    const outside = (event: PointerEvent) => { if (toolbar && event.target instanceof Node && !toolbar.contains(event.target)) setControlsOpen(false); };
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      setControlsOpen(false);
      toolbar?.querySelector<HTMLElement>('.context-toolbar-controls-toggle')?.focus();
    };
    document.addEventListener('pointerdown', outside);
    document.addEventListener('keydown', escape);
    return () => { document.removeEventListener('pointerdown', outside); document.removeEventListener('keydown', escape); };
  }, [controlsOpen, setControlsOpen]);

  useEffect(() => {
    setCollapsed(getLocalItem(STORAGE_KEYS.sidebarCollapsed) === 'true');
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
    window.localStorage.setItem(STORAGE_KEYS.sidebarCollapsed, String(next));
    return next;
  });

  // Move focus explicitly: the content area scrolls inside its own box, so the hash jump alone
  // neither scrolls it nor moves keyboard focus in every browser.
  const skipToContent = (event: MouseEvent<HTMLAnchorElement>) => {
    const target = document.getElementById('main-content');
    if (!target) return;
    event.preventDefault();
    target.focus();
    target.scrollTop = 0;
  };

  const transitionKey = `${pathname}:${toolbarKey ?? ''}`;
  const help = (helpTopic ? helpArticle(helpTopic) : undefined) ?? helpArticleForPath(pathname);
  // "Ajuda: <article>" is one attribute, so both parts are translated by key; the page-wide pass cannot split it.
  const helpLabel = help ? t('shell.helpFor', `Ajuda: ${help.title}`, { title: t(`help.article.${help.slug}`, help.title) }) : '';
  // Landmarks: the header (banner), the sidebar <nav> and one <main> that holds only the page, so
  // screen-reader landmark lists and the skip link land on the content, not on the app chrome.
  return <PageShellConfigContext.Provider value={setConfig}><MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><div className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={skipToContent}>{t('shell.skipToContent')}</a>
    <AppHeader moduleTabs={moduleTabs} onOpenSidebar={() => setSidebarOpen((value) => !value)} onOpenGlobalSearch={() => setGlobalSearchOpen(true)} />
    <div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label={t('shell.closeMenu')} onClick={() => setSidebarOpen(false)} /><section className="content-area"><PageToolbarContext.Provider value={toolbarActionsElement}><div ref={toolbarRef} className={`context-toolbar ${section === 'Dashboard' ? 'dashboard-context-toolbar' : ''} ${toolbarCompact && controlsOpen ? 'controls-open' : ''}`} role="region" aria-label={t('shell.pageControls')} data-compact={toolbarCompact ? '' : undefined}><div className="context-toolbar-title">{showSectionTitle && <strong>{section}</strong>}{breadcrumb ? <span>{breadcrumb}</span> : null}{help && <Link className="icon-button subtle context-toolbar-help" href={`/ajuda/${help.slug}`} aria-label={helpLabel} title={helpLabel}><CircleHelp size={14} /></Link>}</div><button type="button" className="context-toolbar-controls-toggle" aria-expanded={toolbarCompact && controlsOpen} aria-controls={controlsId} hidden={!toolbarCompact} onClick={() => setControlsOpen((open) => !open)}><SlidersHorizontal size={15} aria-hidden="true" /><span>{t('shell.controls')}</span><ChevronDown size={14} aria-hidden="true" /></button><div className="context-toolbar-controls" id={controlsId}><m.div key={`${transitionKey}:navigation`} className="context-toolbar-navigation" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>{toolbar}</m.div><m.div key={`${transitionKey}:actions`} className="context-toolbar-actions" ref={setToolbarActionsElement} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}><ResponsiveToolbarActions>{actions}</ResponsiveToolbarActions></m.div></div></div><main id="main-content" className="app-shell-content" tabIndex={-1}>{children}</main></PageToolbarContext.Provider></section></div>
    <GlobalSearchPalette open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} rackSearch={rackSearch} localSearch={search} />
  </div></LazyMotion></MotionConfig></PageShellConfigContext.Provider>;
}

export { UserMenu };
