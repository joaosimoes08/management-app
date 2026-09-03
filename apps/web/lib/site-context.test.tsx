import { act, cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, Fragment } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { SiteSwitcher } from '@/components/layout/site-switcher';
import { SiteProvider, useSiteContext } from './site-context';

const navigation = vi.hoisted(() => {
  const replace = vi.fn();
  return { replace, pathname: '/ipam' };
});

vi.mock('next/navigation', () => ({
  usePathname: () => navigation.pathname,
  useRouter: () => ({ replace: navigation.replace }),
}));

vi.mock('./auth', () => ({ useAuth: () => ({ authenticated: true, hasRole: () => false }) }));
vi.mock('@/lib/i18n', () => ({ useI18n: () => ({ t: (key: string) => key === 'shell.activeSite' ? 'Site ativo' : key === 'shell.allSites' ? 'Todos os Sites' : key }) }));
vi.mock('@/lib/api/client', () => ({
  apiFetch: () => Promise.resolve({ items: [{ id: 'alpha', name: 'Alpha', code: 'ALP' }, { id: 'beta', name: 'Beta', code: 'BET' }] }),
}));

function SiteConsumer() {
  const { activeSite, activateSite } = useSiteContext();
  return createElement(Fragment, null,
    createElement('span', { 'data-testid': 'active-site' }, activeSite?.name),
    createElement('button', { onClick: () => activateSite('beta') }, 'Escolher Beta'),
  );
}

describe('SiteProvider', () => {
  afterEach(cleanup);

  beforeEach(() => {
    navigation.replace.mockReset();
    window.localStorage.clear();
    window.history.replaceState(null, '', '/ipam?siteId=alpha');
  });

  it('updates the active Site immediately while the URL replacement is pending', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(SiteProvider, null, createElement(SiteConsumer))));

    await waitFor(() => expect(screen.getByTestId('active-site')).toHaveTextContent('Alpha'));
    fireEvent.click(screen.getByRole('button', { name: 'Escolher Beta' }));
    await act(async () => undefined);

    expect(screen.getByTestId('active-site')).toHaveTextContent('Beta');
    expect(window.location.search).toBe('?siteId=beta');
    expect(navigation.replace).toHaveBeenCalledWith('/ipam?siteId=beta', { scroll: false });
  });

  it('shows the newly selected Site in the sidebar selector', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(SiteProvider, null, createElement(SiteSwitcher))));

    const switcher = screen.getByRole('button', { name: /Site ativo/i });
    await waitFor(() => expect(within(switcher).getByText('Alpha')).toBeInTheDocument());
    const previousCopy = switcher.querySelector('.workspace-switcher-copy');
    const previousAvatar = switcher.querySelector('.workspace-avatar');
    expect(previousAvatar).toHaveTextContent('A');
    fireEvent.click(switcher);
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Beta/i }));
    await act(async () => undefined);

    const currentCopy = switcher.querySelector('.workspace-switcher-copy');
    const currentAvatar = switcher.querySelector('.workspace-avatar');
    expect(currentCopy).not.toBe(previousCopy);
    expect(currentAvatar).not.toBe(previousAvatar);
    expect(currentAvatar).toHaveTextContent('B');
    expect(currentCopy).toHaveTextContent('Site ativoBeta');
    expect(within(switcher).queryByText('Todos os Sites')).not.toBeInTheDocument();
  });
});
