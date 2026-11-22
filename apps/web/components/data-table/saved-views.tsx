'use client';

import { useEffect, useId, useState, type FormEvent } from 'react';
import { Bookmark, Link2, Trash2 } from 'lucide-react';
import { useAuth } from '@/lib/auth';
import { useOptionalToast } from '@/components/ui/toast';
import { parseTableState, serializeTableState, type TableFilters, type TableState, type TableStateConfig } from './table-state';

/**
 * Step 36 — saved views: named search/filter/sort sets for one table page,
 * kept per user in this browser (no back end). A view stores only the table's
 * own query keys, so it never carries the Site or a selected record.
 */
export type SavedView = { name: string; query: string };

const EVENT = 'cociber:saved-views';
export const SAVED_VIEWS_LIMIT = 20;
export const savedViewsKey = (userId: string | undefined, pageId: string) => `management-app:saved-views:${userId || 'local'}:${pageId}`;

/** The table's own part of the URL for a state (`?q=…&status=…`, or '' for the defaults). */
export const tableQueryOf = <F extends TableFilters>(state: TableState<F>, config: TableStateConfig<F>) => serializeTableState('', state, config);

export function readSavedViews(key: string): SavedView[] {
  try {
    const value = JSON.parse(window.localStorage.getItem(key) ?? '[]') as unknown;
    return Array.isArray(value) ? value.filter((item): item is SavedView => typeof item?.name === 'string' && typeof item?.query === 'string') : [];
  } catch { return []; }
}

/** Adds or replaces (same name, case-insensitive) a view; newest first, capped. */
export function upsertSavedView(views: SavedView[], view: SavedView): SavedView[] {
  const name = view.name.trim().slice(0, 60);
  if (!name) return views;
  return [{ name, query: view.query }, ...views.filter((item) => item.name.toLowerCase() !== name.toLowerCase())].slice(0, SAVED_VIEWS_LIMIT);
}

export const removeSavedView = (views: SavedView[], name: string) => views.filter((item) => item.name !== name);

function writeSavedViews(key: string, views: SavedView[]) {
  try { window.localStorage.setItem(key, JSON.stringify(views)); window.dispatchEvent(new Event(EVENT)); } catch { /* Saved views are optional when storage is unavailable. */ }
}

/** The signed-in user, or none outside an AuthProvider (isolated component tests); views then use a shared local list. */
function useOptionalUserId(): string | undefined {
  try { return useAuth().user?.id; } catch { return undefined; }
}

export type SavedViewsProps<F extends TableFilters> = {
  /** Stable page id, e.g. `audit`; one list per page and user. */
  pageId: string;
  config: TableStateConfig<F>;
  table: TableState<F> & { applyState: (state: TableState<F>) => void };
};

/** Toolbar control: pick a saved view, save the current one, delete it, or copy the link to share it. */
export function SavedViews<F extends TableFilters>({ pageId, config, table }: SavedViewsProps<F>) {
  const key = savedViewsKey(useOptionalUserId(), pageId);
  const inputId = useId();
  const [views, setViews] = useState<SavedView[]>([]);
  const [naming, setNaming] = useState(false);
  const [name, setName] = useState('');
  const toast = useOptionalToast();

  useEffect(() => {
    const load = () => setViews(readSavedViews(key));
    load();
    window.addEventListener(EVENT, load);
    return () => window.removeEventListener(EVENT, load);
  }, [key]);

  const current = tableQueryOf(table, config);
  const active = views.find((view) => view.query === current)?.name ?? '';

  const apply = (viewName: string) => {
    const view = views.find((item) => item.name === viewName);
    if (view) table.applyState(parseTableState(view.query, config));
  };
  const save = (event: FormEvent) => {
    event.preventDefault();
    if (!name.trim()) return;
    writeSavedViews(key, upsertSavedView(readSavedViews(key), { name, query: current }));
    setName(''); setNaming(false);
  };
  const copyLink = async () => {
    // Confirm through the app's toast (same as every other confirmation), not inline text that shifts the toolbar.
    try { await navigator.clipboard.writeText(window.location.href); toast?.success('Copiar ligação desta vista', 'Ligação copiada'); } catch { /* Clipboard unavailable: nothing was copied, so nothing to confirm. */ }
  };

  return <div className="interface-toolbar-controls saved-views" role="group" aria-label="Vistas guardadas">
    <label>Vista<select aria-label="Aplicar vista guardada" value={active} onChange={(event) => apply(event.target.value)}>
      <option value="">{views.length ? 'Vista atual' : 'Sem vistas guardadas'}</option>
      {views.map((view) => <option key={view.name} value={view.name}>{view.name}</option>)}
    </select></label>
    {naming
      ? <form className="interface-toolbar-controls" onSubmit={save}>
        <label htmlFor={inputId}>Nome da vista</label>
        <input id={inputId} autoFocus maxLength={60} value={name} onChange={(event) => setName(event.target.value)} />
        <button type="submit" className="secondary-button" disabled={!name.trim()}>Guardar</button>
        <button type="button" className="secondary-button" onClick={() => { setNaming(false); setName(''); }}>Cancelar</button>
      </form>
      : <button type="button" className="secondary-button" onClick={() => { setName(active); setNaming(true); }}><Bookmark size={14} /> Guardar vista</button>}
    {active && <button type="button" className="icon-button subtle" aria-label={`Apagar vista ${active}`} title="Apagar vista" onClick={() => writeSavedViews(key, removeSavedView(readSavedViews(key), active))}><Trash2 size={14} /></button>}
    <button type="button" className="icon-button subtle" aria-label="Copiar ligação desta vista" title="Copiar ligação desta vista" onClick={() => void copyLink()}><Link2 size={14} /></button>
  </div>;
}
