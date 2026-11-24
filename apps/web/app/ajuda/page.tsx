'use client';
import Link from 'next/link';
import { useState } from 'react';
import { BookOpen, ChevronRight, LifeBuoy } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { helpArticles } from '@/features/help/articles';
export default function HelpPage(){const [search,setSearch]=useState('');const query=search.trim().toLowerCase();const visibleArticles=query?helpArticles.filter(({title,description})=>`${title} ${description}`.toLowerCase().includes(query)):helpArticles;return <AppShell section="Ajuda" search={{value:search,onChange:setSearch,placeholder:'Pesquisar documentação…',scopeLabel:'Documentação'}}><div className="module-page help-workspace"><div className="panel-heading help-heading"><div><h1>Ajuda e suporte</h1><p className="panel-description">Guias práticos para instalar, operar e diagnosticar o COCiber Management.</p></div><LifeBuoy size={18} aria-hidden="true"/></div><div className="help-grid">{visibleArticles.map(({slug,title,description})=><Link className="help-card" href={`/ajuda/${slug}`} key={slug}><BookOpen size={18}/><span><strong>{title}</strong><small>{description}</small></span><ChevronRight size={15}/></Link>)}</div>{!visibleArticles.length&&<div className="no-data">Sem artigos correspondentes. Experimenta outra pesquisa.</div>}</div></AppShell>}
