'use client';

import { FormEvent, useEffect, useRef, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, HardDrive, RefreshCw, Save, X } from 'lucide-react';
import { PageShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { configureNetAppIntegration, getNetAppIntegration, refreshNetAppSnapshot, type NetAppIntegrationInput, type NetAppSnapshot } from './api';
import { formatDateTime } from '@/lib/format/date';
import { DataTable } from '@/components/data-table/data-table';
import { CapacityTable, formatBytes, NetAppCapacityTrend, TopFullest, type TrendTarget } from './netapp-capacity';
import { useUiText } from '@/components/ui/use-ui-text';

type UiText = ReturnType<typeof useUiText>;

const emptyForm = { endpointUrl: '', username: '', password: '' };
const dateLabel = (value?: string | null) => value ? formatDateTime(value) : '—';
const messageOf = (value: unknown, ui: UiText) => value instanceof Error ? value.message : ui('netapp.operationFailed');

export default function NetAppPage() {
  const ui = useUiText();
  const { hasRole } = useAuth();
  const { siteId, activeSite, loading: siteLoading } = useSiteContext();
  const canConfigure = hasRole('ADMIN');
  const canRefresh = canConfigure || hasRole('SYSTEMS_OPERATOR');
  const queryClient = useQueryClient();
  const [form, setForm] = useState<NetAppIntegrationInput>(emptyForm);
  const [actionError, setActionError] = useState('');
  const [notice, setNotice] = useState('');
  const queryKey = ['netapp', 'site', siteId];
  const integrationQuery = useQuery({ queryKey, queryFn: () => getNetAppIntegration(siteId), enabled: Boolean(siteId), retry: false });
  const saveMutation = useMutation({
    mutationFn: (input: NetAppIntegrationInput) => configureNetAppIntegration(siteId, input),
    onSuccess: async (saved) => { setActionError(''); setNotice(ui('netapp.notice.saved')); setForm((current) => ({ ...current, password: '' })); queryClient.setQueryData(queryKey, saved); await queryClient.invalidateQueries({ queryKey }); },
    onError: (error) => { setNotice(''); setActionError(messageOf(error, ui)); },
  });
  const refreshMutation = useMutation({
    mutationFn: () => refreshNetAppSnapshot(siteId),
    onSuccess: async (updated) => { setActionError(''); setNotice(ui('netapp.notice.refreshed')); queryClient.setQueryData(queryKey, updated); await queryClient.invalidateQueries({ queryKey }); },
    onError: async (error) => { setNotice(''); setActionError(messageOf(error, ui)); await queryClient.invalidateQueries({ queryKey }); },
  });
  const integration = integrationQuery.data?.configured ? integrationQuery.data : undefined;
  const snapshot = integration?.snapshot ?? null;
  const missingConfiguration = integrationQuery.data?.configured === false;

  useEffect(() => { setForm(emptyForm); setActionError(''); setNotice(''); }, [siteId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(''); setActionError('');
    saveMutation.mutate(form);
  };

  return <PageShell section="NetApp" actions={<><button className="topbar-action secondary-button" disabled={!siteId || siteLoading || integrationQuery.isFetching} onClick={() => void integrationQuery.refetch()}><RefreshCw size={14} className={integrationQuery.isFetching ? 'spin' : ''} /> {ui('netapp.refresh')}</button>{integration && canRefresh && <button className="primary-button" disabled={refreshMutation.isPending} onClick={() => { setActionError(''); setNotice(''); refreshMutation.mutate(); }}><RefreshCw size={14} className={refreshMutation.isPending ? 'spin' : ''} />{refreshMutation.isPending ? ui('netapp.snapshot.querying') : ui('netapp.snapshot.refresh')}</button>}</>}>
    <div className="module-page snmp-workspace aligned-workspace">
      <section className="ipam-card page-primary-card"><div className="panel-heading"><div><h1>NetApp ONTAP</h1><p className="panel-description">{ui('netapp.description')}</p></div></div><div className="page-primary-content">
      {actionError && <div role="alert" className="ipam-alert error"><X size={15} />{actionError}</div>}
      {notice && <div role="status" className="ipam-alert"><Check size={15} />{notice}</div>}
      {!siteId ? <div className="empty-context"><HardDrive size={24} /><strong>{siteLoading ? ui('netapp.site.loading') : ui('netapp.site.select')}</strong><span>{ui('netapp.site.scopeNote')}</span></div> : <>
        <section className="snmp-device-bar"><HardDrive size={17} /><strong>{activeSite?.name ?? ui('netapp.site.selected')}</strong><span>{integration?.lastErrorCode ? ui('netapp.status.lastRefreshFailed') : integration?.configured ? snapshot ? ui('netapp.status.configured') : ui('netapp.status.noSnapshot') : missingConfiguration ? ui('netapp.status.notConfigured') : ui('netapp.status.loading')}</span></section>
        {integrationQuery.isLoading && <section className="ipam-card" aria-live="polite">{ui('netapp.loadingIntegration')}</section>}
        {integrationQuery.isError && !missingConfiguration && <section role="alert" className="ipam-card"><strong>{ui('netapp.loadError.title')}</strong><p>{messageOf(integrationQuery.error, ui)} {ui('netapp.loadError.retry')}</p></section>}
        {missingConfiguration && <section className="ipam-card"><div className="panel-heading"><div><h2>{ui('netapp.missing.title')}</h2></div><AlertTriangle size={18} /></div><p>{ui('netapp.missing.description')}</p></section>}
        {canConfigure && <section className="ipam-card"><div className="panel-heading"><div><h2>{integration ? ui('netapp.config.update') : ui('netapp.config.setup')}</h2></div><Save size={18} /></div><p>{ui('netapp.config.secretNote')}</p><form className="snmp-form-grid" onSubmit={submit}>
          <label><span>{ui('netapp.config.endpoint')}</span><input required type="url" placeholder="https://ontap.example.local" value={form.endpointUrl} onChange={(event) => setForm({ ...form, endpointUrl: event.target.value })} autoComplete="url" /></label>
          <label><span>{ui('netapp.config.username')}</span><input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" /></label>
          <label><span>{integration ? ui('netapp.config.newPassword') : ui('netapp.config.password')}</span><input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
          <button className="primary-button" type="submit" disabled={saveMutation.isPending || !siteId}><Save size={14} />{saveMutation.isPending ? ui('netapp.config.saving') : ui('netapp.config.save')}</button>
        </form>{integration && <p>{ui('netapp.config.configuredFor')} <strong>{integration.username}</strong> {ui('netapp.config.at')} <span className="mono">{integration.endpointUrl}</span>.</p>}</section>}
        {integration && <>
          <section className="ipam-card"><div className="panel-heading"><div><h2>{ui('netapp.summary.title')}</h2></div></div>
            <div className="summary-stats"><div><strong>{snapshot?.systems.length ?? 0}</strong><span>{ui('netapp.systems')}</span></div><div><strong>{snapshot?.nodes.length ?? 0}</strong><span>{ui('netapp.nodes')}</span></div><div><strong>{snapshot?.volumes.length ?? 0}</strong><span>{ui('netapp.volumes')}</span></div></div>
            <div className="detail-grid"><div><span>{ui('netapp.health')}</span><strong>{snapshot?.health ?? ui('netapp.summary.noData')}</strong></div><div><span>{ui('netapp.summary.totalCapacity')}</span><strong>{formatBytes(snapshot?.capacity.sizeBytes)}</strong></div><div><span>{ui('netapp.summary.used')}</span><strong>{formatBytes(snapshot?.capacity.usedBytes)}{snapshot?.capacity.usedPercent != null ? ` · ${snapshot.capacity.usedPercent}%` : ''}</strong></div><div><span>{ui('netapp.summary.free')}</span><strong>{formatBytes(snapshot?.capacity.availableBytes)}</strong></div><div><span>{ui('netapp.summary.lastSuccess')}</span><strong>{dateLabel(integration.lastSuccessAt)}</strong></div><div><span>{ui('netapp.summary.lastAttempt')}</span><strong>{dateLabel(integration.lastAttemptAt)}</strong></div></div>
            {integration.lastErrorCode && <div role="status" className="ipam-alert error"><AlertTriangle size={15} />{ui('netapp.lastRefreshFailed', undefined, { code: integration.lastErrorCode })}</div>}
            {!snapshot && <div className="empty-context"><HardDrive size={22} /><strong>{ui('netapp.noSnapshot.title')}</strong><span>{ui('netapp.noSnapshot.hint')}</span></div>}
          </section>
          {snapshot && <SnapshotTables key={siteId} siteId={siteId} snapshot={snapshot} />}
        </>}
      </>}
    </div></section></div>
  </PageShell>;
}

function SnapshotTables({ siteId, snapshot }: { siteId: string; snapshot: NetAppSnapshot }) {
  const ui = useUiText();
  const [trendTarget, setTrendTarget] = useState<TrendTarget>({ kind: 'CLUSTER', key: null });
  const openedFromLink = useRef(false);
  useEffect(() => {
    if (openedFromLink.current) return;
    openedFromLink.current = true;
    const params = new URLSearchParams(window.location.search);
    const kind = params.get('trendKind');
    const key = params.get('trendKey');
    const objects = kind === 'VOLUME' ? snapshot.volumes : kind === 'AGGREGATE' ? snapshot.aggregates : [];
    if ((kind === 'VOLUME' || kind === 'AGGREGATE') && key && objects.some((item) => (item.uuid || item.name) === key)) {
      setTrendTarget({ kind, key });
      document.getElementById('netapp-capacity-trend')?.scrollIntoView?.({ block: 'start' });
    }
  }, [siteId, snapshot]);
  const showTrend = (target: TrendTarget) => {
    setTrendTarget(target);
    document.getElementById('netapp-capacity-trend')?.scrollIntoView?.({ behavior: 'smooth', block: 'start' });
  };
  return <>
    <div className="ipam-overview-grid">
      <TopFullest snapshot={snapshot} onTrend={showTrend} />
      <NetAppCapacityTrend siteId={siteId} target={trendTarget} onTarget={setTrendTarget} />
    </div>
    <SnapshotTable title={ui('netapp.systems')} rows={snapshot.systems.map((item) => [item.name, item.version ?? '—', item.serialNumber ?? item.uuid ?? '—'])} headings={[ui('netapp.table.system'), ui('netapp.table.version'), ui('netapp.table.serial')]} />
    <SnapshotTable title={ui('netapp.nodes')} rows={snapshot.nodes.map((item) => [item.name, item.health ?? '—', item.eligibility ?? '—'])} headings={[ui('netapp.table.node'), ui('netapp.health'), ui('netapp.table.eligibility')]} />
    <CapacityTable title={ui('netapp.aggregates')} kind="AGGREGATE" items={snapshot.aggregates} onTrend={showTrend} />
    <CapacityTable title={ui('netapp.volumes')} kind="VOLUME" items={snapshot.volumes} onTrend={showTrend} />
    <p className="netapp-observed-at">{ui('netapp.observedAt', undefined, { date: dateLabel(snapshot.observedAt) })}</p>
  </>;
}

function SnapshotTable({ title, rows, headings }: { title: string; rows: string[][]; headings: string[] }) {
  const ui = useUiText();
  return <section className="ipam-card"><div className="panel-heading"><div><h2>{title}</h2></div><span>{rows.length}</span></div>{rows.length ? <DataTable<{ key: string; cells: string[] }> rows={rows.map((cells, index) => ({ key: `${cells[0]}-${index}`, cells }))} rowKey={(row) => row.key} label={title} columns={headings.map((heading, cell) => ({ id: String(cell), header: heading, cell: (row) => row.cells[cell] }))} /> : <p>{ui('netapp.table.empty')}</p>}</section>;
}
