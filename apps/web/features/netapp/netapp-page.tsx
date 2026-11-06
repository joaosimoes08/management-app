'use client';

import { FormEvent, useEffect, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { AlertTriangle, Check, HardDrive, RefreshCw, Save, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { useSiteContext } from '@/lib/site-context';
import { configureNetAppIntegration, getNetAppIntegration, refreshNetAppSnapshot, type NetAppIntegrationInput, type NetAppSnapshot } from './api';

const emptyForm = { endpointUrl: '', username: '', password: '' };
const formatBytes = (value?: number | null) => typeof value === 'number' && Number.isFinite(value) ? new Intl.NumberFormat('pt-PT', { style: 'unit', unit: 'byte', unitDisplay: 'narrow', notation: 'compact', maximumFractionDigits: 1 }).format(value) : '—';
const dateLabel = (value?: string | null) => value ? new Date(value).toLocaleString('pt-PT') : '—';
const messageOf = (value: unknown) => value instanceof Error ? value.message : 'A operação NetApp falhou.';

export default function NetAppPage() {
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
    onSuccess: async (saved) => { setActionError(''); setNotice('A configuração foi guardada.'); setForm((current) => ({ ...current, password: '' })); queryClient.setQueryData(queryKey, saved); await queryClient.invalidateQueries({ queryKey }); },
    onError: (error) => { setNotice(''); setActionError(messageOf(error)); },
  });
  const refreshMutation = useMutation({
    mutationFn: () => refreshNetAppSnapshot(siteId),
    onSuccess: async (updated) => { setActionError(''); setNotice('Snapshot atualizado a partir do ONTAP.'); queryClient.setQueryData(queryKey, updated); await queryClient.invalidateQueries({ queryKey }); },
    onError: async (error) => { setNotice(''); setActionError(messageOf(error)); await queryClient.invalidateQueries({ queryKey }); },
  });
  const integration = integrationQuery.data;
  const snapshot = integration?.snapshot ?? null;
  const missingConfiguration = integrationQuery.isError && /NETAPP_INTEGRATION_NOT_CONFIGURED|não está configurada|not configured/i.test(messageOf(integrationQuery.error));

  useEffect(() => { setForm(emptyForm); setActionError(''); setNotice(''); }, [siteId]);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    setNotice(''); setActionError('');
    saveMutation.mutate(form);
  };

  return <AppShell section="NetApp" actions={<button className="topbar-action secondary-button" disabled={!siteId || siteLoading || integrationQuery.isFetching} onClick={() => void integrationQuery.refetch()}><RefreshCw size={14} className={integrationQuery.isFetching ? 'spin' : ''} /> Atualizar</button>}>
    <main className="module-page snmp-workspace">
      <header className="workspace-head"><div><span className="section-kicker">STORAGE INVENTORY</span><h1>NetApp ONTAP</h1><p>Inventário de storage, capacidade e saúde, isolado ao Site selecionado.</p></div></header>
      {actionError && <div role="alert" className="ipam-alert error"><X size={15} />{actionError}</div>}
      {notice && <div role="status" className="ipam-alert"><Check size={15} />{notice}</div>}
      {!siteId ? <div className="empty-context"><HardDrive size={24} /><strong>{siteLoading ? 'A carregar o Site…' : 'Seleciona um Site para continuar'}</strong><span>Os dados e a configuração NetApp são consultados apenas para o Site ativo.</span></div> : <>
        <section className="snmp-device-bar"><HardDrive size={17} /><strong>{activeSite?.name ?? 'Site selecionado'}</strong><span>{integration?.lastErrorCode ? 'ÚLTIMA ATUALIZAÇÃO COM FALHA' : integration?.configured ? snapshot ? 'CONFIGURADO' : 'SEM SNAPSHOT' : missingConfiguration ? 'NÃO CONFIGURADO' : 'A CARREGAR'}</span></section>
        {integrationQuery.isLoading && <section className="ipam-card" aria-live="polite">A carregar a configuração e o último snapshot deste Site…</section>}
        {integrationQuery.isError && !missingConfiguration && <section role="alert" className="ipam-card"><strong>Não foi possível carregar os dados NetApp deste Site.</strong><p>{messageOf(integrationQuery.error)}</p><button className="secondary-button" onClick={() => void integrationQuery.refetch()}>Tentar novamente</button></section>}
        {missingConfiguration && <section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">SEM CONFIGURAÇÃO</span><h2>Este Site ainda não tem integração NetApp</h2></div><AlertTriangle size={18} /></div><p>Um administrador pode configurar o endereço HTTPS do ONTAP e uma conta apenas de leitura. Não serão enviados comandos de alteração ao storage.</p></section>}
        {canConfigure && <section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">ADMINISTRAÇÃO DO SITE</span><h2>{integration ? 'Atualizar configuração' : 'Configurar integração'}</h2></div><Save size={18} /></div><p>O segredo nunca é devolvido ao browser. Para substituir a configuração, introduz a nova palavra-passe da conta ONTAP.</p><form className="snmp-form-grid" onSubmit={submit}>
          <label><span>Endpoint HTTPS (origem)</span><input required type="url" placeholder="https://ontap.example.local" value={form.endpointUrl} onChange={(event) => setForm({ ...form, endpointUrl: event.target.value })} autoComplete="url" /></label>
          <label><span>Username ONTAP</span><input required value={form.username} onChange={(event) => setForm({ ...form, username: event.target.value })} autoComplete="username" /></label>
          <label><span>{integration ? 'Nova palavra-passe' : 'Palavra-passe'}</span><input required type="password" value={form.password} onChange={(event) => setForm({ ...form, password: event.target.value })} autoComplete="new-password" /></label>
          <button className="primary-button" type="submit" disabled={saveMutation.isPending || !siteId}><Save size={14} />{saveMutation.isPending ? 'A guardar…' : 'Guardar configuração'}</button>
        </form>{integration && <p>Configurado para <strong>{integration.username}</strong> em <span className="mono">{integration.endpointUrl}</span>.</p>}</section>}
        {integration && <>
          <section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">SCOPE · {activeSite?.name ?? 'SITE'}</span><h2>Estado da integração</h2></div>{canRefresh && <button className="primary-button" disabled={refreshMutation.isPending} onClick={() => { setActionError(''); setNotice(''); refreshMutation.mutate(); }}><RefreshCw size={14} className={refreshMutation.isPending ? 'spin' : ''} />{refreshMutation.isPending ? 'A consultar…' : 'Atualizar snapshot'}</button>}</div>
            <div className="summary-stats"><div><strong>{snapshot?.systems.length ?? 0}</strong><span>Sistemas</span></div><div><strong>{snapshot?.nodes.length ?? 0}</strong><span>Nós</span></div><div><strong>{snapshot?.volumes.length ?? 0}</strong><span>Volumes</span></div></div>
            <div className="detail-grid"><div><span>Saúde</span><strong>{snapshot?.health ?? 'Sem dados'}</strong></div><div><span>Capacidade total</span><strong>{formatBytes(snapshot?.capacity.sizeBytes)}</strong></div><div><span>Utilizada</span><strong>{formatBytes(snapshot?.capacity.usedBytes)}{snapshot?.capacity.usedPercent != null ? ` · ${snapshot.capacity.usedPercent}%` : ''}</strong></div><div><span>Livre</span><strong>{formatBytes(snapshot?.capacity.availableBytes)}</strong></div><div><span>Último sucesso</span><strong>{dateLabel(integration.lastSuccessAt)}</strong></div><div><span>Última tentativa</span><strong>{dateLabel(integration.lastAttemptAt)}</strong></div></div>
            {integration.lastErrorCode && <div role="status" className="ipam-alert error"><AlertTriangle size={15} />A última atualização falhou ({integration.lastErrorCode}). Os dados abaixo são o último snapshot conhecido e foram mantidos.</div>}
            {!snapshot && <div className="empty-context"><HardDrive size={22} /><strong>Ainda não existe snapshot</strong><span>Usa “Atualizar snapshot” para importar sistemas, nós, aggregates, volumes, capacidade e saúde.</span></div>}
          </section>
          {snapshot && <SnapshotTables snapshot={snapshot} />}
        </>}
      </>}
    </main>
  </AppShell>;
}

