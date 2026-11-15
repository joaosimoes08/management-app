import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { GlobalSearchPalette, filterRackSearchItems, type RackSearchItem } from './global-search';

const { push, apiFetch } = vi.hoisted(() => ({
  push: vi.fn(),
  apiFetch: vi.fn(async (..._args: unknown[]) => ({ items: [{ id: 'site-1', type: 'site', title: 'Main site', detail: 'Site', href: '/sites/site-1' }] })),
}));
vi.mock('next/navigation', () => ({ useRouter: () => ({ push }) }));
vi.mock('@/lib/api/client', () => ({ apiFetch: (...args: unknown[]) => apiFetch(...args) }));

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
