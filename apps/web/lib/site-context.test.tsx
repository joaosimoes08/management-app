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
  const { activeSite, activateSite, resolved, siteId } = useSiteContext();
  return createElement(Fragment, null,
    createElement('span', { 'data-testid': 'resolved' }, resolved ? `resolved:${siteId}` : 'pending'),
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

  it('shows and changes the active Site in the combined COCIBER selector', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(SiteProvider, null, createElement(SiteSwitcher))));

    const switcher = screen.getByRole('button', { name: /Site ativo/i });
    await waitFor(() => expect(within(switcher).getByText('Alpha')).toBeInTheDocument());
    expect(switcher).toHaveAttribute('aria-expanded', 'false');
    expect(switcher.querySelector('.workspace-switcher-shield')).toHaveAttribute('aria-hidden', 'true');
    expect(switcher.querySelector('.workspace-avatar')).not.toBeInTheDocument();
    fireEvent.click(switcher);
    expect(switcher).toHaveAttribute('aria-expanded', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Alpha/i })).toHaveAttribute('aria-checked', 'true');
    expect(screen.getByRole('menuitemradio', { name: /Beta/i })).toHaveAttribute('aria-checked', 'false');
    fireEvent.click(screen.getByRole('menuitemradio', { name: /Beta/i }));
    await act(async () => undefined);

    await waitFor(() => expect(within(switcher).getByText('Beta')).toBeInTheDocument());
    expect(switcher).toHaveAttribute('aria-expanded', 'false');
    expect(switcher.querySelector('.workspace-switcher-shield')).toHaveAttribute('aria-hidden', 'true');
    expect(window.location.search).toBe('?siteId=beta');
    expect(navigation.replace).toHaveBeenCalledWith('/ipam?siteId=beta', { scroll: false });
    expect(within(switcher).queryByText('Todos os Sites')).not.toBeInTheDocument();
  });

  it('reports the site as resolved only together with the resolved siteId', async () => {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const seen: string[] = [];
    function Recorder() { const { resolved, siteId } = useSiteContext(); seen.push(resolved ? `resolved:${siteId}` : `pending:${siteId}`); return null; }
    render(createElement(QueryClientProvider, { client: queryClient }, createElement(SiteProvider, null, createElement(Recorder))));
    await waitFor(() => expect(seen.at(-1)).toBe('resolved:alpha'));
    expect(seen.filter((entry) => entry.startsWith('resolved:')).every((entry) => entry === 'resolved:alpha')).toBe(true);
  });
});