function SnapshotTables({ snapshot }: { snapshot: NetAppSnapshot }) {
  return <>
    <SnapshotTable title="Sistemas" rows={snapshot.systems.map((item) => [item.name, item.version ?? '—', item.serialNumber ?? item.uuid ?? '—'])} headings={['Sistema', 'Versão', 'Número de série / UUID']} />
    <SnapshotTable title="Nós" rows={snapshot.nodes.map((item) => [item.name, item.health ?? '—', item.eligibility ?? '—'])} headings={['Nó', 'Saúde', 'Elegibilidade']} />
    <SnapshotTable title="Aggregates" rows={snapshot.aggregates.map((item) => [item.name, item.state ?? '—', `${formatBytes(item.usedBytes)} / ${formatBytes(item.sizeBytes)}`])} headings={['Aggregate', 'Estado', 'Utilizado / total']} />
    <SnapshotTable title="Volumes" rows={snapshot.volumes.map((item) => [item.name, item.svm ?? '—', item.state ?? '—', `${formatBytes(item.usedBytes)} / ${formatBytes(item.sizeBytes)}`])} headings={['Volume', 'SVM', 'Estado', 'Utilizado / total']} />
    <p className="netapp-observed-at">Snapshot observado em {dateLabel(snapshot.observedAt)}.</p>
  </>;
}

function SnapshotTable({ title, rows, headings }: { title: string; rows: string[][]; headings: string[] }) {
  return <section className="ipam-card"><div className="panel-heading"><div><span className="section-kicker">SNAPSHOT</span><h2>{title}</h2></div><span>{rows.length}</span></div>{rows.length ? <div className="ip-table-wrap"><table className="ip-table"><thead><tr>{headings.map((heading) => <th key={heading}>{heading}</th>)}</tr></thead><tbody>{rows.map((row, index) => <tr key={`${row[0]}-${index}`}>{row.map((value, cell) => <td key={`${cell}-${value}`}>{value}</td>)}</tr>)}</tbody></table></div> : <p>Sem registos neste snapshot.</p>}</section>;
}
