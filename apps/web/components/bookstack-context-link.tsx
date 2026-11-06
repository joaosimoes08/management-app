'use client';

import { BookOpen } from 'lucide-react';
import { getBookStackLink, type BookStackContextType } from '@/lib/bookstack';

export function BookStackContextLink({ type, id }: { type: BookStackContextType; id: string }) {
  const href = getBookStackLink(type, id);
  if (!href) return <small className="bookstack-unavailable">BookStack não configurado</small>;
  return <a className="bookstack-context-link" href={href} target="_blank" rel="noopener noreferrer">
    <BookOpen size={13} aria-hidden="true" /> Pesquisar runbooks
  </a>;
}
