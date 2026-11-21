'use client';

import { useEffect, type ReactNode } from 'react';
import { useQuery } from '@tanstack/react-query';
import { ExternalLink, Pencil, Plus, Server } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { deviceEditHref, entityHref } from '@/components/data-table/entity-link';
import { rememberRecentItem } from '@/lib/recent-items';
import { apiFetch } from '@/lib/api/client';
import { useAuth } from '@/lib/auth';
import { getDevice, listDeviceIpAddresses, listInterfaces } from '../api';
import type { Device } from '../types';
import { assetFileUrl } from '../utils';

/**
 * Step 29 — read-first Device 360 page.
 *
 * Every section loads on its own from an existing endpoint, so one slow or
 * forbidden source never blanks the page. A section the user's roles cannot
 * read is not rendered at all (same role lists as the API controllers).
 * "Host e serviços" (Step 26) and the criticality tier (Step 28b) are
 * feature-detected on the device payload and show an explicit empty state
 * until those land.
 */

const ROLES = {
  interfaces: ['ADMIN', 'NETWORK_OPERATOR'],
  snmp: ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'],
  attestation: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR'],
  changes: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'],
  changeCreate: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'],
  audit: ['ADMIN', 'AUDITOR'],
  edit: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'],
} as const;

const CLOSED_CHANGE = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'CLOSED', 'IMPLEMENTED']);

type Connection = { id: string; type?: string; label?: string | null; sourceDeviceId: string; targetDeviceId: string; sourceDevice?: { id: string; name: string } | null; targetDevice?: { id: string; name: string } | null; sourceInterface?: { name: string } | null; targetInterface?: { name: string } | null };
type SnmpOverview = { config?: { enabled?: boolean } | null; latestSnapshot?: { collectedAt?: string; createdAt?: string; status?: string } | null; drifts?: Array<{ id: string; status?: string }>; traps?: Array<{ id: string }> };
type LifecycleDate = { id: string; deviceId: string; kind: string; dueDate: string };
type ChangeItem = { entityType: string; entityId: string };
type ChangePlan = { id: string; title: string; status: string; plannedStartAt: string; items?: ChangeItem[] };
type CriticalAsset = { id: string; latestOutcome?: string | null; latestConfirmedAt?: string | null; dueState?: string; dueDate?: string | null };
type AuditEvent = { id: string; action: string; createdAt: string; user?: { username: string; displayName?: string | null } | null; actor?: { username: string; displayName?: string | null } | null };
/** Fields Step 26 / 28b will add to the device payload; read defensively until then. */
type FutureDeviceFields = { criticalityTier?: string | number | null; host?: { id: string; name?: string; services?: Array<{ id: string; name: string; port?: number | null }> } | null };

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');
const q = (values: Record<string, string | null | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(values)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
const itemsOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : Array.isArray((value as { items?: unknown })?.items) ? (value as { items: T[] }).items : []);

function Section({ id, title, fullHref, fullLabel, children }: { id: string; title: string; fullHref?: string; fullLabel?: string; children: ReactNode }) {
  return <section className="ipam-card device-360-section" aria-labelledby={`d360-${id}`} data-section={id}>
    <header className="device-360-section-head"><h2 id={`d360-${id}`}>{title}</h2>{fullHref && <a className="text-button" href={fullHref}>{fullLabel ?? 'Ver na página completa'} <ExternalLink size={12} aria-hidden="true" /></a>}</header>
    {children}
  </section>;
}

const EmptyLine = ({ children }: { children: ReactNode }) => <p className="panel-description device-360-empty">{children}</p>;

