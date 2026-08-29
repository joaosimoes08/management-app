'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useI18n } from '@/lib/i18n';
import { listAuditEvents } from './api';

export default function AuditPage() {
  const [search, setSearch] = useState('');
  const { formatDate } = useI18n();
  const { data: events = [], error, refetch, isFetching } = useQuery({ queryKey: ['audit', 'events'], queryFn: listAuditEvents });
  const load = () => void refetch();
  const errorMessage = error instanceof Error ? error.message : '';
  const query = search.trim().toLowerCase(); const visibleEvents = query ? events.filter((event) => `${event.action} ${event.entityType ?? ''} ${event.entityId ?? ''} ${event.user?.displayName ?? ''} ${event.user?.username ?? ''}`.toLowerCase().includes(query)) : events;
  return <AppShell section="Auditoria" search={{ value: search, onChange: setSearch, placeholder: 'Pesquisar eventos…' }} actions={<button className="topbar-action secondary-button" onClick={load}><RefreshCw size={14} /> Atualizar</button>}><main className="module-page"><div className="module-hero"><div className="module-icon"><ShieldCheck size={24} /></div><span className="section-kicker">CONTROLO E RASTREABILIDADE</span><h1>Auditoria</h1><p>Eventos administrativos, alterações de inventário e execuções de discovery.</p></div>{errorMessage ? <div className="ipam-alert error">{errorMessage}</div> : <section className="audit-table panel"><div className="panel-heading"><div><span className="section-kicker">EVENTOS RECENTES</span><h2>{visibleEvents.length} eventos</h2></div><Activity size={18} /></div>{visibleEvents.length ? <div className="audit-list">{visibleEvents.map((event) => <div className="audit-row" key={event.id}><span className="activity-icon dark"><ShieldCheck size={15} /></span><span><strong>{event.action}</strong><small>{event.entityType ?? 'Sistema'}{event.entityId ? ` · ${event.entityId}` : ''}</small></span><span className="audit-user">{event.user?.displayName ?? event.user?.username ?? 'sistema'}<small>{formatDate(event.createdAt)}</small></span></div>)}</div> : <div className="no-data">{search ? 'Sem eventos correspondentes.' : 'Ainda não existem eventos de auditoria.'}</div>}</section>}</main></AppShell>;
}
