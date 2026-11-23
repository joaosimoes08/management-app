'use client';

import { useEffect, useId, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ArrowLeft, ArrowRight, Server, X } from 'lucide-react';
import { DataTable, EntityLink, HistoryBlock, useTableUrlState, type DataTableColumn } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { apiFetch } from '@/lib/api/client';
import { useI18n } from '@/lib/i18n';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';
import type { ActiveSite } from '@/lib/site-context';
import styles from './linux-hosts.module.css';

const api = '/api/v1/linux-agents';
const inventoryKey = ['infrastructure', 'linux-hosts'];
const filters = { prefix: 'hosts-', filters: { site: '', state: '' }, sortable: [] };
const states = ['ONLINE', 'STALE', 'NONE', 'REVOKED'] as const;
type AgentState = typeof states[number];
type Host = {
  id: string;
  name: string;
  hostname: string | null;
  operatingSystem: string | null;
  device: { id: string; name: string; siteId: string | null } | null;
  ipAddresses: { id: string; address: string; subnet: { id: string; siteId: string | null } }[];
  agent: {
    id: string;
    state: Exclude<AgentState, 'NONE'> | 'PENDING';
    enrolledAt: string;
    revokedAt: string | null;
    lastHeartbeatAt: string | null;
    agentVersion: string | null;
  } | null;
};
type Service = {
  id: string;
  name: string;
  protocol: string | null;
  port: number | null;
  version: string | null;
  observedStatus: string | null;
  lastSeenAt: string | null;
};
type Inventory = { staleMinutes: number; items: Host[] };
type Enrollment = { token: string } | { tokenAlreadyIssued: true };

function stateOf(host: Host): AgentState {
  return !host.agent || host.agent.state === 'PENDING' ? 'NONE' : host.agent.state;
}

function Dialog({ title, drawer, busy, onClose, children }: {
  title: string;
  drawer?: boolean;
  busy?: boolean;
  onClose: () => void;
  children: ReactNode;
}) {
  const { t } = useI18n();
  const ref = useRef<HTMLDialogElement>(null);
  const titleId = useId();
  useEffect(() => {
    const dialog = ref.current!;
    const previousFocus = document.activeElement;
    dialog.showModal();
    return () => {
      dialog.close();
      if (previousFocus instanceof HTMLElement && previousFocus.isConnected) previousFocus.focus();
    };
  }, []);
  return <dialog
    ref={ref}
    aria-labelledby={titleId}
    className={drawer ? `host-panel ${styles.drawer}` : `modal-card ${styles.dialog}`}
    onCancel={(event) => { event.preventDefault(); if (!busy) onClose(); }}
  >
    <div className={drawer ? 'host-panel-head' : 'modal-heading'}>
      <h2 id={titleId}>{title}</h2>
      <button type="button" className="icon-button subtle" aria-label={t('linuxHosts.close')} onClick={onClose} disabled={busy}><X size={16} /></button>
    </div>
    {children}
  </dialog>;
}

function HostTable({ children }: { children: ReactNode }) {
  const { t } = useI18n();
  const ref = useRef<HTMLDivElement>(null);
  const scroll = (end: boolean) => {
    const table = ref.current?.querySelector<HTMLElement>('.ip-table-wrap');
    if (table) table.scrollTo({ left: end ? table.scrollWidth : 0 });
  };

  return <div className={styles.table} ref={ref}>
    <div className={styles.tableControls}>
      <span>{t('linuxHosts.scrollColumns')}</span>
      <button type="button" className="icon-button" onClick={() => scroll(false)} aria-label={t('linuxHosts.firstColumns')}><ArrowLeft size={16} aria-hidden="true" /></button>
      <button type="button" className="icon-button" onClick={() => scroll(true)} aria-label={t('linuxHosts.lastColumns')}><ArrowRight size={16} aria-hidden="true" /></button>
    </div>
    {children}
  </div>;
}

function IpLinks({ host }: { host: Host }) {
  return <div className={styles.ips}>
    {host.ipAddresses.map((ip) => <EntityLink key={ip.id} kind="ip" id={ip.id} label={ip.address} subnetId={ip.subnet.id} siteId={ip.subnet.siteId} className={`text-button ${styles.entityLink}`} />)}
    {!host.ipAddresses.length && '—'}
  </div>;
}

