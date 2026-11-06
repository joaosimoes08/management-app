'use client';

import { useEffect, useState } from 'react';

type RecentItem = { id: string; label: string; href: string; kind: string; visitedAt: number };
const storageKey = (userId: string) => `management-app:recent-items:${userId}`;

export function rememberRecentItem(userId: string | undefined, item: Omit<RecentItem, 'visitedAt'>) {
  if (!userId || typeof window === 'undefined') return;
  try {
    const key = storageKey(userId);
    const existing = JSON.parse(window.localStorage.getItem(key) ?? '[]') as RecentItem[];
    const next = [{ ...item, visitedAt: Date.now() }, ...existing.filter((entry) => entry.id !== item.id)].slice(0, 6);
    window.localStorage.setItem(key, JSON.stringify(next));
    window.dispatchEvent(new Event('management-app:recent-items'));
  } catch { /* Recent history is optional when browser storage is unavailable. */ }
}

export function RecentItems({ userId }: { userId: string | undefined }) {
  const [items, setItems] = useState<RecentItem[]>([]);
  useEffect(() => {
    const load = () => {
      if (!userId) { setItems([]); return; }
      try { setItems(JSON.parse(window.localStorage.getItem(storageKey(userId)) ?? '[]') as RecentItem[]); }
      catch { setItems([]); }
    };
    load(); window.addEventListener('management-app:recent-items', load);
    return () => window.removeEventListener('management-app:recent-items', load);
  }, [userId]);
  if (!items.length) return null;
  return <section className="recent-items" aria-label="Registos vistos recentemente"><h2>Vistos recentemente</h2><ul>{items.map((item) => <li key={`${item.kind}:${item.id}`}><a href={item.href}><small>{item.kind}</small><span>{item.label}</span></a></li>)}</ul></section>;
}
