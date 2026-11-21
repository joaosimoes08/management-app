import { describe, expect, it } from 'vitest';
import { compareSortValues, hasTableFilters, nextSort, parseSort, parseTableState, serializeTableState, sortRows, type TableStateConfig } from './table-state';

type F = { type: string; owner: string };
const config: TableStateConfig<F> = { filters: { type: '', owner: '' }, sortable: ['name', 'size'] };

describe('sorting', () => {
  it('sorts numbers, dates and pt-PT text, with empty values last in both directions', () => {
    expect([3, null, 1, 2].sort((a, b) => compareSortValues(a, b))).toEqual([1, 2, 3, null]);
    expect([3, null, 1, 2].sort((a, b) => compareSortValues(a, b, 'desc'))).toEqual([3, 2, 1, null]);
    expect(['Évora', 'atlas', 'Braga', '', 'ázimo'].sort((a, b) => compareSortValues(a, b))).toEqual(['atlas', 'ázimo', 'Braga', 'Évora', '']);
    expect(['sw10', 'sw2', 'sw1'].sort((a, b) => compareSortValues(a, b))).toEqual(['sw1', 'sw2', 'sw10']);
    expect(compareSortValues(new Date('2026-01-02'), new Date('2026-01-01'))).toBeGreaterThan(0);
  });

  it('keeps the incoming order for equal values (stable) and returns a copy without a sort', () => {
    const rows = [{ id: 'a', size: 1 }, { id: 'b', size: 0 }, { id: 'c', size: 1 }, { id: 'd', size: 0 }];
    expect(sortRows(rows, { column: 'size', direction: 'asc' }, (row) => row.size).map((row) => row.id)).toEqual(['b', 'd', 'a', 'c']);
    expect(sortRows(rows, { column: 'size', direction: 'desc' }, (row) => row.size).map((row) => row.id)).toEqual(['a', 'c', 'b', 'd']);
    const copy = sortRows(rows, null, () => 0);
    expect(copy).toEqual(rows);
    expect(copy).not.toBe(rows);
  });

  it('cycles a header ascending → descending → default', () => {
    expect(nextSort(null, 'name')).toEqual({ column: 'name', direction: 'asc' });
    expect(nextSort({ column: 'name', direction: 'asc' }, 'name')).toEqual({ column: 'name', direction: 'desc' });
    expect(nextSort({ column: 'name', direction: 'desc' }, 'name')).toBeNull();
    expect(nextSort({ column: 'name', direction: 'desc' }, 'name', { column: 'size', direction: 'asc' })).toEqual({ column: 'size', direction: 'asc' });
    expect(nextSort({ column: 'size', direction: 'desc' }, 'name')).toEqual({ column: 'name', direction: 'asc' });
  });
});

describe('URL state', () => {
  it('reads search, filters and sort, ignoring unknown sort columns', () => {
    expect(parseTableState('?siteId=s1&q=core&type=SWITCH&sort=-size', config)).toEqual({ search: 'core', filters: { type: 'SWITCH', owner: '' }, sort: { column: 'size', direction: 'desc' } });
    expect(parseTableState('?sort=password', config).sort).toBeNull();
    expect(parseSort('none', ['name'], { column: 'name', direction: 'asc' })).toBeNull();
    expect(parseSort(null, ['name'], { column: 'name', direction: 'asc' })).toEqual({ column: 'name', direction: 'asc' });
  });

  it('keeps parameters it does not own and leaves defaults out of the URL', () => {
    const query = serializeTableState('?siteId=s1&tab=x&type=OLD', { search: 'a b&c', filters: { type: '', owner: 'g1' }, sort: { column: 'name', direction: 'asc' } }, config);
    const params = new URLSearchParams(query);
    expect(params.get('siteId')).toBe('s1');
    expect(params.get('tab')).toBe('x');
    expect(params.has('type')).toBe(false);
    expect(params.get('owner')).toBe('g1');
    expect(params.get('q')).toBe('a b&c');
    expect(params.get('sort')).toBe('name');
    expect(serializeTableState('?siteId=s1&q=x&owner=g1&sort=name', { search: '  ', filters: { type: '', owner: '' }, sort: null }, config)).toBe('?siteId=s1');
    expect(serializeTableState('', { search: '', filters: { type: '', owner: '' }, sort: null }, config)).toBe('');
  });

  it('round-trips, writes "none" only to override a default sort, and supports a prefix', () => {
    const state = { search: 'ç', filters: { type: 'ROUTER', owner: '__none__' }, sort: { column: 'size', direction: 'desc' as const } };
    expect(parseTableState(serializeTableState('', state, config), config)).toEqual(state);
    const withDefault = { ...config, defaultSort: { column: 'name', direction: 'asc' as const } };
    expect(serializeTableState('', { ...state, sort: { column: 'name', direction: 'asc' } }, withDefault)).not.toContain('sort');
    expect(new URLSearchParams(serializeTableState('', { ...state, sort: null }, withDefault)).get('sort')).toBe('none');
    const prefixed = { ...config, prefix: 'ips.' };
    const query = serializeTableState('?type=keep', state, prefixed);
    expect(new URLSearchParams(query).get('type')).toBe('keep');
    expect(new URLSearchParams(query).get('ips.type')).toBe('ROUTER');
    expect(parseTableState(query, prefixed)).toEqual(state);
  });

  it('knows when search or filters differ from the defaults', () => {
    expect(hasTableFilters({ search: ' ', filters: { type: '', owner: '' } }, config.filters)).toBe(false);
    expect(hasTableFilters({ search: '', filters: { type: 'X', owner: '' } }, config.filters)).toBe(true);
    expect(hasTableFilters({ search: 'x', filters: { type: '', owner: '' } }, config.filters)).toBe(true);
  });
});