function SectionBody<T>({ query, empty, children }: { query: { data?: T; isLoading: boolean; error: unknown }; empty: (data: T) => string | null; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <EmptyLine>A carregar…</EmptyLine>;
  if (query.error) return <EmptyLine>Não foi possível carregar esta secção.</EmptyLine>;
  if (query.data === undefined) return <EmptyLine>Sem dados.</EmptyLine>;
  const message = empty(query.data);
  return message ? <EmptyLine>{message}</EmptyLine> : <>{children(query.data)}</>;
}

export function Device360Page({ deviceId }: { deviceId: string }) {
  const { hasRole, user } = useAuth();
  const can = (key: keyof typeof ROLES) => ROLES[key].some((role) => hasRole(role));

  const deviceQuery = useQuery({ queryKey: ['device-360', deviceId], queryFn: () => getDevice(deviceId), enabled: Boolean(deviceId) });
  const device = deviceQuery.data as (Device & FutureDeviceFields) | undefined;
  const siteId = device?.siteId ?? device?.site?.id ?? '';
  const ready = Boolean(device);
  const deviceName = device?.name;
  useEffect(() => {
    if (deviceName) rememberRecentItem(user?.id, { id: `device:${deviceId}`, kind: 'Equipamento', label: deviceName, href: entityHref({ kind: 'device', id: deviceId, siteId }) });
  }, [user?.id, deviceId, deviceName, siteId]);

  const interfaces = useQuery({ queryKey: ['device-360', deviceId, 'interfaces'], queryFn: () => listInterfaces(deviceId), enabled: ready && can('interfaces') });
  const ips = useQuery({ queryKey: ['device-360', deviceId, 'ips', siteId], queryFn: () => listDeviceIpAddresses(siteId, deviceId), enabled: ready && Boolean(siteId) });
  const connections = useQuery({ queryKey: ['device-360', deviceId, 'connections'], queryFn: async () => itemsOf<Connection>(await apiFetch(`/api/v1/topology/connections${q({ siteId, search: device?.name, pageSize: '200' })}`)).filter((c) => c.sourceDeviceId === deviceId || c.targetDeviceId === deviceId), enabled: ready });
  const snmp = useQuery({ queryKey: ['device-360', deviceId, 'snmp'], queryFn: () => apiFetch<SnmpOverview>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}`), enabled: ready && can('snmp') });
  const lifecycle = useQuery({ queryKey: ['device-360', deviceId, 'lifecycle', siteId], queryFn: async () => itemsOf<LifecycleDate>(await apiFetch(`/api/v1/lifecycle-dates${q({ siteId, from: '2000-01-01', to: '2100-01-01' })}`)).filter((d) => d.deviceId === deviceId), enabled: ready && Boolean(siteId) });
  const attestation = useQuery({ queryKey: ['device-360', deviceId, 'attestation', siteId], queryFn: async () => { const r = await apiFetch<{ assets?: CriticalAsset[]; unassigned?: CriticalAsset[] }>(`/api/v1/critical-assets${q({ siteId })}`); return [...(r.assets ?? []), ...(r.unassigned ?? [])].find((a) => a.id === deviceId) ?? null; }, enabled: ready && Boolean(siteId) && Boolean(device?.isCritical) && can('attestation') });
  const changes = useQuery({ queryKey: ['device-360', deviceId, 'changes', siteId], queryFn: async () => itemsOf<ChangePlan>(await apiFetch(`/api/v1/change-plans${q({ siteId })}`)).filter((p) => !CLOSED_CHANGE.has(p.status) && (p.items ?? []).some((i) => i.entityType === 'DEVICE' && i.entityId === deviceId)), enabled: ready && Boolean(siteId) && can('changes') });
  const audit = useQuery({ queryKey: ['device-360', deviceId, 'audit'], queryFn: async () => itemsOf<AuditEvent>(await apiFetch(`/api/v1/audit/events/page${q({ entityType: 'Device', entityId: deviceId, limit: '10' })}`)), enabled: ready && can('audit') });

  if (!deviceId || deviceQuery.error) return <AppShell section="Mapa físico"><main className="module-page device-360"><section className="ipam-card empty-context" role="alert"><Server size={28} /><strong>Equipamento não encontrado</strong><span>Não foi possível abrir este equipamento ou não tens acesso a ele.</span><a className="secondary-button" href="/infraestrutura?tab=devices">Voltar à lista de equipamentos</a></section></main></AppShell>;
  if (!device) return <AppShell section="Mapa físico"><main className="module-page device-360"><EmptyLine>A carregar equipamento…</EmptyLine></main></AppShell>;

  const rack = device.rack;
  const location = [device.site?.name, rack?.room?.building?.name, rack?.room?.name, rack?.name, device.rackUnitStart ? `U${device.rackUnitStart}${device.rackUnitSize && device.rackUnitSize > 1 ? `–${device.rackUnitStart + device.rackUnitSize - 1}` : ''}` : null].filter(Boolean).join(' · ');
  const imageAsset = device.frontAsset ?? device.model?.frontAsset;
  const image = imageAsset ? assetFileUrl(imageAsset) : null;
  const modelName = device.model ? `${device.model.manufacturer} ${device.model.model}`.trim() : '';
  const tier = device.criticalityTier;
  const rackHref = rack ? `/infraestrutura${q({ siteId, buildingId: rack.room?.building?.id, roomId: rack.room?.id, rackId: rack.id })}` : null;
  const outlets = (device.power as { outlets?: Array<{ pduName?: string; outletIndex?: number; pduId?: string }> } | null | undefined)?.outlets ?? [];

  return <AppShell section="Mapa físico"><main className="module-page device-360">
    <header className="workspace-head device-360-head">
      {/* eslint-disable-next-line @next/next/no-img-element -- API asset URL, same as the rack views */}
      {image && <img className="device-360-image" src={image} alt={`Frente de ${modelName || device.name}`} />}
      <div>
        <span className="section-kicker">EQUIPAMENTO · {device.type}{modelName ? ` · ${modelName}` : ''}</span>
        <h1>{device.name}</h1>
        <p>{location || 'Sem localização'}</p>
        <p className="device-360-badges">
          <span className="state-badge"><i />{device.status}</span>
          {tier != null ? <span className="state-badge warning" data-testid="tier-badge">Tier {tier}</span> : device.isCritical ? <span className="state-badge warning" data-testid="tier-badge">Crítico</span> : null}
        </p>
      </div>
      <div className="device-360-actions">
        {can('edit') && <a className="primary-button" href={deviceEditHref({ id: device.id, siteId })}><Pencil size={14} aria-hidden="true" /> Editar</a>}
        {rackHref && <a className="secondary-button" href={rackHref}>Abrir no rack</a>}
        {can('changeCreate') && <a className="secondary-button" href={`/alteracoes${q({ siteId, new: '1', deviceId: device.id })}`}><Plus size={14} aria-hidden="true" /> Criar alteração</a>}
      </div>
    </header>

    <div className="device-360-grid">
      <Section id="resumo" title="Resumo">
        <dl className="device-360-facts">
          <dt>Hostname</dt><dd>{device.hostname || '—'}</dd>
          <dt>IP de gestão</dt><dd>{device.managementIp || '—'}</dd>
          <dt>N.º de série</dt><dd>{device.serialNumber || '—'}</dd>
          <dt>Etiqueta</dt><dd>{device.assetTag || '—'}</dd>
          <dt>Origem</dt><dd>{device.source || '—'}</dd>
        </dl>
        {device.notes && <p className="panel-description">Notas: {device.notes}</p>}
        {device.requiredConfig && !device.requiredConfig.complete && <p className="ipam-scope-note" role="status">Configuração em falta: {device.requiredConfig.missing.join(', ')}</p>}
      </Section>

      <Section id="interfaces" title="Interfaces e IPs" fullHref={`/ipam${q({ siteId, q: device.name })}`} fullLabel="Ver no IPAM">
        {can('interfaces') && <SectionBody query={interfaces} empty={(list) => (list.length ? null : 'Sem interfaces registadas.')}>{(list) => <ul className="device-360-list">{list.slice(0, 12).map((item) => <li key={item.id}>{item.name}</li>)}{list.length > 12 && <li>+{list.length - 12} interfaces</li>}</ul>}</SectionBody>}
        {siteId ? <SectionBody query={ips} empty={(r) => (r.items.length ? null : 'Sem IPs atribuídos.')}>{(r) => <ul className="device-360-list">{r.items.map((ip) => <li key={ip.id}><a href={`/ipam${q({ siteId, subnetId: (ip as { subnetId?: string }).subnetId, ipId: ip.id })}`}>{ip.address}</a></li>)}</ul>}</SectionBody> : <EmptyLine>Sem Site: os IPs aparecem depois de associar um Site.</EmptyLine>}
      </Section>

      <Section id="ligacoes" title="Ligações" fullHref={`/topology${q({ siteId, deviceId: device.id })}`} fullLabel="Ver na Topologia">
        <SectionBody query={connections} empty={(list) => (list.length ? null : 'Sem ligações registadas.')}>{(list) => <ul className="device-360-list">{list.map((c) => { const outgoing = c.sourceDeviceId === deviceId; const other = outgoing ? c.targetDevice : c.sourceDevice; const local = outgoing ? c.sourceInterface : c.targetInterface; const remote = outgoing ? c.targetInterface : c.sourceInterface; return <li key={c.id}>{local?.name ?? '—'} → {other ? <a href={`/infraestrutura/equipamentos/${encodeURIComponent(other.id)}${q({ siteId })}`}>{other.name}</a> : '—'}{remote?.name ? ` (${remote.name})` : ''}{c.type ? ` · ${c.type === 'LOGICAL' ? 'Lógica' : 'Física'}` : ''}</li>; })}</ul>}</SectionBody>
      </Section>

      <Section id="energia" title="Energia" fullHref={rackHref ?? undefined} fullLabel="Ver energia do rack">
        {outlets.length ? <ul className="device-360-list">{outlets.map((o, i) => <li key={`${o.pduId ?? ''}:${o.outletIndex ?? i}`}>{o.pduName ?? 'PDU'} · tomada {o.outletIndex ?? '—'}</li>)}</ul> : <EmptyLine>Sem tomadas de PDU ligadas.</EmptyLine>}
      </Section>

      {can('snmp') && <Section id="snmp" title="SNMP" fullHref={`/snmp${q({ deviceId: device.id })}`} fullLabel="Ver no SNMP">
        <SectionBody query={snmp} empty={(r) => (r.config ? null : 'Sem SNMP configurado.')}>{(r) => { const open = (r.drifts ?? []).filter((d) => !d.status || d.status === 'OPEN').length; return <dl className="device-360-facts"><dt>Estado</dt><dd>{r.config?.enabled === false ? 'Desativado' : 'Ativo'}</dd><dt>Última recolha</dt><dd>{fmt(r.latestSnapshot?.collectedAt ?? r.latestSnapshot?.createdAt)}</dd><dt>Drifts abertos</dt><dd>{open}</dd><dt>Traps recentes</dt><dd>{(r.traps ?? []).length}</dd></dl>; }}</SectionBody>
      </Section>}

      <Section id="host" title="Host e serviços" fullHref={device.host ? `/ipam${q({ siteId, hostId: device.host.id })}` : undefined}>
        {device.host === undefined ? <EmptyLine>Ainda não disponível: os hosts e serviços ligados a este equipamento aparecem aqui quando a secção de hosts estiver ativa.</EmptyLine> : !device.host ? <EmptyLine>Sem host associado.</EmptyLine> : (device.host.services ?? []).length ? <ul className="device-360-list">{device.host.services!.map((s) => <li key={s.id}>{s.name}{s.port ? `:${s.port}` : ''}</li>)}</ul> : <EmptyLine>{device.host.name ?? 'Host'} sem serviços registados.</EmptyLine>}
      </Section>

      <Section id="ciclo" title="Ciclo de vida" fullHref={`/infraestrutura${q({ siteId, tab: 'lifecycle' })}`} fullLabel="Ver datas de ciclo de vida">
        {siteId ? <SectionBody query={lifecycle} empty={(list) => (list.length ? null : 'Sem datas de ciclo de vida.')}>{(list) => <ul className="device-360-list">{list.map((d) => <li key={d.id}>{d.kind} · {fmt(d.dueDate)}</li>)}</ul>}</SectionBody> : <EmptyLine>Sem datas de ciclo de vida.</EmptyLine>}
      </Section>

      {can('attestation') && <Section id="atestacao" title="Atestação" fullHref={`/attestacao-ativos${q({ siteId, q: device.name })}`} fullLabel="Ver em Ativos críticos">
        {!device.isCritical ? <EmptyLine>Não é um ativo crítico.</EmptyLine> : <SectionBody query={attestation} empty={(a) => (a ? null : 'Sem atestação registada.')}>{(a) => <dl className="device-360-facts"><dt>Última revisão</dt><dd>{a!.latestOutcome ? `${a!.latestOutcome} · ${fmt(a!.latestConfirmedAt)}` : 'Sem revisão'}</dd><dt>Prazo</dt><dd>{fmt(a!.dueDate)}</dd></dl>}</SectionBody>}
      </Section>}

      {can('changes') && <Section id="alteracoes" title="Alterações" fullHref={`/alteracoes${q({ siteId, q: device.name })}`} fullLabel="Ver em Alterações">
        {siteId ? <SectionBody query={changes} empty={(list) => (list.length ? null : 'Sem alterações abertas ou agendadas.')}>{(list) => <ul className="device-360-list">{list.map((p) => <li key={p.id}><a href={`/alteracoes${q({ siteId, q: p.title })}`}>{p.title}</a> · {p.status} · {fmt(p.plannedStartAt)}</li>)}</ul>}</SectionBody> : <EmptyLine>Sem alterações abertas ou agendadas.</EmptyLine>}
      </Section>}

      {can('audit') && <Section id="historico" title="Histórico" fullHref={`/auditoria${q({ entityType: 'Device', entityId: device.id, q: device.id })}`} fullLabel="Ver na Auditoria">
        <SectionBody query={audit} empty={(list) => (list.length ? null : 'Sem eventos de auditoria.')}>{(list) => <ul className="device-360-list">{list.map((e) => { const who = e.user ?? e.actor; return <li key={e.id}><time dateTime={e.createdAt}>{fmt(e.createdAt)}</time> · {e.action}{who ? ` · ${who.displayName || who.username}` : ''}</li>; })}</ul>}</SectionBody>
      </Section>}
    </div>
  </main></AppShell>;
}
