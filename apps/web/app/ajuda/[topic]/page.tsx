'use client';
import Link from 'next/link';
import { ArrowLeft, ArrowRight, BookOpen } from 'lucide-react';
import { useParams } from 'next/navigation';
import { AppShell } from '@/components/layout/app-shell';
import { helpArticles as articleList, helpArticle } from '@/features/help/articles';
import { useUiText } from '@/components/ui/use-ui-text';
const articles=articleList.map(({slug,title})=>[slug,title] as const);
export default function HelpTopic(){const ui=useUiText();const {topic}=useParams<{topic:string}>();const index=articles.findIndex(([slug])=>slug===topic);const item=helpArticle(topic)??{title:ui('help.notFoundTitle'),body:[ui('help.notFoundBody')]};const previous=index>0?articles[index-1]:null;const next=index>=0&&index<articles.length-1?articles[index+1]:null;return <AppShell section="Ajuda" context={[item.title]}><div className="module-page help-workspace"><div className="help-article-layout"><nav className="help-index" aria-label={ui('help.index')}>{articles.map(([slug,title])=><Link className={slug===topic?'active':''} href={`/ajuda/${slug}`} key={slug}>{title}</Link>)}</nav><section className="help-article"><Link className="text-button" href="/ajuda"><ArrowLeft size={14}/> {ui('help.back')}</Link><div className="panel-heading help-heading"><div><h1>{item.title}</h1></div><BookOpen size={18} aria-hidden="true"/></div>{item.body.map((paragraph,i)=><p key={i}>{paragraph}</p>)}<nav className="help-article-nav">{previous?<Link href={`/ajuda/${previous[0]}`}><ArrowLeft size={14}/> {previous[1]}</Link>:<span/>}{next&&<Link href={`/ajuda/${next[0]}`}>{next[1]} <ArrowRight size={14}/></Link>}</nav></section></div></div></AppShell>}
