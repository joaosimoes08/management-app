import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppShell } from './app-shell';

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