function DeviceLink({ host }: { host: Host }) {
  const device = host.device;
  return device ? <EntityLink kind="device" id={device.id} label={device.name} siteId={device.siteId} className={`text-button ${styles.entityLink}`} /> : '—';
}

function HostDetails({ host, onClose, audit }: { host: Host; onClose: () => void; audit: boolean }) {
  const { t, formatDate } = useI18n();
  const services = useQuery({
    queryKey: [...inventoryKey, 'services', host.id],
    queryFn: () => apiFetch<Service[]>(`${api}/hosts/${encodeURIComponent(host.id)}/services`),
  });
  const columns: DataTableColumn<Service>[] = [
    { id: 'name', header: t('linuxHosts.name'), cell: (row) => row.name },
    { id: 'port', header: t('linuxHosts.protocolPort'), cell: (row) => [row.protocol, row.port].filter((part) => part != null).join(' / ') || '—' },
    { id: 'version', header: t('linuxHosts.version'), cell: (row) => row.version || '—' },
    { id: 'status', header: t('linuxHosts.observedStatus'), cell: (row) => row.observedStatus ? t(`linuxHosts.observed.${row.observedStatus}`, row.observedStatus) : '—' },
    { id: 'seen', header: t('linuxHosts.lastSeen'), cell: (row) => formatDate(row.lastSeenAt) },
  ];
  const agent = host.agent;

  return <Dialog title={host.name} drawer onClose={onClose}>
    <div className="host-status-line">
      <span>{t(`linuxHosts.state.${stateOf(host)}`)}</span>
      {agent?.state === 'PENDING' && <span>{t('linuxHosts.tokenIssued')}</span>}
    </div>
    <div className="host-detail-grid">
      <div><span>{t('linuxHosts.hostname')}</span><strong>{host.hostname || '—'}</strong></div>
      <div><span>{t('linuxHosts.os')}</span><strong>{host.operatingSystem || '—'}</strong></div>
      <div><span>{t('linuxHosts.device')}</span><strong><DeviceLink host={host} /></strong></div>
      <div><span>{t('linuxHosts.heartbeat')}</span><strong>{formatDate(agent?.lastHeartbeatAt)}</strong></div>
      <div className="wide"><span>{t('linuxHosts.ips')}</span>
        <IpLinks host={host} />
      </div>
    </div>
    <section className="host-section">
      <h3>{t('linuxHosts.services')}</h3>
      {services.isError
        ? <p className="ipam-alert error" role="alert">{t('linuxHosts.servicesError')}</p>
        : <HostTable><DataTable columns={columns} rows={services.data ?? []} rowKey={(row) => row.id} label={t('linuxHosts.services')} loading={services.isPending} empty={<p className="no-data">{t('linuxHosts.noServices')}</p>} /></HostTable>}
    </section>
    <HistoryBlock heading={t('linuxHosts.history')} formatDate={formatDate} events={agent ? [
      ...(agent.revokedAt ? [{ id: 'revoked', title: t('linuxHosts.revoked'), at: agent.revokedAt }] : []),
      { id: 'enrolled', title: t('linuxHosts.enrolled'), at: agent.enrolledAt },
    ] : []} empty={t('linuxHosts.noHistory')} />
    {agent && audit && <div className="form-actions"><EntityLink kind="audit" id={agent.id} label={t('linuxHosts.audit')} className="secondary-button" /></div>}
  </Dialog>;
}

function installCommand() {
  const configured = getPublicRuntimeConfig().apiUrl || window.location.origin;
  const url = new URL(configured, window.location.origin);
  const origin = url.protocol === 'https:' ? url.origin : 'https://management.example';
  return [
    'sudo install -D -m 0755 linux_heartbeat_agent.py /opt/management-agent/linux_heartbeat_agent.py',
    `MANAGEMENT_API_URL='${origin}' MANAGEMENT_AGENT_TOKEN_FILE="$HOME/.management-agent-token" python3 /opt/management-agent/linux_heartbeat_agent.py`,
  ].join('\n');
}

