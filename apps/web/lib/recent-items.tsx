'use client';

import { useEffect, useState } from 'react';
import { useUiText } from '@/components/ui/use-ui-text';
import { isAppPath, isFiniteNumber, isRecord, isString, parseJson } from '@/lib/data-guards';

export type RecentItem = { id: string; label: string; href: string; kind: string; visitedAt: number };
const storageKey = (userId: string) => `management-app:recent-items:${userId}`;

/** Stored recent items, keeping only well-formed in-app entries; anything else in storage reads as an empty list. */
export function parseRecentItems(raw: string | null): RecentItem[] {
  const value = parseJson(raw);
  if (!Array.isArray(value)) return [];
  return value.flatMap((entry): RecentItem[] => isRecord(entry) && isString(entry.id) && isString(entry.label) && isString(entry.kind) && isAppPath(entry.href)
    ? [{ id: entry.id, label: entry.label, kind: entry.kind, href: entry.href, visitedAt: isFiniteNumber(entry.visitedAt) ? entry.visitedAt : 0 }]
    : []);
}

export function rememberRecentItem(userId: string | undefined, item: Omit<RecentItem, 'visitedAt'>) {
  if (!userId || typeof window === 'undefined') return;
  try {
    const key = storageKey(userId);
    const existing = parseRecentItems(window.localStorage.getItem(key));
    const next = [{ ...item, visitedAt: Date.now() }, ...existing.filter((entry) => entry.id !== item.id)].slice(0, 6);
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event('management-app:recent-items'));
  } catch { /* Recent history is optional when browser storage is unavailable. */ }
}

// Stored kinds are labels saved in earlier visits; 'Equipamento' is shown in the active language.
const recentKindKeys: Record<string, string> = { Equipamento: 'shell.recentItems.kind.device' };
const recentKindLabel = (ui: ReturnType<typeof useUiText>, kind: string) => (Object.hasOwn(recentKindKeys, kind) ? ui(recentKindKeys[kind], kind) : kind);

export function RecentItems({ userId }: { userId: string | undefined }) {
  const ui = useUiText();
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    const load = () => {
      if (!userId) { setItems([]); return; }
      try { setItems(parseRecentItems(window.localStorage.getItem(storageKey(userId)))); }
      catch { setItems([]); }
    };
    load(); window.addEventListener('management-app:recent-items', load);
    return () => window.removeEventListener('management-app:recent-items', load);
  }, [userId]);
  if (!items.length) return null;
  return <section className="recent-items" aria-label={ui('recentItems.label')}><h2>{ui('recentItems.title')}</h2><ul>{items.map((item) => <li key={`${item.kind}:${item.id}`}><a href={item.href}><small>{recentKindLabel(ui, item.kind)}</small><span>{item.label}</span></a></li>)}</ul></section>;
}
