'use client';

import { FormEvent, useCallback, useEffect, useId, useState } from 'react';
import { Bell, Check, Mail, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';

export type DeliveryTarget = 'USER_NOTIFICATIONS' | 'GROUP_ALERTS';
export type ChannelKind = 'TEAMS' | 'EMAIL';
export type SmtpSecurity = 'TLS' | 'STARTTLS' | 'NONE';
export type SmtpView = { host: string; port: number; security: SmtpSecurity; username: string | null; from: string; passwordSet: boolean };
export type ChannelStatus = {
  kind: ChannelKind; target: DeliveryTarget; enabled: boolean; configured: boolean; minSeverity: 'CRITICAL' | 'HIGH' | null; updatedAt: string | null;
  /** EMAIL/USER_NOTIFICATIONS only: the SMTP server, without the password. */
  smtp?: SmtpView | null;
  /** EMAIL/GROUP_ALERTS only. */
  recipients?: string[]; serverConfigured?: boolean;
  /** GROUP_ALERTS only: what the channel still needs before it sends alerts (empty when ready). */
  delivery?: { ready: boolean; missing: GroupDeliveryMissing[] };
};
export type GroupDeliveryMissing = 'enabled' | 'destination' | 'minSeverity';
type ChannelsResponse = {
  channels: ChannelStatus[]; keyringAvailable: boolean; publicLinks: boolean; maxAttempts: number; maxTotalAttempts?: number;
  /** True when no group channel can send operational alerts. */
  groupAlertsUnconfigured?: boolean;
};
type DeliveryStatus = 'PENDING' | 'SENDING' | 'SENT' | 'FAILED';
export type DeliveryItem = {
  id: string; channel?: ChannelKind; target: DeliveryTarget; status: DeliveryStatus; topic: string; title: string; attempts: number;
  failureReason: string | null; createdAt: string; sentAt: string | null; nextAttemptAt: string | null;
  recipient: { username: string; displayName: string | null } | null;
};
type DeliveryPage = { items: DeliveryItem[]; nextCursor: string | null; counts: Partial<Record<DeliveryStatus, number>> };
/** '' = not chosen yet. There is no default: a group channel without a minimum severity sends nothing. */
type GroupSeverity = 'CRITICAL' | 'HIGH' | '';
type Draft = { enabled: boolean; webhookUrl: string; minSeverity: GroupSeverity };
type SmtpDraft = { enabled: boolean; host: string; port: string; security: SmtpSecurity; username: string; password: string; from: string };
type GroupEmailDraft = { enabled: boolean; minSeverity: GroupSeverity; recipients: string };

const ROOT = '/api/v1/settings/notification-channels';
const BASE = `${ROOT}/TEAMS`;
const EMAIL_BASE = `${ROOT}/EMAIL`;
const DEFAULT_PORT: Record<SmtpSecurity, string> = { STARTTLS: '587', TLS: '465', NONE: '25' };
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
  CRITICAL_ASSET_ATTESTATION: 'Atestação de ativos críticos', LIFECYCLE_DATE: 'Data de ciclo de vida', SCHEDULED_REPORT: 'Relatório agendado',
};
/** Failure codes are stable API values; the webhook address, SMTP password and e-mail addresses are never part of them. */
export function failureLabel(code: string | null): string {
  if (!code) return '—';
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return `O Teams respondeu HTTP ${http[1]}`;
  const auth = /^SMTP_EAUTH(?:_(\d{3}))?$/.exec(code);
  if (auth) return `O servidor SMTP recusou o utilizador ou a palavra-passe${auth[1] ? ` (${auth[1]})` : ''}`;
  const smtp = /^SMTP_(\d{3})$/.exec(code);
  if (smtp) return `O servidor SMTP respondeu ${smtp[1]}`;
  return ({
    SMTP_CONNECTION_FAILED: 'Não foi possível ligar ao servidor SMTP (sem resposta, recusado ou falha TLS)', SMTP_HOST_NOT_ALLOWED: 'Servidor SMTP não permitido (loopback, link-local ou não especificado)',
    SMTP_ECONNECTION: 'Ligação ao servidor SMTP falhou', SMTP_ETIMEDOUT: 'Servidor SMTP sem resposta em 10 s', SMTP_ESOCKET: 'Erro de ligação ao servidor SMTP',
    SMTP_EDNS: 'Servidor SMTP não encontrado (DNS)', SMTP_ETLS: 'Falha na negociação TLS com o servidor SMTP', SMTP_ENOAUTH: 'Servidor SMTP exige autenticação',
    SMTP_EENVELOPE: 'Remetente ou destinatário recusado', SMTP_EPROTOCOL: 'Resposta SMTP inválida', SMTP_ECONFIG: 'Configuração SMTP inválida', SMTP_ERROR: 'Erro ao enviar email',
    RECIPIENT_NO_EMAIL: 'Destinatário sem email definido', REPORT_UNSUBSCRIBED: 'O destinatário cancelou a subscrição do relatório', REPORT_REMOVED: 'Relatório removido antes do envio',
    TIMEOUT: 'Sem resposta em 10 s', NETWORK_ERROR: 'Erro de rede', REDIRECT_BLOCKED: 'Redirecionamento recusado',
    CHANNEL_DISABLED: 'Canal desativado', CHANNEL_NOT_CONFIGURED: 'Canal sem webhook', KEYRING_UNAVAILABLE: 'Chave de cifra indisponível',
    SECRET_UNREADABLE: 'Webhook guardado ilegível', TEAMS_WEBHOOK_INVALID: 'Webhook inválido', DISPATCH_ERROR: 'Erro interno ao enviar',
  } as Record<string, string>)[code] ?? code;
}
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const draftOf = (channel?: ChannelStatus): Draft => ({ enabled: channel?.enabled ?? false, webhookUrl: '', minSeverity: channel?.minSeverity ?? '' });
const smtpDraftOf = (channel?: ChannelStatus): SmtpDraft => ({
  enabled: channel?.enabled ?? false, host: channel?.smtp?.host ?? '', port: String(channel?.smtp?.port ?? DEFAULT_PORT.STARTTLS),
  security: channel?.smtp?.security ?? 'STARTTLS', username: channel?.smtp?.username ?? '', password: '', from: channel?.smtp?.from ?? '',
});
const groupEmailDraftOf = (channel?: ChannelStatus): GroupEmailDraft => ({ enabled: channel?.enabled ?? false, minSeverity: channel?.minSeverity ?? '', recipients: (channel?.recipients ?? []).join('\n') });
const MISSING_TEXT: Record<ChannelKind, Record<GroupDeliveryMissing, string>> = {
  TEAMS: { enabled: 'ativar o canal', destination: 'guardar o webhook', minSeverity: 'escolher a severidade mínima' },
  EMAIL: { enabled: 'ativar o canal', destination: 'configurar o servidor SMTP e os destinatários', minSeverity: 'escolher a severidade mínima' },
};
/** "Não envia alertas: falta escolher a severidade mínima." or null when the channel is ready. */
export function groupDeliveryNote(channel?: ChannelStatus | null): string | null {
  const missing = channel?.delivery?.missing;
  if (!channel || !missing?.length) return null;
  const items = missing.map((item) => MISSING_TEXT[channel.kind ?? 'TEAMS'][item]);
  return `Não envia alertas: falta ${items.length > 1 ? `${items.slice(0, -1).join(', ')} e ${items.at(-1)}` : items[0]}.`;
}
/** Older APIs do not send groupAlertsUnconfigured; derive it the same way. */
export function groupAlertsUnconfigured(state: Pick<ChannelsResponse, 'channels' | 'groupAlertsUnconfigured'>): boolean {
  if (typeof state.groupAlertsUnconfigured === 'boolean') return state.groupAlertsUnconfigured;
  return !state.channels.some((item) => item.target === 'GROUP_ALERTS' && (item.delivery ? item.delivery.ready : item.enabled && item.configured && Boolean(item.minSeverity)));
}
/** No preselected value: the minimum severity is an explicit choice (Joao's rule, #145). */
function GroupSeveritySelect({ value, required, onChange }: { value: GroupSeverity; required: boolean; onChange: (value: GroupSeverity) => void }) {
  const hintId = useId();
  return <div className="field-with-hint"><label>Severidade mínima<select value={value} aria-describedby={hintId} aria-invalid={required && !value ? true : undefined} onChange={(event) => onChange(event.target.value as GroupSeverity)}>
    <option value="">Escolher severidade…</option><option value="HIGH">Alto e Crítico</option><option value="CRITICAL">Só Crítico</option>
  </select></label><small id={hintId}>Sem severidade escolhida, este canal não envia alertas.</small></div>;
}
const splitRecipients = (value: string) => value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
const smtpChanged = (draft: SmtpDraft, current?: SmtpView | null) => Boolean(draft.password) || (current
  ? draft.host.trim() !== current.host || Number(draft.port) !== current.port || draft.security !== current.security || draft.username.trim() !== (current.username ?? '') || draft.from.trim() !== current.from
  : Boolean(draft.host.trim() || draft.from.trim() || draft.username.trim()));

