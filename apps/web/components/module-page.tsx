'use client';

import { ArrowUpRight, Boxes, CheckCircle2, CircleHelp, Construction, ExternalLink, Network, Search, Settings, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';

const icons = { infrastructure: Boxes, discovery: Search, settings: Settings, help: CircleHelp };
export function ModulePage({ kind, title, eyebrow, description, children }: { kind: keyof typeof icons; title: string; eyebrow: string; description: string; children?: React.ReactNode }) {
  const Icon = icons[kind];
  return <AppShell section={title}><main className="module-page"><div className="module-hero"><div className="module-icon"><Icon size={24} /></div><span className="section-kicker">{eyebrow}</span><h1>{title}</h1><p>{description}</p></div>{children}</main></AppShell>;
}

export function RoadmapCard({ title, description, href, label }: { title: string; description: string; href?: string; label?: string }) {
  return <article className="roadmap-card"><div className="roadmap-card-icon"><Construction size={17} /></div><div><h2>{title}</h2><p>{description}</p>{href && <a href={href}>{label ?? 'Abrir módulo'} <ArrowUpRight size={14} /></a>}</div></article>;
}
