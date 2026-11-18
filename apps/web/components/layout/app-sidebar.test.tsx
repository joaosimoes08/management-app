import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './app-sidebar';

const motionPreference = vi.hoisted(() => ({ reduced: false }));

vi.mock('next/navigation', () => ({ usePathname: () => '/infraestrutura', useRouter: () => ({ push: vi.fn() }) }));
vi.mock('motion/react', () => ({ useReducedMotion: () => motionPreference.reduced }));
vi.mock('motion/react-m', async () => {
  const React = await import('react');
  const MotionAside = React.forwardRef(({ initial, animate, whileHover, transition, ...props }: Record<string, unknown>, ref: React.Ref<HTMLElement>) => {
    void initial;
    void animate;
    void whileHover;
    return React.createElement('aside', { ...props, ref, 'data-motion-duration': String((transition as { duration?: number }).duration) });
  });
  MotionAside.displayName = 'MotionAside';
  return { aside: MotionAside };
});
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => true }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key }) }));
vi.mock('./user-menu', async () => {
  const React = await import('react');
  return {
    UserMenu: () => {
      const [open, setOpen] = React.useState(false);
      return <div className="user-menu"><button type="button" aria-haspopup="menu" aria-expanded={open} onClick={() => setOpen((value) => !value)}>Profile and settings</button>{open && <div role="menu"><button type="button">Profile</button></div>}</div>;
    },
  };
});

afterEach(() => {
  cleanup();
  motionPreference.reduced = false;
});

describe('AppSidebar footer controls', () => {
  it('keeps brand and site selection in the topbar and removes Next Steps from the sidebar', () => {
    const { container } = render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
    expect(container.querySelector('.brand-block')).not.toBeInTheDocument();
    expect(container.querySelector('.site-switcher-root')).not.toBeInTheDocument();
    expect(container.querySelector('.sidebar-note-button')).not.toBeInTheDocument();
  });

  it('keeps Settings directly above Help and the profile left of the footer toggle', () => {
    const { container } = render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
    const nav = container.querySelector('.primary-nav') as HTMLElement;
    const settings = nav.querySelector('.sidebar-settings-link');
    const help = container.querySelector('.sidebar-help-link');
    expect(settings).toBeInTheDocument();
    expect(settings?.nextElementSibling).toBe(help);
    expect(container.querySelector('.nav-group-label')).not.toBeInTheDocument();
    const footer = container.querySelector('.sidebar-bottom-row');
    expect(footer).toBeInTheDocument();
    const controls = Array.from((footer as HTMLElement).children);
    expect(controls[0]).toHaveClass('sidebar-account-controls');
    expect(controls[1]).toHaveAccessibleName('Recolher menu');
    expect(footer?.querySelector('.sidebar-settings-link')).not.toBeInTheDocument();
    expect(withinSidebarAccount(footer as HTMLElement, 'Profile and settings')).toBeInTheDocument();
  });

  it('keeps the bottom toggle functional in both sidebar states', () => {
    const onToggle = vi.fn();
    const { rerender } = render(<AppSidebar collapsed={false} onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Recolher menu' }));
    expect(onToggle).toHaveBeenCalledOnce();
    rerender(<AppSidebar collapsed onToggle={onToggle} />);
    fireEvent.click(screen.getByRole('button', { name: 'Fixar menu aberto' }));
    expect(onToggle).toHaveBeenCalledTimes(2);
  });

  it('opens the profile menu from the collapsed footer while the sidebar is hovered', () => {
    const { container } = render(<AppSidebar collapsed onToggle={vi.fn()} />);
    const sidebar = container.querySelector('.app-sidebar') as HTMLElement;
    fireEvent.mouseEnter(sidebar);
    fireEvent.click(screen.getByRole('button', { name: 'Profile and settings' }));
    expect(screen.getByRole('menu')).toBeInTheDocument();
  });

  it('disables sidebar width motion when reduced motion is preferred', () => {
    motionPreference.reduced = true;
    const { container } = render(<AppSidebar collapsed onToggle={vi.fn()} />);
    expect(container.querySelector('.app-sidebar')).toHaveAttribute('data-motion-duration', '0');
  });
});

function withinSidebarAccount(footer: HTMLElement, text: string) {
  return Array.from(footer.querySelector('.sidebar-account-controls')?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes(text) || button.getAttribute('aria-label')?.includes(text));
}
