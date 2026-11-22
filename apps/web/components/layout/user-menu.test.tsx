import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { placeUserDropdown, UserMenu } from './user-menu';

const push = vi.fn();
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ user: { username: 'joao', roles: ['ADMIN'] }, profile: { firstName: 'Joao' }, logout: vi.fn(), hasRole: () => true }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string, fallback?: string) => fallback ?? key }) }));

afterEach(() => {
  cleanup();
  push.mockReset();
});

const viewport = { width: 1280, height: 720 };
const menu = { width: 190, height: 180 };

describe('placeUserDropdown', () => {
  it('opens above the collapsed-rail account button, inside the viewport', () => {
    const anchor = { top: 660, bottom: 688, left: 21, width: 28, height: 28 };
    const result = placeUserDropdown(anchor, menu, viewport, 'top');
    expect(result.placement).toBe('top');
    expect(result.top + menu.height).toBeLessThanOrEqual(anchor.top);
    expect(result.left).toBe(21);
    expect(result.left + menu.width).toBeLessThanOrEqual(viewport.width);
  });

  it('flips below when there is no room above and clamps to the viewport edges', () => {
    const result = placeUserDropdown({ top: 20, bottom: 48, left: 1200, width: 28, height: 28 }, menu, viewport, 'top');
    expect(result.placement).toBe('bottom');
    expect(result.top).toBe(54);
    expect(result.left).toBe(viewport.width - menu.width - 8);
  });

  it('keeps the compact top-bar variant below and right-aligned to its button', () => {
    const result = placeUserDropdown({ top: 12, bottom: 44, left: 1150, width: 110, height: 32 }, menu, viewport, 'bottom');
    expect(result).toEqual({ top: 50, left: 1070, placement: 'bottom' });
  });
});

describe('UserMenu', () => {
  it('renders the menu outside the sidebar so its overflow cannot clip it', () => {
    const { container } = render(<aside style={{ overflow: 'hidden' }}><UserMenu /></aside>);
    fireEvent.click(screen.getByRole('button', { name: /Joao/ }));
    const dropdown = screen.getByRole('menu');
    expect(container.contains(dropdown)).toBe(false);
    expect(dropdown.parentElement).toBe(document.body);
    expect(dropdown).toHaveClass('user-dropdown', 'user-dropdown-floating');
  });

  it('focuses the first item, moves with arrow keys and closes with Escape returning focus', () => {
    render(<UserMenu />);
    const trigger = screen.getByRole('button', { name: /Joao/ });
    fireEvent.click(trigger);
    expect(trigger).toHaveAttribute('aria-expanded', 'true');
    const items = screen.getAllByRole('menuitem');
    expect(items[0]).toHaveFocus();
    fireEvent.keyDown(items[0], { key: 'ArrowDown' });
    expect(items[1]).toHaveFocus();
    fireEvent.keyDown(items[1], { key: 'ArrowUp' });
    fireEvent.keyDown(items[0], { key: 'ArrowUp' });
    expect(items[items.length - 1]).toHaveFocus();
    fireEvent.keyDown(window, { key: 'Escape' });
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    expect(trigger).toHaveAttribute('aria-expanded', 'false');
    expect(trigger).toHaveFocus();
  });

  it('closes on an outside click and navigates from an item', () => {
    render(<UserMenu />);
    const trigger = screen.getByRole('button', { name: /Joao/ });
    fireEvent.click(trigger);
    fireEvent.mouseDown(document.body);
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
    fireEvent.click(trigger);
    fireEvent.click(screen.getByRole('menuitem', { name: 'nav.help' }));
    expect(push).toHaveBeenCalledWith('/ajuda');
    expect(screen.queryByRole('menu')).not.toBeInTheDocument();
  });
});
