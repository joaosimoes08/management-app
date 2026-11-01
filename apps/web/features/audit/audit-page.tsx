'use client';

import { useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { Activity, RefreshCw, ShieldCheck } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useI18n } from '@/lib/i18n';
import { listAuditEvents, type AuditFilters } from './api';

export default function AuditPage() {
  const [filters, setFilters] = useState<AuditFilters>({});
  const { formatDate, t } = useI18n();
  const { data: events = [], error, refetch, isFetching } = useQuery({ queryKey: ['audit', 'events', filters], queryFn: () => listAuditEvents(filters) });
  const load = () => void refetch();
  const errorMessage = error instanceof Error ? error.message : '';
  const change = (key: keyof AuditFilters, value: string) => setFilters((current) => ({ ...current, [key]: value }));
  return <AppShell section="Auditoria" search={{ value: filters.search ?? '', onChange: (value) => change('search', value), placeholder: 'Pesquisar eventos…' }} actions={<button className="topbar-action secondary-button" onClick={load} disabled={isFetching}><RefreshCw size={14} /> Atualizar</button>}><main className="module-page"><div className="module-hero"><div className="module-icon"><ShieldCheck size={24} /></div><span className="section-kicker">CONTROLO E RASTREABILIDADE</span><h1>Auditoria</h1><p>Eventos administrativos, alterações de inventário e execuções de discovery.</p></div>{errorMessage ? <div className="ipam-alert error">{errorMessage}</div> : <section className="audit-table panel"><div className="panel-heading"><div><span className="section-kicker">EVENTOS RECENTES</span><h2>{events.length} eventos</h2></div><Activity size={18} /></div><div className="audit-filters"><label>Ação<input value={filters.action ?? ''} onChange={(event) => change('action', event.target.value)} placeholder="Ex.: USER_UPDATED" /></label><label>Tipo de entidade<input value={filters.entityType ?? ''} onChange={(event) => change('entityType', event.target.value)} placeholder="Ex.: Device" /></label><label>Utilizador<input value={filters.user ?? ''} onChange={(event) => change('user', event.target.value)} placeholder={t('audit.userFilterPlaceholder')} /></label><label>Desde<input type="date" value={filters.from?.slice(0, 10) ?? ''} onChange={(event) => change('from', event.target.value ? `${event.target.value}T00:00:00.000Z` : '')} /></label><label>Até<input type="date" value={filters.to?.slice(0, 10) ?? ''} onChange={(event) => change('to', event.target.value ? `${event.target.value}T23:59:59.999Z` : '')} /></label></div>{events.length ? <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.id}><span className="activity-icon dark"><ShieldCheck size={15} /></span><span><strong>{event.action}</strong><small>{event.entityType ?? 'Sistema'}{event.entityId ? ` · ${event.entityId}` : ''}</small></span><span className="audit-user">{event.user?.displayName ?? event.user?.username ?? 'sistema'}<small>{formatDate(event.createdAt)}</small></span></div>)}</div> : <div className="no-data">{Object.values(filters).some(Boolean) ? 'Sem eventos correspondentes.' : 'Ainda não existem eventos de auditoria.'}</div>}</section>}</main></AppShell>;
}
