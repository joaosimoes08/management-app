'use client';

import Link from 'next/link';
import { useMemo } from 'react';
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react';
import { PageShell } from '@/components/layout/app-shell';
import { useUiText } from '@/components/ui/use-ui-text';
import { localizedHelpArticles } from './articles';

/** /ajuda/[topic]: one help article with the article index and previous/next links. */
export function HelpArticlePage({ topic }: { topic: string }) {
  const ui = useUiText();
  const localized = useMemo(() => localizedHelpArticles(ui), [ui]);
  const articles = localized.map(({ slug, title }) => [slug, title] as const);
  const index = articles.findIndex(([slug]) => slug === topic);
  const item = localized.find((article) => article.slug === topic) ?? { title: ui('help.notFoundTitle'), body: [ui('help.notFoundBody')] };
  const previous = index > 0 ? articles[index - 1] : null;
  const next = index >= 0 && index < articles.length - 1 ? articles[index + 1] : null;
  return <PageShell section={ui('help.section')} context={[item.title]}>
    <div className="module-page help-workspace"><div className="help-article-layout">
      <nav className="help-index" aria-label={ui('help.index')}>{articles.map(([slug, title]) => <Link className={slug === topic ? 'active' : ''} href={`/ajuda/${slug}`} key={slug}>{title}</Link>)}</nav>
      <section className="help-article">
        <Link className="text-button" href="/ajuda"><ArrowLeft size={14} /> {ui('help.back')}</Link>
        <div className="panel-heading help-heading"><div><h1>{item.title}</h1></div><BookOpen size={18} aria-hidden="true" /></div>
        {item.body.map((paragraph, i) => <p key={i}>{paragraph}</p>)}
        <nav className="help-article-nav">{previous ? <Link href={`/ajuda/${previous[0]}`}><ArrowLeft size={14} /> {previous[1]}</Link> : <span />}{next && <Link href={`/ajuda/${next[0]}`}>{next[1]} <ArrowRight size={14} /></Link>}</nav>
      </section>
    </div></div>
  </PageShell>;
}
