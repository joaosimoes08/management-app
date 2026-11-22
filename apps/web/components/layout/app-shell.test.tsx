import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, PageToolbarPortal } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/infraestrutura' }));
vi.mock('./app-header', () => ({ AppHeader: () => <header /> }));
vi.mock('./app-sidebar', () => ({ AppSidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => <aside className={`sidebar app-sidebar${collapsed ? ' sidebar-collapsed' : ''}`}><button onClick={onToggle}>{collapsed ? 'Expandir' : 'Recolher'}</button></aside> }));
vi.mock('./global-search', () => ({ GlobalSearchPalette: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ locale: 'pt-PT', t: (key: string) => ({ 'shell.skipToContent': 'Saltar para o conteúdo', 'shell.closeMenu': 'Fechar menu', 'shell.pageControls': 'Controlos da página' } as Record<string, string>)[key] ?? key }) }));

afterEach(() => { cleanup(); localStorage.clear(); });

describe('AppShell sidebar preference', () => {
  it('starts expanded when storage has no saved preference', async () => {
    localStorage.removeItem('cociber.sidebar.collapsed');
    const { container } = render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed'));
    expect(screen.getByRole('button', { name: 'Recolher' })).toBeInTheDocument();
  });

  it('honors a saved collapsed state and keeps the manual toggle functional', async () => {
    localStorage.setItem('cociber.sidebar.collapsed', 'true');
    const { container } = render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    await waitFor(() => expect(container.querySelector('.app-shell')).toHaveClass('sidebar-collapsed'));
    fireEvent.click(screen.getByRole('button', { name: 'Expandir' }));
    await waitFor(() => expect(container.querySelector('.app-shell')).not.toHaveClass('sidebar-collapsed'));
    expect(localStorage.getItem('cociber.sidebar.collapsed')).toBe('false');
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
      expect(toolbar.children[1]).toBe(navigation);
      expect(toolbar.children[2]).toBe(actions);
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

    expect(toolbar.children[1]).toBe(navigation);
    expect(toolbar.children[2]).toBe(actions);
    expect(within(actions).getByRole('button', { name: 'Atualizar' })).toBeInTheDocument();
  });
});

describe('AppShell help link', () => {
  it('links the page title to its Ajuda article', () => {
    render(<AppShell section="Infraestrutura"><p>Content</p></AppShell>);
    expect(screen.getByRole('link', { name: 'Ajuda: Equipamentos' })).toHaveAttribute('href', '/ajuda/equipamentos');
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
