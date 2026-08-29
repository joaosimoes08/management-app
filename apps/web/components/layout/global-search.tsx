'use client';

import { useEffect, useRef, useState } from 'react';
import { ChevronRight, Loader2, Search } from 'lucide-react';
import { useRouter } from 'next/navigation';
import { apiFetch } from '@/lib/api/client';

type SearchResult = { id: string; type: string; title: string; detail: string; href: string };

export interface GlobalSearchPaletteProps {
  open: boolean;
  onClose: () => void;
}

/** Global command palette (⌘K) searching sites, devices, VLANs, subnets, IPs and apps. */
export function GlobalSearchPalette({ open, onClose }: GlobalSearchPaletteProps) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [query, setQuery] = useState('');
  const [items, setItems] = useState<SearchResult[]>([]);
  const [searching, setSearching] = useState(false);
  const [error, setError] = useState('');
  const [activeIndex, setActiveIndex] = useState(0);

  useEffect(() => {
    if (open) window.setTimeout(() => inputRef.current?.focus(), 0);
    else {
      setQuery('');
      setItems([]);
      setError('');
    }
  }, [open]);

  useEffect(() => {
    const value = query.trim();
    if (!open || value.length < 2) {
      setItems([]);
      setSearching(false);
      return;
    }
    const controller = new AbortController();
    const timer = window.setTimeout(() => {
      setSearching(true);
      setError('');
      void apiFetch<{ items: SearchResult[] }>(`/api/v1/dashboard/search?q=${encodeURIComponent(value)}&limit=8`, { signal: controller.signal })
        .then((result) => {
          setItems(result.items);
          setActiveIndex(0);
        })
        .catch((cause) => {
          if ((cause as Error).name !== 'AbortError') {
            setItems([]);
            setError('Não foi possível pesquisar.');
          }
        })
        .finally(() => setSearching(false));
    }, 250);
    return () => {
      window.clearTimeout(timer);
      controller.abort();
    };
  }, [open, query]);

  const activate = (item: SearchResult | undefined) => {
    if (!item) return;
    onClose();
    if (/^https?:\/\//.test(item.href)) window.open(item.href, '_blank', 'noopener,noreferrer');
    else router.push(item.href);
  };

  if (!open) return null;

  return <div className="command-backdrop" role="presentation" onMouseDown={onClose}><section className="command-palette" role="dialog" aria-modal="true" aria-label="Pesquisa global" onMouseDown={(event) => event.stopPropagation()}><div className="command-input"><Search size={18} /><input ref={inputRef} value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Pesquisar sites, equipamentos, VLANs, subnets, IPs ou aplicações…" aria-label="Pesquisa global" onKeyDown={(event) => {
    if (event.key === 'ArrowDown') {
      event.preventDefault();
      setActiveIndex((index) => Math.min(index + 1, items.length - 1));
    }
    if (event.key === 'ArrowUp') {
      event.preventDefault();
      setActiveIndex((index) => Math.max(index - 1, 0));
    }
    if (event.key === 'Enter') {
      event.preventDefault();
      activate(items[activeIndex]);
    }
    if (event.key === 'Escape') onClose();
  }} /><kbd>ESC</kbd></div><div className="command-results" role="listbox">{searching ? <div className="command-empty"><Loader2 className="spin" size={16} /> A pesquisar…</div> : error ? <div className="command-empty error">{error}</div> : query.trim().length < 2 ? <div className="command-empty">Escreve pelo menos dois caracteres.</div> : items.length ? items.map((item, index) => <button key={`${item.type}-${item.id}`} className={index === activeIndex ? 'active' : ''} role="option" aria-selected={index === activeIndex} onMouseEnter={() => setActiveIndex(index)} onClick={() => activate(item)}><span className="command-result-icon"><Search size={14} /></span><span><strong>{item.title}</strong><small>{item.detail}</small></span><ChevronRight size={14} /></button>) : <div className="command-empty">Sem resultados para “{query.trim()}”.</div>}</div></section></div>;
}
