'use client';

import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Bell, Check, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';

export type DeliveryTarget = 'USER_NOTIFICATIONS' | 'GROUP_ALERTS';
export type ChannelStatus = { kind: 'TEAMS'; target: DeliveryTarget; enabled: boolean; configured: boolean; minSeverity: 'CRITICAL' | 'HIGH' | null; updatedAt: string | null };
type ChannelsResponse = { channels: ChannelStatus[]; keyringAvailable: boolean; publicLinks: boolean; maxAttempts: number };
type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
export type DeliveryItem = {
  id: string; target: DeliveryTarget; status: DeliveryStatus; topic: string; title: string; attempts: number;
  failureReason: string | null; createdAt: string; sentAt: string | null; nextAttemptAt: string | null;
  recipient: { username: string; displayName: string | null } | null;
};
type DeliveryPage = { items: DeliveryItem[]; nextCursor: string | null; counts: Partial<Record<DeliveryStatus, number>> };
type Draft = { enabled: boolean; webhookUrl: string; minSeverity: 'CRITICAL' | 'HIGH' };

const BASE = '/api/v1/settings/notification-channels/TEAMS';
const TARGETS: { target: DeliveryTarget; title: string; description: string }[] = [
  { target: 'USER_NOTIFICATIONS', title: 'Notificações pessoais', description: 'Cópia das notificações de cada utilizador que a ativar em Perfil → Notificações. A mensagem indica o destinatário e é visível para os membros do canal.' },
  { target: 'GROUP_ALERTS', title: 'Alertas operacionais', description: 'Alertas críticos e altos publicados num canal de grupo. CRITICAL é sempre enviado; os restantes respeitam janelas de manutenção e regras de alerta.' },
];
const STATUS: Record<DeliveryStatus, { label: string; badge: string }> = {
  PENDING: { label: 'Pendente', badge: 'pending' },
  SENDING: { label: 'A enviar', badge: 'processing' },
  SENT: { label: 'Enviada', badge: 'approved' },
  FAILED: { label: 'Falhou', badge: 'rejected' },
};
const TOPICS: Record<string, string> = {
  TEST: 'Mensagem de teste', OPERATIONAL_ALERT: 'Alerta operacional', ROLE_REQUEST: 'Pedido de acesso',
  CRITICAL_ASSET_ATTESTATION: 'Atestação de ativos críticos', LIFECYCLE_DATE: 'Data de ciclo de vida',
};
/** Failure codes are stable API values; the webhook address is never part of them. */
export function failureLabel(code: string | null): string {
  if (!code) return '—';
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return `O Teams respondeu HTTP ${http[1]}`;
  return ({
    TIMEOUT: 'Sem resposta em 10 s', NETWORK_ERROR: 'Erro de rede', REDIRECT_BLOCKED: 'Redirecionamento recusado',
    CHANNEL_DISABLED: 'Canal desativado', CHANNEL_NOT_CONFIGURED: 'Canal sem webhook', KEYRING_UNAVAILABLE: 'Chave de cifra indisponível',
    SECRET_UNREADABLE: 'Webhook guardado ilegível', TEAMS_WEBHOOK_INVALID: 'Webhook inválido', DISPATCH_ERROR: 'Erro interno ao enviar',
  } as Record<string, string>)[code] ?? code;
}
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const draftOf = (channel?: ChannelStatus): Draft => ({ enabled: channel?.enabled ?? false, webhookUrl: '', minSeverity: channel?.minSeverity ?? 'HIGH' });

