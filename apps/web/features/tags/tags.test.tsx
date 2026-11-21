import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { createElement, type ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Subnet } from '@/features/ipam/types';
import type { Tag } from './types';

const api = vi.hoisted(() => ({
  listTags: vi.fn(),
  createTag: vi.fn(),
  updateTag: vi.fn(),
  deleteTag: vi.fn(),
  setDeviceTags: vi.fn(),
  setSubnetTags: vi.fn(),
}));
vi.mock('./api', () => ({ ...api, tagsQueryKey: (siteId: string | null | undefined) => ['tags', siteId ?? null] }));

import { canManageTagCatalog, hasAllTags, parseTagFilterValue, tagColorClass } from './types';
import { TagChips, TagEditor, TagFilter, TagManager } from './tag-components';
import { SubnetsView } from '@/features/ipam/components/subnets-view';

const core: Tag = { id: 't-core', siteId: 's1', name: 'core', color: 'blue', deviceCount: 2, subnetCount: 1 };
const dmz: Tag = { id: 't-dmz', siteId: 's1', name: 'dmz', color: 'red', deviceCount: 0, subnetCount: 0 };

function withQuery(element: ReactElement) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false }, mutations: { retry: false } } });
  return createElement(QueryClientProvider, { client }, element);
}

beforeEach(() => {
  api.listTags.mockResolvedValue([core, dmz]);
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
  localStorage.clear();
  window.history.replaceState(null, '', '/');
});

describe('tag filter helpers', () => {
  it('parses comma lists and requires every listed tag', () => {
    expect(parseTagFilterValue(' a, b ,,')).toEqual(['a', 'b']);
    expect(parseTagFilterValue('')).toEqual([]);
    const item = { tags: [{ id: 'a', name: 'a', color: 'gray' }, { id: 'b', name: 'b', color: 'blue' }] };
    expect(hasAllTags(item, '')).toBe(true);
    expect(hasAllTags(item, 'a')).toBe(true);
    expect(hasAllTags(item, 'a,b')).toBe(true);
    expect(hasAllTags(item, 'a,c')).toBe(false);
    expect(hasAllTags({}, 'a')).toBe(false);
  });

  it('falls back to gray for unknown colours', () => {
    expect(tagColorClass('purple')).toBe('purple');
    expect(tagColorClass('violet')).toBe('gray');
    expect(tagColorClass(undefined)).toBe('gray');
  });
});

describe('TagChips', () => {
  it('renders coloured chips and collapses the rest into +N', () => {
    render(<TagChips tags={[core, dmz, { id: 'x', name: 'lab', color: 'green' }]} limit={2} />);
    expect(screen.getByText('core').className).toContain('tag-chip--blue');
    expect(screen.getByText('dmz').className).toContain('tag-chip--red');
    expect(screen.getByText('+1')).toHaveAttribute('title', 'lab');
  });

  it('renders nothing without tags', () => {
    const { container } = render(<TagChips tags={[]} />);
    expect(container.innerHTML).toBe('');
  });
});

describe('TagFilter', () => {
  it('lists the site tags and reports the chosen id', async () => {
    const onChange = vi.fn();
    render(withQuery(<TagFilter siteId="s1" value="" onChange={onChange} />));
    const select = screen.getByRole('combobox', { name: 'Filtrar por etiqueta' });
    await screen.findByRole('option', { name: 'dmz' });
    fireEvent.change(select, { target: { value: 't-dmz' } });
    expect(onChange).toHaveBeenCalledWith('t-dmz');
    expect(api.listTags).toHaveBeenCalledWith('s1');
  });

  it('keeps a saved filter whose tag was deleted visible', async () => {
    render(withQuery(<TagFilter siteId="s1" value="t-gone" onChange={vi.fn()} />));
    expect(await screen.findByRole('option', { name: 'Etiqueta removida' })).toBeInTheDocument();
  });
});

