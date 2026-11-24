import { cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { AppSidebar } from './app-sidebar';
import { helpNavigation, navigation, settingsNavigation } from './navigation';

const motionPreference = vi.hoisted(() => ({ reduced: false }));
const routeState = vi.hoisted(() => ({ pathname: '/infraestrutura' }));

vi.mock('next/navigation', () => ({ usePathname: () => routeState.pathname, useRouter: () => ({ push: vi.fn() }) }));
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
  routeState.pathname = '/infraestrutura';
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

  it('shows a muted copyright line below the account controls, shortened when collapsed', () => {
    const { container, rerender } = render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
    const copyright = container.querySelector('.sidebar-copyright') as HTMLElement;
    expect(copyright).toBeInTheDocument();
    expect(container.querySelector('.sidebar-bottom-row')?.nextElementSibling).toBe(copyright);
    expect(copyright.querySelector('.sidebar-copyright-full')).toHaveTextContent('shell.copyright');
    expect(copyright.querySelector('.sidebar-copyright-short')).toHaveAttribute('aria-hidden', 'true');
    expect(copyright).toHaveAttribute('title', 'shell.copyright');
    rerender(<AppSidebar collapsed onToggle={vi.fn()} />);
    expect(container.querySelector('.sidebar-copyright-full')).toHaveTextContent('shell.copyright');
    expect(container.querySelector('.sidebar-copyright-short')).toHaveTextContent('shell.copyrightShort');
  });

  it('disables sidebar width motion when reduced motion is preferred', () => {
    motionPreference.reduced = true;
    const { container } = render(<AppSidebar collapsed onToggle={vi.fn()} />);
    expect(container.querySelector('.app-sidebar')).toHaveAttribute('data-motion-duration', '0');
  });
});

describe('AppSidebar navigation entries', () => {
  it('renders every entry, including Portal, Settings and Help, as a real link with its href', () => {
    const { container } = render(<AppSidebar collapsed onToggle={vi.fn()} />);
    const nav = container.querySelector('.primary-nav') as HTMLElement;
    expect(nav.querySelectorAll('button')).toHaveLength(0);
    const links = Array.from(nav.querySelectorAll('a.nav-item'));
    expect(links.map((link) => link.getAttribute('href'))).toEqual([...navigation.map((item) => item.href), settingsNavigation.href, helpNavigation.href]);
    expect(screen.getByRole('link', { name: 'nav.portal' })).toHaveAttribute('href', '/portal');
    expect(screen.getByRole('link', { name: 'nav.help' })).toHaveAttribute('href', '/ajuda');
    expect(screen.getByRole('link', { name: 'nav.settings' })).toHaveAttribute('href', '/definicoes');
  });

  it('keeps the collapsed tooltip and class names on the links', () => {
    const { container } = render(<AppSidebar collapsed onToggle={vi.fn()} />);
    expect(screen.getByRole('link', { name: 'nav.portal' })).toHaveAttribute('title', 'nav.portal');
    expect(container.querySelector('a.nav-item.sidebar-settings-link')).toBeInTheDocument();
    expect(container.querySelector('a.nav-item.sidebar-help-link')).toBeInTheDocument();
  });

  it('marks only the active entry with aria-current="page", including on sub-routes', () => {
    routeState.pathname = '/infraestrutura/racks';
    render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
    const active = screen.getByRole('link', { name: 'nav.infrastructure' });
    expect(active).toHaveAttribute('aria-current', 'page');
    expect(active).toHaveClass('active');
    expect(screen.getByRole('link', { name: 'nav.dashboard' })).not.toHaveAttribute('aria-current');
    expect(document.querySelectorAll('[aria-current="page"]')).toHaveLength(1);
  });

  it('gives Help the active style and aria-current on /ajuda and its sub-pages', () => {
    routeState.pathname = '/ajuda/snmp';
    render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
    const help = screen.getByRole('link', { name: 'nav.help' });
    expect(help).toHaveAttribute('aria-current', 'page');
    expect(help).toHaveClass('active');
    expect(document.querySelectorAll('.primary-nav .nav-item.active')).toHaveLength(1);
  });

  it('keeps the active style and aria-current on the same single entry for every route', () => {
    for (const pathname of ['/', '/infraestrutura/racks', '/snmp', '/ajuda', '/portal']) {
      routeState.pathname = pathname;
      const { container, unmount } = render(<AppSidebar collapsed={false} onToggle={vi.fn()} />);
      const active = Array.from(container.querySelectorAll('.primary-nav .nav-item.active'));
      const current = Array.from(container.querySelectorAll('.primary-nav [aria-current="page"]'));
      expect(active).toHaveLength(1);
      expect(current).toEqual(active);
      unmount();
    }
  });

  it('still closes the mobile drawer when a main entry is clicked', () => {
    const onClose = vi.fn();
    render(<AppSidebar collapsed={false} onToggle={vi.fn()} onClose={onClose} />);
    const portal = screen.getByRole('link', { name: 'nav.portal' });
    portal.addEventListener('click', (event) => event.preventDefault());
    fireEvent.click(portal);
    expect(onClose).toHaveBeenCalledOnce();
  });
});

function withinSidebarAccount(footer: HTMLElement, text: string) {
  return Array.from(footer.querySelector('.sidebar-account-controls')?.querySelectorAll('button') ?? []).find((button) => button.textContent?.includes(text) || button.getAttribute('aria-label')?.includes(text));
}
