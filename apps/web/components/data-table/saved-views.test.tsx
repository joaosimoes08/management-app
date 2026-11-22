import { act, cleanup, fireEvent, render, screen } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { SavedViews, readSavedViews, removeSavedView, savedViewsKey, tableQueryOf, upsertSavedView } from './saved-views';
import { useTableUrlState } from './use-table-url-state';
import type { TableStateConfig } from './table-state';

const config: TableStateConfig<{ status: string }> = { filters: { status: '' }, sortable: ['name'], defaultSort: { column: 'name', direction: 'asc' } };

afterEach(() => { cleanup(); localStorage.clear(); window.history.replaceState(null, '', '/'); });

describe('saved view helpers', () => {
  it('keys by user and page, falling back to a local list', () => {
    expect(savedViewsKey('u1', 'audit')).toBe('management-app:saved-views:u1:audit');
    expect(savedViewsKey(undefined, 'audit')).toBe('management-app:saved-views:local:audit');
  });

  it('stores only the table query, without defaults', () => {
    expect(tableQueryOf({ search: '', filters: { status: '' }, sort: { column: 'name', direction: 'asc' } }, config)).toBe('');
    expect(tableQueryOf({ search: 'core', filters: { status: 'OPEN' }, sort: { column: 'name', direction: 'desc' } }, config)).toBe('?q=core&status=OPEN&sort=-name');
  });

  it('replaces a view with the same name, trims, caps and removes', () => {
    let views = upsertSavedView([], { name: '  Abertos ', query: '?status=OPEN' });
    views = upsertSavedView(views, { name: 'Todos', query: '' });
    views = upsertSavedView(views, { name: 'abertos', query: '?status=OPEN&q=x' });
    expect(views).toEqual([{ name: 'abertos', query: '?status=OPEN&q=x' }, { name: 'Todos', query: '' }]);
    expect(upsertSavedView(views, { name: '   ', query: '' })).toBe(views);
    expect(removeSavedView(views, 'Todos')).toEqual([{ name: 'abertos', query: '?status=OPEN&q=x' }]);
    let many: ReturnType<typeof upsertSavedView> = [];
    for (let i = 0; i < 25; i += 1) many = upsertSavedView(many, { name: `v${i}`, query: '' });
    expect(many).toHaveLength(20);
  });

  it('ignores broken storage', () => {
    localStorage.setItem('k', '{not json');
    expect(readSavedViews('k')).toEqual([]);
    localStorage.setItem('k', JSON.stringify([{ name: 'ok', query: '' }, { name: 1 }]));
    expect(readSavedViews('k')).toEqual([{ name: 'ok', query: '' }]);
  });
});

function Harness() {
  const table = useTableUrlState(config);
  return <><SavedViews pageId="test" config={config} table={table} /><output data-testid="status">{table.filters.status || 'all'}</output></>;
}

describe('SavedViews', () => {
  it('saves the current filters, applies them later and deletes the view', () => {
    window.history.replaceState(null, '', '/page?status=OPEN&siteId=s1');
    render(<Harness />);
    expect(screen.getByRole('combobox', { name: 'Aplicar vista guardada' })).toHaveDisplayValue('Sem vistas guardadas');
    fireEvent.click(screen.getByRole('button', { name: /Guardar vista/ }));
    fireEvent.change(screen.getByLabelText('Nome da vista'), { target: { value: 'Abertos' } });
    fireEvent.click(screen.getByRole('button', { name: 'Guardar' }));
    expect(readSavedViews(savedViewsKey(undefined, 'test'))).toEqual([{ name: 'Abertos', query: '?status=OPEN' }]);
    expect(screen.getByRole('combobox', { name: 'Aplicar vista guardada' })).toHaveDisplayValue('Abertos');

    window.history.pushState(null, '', '/page?siteId=s1');
    act(() => { window.dispatchEvent(new PopStateEvent('popstate')); });
    expect(screen.getByTestId('status')).toHaveTextContent('all');
    expect(screen.getByRole('combobox', { name: 'Aplicar vista guardada' })).toHaveDisplayValue('Vista atual');

    fireEvent.change(screen.getByRole('combobox', { name: 'Aplicar vista guardada' }), { target: { value: 'Abertos' } });
    expect(screen.getByTestId('status')).toHaveTextContent('OPEN');
    expect(window.location.search).toBe('?siteId=s1&status=OPEN');

    fireEvent.click(screen.getByRole('button', { name: 'Apagar vista Abertos' }));
    expect(readSavedViews(savedViewsKey(undefined, 'test'))).toEqual([]);
    expect(screen.queryByRole('button', { name: 'Apagar vista Abertos' })).not.toBeInTheDocument();
  });
});