describe('TagEditor', () => {
  it('saves the checked tag ids and closes', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    const close = vi.fn();
    render(withQuery(<TagEditor siteId="s1" itemLabel="sw-core-01" selected={[core]} save={save} close={close} />));
    expect(screen.getByRole('dialog', { name: 'Etiquetas · sw-core-01' })).toBeInTheDocument();
    fireEvent.click(await screen.findByRole('checkbox', { name: 'dmz' }));
    fireEvent.click(screen.getByRole('checkbox', { name: 'core' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar etiquetas' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['t-dmz']));
    await waitFor(() => expect(close).toHaveBeenCalled());
  });

  it('creates a tag inline and selects it', async () => {
    const lab: Tag = { id: 't-lab', siteId: 's1', name: 'lab', color: 'green', deviceCount: 0, subnetCount: 0 };
    api.createTag.mockResolvedValue(lab);
    const save = vi.fn().mockResolvedValue(undefined);
    render(withQuery(<TagEditor siteId="s1" itemLabel="sw" selected={[]} save={save} close={vi.fn()} canCreate />));
    await screen.findByRole('checkbox', { name: 'core' });
    fireEvent.change(screen.getByRole('textbox', { name: 'Nome da nova etiqueta' }), { target: { value: ' lab ' } });
    fireEvent.change(screen.getByRole('combobox', { name: 'Cor da nova etiqueta' }), { target: { value: 'green' } });
    fireEvent.click(screen.getByRole('button', { name: /Criar/ }));
    await waitFor(() => expect(api.createTag).toHaveBeenCalledWith({ siteId: 's1', name: 'lab', color: 'green' }));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar etiquetas' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['t-lab']));
  });

  it('shows the API error and stays open', async () => {
    const close = vi.fn();
    render(withQuery(<TagEditor siteId="s1" itemLabel="sw" selected={[]} save={vi.fn().mockRejectedValue(new Error('Sem permissão'))} close={close} />));
    fireEvent.click(screen.getByRole('button', { name: 'Guardar etiquetas' }));
    expect(await screen.findByRole('alert')).toHaveTextContent('Sem permissão');
    expect(close).not.toHaveBeenCalled();
  });
});

describe('TagManager', () => {
  it('renames, then deletes after confirmation', async () => {
    api.updateTag.mockResolvedValue({ ...core, name: 'backbone' });
    api.deleteTag.mockResolvedValue({ success: true });
    const onChanged = vi.fn();
    render(withQuery(<TagManager siteId="s1" close={vi.fn()} onChanged={onChanged} canManage />));
    const names = await screen.findAllByRole('textbox', { name: 'Nome da etiqueta' });
    const row = names[0].closest('li') as HTMLElement;
    fireEvent.change(names[0], { target: { value: 'backbone' } });
    fireEvent.click(within(row).getByRole('button', { name: 'Guardar' }));
    await waitFor(() => expect(api.updateTag).toHaveBeenCalledWith('t-core', { name: 'backbone', color: 'blue' }));
    fireEvent.click(within(row).getByRole('button', { name: 'Eliminar core' }));
    const confirm = await screen.findByRole('alertdialog');
    expect(confirm).toHaveTextContent('Sai de 3 itens');
    fireEvent.click(within(confirm).getByRole('button', { name: 'Eliminar' }));
    await waitFor(() => expect(api.deleteTag).toHaveBeenCalledWith('t-core'));
    expect(onChanged).toHaveBeenCalled();
  });
});

describe('tag catalog for NETWORK_OPERATOR', () => {
  it('only ADMIN and SYSTEMS_OPERATOR manage the catalog', () => {
    expect(canManageTagCatalog((role) => role === 'ADMIN')).toBe(true);
    expect(canManageTagCatalog((role) => role === 'SYSTEMS_OPERATOR')).toBe(true);
    expect(canManageTagCatalog((role) => role === 'NETWORK_OPERATOR')).toBe(false);
    expect(canManageTagCatalog(() => false)).toBe(false);
  });

  it('the editor assigns existing tags but cannot create new ones', async () => {
    const save = vi.fn().mockResolvedValue(undefined);
    render(withQuery(<TagEditor siteId="s1" itemLabel="sw" selected={[]} save={save} close={vi.fn()} />));
    fireEvent.click(await screen.findByRole('checkbox', { name: 'core' }));
    expect(screen.queryByRole('textbox', { name: 'Nome da nova etiqueta' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Guardar etiquetas' }));
    await waitFor(() => expect(save).toHaveBeenCalledWith(['t-core']));
  });

  it('the manager lists tags without rename, recolour, delete or create', async () => {
    render(withQuery(<TagManager siteId="s1" close={vi.fn()} />));
    expect(await screen.findByText('core')).toBeInTheDocument();
    expect(screen.queryByRole('textbox')).not.toBeInTheDocument();
    expect(screen.queryByRole('combobox')).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Eliminar/ })).not.toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Criar/ })).not.toBeInTheDocument();
  });
});