function EnrollDialog({ hosts, initialId, close, refresh }: { hosts: Host[]; initialId: string; close: () => void; refresh: () => Promise<void> }) {
  const { t } = useI18n();
  const [hostId, setHostId] = useState(initialId);
  const [token, setToken] = useState('');
  const [issued, setIssued] = useState(false);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState('');
  const active = hosts.find((host) => host.id === hostId);
  const alreadyIssued = issued || Boolean(active?.agent && active.agent.state !== 'REVOKED');

  async function enroll(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!active || alreadyIssued || busy) return;
    setBusy(true);
    setMessage('');
    try {
      const result = await apiFetch<Enrollment>(`${api}/enrollments`, { method: 'POST', body: JSON.stringify({ hostId }) });
      if ('token' in result) setToken(result.token);
      else setIssued(true);
      await refresh();
    } catch {
      setMessage('linuxHosts.enrollError');
    } finally {
      setBusy(false);
    }
  }

  async function copyToken() {
    try {
      await navigator.clipboard.writeText(token);
      setMessage('linuxHosts.copied');
    } catch {
      setMessage('linuxHosts.copyError');
    }
  }

  return <Dialog title={t('linuxHosts.enroll')} onClose={close} busy={busy}>
    {token ? <div className="modal-form">
      <p>{t('linuxHosts.tokenOnce')}</p>
      <label>{t('linuxHosts.token')}<input readOnly value={token} onFocus={(event) => event.currentTarget.select()} autoComplete="off" spellCheck={false} /></label>
      <div><button type="button" className="secondary-button" onClick={() => void copyToken()}>{t('linuxHosts.copy')}</button></div>
      <p>{t('linuxHosts.installHint')}</p>
      <pre className={styles.command}>{installCommand()}</pre>
    </div> : <form className="modal-form" onSubmit={(event) => void enroll(event)}>
      <label>{t('linuxHosts.host')}
        <select value={hostId} onChange={(event) => { setHostId(event.target.value); setIssued(false); setMessage(''); }} disabled={busy}>
          <option value="">{t('linuxHosts.selectHost')}</option>
          {hosts.map((host) => <option key={host.id} value={host.id}>{host.name}</option>)}
        </select>
      </label>
      {alreadyIssued && <p role="status">{t('linuxHosts.tokenIssued')}</p>}
      <div className="modal-actions">
        <button type="submit" className="primary-button" disabled={!active || alreadyIssued || busy}>{t(busy ? 'linuxHosts.enrolling' : 'linuxHosts.enroll')}</button>
      </div>
    </form>}
    {message && <p className="panel-description" role="status">{t(message)}</p>}
  </Dialog>;
}

