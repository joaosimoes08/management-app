import { cleanup, fireEvent, render as rtlRender, screen, waitFor } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import type { ReactElement, ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearchPalette, expandSearchResults, filterRackSearchItems, type RackSearchItem } from './global-search';

const { push, apiFetch } = vi.hoisted(() => ({
  push: vi.fn(),
  apiFetch: vi.fn(async (..._args: unknown[]) => ({ items: [{ id: 'site-1', type: 'site', title: 'Main site', detail: 'Site', href: '/sites/site-1' }] })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));


function render(ui: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return rtlRender(ui, { wrapper: ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider> });
}
afterEach(() => { cleanup(); vi.clearAllMocks(); });

const rackFixtures: RackSearchItem[] = [
  { id: 'rack-a', name: 'Core cabinet', roomId: 'room-1', devices: [{ name: 'Edge switch 24' }] },
  { id: 'rack-b', name: 'Storage row', roomId: 'room-1', devices: [{ name: 'Atlas array' }] },
];

describe('rack-scoped global search', () => {
  it('matches rack names and device names in the in-memory room inventory', () => {
    expect(filterRackSearchItems(rackFixtures, 'CORE').map(({ id }) => id)).toEqual(['rack-a']);
    expect(filterRackSearchItems(rackFixtures, 'atlas').map(({ id }) => id)).toEqual(['rack-b']);
  });

  it('routes current-tab queries to the existing page filter and preserves global search when switched', async () => {
    const onChange = vi.fn();
    render(<GlobalSearchPalette open onClose={vi.fn()} localSearch={{ value: '', onChange, placeholder: 'Pesquisar dispositivos…', scopeLabel: 'Equipamentos' }} />);
    expect(screen.getByRole('button', { name: 'Equipamentos' })).toHaveAttribute('aria-pressed', 'true');

    const input = screen.getByRole('textbox', { name: 'Pesquisar dispositivos…' });
    fireEvent.change(input, { target: { value: 'switch' } });
    expect(onChange).toHaveBeenCalledWith('switch');
    expect(screen.getByText('A filtrar equipamentos.')).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Toda a plataforma' }));
    expect(onChange).toHaveBeenLastCalledWith('');
    expect(screen.getByRole('textbox', { name: 'Pesquisa global' })).toHaveValue('switch');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/dashboard/search?q=switch&limit=8'), expect.anything()), { timeout: 1000 });
    expect(await screen.findByRole('option', { name: /Main site/ })).toBeInTheDocument();
  });

  it('offers rack scope and can switch back to platform-wide search', async () => {
    const onChange = vi.fn();
    render(<GlobalSearchPalette open onClose={vi.fn()} rackSearch={{
      racks: rackFixtures,
      value: '',
      onChange,
      hrefForRack: (rack) => `/infraestrutura?rackId=${rack.id}`,
    }} />);

    const input = screen.getByRole('textbox', { name: 'Pesquisar bastidores ou equipamentos deste site' });
    fireEvent.change(input, { target: { value: 'atlas' } });
    expect(await screen.findByRole('option', { name: /Storage row/ })).toBeInTheDocument();
    expect(onChange).toHaveBeenCalledWith('atlas');

    fireEvent.click(screen.getByRole('button', { name: 'Toda a plataforma' }));
    expect(screen.getByRole('textbox', { name: 'Pesquisa global' })).toBeInTheDocument();
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(expect.stringContaining('/api/v1/dashboard/search?q=atlas&limit=8'), expect.anything()),
      { timeout: 1000 });
    expect(await screen.findByRole('option', { name: /Main site/ })).toBeInTheDocument();
  });
});

describe('platform search with extended types (Phase D)', () => {
  it('asks for every result type and renders change plans, audit events and quality findings with their links', async () => {
    apiFetch.mockResolvedValueOnce({ items: [
      { id: 'c1', type: 'CHANGE_PLAN', title: 'Trocar switch', detail: 'Alteração · SUBMITTED · Lisboa', href: '/alteracoes?siteId=s1&planId=c1' },
      { id: 'e1', type: 'AUDIT_EVENT', title: 'device.update', detail: 'Auditoria · Device', href: '/auditoria?entityType=Device&entityId=d1' },
      { id: 'f1', type: 'QUALITY_FINDING', title: 'Sem número de série', detail: 'Qualidade · HIGH · OPEN', href: '/qualidade-inventario?siteId=s1&findingId=f1', actionHref: '/infraestrutura?siteId=s1&deviceId=d1' },
    ] } as never);
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisa global' }), { target: { value: 'sw' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith('/api/v1/dashboard/search?q=sw&limit=8&types=all', expect.anything()), { timeout: 1000 });
    expect(await screen.findByRole('option', { name: /Trocar switch/ })).toBeInTheDocument();
    expect(screen.getByRole('option', { name: /device\.update/ })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('option', { name: /Corrigir: Sem número de série/ }));
    expect(push).toHaveBeenCalledWith('/infraestrutura?siteId=s1&deviceId=d1');
  });

  it('falls back to the default search when the API rejects the types parameter', async () => {
    apiFetch.mockRejectedValueOnce(Object.assign(new Error('types inválido'), { status: 400, code: 'SEARCH_TYPES_INVALID' }));
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisa global' }), { target: { value: 'main' } });
    expect(await screen.findByRole('option', { name: /Main site/ }, { timeout: 1000 })).toBeInTheDocument();
    expect(apiFetch.mock.calls.map(([path]) => path)).toEqual(['/api/v1/dashboard/search?q=main&limit=8&types=all', '/api/v1/dashboard/search?q=main&limit=8']);
  });

  it('shows the generic error for other failures', async () => {
    apiFetch.mockRejectedValueOnce(Object.assign(new Error('boom'), { status: 500 }));
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisa global' }), { target: { value: 'main' } });
    expect(await screen.findByText('Não foi possível pesquisar.', undefined, { timeout: 1000 })).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledTimes(1);
  });
});

describe('platform search debounce and cancel', () => {
  const searchPaths = () => apiFetch.mock.calls.map(([path]) => path as string);

  it('waits 250 ms after the last keystroke and searches only the settled text', async () => {
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Pesquisa global' });
    fireEvent.change(input, { target: { value: 'ma' } });
    fireEvent.change(input, { target: { value: 'mai' } });
    fireEvent.change(input, { target: { value: 'main' } });
    await new Promise((resolve) => setTimeout(resolve, 150));
    expect(apiFetch).not.toHaveBeenCalled();
    expect(await screen.findByRole('option', { name: /Main site/ }, { timeout: 1000 })).toBeInTheDocument();
    await new Promise((resolve) => setTimeout(resolve, 300));
    expect(searchPaths()).toEqual(['/api/v1/dashboard/search?q=main&limit=8&types=all']);
  });

  it('does not search below 2 characters', async () => {
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    fireEvent.change(screen.getByRole('textbox', { name: 'Pesquisa global' }), { target: { value: 'm' } });
    await new Promise((resolve) => setTimeout(resolve, 400));
    expect(apiFetch).not.toHaveBeenCalled();
  });

  it('cancels the search in flight on the next keystroke, before the new search starts', async () => {
    let firstSignal: AbortSignal | undefined;
    apiFetch.mockImplementationOnce(async (_path: unknown, init: unknown) => {
      firstSignal = (init as { signal?: AbortSignal }).signal;
      return new Promise(() => undefined) as never;
    });
    render(<GlobalSearchPalette open onClose={vi.fn()} />);
    const input = screen.getByRole('textbox', { name: 'Pesquisa global' });
    fireEvent.change(input, { target: { value: 'ma' } });
    await waitFor(() => expect(apiFetch).toHaveBeenCalledTimes(1), { timeout: 1000 });
    expect(firstSignal?.aborted).toBe(false);
    fireEvent.change(input, { target: { value: 'main' } });
    // Within the 250 ms debounce: only the keystroke itself can have cancelled it.
    await waitFor(() => expect(firstSignal?.aborted).toBe(true), { timeout: 100 });
    expect(apiFetch).toHaveBeenCalledTimes(1);
    expect(await screen.findByRole('option', { name: /Main site/ }, { timeout: 1000 })).toBeInTheDocument();
    expect(searchPaths()).toEqual(['/api/v1/dashboard/search?q=ma&limit=8&types=all', '/api/v1/dashboard/search?q=main&limit=8&types=all']);
  });
});

describe('device results', () => {
  it('open the Device 360 page in the device Site', () => {
    const [device, iface] = expandSearchResults([
      { id: 'dev-1', type: 'DEVICE', title: 'sw-core', detail: 'Equipamento · Main', href: '/infraestrutura?siteId=site-1&tab=devices' },
      { id: 'if-1', type: 'INTERFACE', title: 'Gi1/0/1', detail: 'Interface', href: '/infraestrutura?siteId=site-1&tab=interfaces&deviceId=dev-1' },
    ]);
    expect(device.href).toBe('/infraestrutura/equipamentos/dev-1?siteId=site-1');
    expect(iface.href).toBe('/infraestrutura?siteId=site-1&tab=interfaces&deviceId=dev-1');
    expect(expandSearchResults([{ id: 'dev-2', type: 'DEVICE', title: 'x', detail: 'Equipamento', href: '/infraestrutura' }])[0].href).toBe('/infraestrutura/equipamentos/dev-2');
  });
});
