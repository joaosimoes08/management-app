import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShellFrame, PageShell, PageToolbarPortal, type AppShellProps } from './app-shell';

// The (authenticated) layout renders the frame once; each page hands its settings over through <PageShell>.
function AppShell(props: AppShellProps) { return <AppShellFrame><PageShell {...props} /></AppShellFrame>; }

vi.mock('next/navigation', () => ({ usePathname: () => '/infraestrutura' }));
const linkClicks = vi.hoisted(() => [] as string[]);
// Stand-in for next/link: client-side navigation instead of a full document load.
vi.mock('next/link', () => ({ default: ({ href, children, ...props }: { href: string; children: React.ReactNode } & React.AnchorHTMLAttributes<HTMLAnchorElement>) => <a {...props} href={href} data-next-link="" onClick={(event) => { event.preventDefault(); linkClicks.push(href); }}>{children}</a> }));
vi.mock('./app-header', () => ({ AppHeader: () => <header /> }));
vi.mock('./app-sidebar', () => ({ AppSidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => <aside className={`sidebar app-sidebar${collapsed ? ' sidebar-collapsed' : ''}`}><button onClick={onToggle}>{collapsed ? 'Expandir' : 'Recolher'}</button></aside> }));
vi.mock('./global-search', () => ({ GlobalSearchPalette: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
// jsdom has no layout, so the one-line fit check is stubbed: false = the controls fit.
const toolbarFit = vi.hoisted(() => ({ overflows: false }));
vi.mock('./context-toolbar-fit', async (importOriginal) => ({ ...(await importOriginal<typeof import('./context-toolbar-fit')>()), contextToolbarOverflows: () => toolbarFit.overflows }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string, fallback?: string) => ({ 'shell.skipToContent': 'Saltar para o conteúdo', 'shell.closeMenu': 'Fechar menu', 'shell.pageControls': 'Controlos da página', 'shell.controls': 'Controlos' } as Record<string, string>)[key] ?? fallback ?? key }) }));

afterEach(() => { cleanup(); localStorage.clear(); });

describe('AppShell sidebar preference', () => {
  it('starts expanded when storage has no saved preference', async () => {
    localStorage.removeItem('civernode.sidebar.collapsed');
    const { container } = render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed'));
    expect(screen.getByRole('button', { name: 'Recolher' })).toBeInTheDocument();
  });

  it('honors a saved collapsed state and keeps the manual toggle functional', async () => {
    localStorage.setItem('civernode.sidebar.collapsed', 'true');
    const { container } = render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    await waitFor(() => expect(container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed'));
    fireEvent.click(screen.getByRole('button', { name: 'Expandir' }));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed'));
    expect(localStorage.getItem('civernode.sidebar.collapsed')).toBe('false');
  });
});

describe('Dashboard AppShell toolbar layout', () => {
  it('keeps Workspace navigation and actions in separate toolbar regions at a narrow viewport', () => {
    const previousWidth = window.innerWidth;
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: 390 });
    const discovery = vi.fn();
    try {
      render(<AppShell section="Dashboard" toolbar={<label>Workspace<select aria-label="Workspace"><option>Site A</option></select></label>} actions={<><button className="secondary-button">Atualizar</button><button className="primary-button" onClick={discovery}>Nova descoberta</button></>}><div /></AppShell>);
      const toolbar = document.querySelector('.dashboard-context-toolbar') as HTMLElement;
      expect(toolbar).toBeInTheDocument();
      const navigation = toolbar.querySelector('.context-toolbar-navigation') as HTMLElement;
      const actions = toolbar.querySelector('.context-toolbar-actions') as HTMLElement;
      expect(navigation).toContainElement(screen.getByRole('combobox', { name: 'Workspace' }));
      expect(actions).toContainElement(screen.getByRole('button', { name: 'Nova descoberta' }));
      const controls = toolbar.querySelector('.context-toolbar-controls') as HTMLElement;
      expect(controls.children[0]).toBe(navigation);
      expect(controls.children[1]).toBe(actions);
      fireEvent.click(within(actions).getByRole('button', { name: 'Nova descoberta' }));
      expect(discovery).toHaveBeenCalledOnce();
    } finally {
      Object.defineProperty(window, 'innerWidth', { configurable: true, value: previousWidth });
    }
  });
});

