'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { useEffect, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, ClipboardCheck, GitPullRequestArrow, History, Loader2, Search, Wrench } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { dashboardKeys, searchPlatform, type GlobalSearchResult } from '@/features/dashboard/api';
import { entityHref } from '@/lib/routes';
import { portugueseText, useUiText, type UiText } from '@/components/ui/use-ui-text';
import { localizeServerText } from '@/lib/i18n/server-text';

type SearchResult = GlobalSearchResult;

export { globalSearchPath, isSearchTypesInvalid } from '@/features/dashboard/api';
/** Devices open on their Device 360 page (Step 29); the Site comes from the API's href. */
const siteIdFromHref = (href: string) => { try { return new URL(href, 'http://local').searchParams.get('siteId'); } catch { return null; } };
export const withDevicePage = (item: SearchResult): SearchResult => item.type === 'DEVICE' ? { ...item, href: entityHref({ kind: 'device', id: item.id, siteId: siteIdFromHref(item.href) }) } : item;
/** A quality finding with a fix page gets a second entry that opens it directly. */
export const expandSearchResults = (items: SearchResult[], text: UiText = portugueseText): SearchResult[] => items.map(withDevicePage).flatMap((item) => item.type === 'QUALITY_FINDING' && item.actionHref && item.actionHref !== item.href
  ? [item, { id: `${item.id}-action`, type: 'QUALITY_FINDING_ACTION', title: text('shell.search.fixTitle', undefined, { title: localizeServerText(text, item.title) }), detail: text('shell.search.fixDetail'), href: item.actionHref }]
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
  const ui = useUiText();
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  // The platform search runs 250 ms after the last keystroke, for 2+ characters; `term` is that settled text.
  const [term, setTerm] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);
  const [scope, setScope] = useState<'platform' | 'local'>('platform');

  useEffect(() => {
    if (open) {
      setScope(rackSearch || localSearch ? 'local' : 'platform');
      setQuery(rackSearch?.value ?? localSearch?.value ?? '');
      window.setTimeout(() => inputRef.current?.focus(), 0);
    } else {
      setQuery('');
    }
  }, [open]);

  const queryClient = useQueryClient();
  useEffect(() => {
    const value = query.trim();
    // Each keystroke drops the search in flight, as the palette always did.
    void queryClient.cancelQueries({ queryKey: dashboardKeys.searchAll });
    if (scope === 'local' || !open || value.length < 2) { setTerm(''); return; }
    const timer = window.setTimeout(() => setTerm(value), 250);
    return () => window.clearTimeout(timer);
  }, [open, query, scope, queryClient]);
  const platformSearch = scope !== 'local' && open && term.length >= 2;
  // Fresh on every search and never kept once the palette moves on (gcTime 0); no retry, as before.
  const search = useQuery({ queryKey: dashboardKeys.search(term), queryFn: ({ signal }) => searchPlatform(term, signal), enabled: platformSearch, retry: false, staleTime: 0, gcTime: 0, refetchOnReconnect: false });
  const items: SearchResult[] = platformSearch && search.data ? expandSearchResults(search.data.items, ui) : [];
  const searching = platformSearch && search.isFetching;
  const failed = platformSearch && search.isError;
  // New results start with the first one selected.
  const [seenResults, setSeenResults] = useState(0);
  if (search.data && search.dataUpdatedAt !== seenResults) { setSeenResults(search.dataUpdatedAt); setActiveIndex(0); }

  const results: SearchResult[] = scope === 'local' && rackSearch
    ? filterRackSearchItems(rackSearch.racks, query).map((rack) => ({ id: rack.id, type: 'rack', title: rack.name, detail: ui('globalSearch.rackDevices', undefined, { count: rack.devices?.length ?? 0 }), href: rackSearch.hrefForRack(rack) }))
    : items;

  const activate = (item: SearchResult | undefined) => {
    if (!item) return;
    handleClose();
    if (/^https?:\/\//.test(item.href)) window.open(item.href, '_blank', 'noopener,noreferrer');
    else router.push(item.href);
  };
  const localValue = rackSearch?.value ?? localSearch?.value ?? '';
  const localLabel = rackSearch ? ui('globalSearch.racksScope') : localSearch?.scopeLabel ?? ui('globalSearch.thisTab');
  const changeLocalQuery = (value: string) => {
    if (rackSearch) rackSearch.onChange(value);
    else localSearch?.onChange(value);
  };
  const handleClose = () => { if (scope === 'local' && rackSearch) rackSearch.onChange(''); onClose(); };

  useEscapeClose(handleClose, open);
  const dialogRef = useDialogFocusRef<HTMLElement>(open);
  if (!open) return null;

  return <div className="command-backdrop" role="presentation" onMouseDown={handleClose}>
    <section ref={dialogRef} className="command-palette" role="dialog" aria-modal="true" aria-label={ui('globalSearch.label')} onMouseDown={(event) => event.stopPropagation()}>
      {(rackSearch || localSearch) && <div className="global-search-scopes" role="group" aria-label={ui('globalSearch.scope')}>
        <button type="button" aria-pressed={scope === 'local'} onClick={() => { setScope('local'); setQuery(localValue); setActiveIndex(0); }}>{localLabel}</button>
        <button type="button" aria-pressed={scope === 'platform'} onClick={() => { if (scope === 'local') changeLocalQuery(''); setScope('platform'); setActiveIndex(0); }}>{ui('globalSearch.platform')}</button>
      </div>}
      <div className="command-input">
        <Search size={18} />
        <input ref={inputRef} value={query} onChange={(event) => { setQuery(event.target.value); if (scope === 'local') changeLocalQuery(event.target.value); }} placeholder={scope === 'local' ? rackSearch ? ui('globalSearch.racksPlaceholder') : localSearch?.placeholder ?? ui('globalSearch.thisTabPlaceholder') : ui('globalSearch.platformPlaceholder')} aria-label={scope === 'local' ? rackSearch ? ui('globalSearch.racksLabel') : localSearch?.ariaLabel ?? localSearch?.placeholder ?? ui('globalSearch.thisTabLabel') : ui('globalSearch.label')} onKeyDown={(event) => {
          if (event.key === 'ArrowDown') { event.preventDefault(); setActiveIndex((index) => Math.min(index + 1, results.length - 1)); }
          if (event.key === 'ArrowUp') { event.preventDefault(); setActiveIndex((index) => Math.max(index - 1, 0)); }
          if (event.key === 'Enter') { event.preventDefault(); activate(results[activeIndex]); }
        }} />
        <kbd>ESC</kbd>
      </div>
      <div className="command-results" role="listbox">
        {scope === 'local' && !rackSearch ? query.trim().length < 2 ? <div className="command-empty">{ui('globalSearch.localHint', undefined, { scope: localLabel.toLocaleLowerCase() })}</div> : <div className="command-empty">{ui('globalSearch.localFiltering', undefined, { scope: localLabel.toLocaleLowerCase() })}</div>
          : scope === 'platform' && searching ? <div className="command-empty"><Loader2 className="spin" size={16} /> {ui('globalSearch.searching')}</div>
          : scope === 'platform' && failed ? <div className="command-empty error">{ui('globalSearch.error')}</div>
            : query.trim().length < 2 ? <div className="command-empty">{ui('globalSearch.minChars')}</div>
              : results.length ? results.map((item, index) => <button key={`${item.type}-${item.id}`} className={index === activeIndex ? 'active' : ''} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(item)}><span className="command-result-icon"><ResultIcon type={item.type} /></span><span><strong>{localizeServerText(ui, item.title)}</strong><small>{localizeServerText(ui, item.detail)}</small></span><ChevronRight size={14} /></button>)
                : <div className="command-empty">{ui('globalSearch.noResults', undefined, { query: query.trim() })}</div>}
      </div>
    </section>
  </div>;
}

function ResultIcon({ type }: { type: string }) {
  const Icon = resultIcons[type] ?? Search;
  return <Icon size={14} />;
}
