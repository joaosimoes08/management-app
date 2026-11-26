'use client';

import { BookOpen } from 'lucide-react';
import { getBookStackLink, type BookStackContextType } from '@/lib/bookstack';
import { useUiText } from '@/components/ui/use-ui-text';

export function BookStackContextLink({ type, id }: { type: BookStackContextType; id: string }) {
  const ui = useUiText();
  const href = getBookStackLink(type, id);
  if (!href) return <small className="bookstack-unavailable">{ui('bookstack.notConfigured')}</small>;
  return <a className="bookstack-context-link" href={href} target="_blank" rel="noopener noreferrer">
    <BookOpen size={13} aria-hidden="true" /> {ui('bookstack.searchRunbooks')}
  </a>;
}