/** Definições → Notificações: Microsoft Teams webhooks (write-only), test message and delivery log. */
export function NotificationChannelsSettings() {
  const { success, error: toastError } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [state, setState] = useState<ChannelsResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<DeliveryTarget, Draft>>({ USER_NOTIFICATIONS: draftOf(), GROUP_ALERTS: draftOf() });
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');
  const [log, setLog] = useState<DeliveryPage | null>(null);
  const [logError, setLogError] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try {
      const next = await apiFetch<ChannelsResponse>('/api/v1/settings/notification-channels');
      setState(next);
      const byTarget = (target: DeliveryTarget) => next.channels.find((item) => item.target === target);
      setDrafts({ USER_NOTIFICATIONS: draftOf(byTarget('USER_NOTIFICATIONS')), GROUP_ALERTS: draftOf(byTarget('GROUP_ALERTS')) });
    } catch (reason) { setFeedback(messageOf(reason, 'Não foi possível carregar os canais de notificação.')); }
    finally { setLoading(false); }
  }, []);
  const loadLog = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams();
    if (statusFilter) query.set('status', statusFilter);
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await apiFetch<DeliveryPage>(`/api/v1/settings/notification-deliveries${query.size ? `?${query}` : ''}`);
      setLog((current) => cursor && current ? { ...page, items: [...current.items, ...page.items] } : page);
      setLogError('');
    } catch (reason) { setLogError(messageOf(reason, 'Não foi possível carregar o registo de entregas.')); }
  }, [statusFilter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const channel = (target: DeliveryTarget) => state?.channels.find((item) => item.target === target);
  const setDraft = (target: DeliveryTarget, change: Partial<Draft>) => setDrafts((current) => ({ ...current, [target]: { ...current[target], ...change } }));

  const save = async (event: FormEvent) => {
    event.preventDefault(); setBusy('save'); setFeedback('');
    try {
      for (const { target } of TARGETS) {
        const draft = drafts[target]; const current = channel(target);
        const url = draft.webhookUrl.trim();
        const changed = url || draft.enabled !== current?.enabled || (target === 'GROUP_ALERTS' && draft.minSeverity !== (current?.minSeverity ?? 'HIGH'));
        if (!changed) continue;
        await apiFetch(`${BASE}/${target}`, { method: 'PUT', body: JSON.stringify({ enabled: draft.enabled, ...(url ? { webhookUrl: url } : {}), ...(target === 'GROUP_ALERTS' ? { minSeverity: draft.minSeverity } : {}) }) });
      }
      setFeedback('Configuração guardada. O endereço do webhook fica cifrado e não é devolvido pela aplicação.');
      success('Notificações', 'Canais Microsoft Teams guardados');
      await load();
    } catch (reason) { const message = messageOf(reason, 'Não foi possível guardar.'); setFeedback(message); toastError('Notificações', message); }
    finally { setBusy(''); }
  };
  const test = async (target: DeliveryTarget) => {
    setBusy(`test:${target}`); setFeedback('');
    try {
      const result = await apiFetch<{ status: DeliveryStatus; failureReason: string | null }>(`${BASE}/${target}/test`, { method: 'POST' });
      if (result.status === 'SENT') success('Microsoft Teams', 'Mensagem de teste enviada');
      else { const message = `Mensagem de teste falhou: ${failureLabel(result.failureReason)}`; setFeedback(message); toastError('Microsoft Teams', message); }
      await loadLog();
    } catch (reason) { const message = messageOf(reason, 'Não foi possível enviar a mensagem de teste.'); setFeedback(message); toastError('Microsoft Teams', message); }
    finally { setBusy(''); }
  };
  const clear = async (target: DeliveryTarget, title: string) => {
    if (!(await confirm({ title: 'Remover webhook', message: `Remover o webhook de “${title}” e desativar o canal?`, confirmLabel: 'Remover', destructive: true }))) return;
    setBusy(`clear:${target}`);
    try { await apiFetch(`${BASE}/${target}`, { method: 'DELETE' }); success('Microsoft Teams', 'Webhook removido'); await load(); }
    catch (reason) { toastError('Microsoft Teams', messageOf(reason, 'Não foi possível remover o webhook.')); }
    finally { setBusy(''); }
  };
  const retry = async (item: DeliveryItem) => {
    setBusy(`retry:${item.id}`);
    try { await apiFetch(`/api/v1/settings/notification-deliveries/${item.id}/retry`, { method: 'POST' }); success('Microsoft Teams', 'Entrega reagendada'); await loadLog(); }
    catch (reason) { toastError('Microsoft Teams', messageOf(reason, 'Não foi possível reagendar a entrega.')); }
    finally { setBusy(''); }
  };

  const columns: DataTableColumn<DeliveryItem>[] = [
    { id: 'createdAt', header: 'Criada', cell: (item) => formatDateTime(item.createdAt) },
    { id: 'topic', header: 'Tipo', cell: (item) => <><strong>{TOPICS[item.topic] ?? item.topic}</strong><br /><small>{item.title}</small></> },
    { id: 'target', header: 'Canal', cell: (item) => item.target === 'GROUP_ALERTS' ? 'Alertas operacionais' : `Pessoal · ${item.recipient?.displayName?.trim() || item.recipient?.username || '—'}` },
    { id: 'status', header: 'Estado', cell: (item) => <span className={`state-badge ${STATUS[item.status]?.badge ?? ''}`.trim()} data-status={item.status}><i />{STATUS[item.status]?.label ?? item.status}</span> },
    { id: 'attempts', header: 'Tentativas', cell: (item) => `${item.attempts}/${state?.maxAttempts ?? 5}` },
    { id: 'failure', header: 'Motivo', cell: (item) => item.failureReason ? <span title={item.failureReason}>{failureLabel(item.failureReason)}{item.status === 'PENDING' && item.nextAttemptAt ? ` · nova tentativa ${formatDateTime(item.nextAttemptAt)}` : ''}</span> : '—' },
    { id: 'actions', header: 'Ações', cell: (item) => item.status === 'FAILED' ? <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void retry(item)}><RotateCcw size={14} />Repetir</button> : null },
  ];

  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><h2>Microsoft Teams</h2><p className="panel-description">Envia notificações e alertas para canais Teams através de webhooks de entrada (Workflows). O envio é feito em segundo plano, com novas tentativas automáticas, e nunca atrasa a aplicação.</p></div><Bell size={19} /></div>
    {state && !state.keyringAvailable && <div className="ipam-alert error">A chave de cifra (SNMP_KEYRING_FILE) não está disponível; não é possível guardar nem usar webhooks.</div>}
    {state && !state.publicLinks && <div className="ipam-alert">APP_PUBLIC_URL não está definido: as mensagens são enviadas sem botão “Abrir na aplicação”.</div>}
    {feedback && <div className="ipam-alert">{feedback}</div>}
    <form className="settings-form" id="settings-notifications-form" onSubmit={(event) => void save(event)} aria-busy={loading}>
      {TARGETS.map(({ target, title, description }) => {
        const current = channel(target); const draft = drafts[target];
        return <fieldset key={target} className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
          <legend>{title}</legend>
          <p className="panel-description">{description}</p>
          <div className="integration-row"><span><strong>Estado</strong><small>{loading ? 'A carregar…' : !current?.configured ? 'Sem webhook · desativado' : current.enabled ? `Ativo${current.updatedAt ? ` · atualizado ${formatDateTime(current.updatedAt)}` : ''}` : 'Webhook guardado · desativado'}</small></span></div>
          <label>URL do webhook<input type="password" autoComplete="off" spellCheck={false} maxLength={2048} placeholder={current?.configured ? 'Guardado — introduz um novo endereço para substituir' : 'https://…webhook.office.com/… ou https://…logic.azure.com/…'} value={draft.webhookUrl} onChange={(event) => setDraft(target, { webhookUrl: event.target.value })} /><small>Só são aceites endereços HTTPS do Microsoft Teams / Power Automate. O endereço é cifrado e nunca é mostrado depois de guardado.</small></label>
          {target === 'GROUP_ALERTS' && <label>Severidade mínima<select value={draft.minSeverity} onChange={(event) => setDraft(target, { minSeverity: event.target.value as Draft['minSeverity'] })}><option value="HIGH">HIGH e CRITICAL</option><option value="CRITICAL">Só CRITICAL</option></select></label>}
          <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft(target, { enabled: event.target.checked })} /> Ativar este canal</label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void test(target)}><Send size={14} />{busy === `test:${target}` ? 'A enviar…' : 'Enviar mensagem de teste'}</button>
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void clear(target, title)}><Trash2 size={14} />Remover</button>
          </div>
        </fieldset>;
      })}
    </form>
    <div className="panel-heading notification-delivery-heading"><div><h3>Registo de entregas</h3><p className="panel-description">Últimos 90 dias. Até {state?.maxAttempts ?? 5} tentativas por mensagem; o motivo da falha nunca inclui o endereço do webhook.</p></div>
      <div className="modal-actions notification-delivery-filters">
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeliveryStatus | '')}><option value="">Todos{log ? ` (${Object.values(log.counts).reduce((sum, value) => sum + (value ?? 0), 0)})` : ''}</option>{(Object.keys(STATUS) as DeliveryStatus[]).map((status) => <option key={status} value={status}>{STATUS[status].label}{log ? ` (${log.counts[status] ?? 0})` : ''}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => void loadLog()}><RefreshCw size={14} />Atualizar</button>
      </div>
    </div>
    {logError && <div className="ipam-alert error">{logError}</div>}
    {log && <DataTable rows={log.items} columns={columns} rowKey={(item) => item.id} label="Registo de entregas Microsoft Teams" empty={<p className="no-data">Sem entregas registadas.</p>} />}
    {log?.nextCursor && <div className="form-actions"><button type="button" className="secondary-button" onClick={() => void loadLog(log.nextCursor!)}>Carregar mais</button></div>}
    <PageToolbarPortal><button type="submit" form="settings-notifications-form" className="primary-button" disabled={loading || Boolean(busy) || !state?.keyringAvailable}><Check size={14} />{busy === 'save' ? 'A guardar…' : 'Guardar'}</button></PageToolbarPortal>
    {confirmDialog}
  </section>;
}