describe('AppShell utility action alignment slot', () => {
  it('keeps page actions and portal contributions in the dedicated trailing toolbar region', async () => {
    render(<AppShell section="Qualidade" actions={<button>Atualizar</button>}>
      <PageToolbarPortal><button>Exportar</button></PageToolbarPortal>
    </AppShell>);

    const toolbar = document.querySelector('.context-toolbar') as HTMLElement;
    const navigation = toolbar.querySelector('.context-toolbar-navigation') as HTMLElement;
    const actions = toolbar.querySelector('.context-toolbar-actions') as HTMLElement;
    await waitFor(() => expect(within(actions).getByRole('button', { name: 'Exportar' })).toBeInTheDocument());

    const controls = toolbar.querySelector('.context-toolbar-controls') as HTMLElement;
    expect(controls.children[0]).toBe(navigation);
    expect(controls.children[1]).toBe(actions);
    expect(within(actions).getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });
});

describe('AppShell help link', () => {
  it('links the page title to its Ajuda article', () => {
    render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    expect(screen.getByRole('link', { name: 'Ajuda: Equipamentos' })).toHaveAttribute('href', '/ajuda/equipamentos');
  });

  it('keeps a toolbar that only holds the title and Help visible, so Help is reachable on every tab (item 8)', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');
    expect(css).toContain('.context-toolbar:has(.context-toolbar-navigation:empty):has(.context-toolbar-actions:empty):not(:has(.context-toolbar-help)) { display:none; }');
    render(<AppShell section="Mapa físico" helpTopic="equipamentos"><p>Content</p></AppShell>);
    expect(screen.getByRole('link', { name: 'Ajuda: Equipamentos' })).toHaveClass('context-toolbar-help');
  });

  it('opens Help with client-side navigation, not a full page load (item 8)', () => {
    linkClicks.length = 0;
    render(<AppShell section="Mapa físico" helpTopic="equipamentos"><p>Content</p></AppShell>);
    const link = screen.getByRole('link', { name: 'Ajuda: Equipamentos' });
    expect(link).toHaveAttribute('data-next-link');
    fireEvent.click(link);
    expect(linkClicks).toEqual(['/ajuda/equipamentos']);
  });

  it('opens the Servidores Linux article when the page names a help topic (Servidores tab)', () => {
    render(<AppShell section="Mapa físico" helpTopic="servidores"><p>Content</p></AppShell>);
    expect(screen.getByRole('link', { name: 'Ajuda: Servidores Linux' })).toHaveAttribute('href', '/ajuda/servidores');
  });
});

describe('AppShell breadcrumb', () => {
  it('omits a breadcrumb that only repeats the section title', () => {
    render(<AppShell section="Perfil" context={['Perfil']}><p>Content</p></AppShell>);
    const title = document.querySelector('.context-toolbar-title') as HTMLElement;
    expect(title.querySelector('strong')).toHaveTextContent('Perfil');
    expect(title.querySelector('span')).toBeNull();
  });

  it('does not repeat the section title when the page h1 already shows it', () => {
    render(<AppShell section="Perfil" showSectionTitle={false} context={['Perfil']}><h1>Perfil</h1></AppShell>);
    expect((document.querySelector('.context-toolbar-title') as HTMLElement).querySelector('strong')).toBeNull();
    expect(screen.getAllByText('Perfil')).toHaveLength(1);
  });

  it('keeps a breadcrumb that names the active tab', () => {
    render(<AppShell section="Perfil" context={['Notificações']}><p>Content</p></AppShell>);
    expect((document.querySelector('.context-toolbar-title') as HTMLElement).querySelector('span')).toHaveTextContent('Notificações');
  });
});

describe('AppShell landmarks and skip link', () => {
  it('renders one main landmark that holds only the page content', () => {
    render(<AppShell section="Infraestrutura"><p>Page body</p></AppShell>);
    const mains = screen.getAllByRole('main');
    expect(mains).toHaveLength(1);
    expect(mains[0]).toHaveAttribute('id', 'main-content');
    expect(within(mains[0]).getByText('Page body')).toBeInTheDocument();
    // The app header and sidebar sit outside main, so the header is the page banner.
    expect(mains[0].querySelector('header, aside')).toBeNull();
    expect(screen.getByRole('banner')).toBeInTheDocument();
    expect(screen.getByRole('region', { name: 'Controlos da página' })).toBeInTheDocument();
  });

  it('offers a skip link as the first focusable element and moves focus to the content', () => {
    const { container } = render(<AppShell section="Infraestrutura"><button>Primeira ação</button></AppShell>);
    const skip = screen.getByRole('link', { name: 'Saltar para o conteúdo' });
    expect(skip).toHaveAttribute('href', '#main-content');
    expect(container.querySelector('a, button, input, select, textarea, [tabindex]:not([tabindex="-1"])')).toBe(skip);
    skip.focus();
    fireEvent.click(skip);
    expect(document.activeElement).toBe(screen.getByRole('main'));
  });
});

