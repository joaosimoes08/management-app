'use client';

import { useEffect, useState } from 'react';
import { Activity, ShieldCheck } from 'lucide-react';
import { AppShell } from '../../components/app-shell';
import { useAuth } from '../../lib/auth';

type AuditEvent = { id: string; action: string; entityType?: string | null; entityId?: string | null; createdAt: string; user?: { username: string; displayName?: string | null } | null };
export default function AuditPage() {
  const { apiFetch } = useAuth(); const [events, setEvents] = useState<AuditEvent[]>([]); const [error, setError] = useState('');
  useEffect(() => { void apiFetch<AuditEvent[]>('/api/v1/audit/events?limit=100').then(setEvents).catch((reason) => setError(reason instanceof Error ? reason.message : 'Não foi possível carregar a auditoria.')); }, [apiFetch]);
  return <AppShell section="Auditoria"><main className="module-page"><div className="module-hero"><div className="module-icon"><ShieldCheck size={24} /></div><span className="section-kicker">CONTROLO E RASTREABILIDADE</span><h1>Auditoria</h1><p>Eventos administrativos, alterações de inventário e execuções de discovery.</p></div>{error ? <div className="ipam-alert error">{error}</div> : <section className="audit-table panel"><div className="panel-heading"><div><span className="section-kicker">EVENTOS RECENTES</span><h2>{events.length} eventos</h2></div><Activity size={18} /></div>{events.length ? <div className="audit-list">{events.map((event) => <div className="audit-row" key={event.id}><span className="activity-icon dark"><ShieldCheck size={15} /></span><span><strong>{event.action}</strong><small>{event.entityType ?? 'Sistema'}{event.entityId ? ` · ${event.entityId}` : ''}</small></span><span className="audit-user">{event.user?.displayName ?? event.user?.username ?? 'sistema'}<small>{new Date(event.createdAt).toLocaleString('pt-PT')}</small></span></div>)}</div> : <div className="no-data">Ainda não existem eventos de auditoria.</div>}</section>}</main></AppShell>;
}
