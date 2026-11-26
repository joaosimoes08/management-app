'use client';
import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, ChevronRight, LifeBuoy } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { helpArticles } from '@/features/help/articles';
import { useUiText } from '@/components/ui/use-ui-text';
export default function HelpPage(){const ui=useUiText();const [search,setSearch]=useState('');const query=search.trim().toLowerCase();const visibleArticles=query?helpArticles.filter(({title,description})=>`${title} ${description}`.toLowerCase().includes(query)):helpArticles;return <AppShell section="Ajuda" search={{value:search,onChange:setSearch,placeholder:ui('help.searchPlaceholder'),scopeLabel:ui('help.searchScope')}}><div className="module-page help-workspace"><div className="panel-heading help-heading"><div><h1>{ui('help.title')}</h1><p className="panel-description">{ui('help.description')}</p></div><LifeBuoy size={18} aria-hidden="true"/></div><div className="help-grid">{visibleArticles.map(({slug,title,description})=><Link className="help-card" href={`/ajuda/${slug}`} key={slug}><BookOpen size={18}/><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={15}/></Link>)}</div>{!visibleArticles.length&&<div className="no-data">{ui('help.empty')}</div>}</div></AppShell>}