describe('IPAM subnets with tags', () => {
  const subnet = (id: string, cidr: string, tags: Tag[]): Subnet => ({ id, cidr, version: 4, siteId: 's1', tags: tags.map(({ id: tagId, name, color }) => ({ id: tagId, name, color })) });
  const items = [subnet('a', '10.0.0.0/24', [core]), subnet('b', '10.0.1.0/24', [dmz]), subnet('c', '10.0.2.0/24', [])];
  const props = { selected: null, usage: null, capacityHistory: null, ips: [], search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(), canEdit: false, canReserve: false, canReleaseReservations: false, siteId: 's1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(), editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(), reserveIp: vi.fn(), releaseReservation: vi.fn() };

  it('shows tag chips and filters by tag through the URL', async () => {
    render(withQuery(createElement(SubnetsView, { ...props, items })));
    expect(screen.getAllByText('core').some((node) => node.classList.contains('tag-chip'))).toBe(true);
    expect(screen.getByText('10.0.2.0/24')).toBeInTheDocument();
    await screen.findByRole('option', { name: 'dmz' });
    fireEvent.change(screen.getByRole('combobox', { name: 'Filtrar por etiqueta' }), { target: { value: 't-dmz' } });
    await waitFor(() => expect(screen.queryByText('10.0.0.0/24')).not.toBeInTheDocument());
    expect(screen.getByText('10.0.1.0/24')).toBeInTheDocument();
    expect(screen.queryByText('10.0.2.0/24')).not.toBeInTheDocument();
    expect(window.location.search).toContain('subnetstag=t-dmz');
    expect(screen.queryByRole('button', { name: /Gerir etiquetas/ })).not.toBeInTheDocument();
  });

  it('restores the tag filter from a saved view', async () => {
    localStorage.setItem('management-app:saved-views:local:ipam-subnets', JSON.stringify([{ name: 'Núcleo', query: '?subnetstag=t-core' }]));
    render(withQuery(createElement(SubnetsView, { ...props, items, canEdit: true })));
    expect(screen.queryByRole('button', { name: /Gerir etiquetas/ })).not.toBeInTheDocument();
    cleanup();
    render(withQuery(createElement(SubnetsView, { ...props, items, canEdit: true, canManageTags: true })));
    expect(screen.getByRole('button', { name: /Gerir etiquetas/ })).toBeInTheDocument();
    const viewSelect = screen.getAllByRole('combobox').find((node) => within(node).queryByRole('option', { name: 'Núcleo' }));
    expect(viewSelect).toBeDefined();
    fireEvent.change(viewSelect!, { target: { value: 'Núcleo' } });
    await waitFor(() => expect(screen.queryByText('10.0.1.0/24')).not.toBeInTheDocument());
    expect(screen.getByText('10.0.0.0/24')).toBeInTheDocument();
  });
});

describe('Infraestrutura device list with tags', () => {
  it('shows chips, and the tag button only where the user may tag', async () => {
    const { DeviceList } = await import('@/features/infrastructure/components/devices/device-list');
    const onEditTags = vi.fn();
    const devices = [
      { id: 'd1', name: 'sw-core-01', type: 'SWITCH', status: 'ACTIVE', tags: [{ id: 't-core', name: 'core', color: 'blue' }] },
      { id: 'd2', name: 'srv-app-01', type: 'SERVER', status: 'ACTIVE', tags: [] },
    ];
    render(<DeviceList devices={devices} search="" onSelect={vi.fn()} onEdit={vi.fn()} onNew={vi.fn()} onRetire={vi.fn()} canRetire={false} canEdit={false} toolbarFilters={<span>filtros</span>} onEditTags={onEditTags} canEditTagsFor={(device) => device.type === 'SWITCH'} />);
    expect(screen.getByText('core').className).toContain('tag-chip--blue');
    expect(screen.getByText('filtros')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: 'Etiquetas de srv-app-01' })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Etiquetas de sw-core-01' }));
    expect(onEditTags).toHaveBeenCalledWith(devices[0]);
  });
});
