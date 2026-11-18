import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell, PageToolbarPortal } from './app-shell';

vi.mock('next/navigation', () => ({ usePathname: () => '/infraestrutura' }));
vi.mock('./app-header', () => ({ AppHeader: () => <header /> }));
vi.mock('./app-sidebar', () => ({ AppSidebar: ({ collapsed, onToggle }: { collapsed: boolean; onToggle: () => void }) => <aside className={`sidebar app-sidebar${collapsed ? ' sidebar-collapsed' : ''}`}><button onClick={onToggle}>{collapsed ? 'Expandir' : 'Recolher'}</button></aside> }));
vi.mock('./global-search', () => ({ GlobalSearchPalette: () => null }));
vi.mock('./user-menu', () => ({ UserMenu: () => null }));

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