/** Definições → Notificações: Microsoft Teams webhooks and the SMTP server (secrets write-only), test messages and delivery log. */
export function NotificationChannelsSettings() {
  const { success, error: toastError } = useToast();
  const { confirm, confirmDialog } = useConfirm();
  const [state, setState] = useState<ChannelsResponse | null>(null);
  const [drafts, setDrafts] = useState<Record<DeliveryTarget, Draft>>({ USER_NOTIFICATIONS: draftOf(), GROUP_ALERTS: draftOf() });
  const [smtpDraft, setSmtpDraft] = useState<SmtpDraft>(smtpDraftOf());
  const [groupEmail, setGroupEmail] = useState<GroupEmailDraft>(groupEmailDraftOf());
  const [channelFilter, setChannelFilter] = useState<ChannelKind | ''>('');
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
      const find = (kind: ChannelKind, target: DeliveryTarget) => next.channels.find((item) => (item.kind ?? 'TEAMS') === kind && item.target === target);
      setDrafts({ USER_NOTIFICATIONS: draftOf(find('TEAMS', 'USER_NOTIFICATIONS')), GROUP_ALERTS: draftOf(find('TEAMS', 'GROUP_ALERTS')) });
      setSmtpDraft(smtpDraftOf(find('EMAIL', 'USER_NOTIFICATIONS')));
      setGroupEmail(groupEmailDraftOf(find('EMAIL', 'GROUP_ALERTS')));
    } catch (reason) { setFeedback(messageOf(reason, 'Não foi possível carregar os canais de notificação.')); }
    finally { setLoading(false); }
  }, []);
  const loadLog = useCallback(async (cursor?: string) => {
    const query = new URLSearchParams();
    if (statusFilter) query.set('status', statusFilter);
    if (channelFilter) query.set('channel', channelFilter);
    if (cursor) query.set('cursor', cursor);
    try {
      const page = await apiFetch<DeliveryPage>(`/api/v1/settings/notification-deliveries${query.size ? `?${query}` : ''}`);
      setLog((current) => cursor && current ? { ...page, items: [...current.items, ...page.items] } : page);
      setLogError('');
    } catch (reason) { setLogError(messageOf(reason, 'Não foi possível carregar o registo de entregas.')); }
  }, [statusFilter, channelFilter]);
  useEffect(() => { void load(); }, [load]);
  useEffect(() => { void loadLog(); }, [loadLog]);

  const channelOf = (kind: ChannelKind, target: DeliveryTarget) => state?.channels.find((item) => (item.kind ?? 'TEAMS') === kind && item.target === target);
  const channel = (target: DeliveryTarget) => channelOf('TEAMS', target);
  const emailServer = channelOf('EMAIL', 'USER_NOTIFICATIONS');
  const emailGroup = channelOf('EMAIL', 'GROUP_ALERTS');
  const maxTotal = state?.maxTotalAttempts ?? 10;
  // The API never carries a stored password over to another server or account.
  const saved = emailServer?.smtp;
  const passwordReentry = Boolean(saved?.passwordSet && smtpDraft.username.trim() && (smtpDraft.host.trim().toLowerCase() !== saved.host || Number(smtpDraft.port) !== saved.port || smtpDraft.security !== saved.security || smtpDraft.username.trim() !== (saved.username ?? '')));
  const setDraft = (target: DeliveryTarget, change: Partial<Draft>) => setDrafts((current) => ({ ...current, [target]: { ...current[target], ...change } }));

  const save = async (event: FormEvent) => {
    event.preventDefault(); setFeedback('');
    // No default severity: enabling a group channel needs an explicit choice.
    if ((drafts.GROUP_ALERTS.enabled && !drafts.GROUP_ALERTS.minSeverity) || (groupEmail.enabled && !groupEmail.minSeverity)) {
      const message = 'Escolhe a severidade mínima dos alertas operacionais antes de ativar o canal.';
      setFeedback(message); toastError('Notificações', message); return;
    }
    setBusy('save');
    try {
      for (const { target } of TARGETS) {
        const draft = drafts[target]; const current = channel(target);
        const url = draft.webhookUrl.trim();
        const changed = url || draft.enabled !== current?.enabled || (target === 'GROUP_ALERTS' && draft.minSeverity !== (current?.minSeverity ?? ''));
        if (!changed) continue;
        await apiFetch(`${BASE}/${target}`, { method: 'PUT', body: JSON.stringify({ enabled: draft.enabled, ...(url ? { webhookUrl: url } : {}), ...(target === 'GROUP_ALERTS' && draft.minSeverity ? { minSeverity: draft.minSeverity } : {}) }) });
      }
      // The SMTP server is saved before the group e-mail settings, which depend on it.
      const serverChanged = smtpChanged(smtpDraft, emailServer?.smtp);
      if (serverChanged || smtpDraft.enabled !== Boolean(emailServer?.enabled)) {
        const smtp = serverChanged ? {
          host: smtpDraft.host.trim(), port: Number(smtpDraft.port), security: smtpDraft.security, username: smtpDraft.username.trim() || null,
          ...(smtpDraft.password ? { password: smtpDraft.password } : {}), from: smtpDraft.from.trim(),
        } : undefined;
        await apiFetch(`${EMAIL_BASE}/USER_NOTIFICATIONS`, { method: 'PUT', body: JSON.stringify({ enabled: smtpDraft.enabled, ...(smtp ? { smtp } : {}) }) });
      }
      const recipients = splitRecipients(groupEmail.recipients);
      const recipientsChanged = recipients.join(',') !== (emailGroup?.recipients ?? []).join(',');
      if (recipientsChanged || groupEmail.enabled !== Boolean(emailGroup?.enabled) || groupEmail.minSeverity !== (emailGroup?.minSeverity ?? '')) {
        await apiFetch(`${EMAIL_BASE}/GROUP_ALERTS`, { method: 'PUT', body: JSON.stringify({ enabled: groupEmail.enabled, ...(groupEmail.minSeverity ? { minSeverity: groupEmail.minSeverity } : {}), ...(recipientsChanged && recipients.length ? { recipients } : {}) }) });
      }
      setFeedback('Configuração guardada. O endereço do webhook e a palavra-passe SMTP ficam cifrados e não são devolvidos pela aplicação.');
      success('Notificações', 'Canais de notificação guardados');
      await load();
    } catch (reason) { const message = messageOf(reason, 'Não foi possível guardar.'); setFeedback(message); toastError('Notificações', message); }
    finally { setBusy(''); }
  };
  const test = async (target: DeliveryTarget, kind: ChannelKind = 'TEAMS') => {
    const label = kind === 'EMAIL' ? 'Email' : 'Microsoft Teams'; const what = kind === 'EMAIL' ? 'Email de teste' : 'Mensagem de teste';
    setBusy(`test:${kind}:${target}`); setFeedback('');
    try {
      const result = await apiFetch<{ status: DeliveryStatus; failureReason: string | null }>(`${ROOT}/${kind}/${target}/test`, { method: 'POST' });
      if (result.status === 'SENT') success(label, kind === 'EMAIL' ? 'Email de teste enviado' : 'Mensagem de teste enviada');
      else { const message = `${what} falhou: ${failureLabel(result.failureReason)}`; setFeedback(message); toastError(label, message); }
      await loadLog();
    } catch (reason) { const message = messageOf(reason, `Não foi possível enviar o ${what.toLowerCase()}.`); setFeedback(message); toastError(label, message); }
    finally { setBusy(''); }
  };
  const clear = async (target: DeliveryTarget, title: string, kind: ChannelKind = 'TEAMS') => {
    const email = kind === 'EMAIL';
    const message = email ? (target === 'USER_NOTIFICATIONS' ? 'Remover o servidor SMTP (incluindo a palavra-passe) e desativar o envio por email?' : 'Remover os destinatários e desativar os alertas por email?') : `Remover o webhook de “${title}” e desativar o canal?`;
    if (!(await confirm({ title: email ? 'Remover configuração de email' : 'Remover webhook', message, confirmLabel: 'Remover', destructive: true }))) return;
    setBusy(`clear:${kind}:${target}`);
    try { await apiFetch(`${ROOT}/${kind}/${target}`, { method: 'DELETE' }); success(email ? 'Email' : 'Microsoft Teams', email ? 'Configuração de email removida' : 'Webhook removido'); await load(); }
    catch (reason) { toastError(email ? 'Email' : 'Microsoft Teams', messageOf(reason, 'Não foi possível remover a configuração.')); }
    finally { setBusy(''); }
  };
  const retry = async (item: DeliveryItem) => {
    setBusy(`retry:${item.id}`);
    try { await apiFetch(`/api/v1/settings/notification-deliveries/${item.id}/retry`, { method: 'POST' }); success('Notificações', 'Entrega reagendada'); await loadLog(); }
    catch (reason) { toastError('Notificações', messageOf(reason, 'Não foi possível reagendar a entrega.')); }
    finally { setBusy(''); }
  };

  const columns: DataTableColumn<DeliveryItem>[] = [
    { id: 'createdAt', header: 'Criada', cell: (item) => formatDateTime(item.createdAt) },
    { id: 'topic', header: 'Tipo', cell: (item) => <><strong>{TOPICS[item.topic] ?? item.topic}</strong><br /><small>{item.title}</small></> },
    { id: 'target', header: 'Canal', cell: (item) => <><strong>{item.channel === 'EMAIL' ? 'Email' : 'Teams'}</strong><br /><small>{item.target === 'GROUP_ALERTS' ? 'Alertas operacionais' : item.topic === 'TEST' ? 'Teste' : `Pessoal · ${item.recipient?.displayName?.trim() || item.recipient?.username || '—'}`}</small></> },
    { id: 'status', header: 'Estado', cell: (item) => <span className={`state-badge ${STATUS[item.status]?.badge ?? ''}`.trim()} data-status={item.status}><i />{STATUS[item.status]?.label ?? item.status}</span> },
    { id: 'attempts', header: 'Tentativas', cell: (item) => `${item.attempts}/${item.attempts > (state?.maxAttempts ?? 5) ? maxTotal : state?.maxAttempts ?? 5}` },
    { id: 'failure', header: 'Motivo', cell: (item) => item.failureReason ? <span title={item.failureReason}>{failureLabel(item.failureReason)}{item.status === 'PENDING' && item.nextAttemptAt ? ` · nova tentativa ${formatDateTime(item.nextAttemptAt)}` : ''}</span> : '—' },
    { id: 'actions', header: 'Ações', cell: (item) => item.status === 'FAILED' && item.attempts >= maxTotal ? <small>Limite de {maxTotal} tentativas</small> : item.status === 'FAILED' ? <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void retry(item)}><RotateCcw size={14} />Repetir</button> : null },
  ];

  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><h2>Notificações externas</h2><p className="panel-description">Envia notificações e alertas para o Microsoft Teams e por email. Todos os canais começam desativados. O envio é feito em segundo plano, com novas tentativas automáticas, e nunca atrasa a aplicação.</p></div><Bell size={19} /></div>
    {state && !state.keyringAvailable && <div className="ipam-alert error">A chave de cifra (SNMP_KEYRING_FILE) não está disponível; não é possível guardar nem usar webhooks ou palavras-passe SMTP.</div>}
    {state && !state.publicLinks && <div className="ipam-alert warning" role="status">APP_PUBLIC_URL não está definido: as mensagens são enviadas sem botão “Abrir na aplicação”.</div>}
    {state && groupAlertsUnconfigured(state) && <div className="ipam-alert warning" role="alert"><strong>Os alertas operacionais não estão a ser enviados.</strong> Nenhum canal de grupo está pronto: ativa o Teams ou o email em “Alertas operacionais”, guarda o destino e escolhe a severidade mínima. Os alertas continuam visíveis na aplicação.</div>}
    {feedback && <div className="ipam-alert">{feedback}</div>}
    <form className="settings-form" id="settings-notifications-form" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <h3 className="notification-channel-heading">Microsoft Teams</h3>
      {TARGETS.map(({ target, title, description }) => {
        const current = channel(target); const draft = drafts[target];
        return <fieldset key={target} className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
          <legend>{title}</legend>
          <p className="panel-description">{description}</p>
          <div className="integration-row"><span><strong>Estado</strong><small>{loading ? 'A carregar…' : !current?.configured ? 'Sem webhook · desativado' : current.enabled ? `Ativo${current.updatedAt ? ` · atualizado ${formatDateTime(current.updatedAt)}` : ''}` : 'Webhook guardado · desativado'}</small></span></div>
          <label>URL do webhook<input type="password" autoComplete="off" spellCheck={false} maxLength={2048} placeholder={current?.configured ? 'Guardado — introduz um novo endereço para substituir' : 'https://…webhook.office.com/… ou https://…logic.azure.com/…'} value={draft.webhookUrl} onChange={(event) => setDraft(target, { webhookUrl: event.target.value })} /><small>Só são aceites endereços HTTPS do Microsoft Teams / Power Automate. O endereço é cifrado e nunca é mostrado depois de guardado.</small></label>
          {target === 'GROUP_ALERTS' && <GroupSeveritySelect value={draft.minSeverity} required={draft.enabled} onChange={(minSeverity) => setDraft(target, { minSeverity })} />}
          {target === 'GROUP_ALERTS' && !loading && groupDeliveryNote(current) && <small className="ipam-alert warning group-delivery-note">{groupDeliveryNote(current)}</small>}
          <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft(target, { enabled: event.target.checked })} /> Ativar este canal</label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void test(target)}><Send size={14} />{busy === `test:TEAMS:${target}` ? 'A enviar…' : 'Enviar mensagem de teste'}</button>
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void clear(target, title)}><Trash2 size={14} />Remover</button>
          </div>
        </fieldset>;
      })}
      <h3 className="notification-channel-heading"><Mail size={15} aria-hidden="true" /> Email (SMTP)</h3>
      <fieldset className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
        <legend>Servidor SMTP e emails pessoais</legend>
        <p className="panel-description">Servidor usado por todos os emails. Com o envio ativo, cada utilizador pode escolher em Perfil → Notificações receber uma cópia de cada tipo no seu próprio email.</p>
        <div className="integration-row"><span><strong>Estado</strong><small>{loading ? 'A carregar…' : !emailServer?.configured ? 'Sem servidor · desativado' : emailServer.enabled ? `Ativo${emailServer.updatedAt ? ` · atualizado ${formatDateTime(emailServer.updatedAt)}` : ''}` : 'Servidor guardado · desativado'}</small></span></div>
        <div className="notification-channel-grid">
          <label>Servidor<input autoComplete="off" spellCheck={false} maxLength={253} placeholder="smtp.empresa.pt" value={smtpDraft.host} onChange={(event) => setSmtpDraft({ ...smtpDraft, host: event.target.value })} /></label>
          <label>Segurança<select value={smtpDraft.security} onChange={(event) => { const security = event.target.value as SmtpSecurity; setSmtpDraft({ ...smtpDraft, security, port: smtpDraft.port === DEFAULT_PORT[smtpDraft.security] ? DEFAULT_PORT[security] : smtpDraft.port }); }}><option value="STARTTLS">STARTTLS</option><option value="TLS">TLS</option><option value="NONE">Sem encriptação</option></select></label>
          <label>Porta<input type="number" inputMode="numeric" min={1} max={65535} value={smtpDraft.port} onChange={(event) => setSmtpDraft({ ...smtpDraft, port: event.target.value })} /></label>
          <label>Remetente<input type="email" autoComplete="off" maxLength={254} placeholder="alertas@empresa.pt" value={smtpDraft.from} onChange={(event) => setSmtpDraft({ ...smtpDraft, from: event.target.value })} /></label>
          <label>Utilizador<input autoComplete="off" spellCheck={false} maxLength={254} placeholder="Opcional" value={smtpDraft.username} onChange={(event) => setSmtpDraft({ ...smtpDraft, username: event.target.value })} /></label>
          <label>Palavra-passe<input type="password" autoComplete="new-password" maxLength={512} placeholder={emailServer?.smtp?.passwordSet ? (passwordReentry ? 'Introduz de novo a palavra-passe' : 'Guardada — introduz uma nova para substituir') : 'Opcional'} aria-describedby={passwordReentry ? 'smtp-password-reentry' : undefined} value={smtpDraft.password} onChange={(event) => setSmtpDraft({ ...smtpDraft, password: event.target.value })} /></label>
        </div>
        {passwordReentry && !smtpDraft.password && <small id="smtp-password-reentry" className="ipam-alert error">Alteraste o servidor, a porta, a segurança ou o utilizador: a palavra-passe guardada não é reutilizada. Introduz-a de novo para guardar.</small>}
        <small className="panel-description">A palavra-passe é cifrada e nunca é mostrada depois de guardada. Com utilizador ou palavra-passe, a ligação tem de usar TLS ou STARTTLS; o certificado do servidor é sempre verificado.</small>
        <label className="settings-check"><input type="checkbox" checked={smtpDraft.enabled} onChange={(event) => setSmtpDraft({ ...smtpDraft, enabled: event.target.checked })} /> Ativar emails pessoais</label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={!emailServer?.configured || Boolean(busy)} onClick={() => void test('USER_NOTIFICATIONS', 'EMAIL')} title="Enviado para o email do teu utilizador"><Send size={14} />{busy === 'test:EMAIL:USER_NOTIFICATIONS' ? 'A enviar…' : 'Enviar email de teste'}</button>
          <button type="button" className="secondary-button" disabled={!emailServer?.configured || Boolean(busy)} onClick={() => void clear('USER_NOTIFICATIONS', 'Servidor SMTP', 'EMAIL')}><Trash2 size={14} />Remover</button>
        </div>
      </fieldset>
      <fieldset className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
        <legend>Alertas operacionais por email</legend>
        <p className="panel-description">Alertas críticos e altos enviados para uma lista de endereços, através do servidor SMTP acima. CRITICAL é sempre enviado; os restantes respeitam janelas de manutenção e regras de alerta.</p>
        <div className="integration-row"><span><strong>Estado</strong><small>{loading ? 'A carregar…' : !emailGroup?.serverConfigured ? 'Configura primeiro o servidor SMTP' : !emailGroup.configured ? 'Sem destinatários · desativado' : emailGroup.enabled ? `Ativo · ${emailGroup.recipients?.length ?? 0} destinatário(s)` : 'Destinatários guardados · desativado'}</small></span></div>
        <label>Destinatários<textarea className="form-textarea" rows={3} spellCheck={false} placeholder={'noc@empresa.pt\nprevenção@empresa.pt'} value={groupEmail.recipients} onChange={(event) => setGroupEmail({ ...groupEmail, recipients: event.target.value })} /><small>Um endereço por linha (ou separados por vírgulas), até 20.</small></label>
        <GroupSeveritySelect value={groupEmail.minSeverity} required={groupEmail.enabled} onChange={(minSeverity) => setGroupEmail({ ...groupEmail, minSeverity })} />
        {!loading && groupDeliveryNote(emailGroup) && <small className="ipam-alert warning group-delivery-note">{groupDeliveryNote(emailGroup)}</small>}
        <label className="settings-check"><input type="checkbox" checked={groupEmail.enabled} onChange={(event) => setGroupEmail({ ...groupEmail, enabled: event.target.checked })} /> Ativar alertas por email</label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={!emailGroup?.configured || Boolean(busy)} onClick={() => void test('GROUP_ALERTS', 'EMAIL')}><Send size={14} />{busy === 'test:EMAIL:GROUP_ALERTS' ? 'A enviar…' : 'Enviar email de teste'}</button>
          <button type="button" className="secondary-button" disabled={!emailGroup?.configured || Boolean(busy)} onClick={() => void clear('GROUP_ALERTS', 'Alertas operacionais por email', 'EMAIL')}><Trash2 size={14} />Remover</button>
        </div>
      </fieldset>
    </form>
    <div className="panel-heading notification-delivery-heading"><div><h3>Registo de entregas</h3><p className="panel-description">Últimos 90 dias. Até {state?.maxAttempts ?? 5} tentativas por mensagem; o motivo da falha nunca inclui o endereço do webhook nem a palavra-passe SMTP.</p></div>
      <div className="modal-actions notification-delivery-filters">
        <label>Canal<select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as ChannelKind | '')}><option value="">Todos</option><option value="TEAMS">Teams</option><option value="EMAIL">Email</option></select></label>
        <label>Estado<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeliveryStatus | '')}><option value="">Todos{log ? ` (${Object.values(log.counts).reduce((sum, value) => sum + (value ?? 0), 0)})` : ''}</option>{(Object.keys(STATUS) as DeliveryStatus[]).map((status) => <option key={status} value={status}>{STATUS[status].label}{log ? ` (${log.counts[status] ?? 0})` : ''}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => void loadLog()}><RefreshCw size={14} />Atualizar</button>
      </div>
    </div>
    {logError && <div className="ipam-alert error">{logError}</div>}
    {log && <DataTable rows={log.items} columns={columns} rowKey={(item) => item.id} label="Registo de entregas" empty={<p className="no-data">Sem entregas registadas.</p>} />}
    {log?.nextCursor && <div className="form-actions"><button type="button" className="secondary-button" onClick={() => void loadLog(log.nextCursor!)}>Carregar mais</button></div>}
    <PageToolbarPortal><button type="submit" form="settings-notifications-form" className="primary-button" disabled={loading || Boolean(busy) || !state?.keyringAvailable}><Check size={14} />{busy === 'save' ? 'A guardar…' : 'Guardar'}</button></PageToolbarPortal>
    {confirmDialog}
  </section>;
}
