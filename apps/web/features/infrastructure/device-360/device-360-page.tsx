'use client';

import { Fragment, useEffect, useState, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Activity, ExternalLink, Pencil, Plus, Route, Server, Tags } from 'lucide-react';
import { setDeviceTags } from '@/features/tags/api';
import { TagChips, TagEditor } from '@/features/tags/tag-components';
import { canManageTagCatalog } from '@/features/tags/types';
import { AppShell } from '@/components/layout/app-shell';
import { deviceEditHref, entityHref } from '@/lib/routes';
import { rememberRecentItem } from '@/lib/recent-items';
import { useAuth } from '@/lib/auth';
import { ImpactPanel } from '@/features/topology/impact-panel';
import { useUiText } from '@/components/ui/use-ui-text';
import { isSnmpNetworkDevice } from '@/features/snmp/health/health-api';
import { SnmpDeviceHealthBadge, SnmpHealthPanel } from '@/features/snmp/health/health-panel';
import { HealthHistoryChart } from '@/features/snmp/health/health-history-chart';
import { DeviceHealthThresholdsPanel } from '@/features/snmp/health/health-limits-panels';
import { getDevice, listDeviceIpAddresses, listInterfaces } from '../api';
import type { Device } from '../types';
import { AssetImage } from '../components/asset-image';
import { device360Keys, getDeviceAttestation, getDeviceSnmpOverview, listDevice360Connections, listDeviceAuditEvents, listDeviceHosts, listDeviceLifecycleDates, listDeviceOpenChanges, q } from './api';

/**
 * Step 29 — read-first Device 360 page.
 *
 * Every section loads on its own from an existing endpoint, so one slow or
 * forbidden source never blanks the page. A section the user's roles cannot
 * read is not rendered at all (same role lists as the API controllers).
 * "Host e serviços" reads the Linux host inventory (Step 26, #91): hosts
 * linked to this device and their observed services. The criticality tier
 * (Step 28b, `Device.criticalityTier` T1/T2/T3) is feature-detected on the
 * device payload; without it a critical device shows "Crítico".
 */

const ROLES = {
  interfaces: ['ADMIN', 'NETWORK_OPERATOR'],
  snmp: ['ADMIN', 'NETWORK_OPERATOR', 'AUDITOR', 'READ_ONLY'],
  attestation: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR'],
  changes: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'],
  changeCreate: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'],
  audit: ['ADMIN', 'AUDITOR'],
  hosts: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'AUDITOR', 'READ_ONLY'],
  edit: ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR'],
} as const;

/** SNMP Phase 1 step 5.4: drift statuses as the API stores them (PENDING / ACCEPTED / IGNORED), in Portuguese. */
const driftStatusLabels: Record<string, string> = { PENDING: 'Pendente', ACCEPTED: 'Aceite', IGNORED: 'Ignorada' };
export const snmpDriftStatusLabel = (status?: string | null) => (status ? driftStatusLabels[status] ?? status : driftStatusLabels.PENDING);
/** Pending drifts (a drift without a status is pending), plus a count per other status if the API ever returns them. */
export function driftCounts(drifts?: Array<{ status?: string }>): { pending: number; other: Array<[string, number]> } {
  const counts = new Map<string, number>();
  for (const drift of drifts ?? []) { const status = drift.status || 'PENDING'; counts.set(status, (counts.get(status) ?? 0) + 1); }
  const pending = counts.get('PENDING') ?? 0; counts.delete('PENDING');
  return { pending, other: [...counts.entries()] };
}
/** Step 28b adds this to the device payload (#97); read defensively until then. */
type FutureDeviceFields = { criticalityTier?: 'T1' | 'T2' | 'T3' | null };
/** Same labels as the cadence settings (Step 28b). */
/** SNMP polling state for the Device 360 summary: only an explicit true/false is known; anything else is shown as unknown, never as "Ativo". */
export function snmpStateLabel(enabled?: boolean | null): string {
  if (enabled === true) return 'Ativo';
  if (enabled === false) return 'Desativado';
  return 'Estado desconhecido';
}

const TIER_LABELS: Record<string, string> = { T1: 'T1 · Vital', T2: 'T2 · Importante', T3: 'T3 · Padrão' };

const fmt = (value?: string | null) => (value ? new Date(value).toLocaleString('pt-PT', { dateStyle: 'short', timeStyle: 'short' }) : '—');

