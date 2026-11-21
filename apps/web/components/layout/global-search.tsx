'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, ClipboardCheck, GitPullRequestArrow, History, Loader2, Search, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';

type SearchResult = { id: string; type: string; title: string; detail: string; href: string; actionHref?: string };

/** Search params for the palette. `types=all` adds change plans, audit events and quality findings (PR #85). */
export const globalSearchPath = (query: string, types?: 'all') => `/api/v1/dashboard/search?q=${encodeURIComponent(query)}&limit=8${types ? `&types=${types}` : ''}`;
/** An API without the extended types answers 400 SEARCH_TYPES_INVALID; the palette then retries with the default types. */
export const isSearchTypesInvalid = (cause: unknown) => {
  const error = cause as { status?: number; code?: string; payload?: { code?: string } } | null;
  return error?.status === 400 && (error.code ?? error.payload?.code) === 'SEARCH_TYPES_INVALID';
};
/** A quality finding with a fix page gets a second entry that opens it directly. */
export const expandSearchResults = (items: SearchResult[]): SearchResult[] => items.flatMap((item) => item.type === 'QUALITY_FINDING' && item.actionHref && item.actionHref !== item.href
  ? [item, { id: `${item.id}-action`, type: 'QUALITY_FINDING_ACTION', title: `Corrigir: ${item.title}`, detail: 'Qualidade · abrir a página de correção', href: item.actionHref }]
  : [item]);
const resultIcons: Record<string, typeof Search> = { CHANGE_PLAN: GitPullRequestArrow, AUDIT_EVENT: History, QUALITY_FINDING: ClipboardCheck, QUALITY_FINDING_ACTION: Wrench };
export type RackSearchItem = { id: string; name: string; roomId?: string; room?: { id: string; building?: { id: string } }; devices?: { name: string }[] };
export type RackSearchContext = { racks: RackSearchItem[]; value: string; onChange: (value: string) => void; hrefForRack: (rack: RackSearchItem) => string };
export type LocalSearchContext = { value: string; onChange: (value: string) => void; placeholder: string; ariaLabel?: string; scopeLabel?: string };

export function filterRackSearchItems<T extends RackSearchItem>(racks: T[], query: string): T[] {
  const value = query.trim().toLowerCase();
  if (!value) return racks;
  return racks.filter((rack) => `${rack.name} ${(rack.devices ?? []).map((device) => device.name).join(' ')}`.toLowerCase().includes(value));
}

export interface GlobalSearchPaletteProps {
  open: boolean;
  onClose: () => void;
  rackSearch?: RackSearchContext;
  localSearch?: LocalSearchContext;
}

/** Global command palette for platform records and, when provided, local rack inventory. */
export function GlobalSearchPalette({ open, onClose, rackSearch, localSearch }: GlobalSearchPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [scope, setScope] = useState<'platform' | 'local'>('platform');

  useEffect(() => {
    if (open) {
      setScope(rackSearch || localSearch ? 'local' : 'platform');
      setQuery(rackSearch?.value ?? localSearch?.value ?? '');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
      setItems([]);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (scope === 'local' || !open || value.length < 2) {
      setItems([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError('');
      const search = (types?: 'all') => apiFetch<{ items: SearchResult[] }>(globalSearchPath(value, types), { signal: controller.signal });
      void search('all')
        .catch((cause) => { if (isSearchTypesInvalid(cause)) return search(); throw cause; })
        .then((result) => { setItems(expandSearchResults(result.items)); setActiveIndex(0); })
        .catch((cause) => {
          if ((cause as Error).name !== 'AbortError') { setItems([]); setError('Não foi possível pesquisar.'); }
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => { window.clearTimeout(timer); controller.abort(); };
  }, [open, query, scope]);

  const results: SearchResult[] = scope === 'local' && rackSearch
    ? filterRackSearchItems(rackSearch.racks, query).map((rack) => ({ id: rack.id, type: 'rack', title: rack.name, detail: `${rack.devices?.length ?? 0} equipamentos`, href: rackSearch.hrefForRack(rack) }))
    : items;

  const activate = (item: SearchResult | undefined) => {
    if (!item) return;
    handleClose();
    if (/^https?:\/\//.test(item.href)) window.open(item.href, '_blank', 'noopener,noreferrer');
    else router.push(item.href);
  };
  const localValue = rackSearch?.value ?? localSearch?.value ?? '';
  const localLabel = rackSearch ? 'Bastidores deste site' : localSearch?.scopeLabel ?? 'Este separador';
  const changeLocalQuery = (value: string) => {
    if (rackSearch) rackSearch.onChange(value);
    else localSearch?.onChange(value);
  };
  const handleClose = () => { if (scope === 'local' && rackSearch) rackSearch.onChange(''); onClose(); };

  if (!open) return null;

  return <div className="command-backdrop" role="presentation" onMouseDown={handleClose}>
    <section className="command-palette" role="dialog" aria-modal="true" aria-label="Pesquisa global" onMouseDown={(event) => event.stopPropagation()}>
      {(rackSearch || localSearch) && <div className="global-search-scopes" role="group" aria-label="Âmbito da pesquisa">
        <button type="button" aria-pressed={scope === 'local'} onClick={() => { setScope('local'); setQuery(localValue); setActiveIndex(0); }}>{localLabel}</button>
        <button type="button" aria-pressed={scope === 'platform'} onClick={() => { if (scope === 'local') changeLocalQuery(''); setScope('platform'); setActiveIndex(0); }}>Toda a plataforma</button>
      </div>}
      <div className="command-input">
        <Search size={18} />
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); if (scope === 'local') changeLocalQuery(event.target.value); }} placeholder={scope === 'local' ? rackSearch ? 'Pesquisar bastidores ou equipamentos deste site…' : localSearch?.placeholder ?? 'Pesquisar neste separador…' : 'Pesquisar sites, equipamentos, IPs, aplicações, alterações, auditoria ou qualidade…'} aria-label={scope === 'local' ? rackSearch ? 'Pesquisar bastidores ou equipamentos deste site' : localSearch?.ariaLabel ?? localSearch?.placeholder ?? 'Pesquisar neste separador' : 'Pesquisa global'} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
          if (event.key === 'Enter') { event.preventDefault(); activate(results[activeIndex]); }
          if (event.key === 'Escape') handleClose();
        }} />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" role="listbox">
        {scope === 'local' && !rackSearch ? query.trim().length < 2 ? <div className="command-empty">A pesquisa filtra {localLabel.toLocaleLowerCase()} enquanto escreves.</div> : <div className="command-empty">A filtrar {localLabel.toLocaleLowerCase()}.</div>
          : scope === 'platform' && searching ? <div className="command-empty"><Loader2 className="spin" size={16} /> A pesquisar…</div>
          : scope === 'platform' && error ? <div className="command-empty error">{error}</div>
            : query.trim().length < 2 ? <div className="command-empty">Escreve pelo menos dois caracteres.</div>
              : results.length ? results.map((item, index) => <button key={`${item.type}-${item.id}`} className={index === activeIndex ? 'active' : ''} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(item)}><span className="command-result-icon"><ResultIcon type={item.type} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={14} /></button>)
                : <div className="command-empty">Sem resultados para “{query.trim()}”.</div>}
      </div>
    </section>
  </div>;
}

function ResultIcon({ type }: { type: string }) {
  const Icon = resultIcons[type] ?? Search;
  return <Icon size={14} />;
}