/** `embedded`: shown inside Equipamentos (Tipo = Servidores) rather than as its own page, so no page wrapper and an h2. */
export function LinuxHosts({ sites, canManage, canAudit, embedded = false }: { sites: ActiveSite[]; canManage: boolean; canAudit: boolean; embedded?: boolean }) {
  const { t, formatDate } = useI18n();
  const { filters: url, setFilter } = useTableUrlState(filters);
  const siteId = sites.some((site) => site.id === url.site) ? url.site : '';
  const state = states.find((option) => option === url.state) ?? '';
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [selected, setSelected] = useState<string | null>(null);
  const [enrollHost, setEnrollHost] = useState<string | null>(null);
  const [revoking, setRevoking] = useState<string | null>(null);
  const [revokeError, setRevokeError] = useState(false);
  const hosts = useQuery({
    queryKey: [...inventoryKey, siteId],
    queryFn: () => apiFetch<Inventory>(`${api}/hosts${siteId ? `?siteId=${encodeURIComponent(siteId)}` : ''}`),
    refetchInterval: 60_000,
  });
  const items = hosts.data?.items ?? [];
  const detail = items.find((host) => host.id === selected);
  const refresh = () => queryClient.invalidateQueries({ queryKey: inventoryKey });

  async function revoke(host: Host) {
    if (!host.agent || revoking) return;
    const accepted = await confirm({
      title: t('linuxHosts.revoke'),
      message: t('linuxHosts.revokeConfirm', undefined, { name: host.name }),
      confirmLabel: t('linuxHosts.revoke'),
      cancelLabel: t('common.cancel'),
      destructive: true,
    });
    if (!accepted) return;
    setRevokeError(false);
    setRevoking(host.id);
    try {
      await apiFetch(`${api}/${encodeURIComponent(host.agent.id)}`, { method: 'DELETE' });
      await queryClient.invalidateQueries({ queryKey: inventoryKey });
    } catch {
      setRevokeError(true);
    } finally {
      setRevoking(null);
    }
  }

  const columns: DataTableColumn<Host>[] = [
    { id: 'name', header: t('linuxHosts.name'), cell: (host) => <button type="button" className={`text-button ${styles.hostName}`} onClick={() => setSelected(host.id)}>{host.name}</button> },
    { id: 'state', header: t('linuxHosts.state'), cell: (host) => <div className={styles.state}>
      <span className={`state-badge ${styles[stateOf(host)]}`}>{t(`linuxHosts.state.${stateOf(host)}`)}</span>
      {host.agent?.state === 'PENDING' && <small>{t('linuxHosts.tokenIssued')}</small>}
    </div> },
    { id: 'hostname', header: t('linuxHosts.hostname'), cell: (host) => host.hostname || '—' },
    { id: 'os', header: t('linuxHosts.os'), cell: (host) => host.operatingSystem || '—' },
    { id: 'device', header: t('linuxHosts.device'), cell: (host) => <DeviceLink host={host} /> },
    { id: 'ips', header: t('linuxHosts.ips'), cell: (host) => <IpLinks host={host} /> },
    { id: 'heartbeat', header: t('linuxHosts.heartbeat'), cell: (host) => formatDate(host.agent?.lastHeartbeatAt) },
    { id: 'version', header: t('linuxHosts.agentVersion'), cell: (host) => host.agent?.agentVersion || '—' },
  ];
  if (canManage) columns.push({
    id: 'actions', header: t('linuxHosts.actions'),
    cell: (host) => host.agent && host.agent.state !== 'REVOKED'
      ? <button type="button" className={`secondary-button danger ${styles.action}`} onClick={() => void revoke(host)} disabled={revoking !== null} aria-label={t('linuxHosts.revokeHost', undefined, { name: host.name })}>{t('linuxHosts.revoke')}</button>
      : host.device && <button type="button" className={`secondary-button ${styles.action}`} onClick={() => setEnrollHost(host.id)} aria-label={t('linuxHosts.enrollHost', undefined, { name: host.name })}>{t('linuxHosts.enroll')}</button>,
  });

  const Heading = embedded ? 'h2' : 'h1';
  return <div className={embedded ? `${styles.workspace} ${styles.embedded}` : `module-page infrastructure-workspace ${styles.workspace}`}>
    <section className="ipam-card page-heading-card">
      <header className="panel-heading">
        <div><Heading><Server size={16} aria-hidden="true" /> {t('linuxHosts.title')}</Heading><p className="panel-description">{t('linuxHosts.description')}</p></div>
        {canManage && <button type="button" className="primary-button" disabled={!items.some((host) => host.device)} onClick={() => setEnrollHost('')}>{t('linuxHosts.enroll')}</button>}
      </header>
    </section>
    <section className={`ipam-card ${styles.inventory}`}>
      <div className={styles.filters}>
        <label>{t('linuxHosts.site')}<select className="context-toolbar-selector" value={siteId} onChange={(event) => setFilter('site', event.target.value)}>
          <option value="">{t('linuxHosts.allSites')}</option>
          {sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}
        </select></label>
        <label>{t('linuxHosts.state')}<select className="context-toolbar-selector" value={state} onChange={(event) => setFilter('state', event.target.value)}>
          <option value="">{t('linuxHosts.allStates')}</option>
          {states.map((option) => <option key={option} value={option}>{t(`linuxHosts.state.${option}`)}</option>)}
        </select></label>
      </div>
      {hosts.data && <p className={`panel-description ${styles.hint}`}>{t('linuxHosts.threshold', undefined, { minutes: hosts.data.staleMinutes })}</p>}
      {(hosts.isError || revokeError) && <p className="ipam-alert error" role="alert">{t(hosts.isError ? 'linuxHosts.loadError' : 'linuxHosts.revokeError')}</p>}
      {hosts.isPending && <p role="status">{t('common.loading')}</p>}
      <HostTable><DataTable columns={columns} rows={state ? items.filter((host) => stateOf(host) === state) : items} rowKey={(host) => host.id} label={t('linuxHosts.title')} loading={hosts.isPending} empty={hosts.isError ? null : <p className="no-data">{t('linuxHosts.empty')}</p>} /></HostTable>
    </section>
    {detail && <HostDetails host={detail} onClose={() => setSelected(null)} audit={canAudit} />}
    {canManage && enrollHost !== null && <EnrollDialog hosts={items.filter((host) => host.device)} initialId={enrollHost} close={() => setEnrollHost(null)} refresh={refresh} />}
    {confirmDialog}
  </div>;
}
