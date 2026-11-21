/**
 * Pure table state helpers: sorting and the URL query-string form of
 * search + filters + sort. No React here, so it is easy to unit test.
 */

export type SortDirection = 'asc' | 'desc';
export type SortState = { column: string; direction: SortDirection } | null;
export type SortValue = string | number | boolean | Date | null | undefined;

/** Filters are flat string values; '' means "no filter". */
export type TableFilters = Record<string, string>;

export type TableStateConfig<F extends TableFilters> = {
  /** Default (empty) value for every filter key. Keys double as URL parameter names. */
  filters: F;
  /** Column ids the URL may sort by. Unknown ids in the URL are ignored. */
  sortable: readonly string[];
  /** Sort used when the URL has none. Omitted from the URL when active. */
  defaultSort?: SortState;
  /** Prefix for every parameter, for pages with more than one table. */
  prefix?: string;
  /** Parameter name of the free-text search. Default `q`. */
  searchKey?: string;
};

export type TableState<F extends TableFilters> = { search: string; filters: F; sort: SortState };

const collator = new Intl.Collator('pt-PT', { numeric: true, sensitivity: 'base' });

const isEmpty = (value: SortValue) => value === null || value === undefined || value === '' || (typeof value === 'number' && Number.isNaN(value));

/** Compares two sort values. Empty values always sort last, whatever the direction. */
export function compareSortValues(a: SortValue, b: SortValue, direction: SortDirection = 'asc'): number {
  const aEmpty = isEmpty(a);
  const bEmpty = isEmpty(b);
  if (aEmpty || bEmpty) return aEmpty === bEmpty ? 0 : aEmpty ? 1 : -1;
  const sign = direction === 'asc' ? 1 : -1;
  const left = a instanceof Date ? a.getTime() : typeof a === 'boolean' ? Number(a) : a;
  const right = b instanceof Date ? b.getTime() : typeof b === 'boolean' ? Number(b) : b;
  if (typeof left === 'number' && typeof right === 'number') return (left - right) * sign;
  return collator.compare(String(left), String(right)) * sign;
}

/** Stable sort: rows with equal values keep their incoming order. Returns the input when there is no sort. */
export function sortRows<Row>(rows: readonly Row[], sort: SortState, valueOf: (row: Row, column: string) => SortValue): Row[] {
  if (!sort) return [...rows];
  return rows
    .map((row, index) => ({ row, index, value: valueOf(row, sort.column) }))
    .sort((a, b) => compareSortValues(a.value, b.value, sort.direction) || a.index - b.index)
    .map((item) => item.row);
}

/** Header click cycle: ascending → descending → back to the default order. */
export function nextSort(current: SortState, column: string, defaultSort: SortState = null): SortState {
  if (current?.column !== column) return { column, direction: 'asc' };
  if (current.direction === 'asc') return { column, direction: 'desc' };
  return defaultSort;
}

const sameSort = (a: SortState, b: SortState) => (a?.column ?? null) === (b?.column ?? null) && (a?.direction ?? null) === (b?.direction ?? null);

/** `name` = ascending, `-name` = descending, `none` = explicitly unsorted (only written when a default sort exists). */
export function parseSort(value: string | null, sortable: readonly string[], fallback: SortState = null): SortState {
  if (value === null) return fallback;
  if (value === 'none') return null;
  const direction: SortDirection = value.startsWith('-') ? 'desc' : 'asc';
  const column = value.replace(/^-/, '');
  return sortable.includes(column) ? { column, direction } : fallback;
}

export const formatSort = (sort: SortState) => (sort ? `${sort.direction === 'desc' ? '-' : ''}${sort.column}` : 'none');

export function parseTableState<F extends TableFilters>(query: string, config: TableStateConfig<F>): TableState<F> {
  const params = new URLSearchParams(query);
  const prefix = config.prefix ?? '';
  const filters = { ...config.filters };
  for (const key of Object.keys(config.filters) as Array<keyof F & string>) {
    const value = params.get(`${prefix}${key}`);
    if (value !== null) filters[key] = value as F[typeof key];
  }
  return {
    search: params.get(`${prefix}${config.searchKey ?? 'q'}`) ?? '',
    filters,
    sort: parseSort(params.get(`${prefix}sort`), config.sortable, config.defaultSort ?? null),
  };
}

/**
 * Writes the table state into an existing query string. Parameters the table
 * does not own (siteId, tab, …) are kept; values equal to their default are
 * removed so a fresh page has a clean URL. Returns `?…` or ''.
 */
export function serializeTableState<F extends TableFilters>(query: string, state: TableState<F>, config: TableStateConfig<F>): string {
  const params = new URLSearchParams(query);
  const prefix = config.prefix ?? '';
  const write = (key: string, value: string, fallback: string) => {
    if (value === fallback) params.delete(`${prefix}${key}`);
    else params.set(`${prefix}${key}`, value);
  };
  write(config.searchKey ?? 'q', state.search.trim() ? state.search : '', '');
  for (const key of Object.keys(config.filters)) write(key, state.filters[key] ?? '', config.filters[key]);
  const fallback = config.defaultSort ?? null;
  write('sort', sameSort(state.sort, fallback) ? '' : formatSort(state.sort), '');
  const next = params.toString();
  return next ? `?${next}` : '';
}

export const hasTableFilters = <F extends TableFilters>(state: Pick<TableState<F>, 'search' | 'filters'>, defaults: F) =>
  Boolean(state.search.trim()) || Object.keys(defaults).some((key) => (state.filters[key] ?? '') !== defaults[key]);
