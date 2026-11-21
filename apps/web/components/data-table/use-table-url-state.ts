'use client';

import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { hasTableFilters, parseTableState, serializeTableState, type SortState, type TableFilters, type TableState, type TableStateConfig } from './table-state';

/** Fired after this hook rewrites the URL; `popstate` covers back/forward. */
const URL_EVENT = 'cociber:table-url';

function subscribe(onChange: () => void) {
  window.addEventListener('popstate', onChange);
  window.addEventListener(URL_EVENT, onChange);
  return () => {
    window.removeEventListener('popstate', onChange);
    window.removeEventListener(URL_EVENT, onChange);
  };
}
const clientQuery = () => window.location.search;
// The server render never has table state, so hydration starts from the defaults and then reads the URL.
const serverQuery = () => '';

/**
 * Table search, filters and sort kept in the URL query string, so a filtered
 * view can be shared and the back button steps through filter changes.
 *
 * - Filter, sort and reset changes add a history entry (back undoes them).
 * - Typing in the search box replaces the current entry (no entry per keystroke).
 * - Values equal to their default are left out of the URL.
 *
 * Pass a module-level `config` constant: a new object every render re-parses the URL each time.
 */
export function useTableUrlState<F extends TableFilters>(config: TableStateConfig<F>) {
  const query = useSyncExternalStore(subscribe, clientQuery, serverQuery);
  const state = useMemo(() => parseTableState(query, config), [query, config]);

  const commit = useCallback((next: TableState<F>, mode: 'push' | 'replace') => {
    const current = window.location.search;
    const nextQuery = serializeTableState(current, next, config);
    if (nextQuery === current) return;
    // Null state lets Next.js copy its router state into the entry, so back/forward stay client-side.
    const url = `${window.location.pathname}${nextQuery}${window.location.hash}`;
    if (mode === 'push') window.history.pushState(null, '', url);
    else window.history.replaceState(null, '', url);
    window.dispatchEvent(new Event(URL_EVENT));
  }, [config]);

  // Each setter reads the URL at call time, so two quick changes never overwrite each other.
  const latest = useCallback(() => parseTableState(window.location.search, config), [config]);
  const setSearch = useCallback((search: string) => commit({ ...latest(), search }, 'replace'), [commit, latest]);
  const setFilter = useCallback(<K extends keyof F & string>(key: K, value: F[K]) => { const now = latest(); commit({ ...now, filters: { ...now.filters, [key]: value } }, 'push'); }, [commit, latest]);
  const setFilters = useCallback((filters: Partial<F>) => { const now = latest(); commit({ ...now, filters: { ...now.filters, ...filters } }, 'push'); }, [commit, latest]);
  const setSort = useCallback((sort: SortState) => commit({ ...latest(), sort }, 'push'), [commit, latest]);
  /** Clears search and filters; keeps the chosen sort. */
  const clearFilters = useCallback(() => commit({ ...latest(), search: '', filters: { ...config.filters } }, 'push'), [commit, latest, config]);

  return {
    ...state,
    filtering: hasTableFilters(state, config.filters),
    defaultSort: config.defaultSort ?? null,
    setSearch,
    setFilter,
    setFilters,
    setSort,
    clearFilters,
  };
}

export type TableUrlState<F extends TableFilters> = ReturnType<typeof useTableUrlState<F>>;