function Section({ id, title, fullHref, fullLabel, children }: { id: string; title: string; fullHref?: string; fullLabel?: string; children: ReactNode }) {
  return <section className="ipam-card device-360-section" aria-labelledby={`d360-${id}`} data-section={id}>
    <header className="device-360-section-head"><h2 id={`d360-${id}`}>{title}</h2>{fullHref && <a className="text-button" href={fullHref}>{fullLabel ?? 'Ver na página completa'} <ExternalLink size={12} aria-hidden="true" /></a>}</header>
    {children}
  </section>;
}

const EmptyLine = ({ children }: { children: ReactNode }) => <p className="panel-description device-360-empty">{children}</p>;

function SectionBody<T>({ query, empty, children }: { query: { data?: T; isLoading: boolean; isFetching?: boolean; error: unknown; refetch?: () => unknown }; empty: (data: T) => string | null; children: (data: T) => ReactNode }) {
  if (query.isLoading) return <EmptyLine>A carregar…</EmptyLine>;
  if (query.error) return <div className="device-360-error" role="alert">
    <EmptyLine>Não foi possível carregar esta secção.</EmptyLine>
    {query.refetch && <button type="button" className="text-button" disabled={query.isFetching} onClick={() => { void query.refetch?.(); }}>{query.isFetching ? 'A tentar…' : 'Tentar novamente'}</button>}
  </div>;
  if (query.data === undefined) return <EmptyLine>Sem dados.</EmptyLine>;
  const message = empty(query.data);
  return message ? <EmptyLine>{message}</EmptyLine> : <>{children(query.data)}</>;
}