describe('AppShell one-line utility bar', () => {
  it('moves the page controls into the "Controlos" panel when they do not fit on one line', async () => {
    toolbarFit.overflows = true;
    try {
      render(<AppShell section="Alterações" toolbar={<label>Estado<select aria-label="Estado"><option>Todos</option></select></label>} actions={<button className="primary-button">Nova alteração</button>}><div /></AppShell>);
      const toolbar = document.querySelector('.context-toolbar') as HTMLElement;
      await waitFor(() => expect(toolbar).toHaveAttribute('data-compact'));
      const toggle = within(toolbar).getByRole('button', { name: 'Controlos' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      expect(toggle).toHaveAttribute('aria-controls', (toolbar.querySelector('.context-toolbar-controls') as HTMLElement).id);
      fireEvent.click(toggle);
      expect(toggle).toHaveAttribute('aria-expanded', 'true');
      expect(toolbar).toHaveClass('controls-open');
      fireEvent.keyDown(document, { key: 'Escape' });
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
      fireEvent.click(toggle);
      fireEvent.pointerDown(document.body);
      expect(toggle).toHaveAttribute('aria-expanded', 'false');
    } finally {
      toolbarFit.overflows = false;
    }
  });

  it('keeps everything on the bar and hides the toggle when the controls fit', () => {
    render(<AppShell section="Alertas" actions={<button>Atualizar</button>}><div /></AppShell>);
    const toolbar = document.querySelector('.context-toolbar') as HTMLElement;
    expect(toolbar).not.toHaveAttribute('data-compact');
    expect(toolbar.querySelector('.context-toolbar-controls-toggle')).toHaveAttribute('hidden');
  });

  it('never wraps: the bar stays a single row at every width', async () => {
    const { readFileSync } = await import('node:fs');
    const css = readFileSync(`${process.cwd()}/app/globals.css`, 'utf8');
    const block = css.slice(css.lastIndexOf('/* One-line utility bar'));
    expect(block).toMatch(/\.app-shell \.context-toolbar\[role="region"\] \{[^}]*flex-direction:row;[^}]*flex-wrap:nowrap/);
    expect(block).toMatch(/\[data-compact\] \.context-toolbar-controls \{[^}]*position:absolute/);
    expect(css.lastIndexOf('/* One-line utility bar')).toBeGreaterThan(css.lastIndexOf('flex-direction:column; flex-wrap:nowrap; align-items:stretch'));
  });
});

describe('AppShellFrame with PageShell (route-group layout)', () => {
  it('keeps one frame mounted while pages change, and shows the current page settings', async () => {
    localStorage.setItem('civernode.sidebar.collapsed', 'true');
    const { container, rerender } = render(<AppShellFrame><PageShell key="a" section="Auditoria" actions={<button>Exportar</button>}><p>Audit body</p></PageShell></AppShellFrame>);
    await waitFor(() => expect(container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed'));
    const frame = container.querySelector('.app-shell');
    expect(screen.getByText('Auditoria')).toBeInTheDocument();
    expect(screen.getByRole('button', { name: 'Exportar' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Expandir' }));
    rerender(<AppShellFrame><PageShell key="b" section="Alertas"><p>Alerts body</p></PageShell></AppShellFrame>);
    expect(container.querySelector('.app-shell')).toBe(frame);
    expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed');
    expect(screen.getByText('Alertas')).toBeInTheDocument();
    expect(screen.queryByText('Auditoria')).toBeNull();
    expect(screen.queryByRole('button', { name: 'Exportar' })).toBeNull();
    expect(screen.getByRole('main')).toHaveTextContent('Alerts body');
  });

  it('puts the page content directly inside the single <main>', () => {
    render(<AppShellFrame><PageShell section="Topologia"><div className="topology-page">map</div></PageShell></AppShellFrame>);
    expect(screen.getAllByRole('main')).toHaveLength(1);
    expect(screen.getByRole('main').firstElementChild).toHaveClass('topology-page');
  });
});
