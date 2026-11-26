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
import { contextToolbarHasControls, contextToolbarOverflows } from './context-toolbar-fit';
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

/** Application chrome: sidebar + topbar + global search palette around page content. */
export function AppShell({ children, section, context, search, rackSearch, moduleTabs, toolbar, toolbarKey, actions, helpTopic, showSectionTitle = true }: AppShellProps) {
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
  const [toolbarCompact, setToolbarCompact] = useState(false);
  const [controlsOpen, setControlsOpen] = useState(false);

  // One-line utility bar: when the page's controls do not fit beside the title (they would wrap or spill),
  // they move into the "Controlos" panel. The check runs before paint and again on resize or content change.
  useLayoutEffect(() => {
    const toolbar = toolbarRef.current;
    if (!toolbar) return;
    let frame = 0;
    // Width at which the one-line layout last failed for real, so a passing trial cannot flip it back and forth.
    let failedAt = -1;
    const fit = () => {
      frame = 0;
      const width = toolbar.clientWidth;
      if (!contextToolbarHasControls(toolbar)) {
        if (toolbar.hasAttribute('data-compact')) { toolbar.removeAttribute('data-compact'); setToolbarCompact(false); }
        return;
      }
      if (!toolbar.hasAttribute('data-compact')) {
        if (contextToolbarOverflows(toolbar)) { failedAt = width; toolbar.setAttribute('data-compact', ''); setToolbarCompact(true); }
        return;
      }
      if (width <= failedAt) return;
      // Trial: lay the bar out on one line with the page actions folded to their minimum, measure, and keep compact if it still spills.
      toolbar.removeAttribute('data-compact');
      toolbar.setAttribute('data-measuring', '');
      const overflows = contextToolbarOverflows(toolbar);
      toolbar.removeAttribute('data-measuring');
      if (overflows) toolbar.setAttribute('data-compact', '');
      else { setToolbarCompact(false); setControlsOpen(false); }
    };
    const schedule = () => { if (!frame) frame = window.requestAnimationFrame(fit); };
    fit();
    const resize = typeof ResizeObserver === 'undefined' ? undefined : new ResizeObserver(schedule);
    resize?.observe(toolbar);
    const content = typeof MutationObserver === 'undefined' ? undefined : new MutationObserver((records) => {
      const inside = (selector: string) => records.every((record) => (record.target instanceof Element ? record.target : record.target.parentElement)?.closest(selector));
      if (inside('.responsive-overflow-measure, .responsive-overflow-popover')) return;
      // "Mais ações" re-folding itself is a consequence of our own layout change, not new content: keep the failure memory.
      if (!inside('.responsive-toolbar-actions')) failedAt = -1;
      schedule();
    });
    content?.observe(toolbar, { childList: true, subtree: true, characterData: true });
    return () => { resize?.disconnect(); content?.disconnect(); if (frame) window.cancelAnimationFrame(frame); };
  }, []);

  useEffect(() => { setControlsOpen(false); }, [pathname]);

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
  }, [controlsOpen]);

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
  return <MotionConfig reducedMotion="user"><LazyMotion features={domAnimation} strict><div className={`site-shell app-shell ${sidebarOpen ? 'sidebar-visible' : ''} ${collapsed ? 'sidebar-collapsed' : ''}`}>
    <a className="skip-link" href="#main-content" onClick={skipToContent}>{t('shell.skipToContent')}</a>
    <AppHeader moduleTabs={moduleTabs} onOpenSidebar={() => setSidebarOpen((value) => !value)} onOpenGlobalSearch={() => setGlobalSearchOpen(true)} />
    <div className="dashboard-frame"><AppSidebar collapsed={collapsed} onToggle={toggleCollapsed} onClose={() => setSidebarOpen(false)} /><button className="sidebar-backdrop" aria-label={t('shell.closeMenu')} onClick={() => setSidebarOpen(false)} /><section className="content-area"><PageToolbarContext.Provider value={toolbarActionsElement}><div ref={toolbarRef} className={`context-toolbar ${section === 'Dashboard' ? 'dashboard-context-toolbar' : ''} ${toolbarCompact && controlsOpen ? 'controls-open' : ''}`} role="region" aria-label={t('shell.pageControls')} data-compact={toolbarCompact ? '' : undefined}><div className="context-toolbar-title">{showSectionTitle && <strong>{section}</strong>}{breadcrumb ? <span>{breadcrumb}</span> : null}{help && <Link className="icon-button subtle context-toolbar-help" href={`/ajuda/${help.slug}`} aria-label={helpLabel} title={helpLabel}><CircleHelp size={14} /></Link>}</div><button type="button" className="context-toolbar-controls-toggle" aria-expanded={toolbarCompact && controlsOpen} aria-controls={controlsId} hidden={!toolbarCompact} onClick={() => setControlsOpen((open) => !open)}><SlidersHorizontal size={15} aria-hidden="true" /><span>{t('shell.controls')}</span><ChevronDown size={14} aria-hidden="true" /></button><div className="context-toolbar-controls" id={controlsId}><m.div key={`${transitionKey}:navigation`} className="context-toolbar-navigation" initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}>{toolbar}</m.div><m.div key={`${transitionKey}:actions`} className="context-toolbar-actions" ref={setToolbarActionsElement} initial={{ opacity: 0, y: 5 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.18, ease: 'easeOut' }}><ResponsiveToolbarActions>{actions}</ResponsiveToolbarActions></m.div></div></div><main id="main-content" className="app-shell-content" tabIndex={-1}>{children}</main></PageToolbarContext.Provider></section></div>
    <GlobalSearchPalette open={globalSearchOpen} onClose={() => setGlobalSearchOpen(false)} rackSearch={rackSearch} localSearch={search} />
  </div></LazyMotion></MotionConfig>;
}

export { UserMenu };