export function Device360Page({ deviceId }: { deviceId: string }) {
  const { hasRole, user } = useAuth();
  const t = useUiText();
  const can = (key: keyof typeof ROLES) => ROLES[key].some((role) => hasRole(role));

  const [impactOpen, setImpactOpen] = useState(false);
  const [editingTags, setEditingTags] = useState(false);
  const queryClient = useQueryClient();
  const deviceQuery = useQuery({ queryKey: device360Keys.device(deviceId), queryFn: () => getDevice(deviceId), enabled: Boolean(deviceId) });
  const device = deviceQuery.data as (Device & FutureDeviceFields) | undefined;
  // SNMP Phase 2 step 10: health badge and panel for network equipment, same roles as the SNMP section.
  const showHealth = Boolean(device) && can('snmp') && isSnmpNetworkDevice(device?.type);
  const siteId = device?.siteId ?? device?.site?.id ?? '';
  const ready = Boolean(device);
  /** Step 36: ADMIN and SYSTEMS_OPERATOR tag any device; NETWORK_OPERATOR only network equipment (the API checks it too). */
  const canEditTags = Boolean(device && siteId) && (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR') || (hasRole('NETWORK_OPERATOR') && ['SWITCH', 'ROUTER', 'FIREWALL'].includes(device?.type ?? '')));
  const deviceName = device?.name;
  useEffect(() => {
    if (deviceName) rememberRecentItem(user?.id, { id: `device:${deviceId}`, kind: 'Equipamento', label: deviceName, href: entityHref({ kind: 'device', id: deviceId, siteId }) });
  }, [user?.id, deviceId, deviceName, siteId]);

  const interfaces = useQuery({ queryKey: device360Keys.interfaces(deviceId), queryFn: () => listInterfaces(deviceId), enabled: ready && can('interfaces') });
  const ips = useQuery({ queryKey: device360Keys.ips(deviceId, siteId), queryFn: () => listDeviceIpAddresses(siteId, deviceId), enabled: ready && Boolean(siteId) });
  const connections = useQuery({ queryKey: device360Keys.connections(deviceId), queryFn: () => listDevice360Connections(siteId, deviceId, device?.name), enabled: ready });
  const snmp = useQuery({ queryKey: device360Keys.snmp(deviceId), queryFn: () => getDeviceSnmpOverview(deviceId), enabled: ready && can('snmp') });
  const lifecycle = useQuery({ queryKey: device360Keys.lifecycle(deviceId, siteId), queryFn: () => listDeviceLifecycleDates(siteId, deviceId), enabled: ready && Boolean(siteId) });
  const attestation = useQuery({ queryKey: device360Keys.attestation(deviceId, siteId), queryFn: () => getDeviceAttestation(siteId, deviceId), enabled: ready && Boolean(siteId) && Boolean(device?.isCritical) && can('attestation') });
  const changes = useQuery({ queryKey: device360Keys.changes(deviceId, siteId), queryFn: () => listDeviceOpenChanges(siteId, deviceId), enabled: ready && Boolean(siteId) && can('changes') });
  const hosts = useQuery({ queryKey: device360Keys.hosts(deviceId, siteId), queryFn: () => listDeviceHosts(siteId, deviceId), enabled: ready && Boolean(siteId) && can('hosts') });
  const audit = useQuery({ queryKey: device360Keys.audit(deviceId), queryFn: () => listDeviceAuditEvents(deviceId), enabled: ready && can('audit') });

  if (!deviceId || deviceQuery.error) return <AppShell section="Mapa físico"><div className="module-page device-360"><section className="ipam-card empty-context" role="alert"><Server size={28} /><strong>Equipamento não encontrado</strong><span>Não foi possível abrir este equipamento ou não tens acesso a ele.</span><a className="secondary-button" href="/infraestrutura?tab=devices">Voltar à lista de equipamentos</a></section></div></AppShell>;
  if (!device) return <AppShell section="Mapa físico"><div className="module-page device-360"><EmptyLine>A carregar equipamento…</EmptyLine></div></AppShell>;

  const rack = device.rack;
  const location = [device.site?.name, rack?.room?.building?.name, rack?.room?.name, rack?.name, device.rackUnitStart ? `U${device.rackUnitStart}${device.rackUnitSize && device.rackUnitSize > 1 ? `–${device.rackUnitStart + device.rackUnitSize - 1}` : ''}` : null].filter(Boolean).join(' · ');
  const imageAsset = device.frontAsset ?? device.model?.frontAsset;
  const modelName = device.model ? `${device.model.manufacturer} ${device.model.model}`.trim() : '';
  const tier = device.criticalityTier;
  const rackHref = rack ? `/infraestrutura${q({ siteId, buildingId: rack.room?.building?.id, roomId: rack.room?.id, rackId: rack.id })}` : null;
  const outlets = (device.power as { outlets?: Array<{ pduName?: string; outletIndex?: number; pduId?: string }> } | null | undefined)?.outlets ?? [];

  return <AppShell section="Mapa físico"><div className="module-page device-360">
    <header className="workspace-head device-360-head">
      {imageAsset && <AssetImage asset={imageAsset} className="device-360-image" alt={t('infra.frontOf', undefined, { name: modelName || device.name })} loading="eager" fallback={false} />}
      <div>
        <h1>{device.name}</h1>
        <p>{[device.type, modelName, location || 'Sem localização'].filter(Boolean).join(' · ')}</p>
        <p className="device-360-badges">
          <span className="state-badge"><i />{device.status}</span>
          {showHealth && <SnmpDeviceHealthBadge deviceId={device.id} />}
          {tier ? <span className="state-badge warning" data-testid="tier-badge" title="Criticidade">{TIER_LABELS[tier] ?? tier}</span> : device.isCritical ? <span className="state-badge warning" data-testid="tier-badge">Crítico</span> : null}
        </p>
        {device.tags?.length ? <TagChips tags={device.tags} className="device-360-tags" /> : null}
      </div>
      <div className="device-360-actions">
        {can('edit') && <a className="primary-button" href={deviceEditHref({ id: device.id, siteId })}><Pencil size={14} aria-hidden="true" /> Editar</a>}
        {canEditTags && <button type="button" className="secondary-button" onClick={() => setEditingTags(true)}><Tags size={14} aria-hidden="true" /> Etiquetas</button>}
        {rackHref && <a className="secondary-button" href={rackHref}>Abrir no rack</a>}
        <button type="button" className="secondary-button" aria-expanded={impactOpen} aria-controls="d360-impacto-section" onClick={() => setImpactOpen((open) => !open)}><Activity size={14} aria-hidden="true" /> Impacto</button>
        {siteId && <a className="secondary-button" href={`/topology${q({ siteId, pathFrom: device.id })}`}><Route size={14} aria-hidden="true" /> Caminho até…</a>}
        {can('changeCreate') && <a className="secondary-button" href={`/alteracoes${q({ siteId, new: '1', deviceId: device.id })}`}><Plus size={14} aria-hidden="true" /> Criar alteração</a>}
      </div>
    </header>
    {editingTags && device && siteId && <TagEditor siteId={siteId} canCreate={canManageTagCatalog(hasRole)} itemLabel={device.name} selected={device.tags ?? []} save={async (tagIds) => { await setDeviceTags(device.id, tagIds); await queryClient.invalidateQueries({ queryKey: device360Keys.device(deviceId) }); void queryClient.invalidateQueries({ queryKey: ['tags', siteId] }); void queryClient.invalidateQueries({ queryKey: ['infrastructure', 'devices', siteId] }); }} close={() => setEditingTags(false)} />}

    {impactOpen && <section id="d360-impacto-section" className="ipam-card device-360-section device-360-impact" aria-labelledby="d360-impacto" data-section="impacto">
      <header className="device-360-section-head"><h2 id="d360-impacto">Impacto se este equipamento for abaixo</h2><button type="button" className="text-button" onClick={() => setImpactOpen(false)}>Fechar</button></header>
      <ImpactPanel target={{ kind: 'DEVICE', id: device.id }} siteId={siteId} headingId="d360-impacto" />
    </section>}

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
        <SectionBody query={connections} empty={(list) => (list.length ? null : 'Sem ligações registadas.')}>{(list) => <ul className="device-360-list">{list.map((c) => { const outgoing = c.sourceDeviceId === deviceId; const other = outgoing ? c.targetDevice : c.sourceDevice; const local = outgoing ? c.sourceInterface : c.targetInterface; const remote = outgoing ? c.targetInterface : c.sourceInterface; return <li key={c.id}>{local?.name ?? '—'} → {other ? <a href={`/infraestrutura/equipamentos/${encodeURIComponent(other.id)}${q({ siteId })}`}>{other.name}</a> : '—'}{remote?.name ? ` (${remote.name})` : ''}{c.type ? t(`infra.device360.connectionType.${c.type === 'LOGICAL' ? 'logical' : 'physical'}`) : ''}</li>; })}</ul>}</SectionBody>
      </Section>

      <Section id="energia" title="Energia" fullHref={rackHref ?? undefined} fullLabel="Ver energia do rack">
        {outlets.length ? <ul className="device-360-list">{outlets.map((o, i) => <li key={`${o.pduId ?? ''}:${o.outletIndex ?? i}`}>{t('infra.device360.outlet', undefined, { pdu: o.pduName ?? 'PDU', outlet: o.outletIndex ?? '—' })}</li>)}</ul> : <EmptyLine>Sem tomadas de PDU ligadas.</EmptyLine>}
      </Section>

      {showHealth && <Section id="saude" title={t('snmpHealth.panel.title')} fullHref={`/snmp${q({ deviceId: device.id })}`} fullLabel={t('snmpHealth.panel.full')}>
        <SnmpHealthPanel deviceId={device.id} />
        <HealthHistoryChart deviceId={device.id} />
      </Section>}
      {showHealth && <Section id="limites" title={t('healthLimits.deviceSection')} fullHref="/definicoes?tab=health" fullLabel={t('healthLimits.siteLink')}>
        <DeviceHealthThresholdsPanel deviceId={device.id} />
      </Section>}
      {can('snmp') && <Section id="snmp" title="SNMP" fullHref={`/snmp${q({ deviceId: device.id })}`} fullLabel="Ver no SNMP">
        <SectionBody query={snmp} empty={(r) => (r.config ? null : 'Sem SNMP configurado.')}>{(r) => { const drifts = driftCounts(r.drifts); return <dl className="device-360-facts"><dt>Estado</dt><dd>{snmpStateLabel(r.config?.enabled)}</dd><dt>Última recolha</dt><dd>{fmt(r.latestSnapshot?.observedAt ?? r.latestSnapshot?.collectedAt ?? r.latestSnapshot?.createdAt)}</dd><dt>Divergências pendentes</dt><dd>{drifts.pending}</dd>{drifts.other.map(([status, count]) => <Fragment key={status}><dt>{`Divergências: ${snmpDriftStatusLabel(status)}`}</dt><dd>{count}</dd></Fragment>)}<dt>Traps recentes</dt><dd>{(r.traps ?? []).length}</dd></dl>; }}</SectionBody>
      </Section>}

      {can('hosts') && <Section id="host" title="Host e serviços" fullHref={`/infraestrutura${q({ tab: 'devices', type: 'SERVER', 'hosts-site': siteId })}`} fullLabel="Ver servidores em Equipamentos">
        {siteId ? <SectionBody query={hosts} empty={(list) => (list.length ? null : 'Sem host associado.')}>{(list) => <ul className="device-360-list">{list.map((h) => <li key={h.id}><strong>{h.name}</strong>{h.operatingSystem ? ` · ${h.operatingSystem}` : ''}{h.agent?.state ? t('infra.device360.agentState', undefined, { state: h.agent.state }) : ''}{h.services.length ? <ul className="device-360-list">{h.services.map((sv) => <li key={sv.id}>{sv.name}{sv.port ? `:${sv.port}` : ''}{sv.protocol ? ` (${sv.protocol})` : ''}{sv.observedStatus ? ` · ${sv.observedStatus}` : ''}</li>)}</ul> : <EmptyLine>Sem serviços registados.</EmptyLine>}</li>)}</ul>}</SectionBody> : <EmptyLine>Sem host associado.</EmptyLine>}
      </Section>}

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
  </div></AppShell>;
}
