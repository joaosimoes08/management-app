'use client';

import Link from 'next/link';
import { useMemo, useState } from 'react';
import { BookOpen, ChevronRight, LifeBuoy } from 'lucide-react';
import { PageShell } from '@/components/layout/app-shell';
import { useUiText } from '@/components/ui/use-ui-text';
import { helpArticles, localizedHelpArticles } from './articles';

/** /ajuda: searchable list of help articles. */
export function HelpIndexPage() {
  const ui = useUiText();
  const [search, setSearch] = useState('');
  const query = search.trim().toLowerCase();
  const articles = useMemo(() => localizedHelpArticles(ui), [ui]);
  // The search still matches the Portuguese title and description, as before.
  const matching = query ? new Set(helpArticles.filter(({ title, description }) => `${title} ${description}`.toLowerCase().includes(query)).map(({ slug }) => slug)) : null;
  const visibleArticles = matching ? articles.filter(({ slug }) => matching.has(slug)) : articles;
  return <PageShell section={ui('help.section')} search={{ value: search, onChange: setSearch, placeholder: ui('help.searchPlaceholder'), scopeLabel: ui('help.searchScope') }}>
    <div className="module-page help-workspace">
      <div className="panel-heading help-heading"><div><h1>{ui('help.title')}</h1><p className="panel-description">{ui('help.description')}</p></div><LifeBuoy size={18} aria-hidden="true" /></div>
      <div className="help-grid">{visibleArticles.map(({ slug, title, description }) => <Link className="help-card" href={`/ajuda/${slug}`} key={slug}><BookOpen size={18} /><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={15} /></Link>)}</div>
      {!visibleArticles.length && <div className="no-data">{ui('help.empty')}</div>}
    </div>
  </PageShell>;
}
