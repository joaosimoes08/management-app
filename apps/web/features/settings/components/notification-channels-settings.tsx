'use client';

import { FormEvent, useId, useState } from 'react';
import { keepPreviousData, useInfiniteQuery, useMutation, useQuery, useQueryClient, type InfiniteData } from '@tanstack/react-query';
import { Bell, Check, Mail, RefreshCw, RotateCcw, Send, Trash2 } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { formatDateTime, getFormatLocale } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { settingsText } from '../i18n';
import { clearNotificationChannel, getNotificationChannels, listNotificationDeliveries, retryNotificationDelivery, settingsKeys, settingsQueryOptions, testNotificationChannel, updateNotificationChannel } from '../api';
import { useSeedOnLoad } from '../use-seed-on-load';
import type { ChannelKind, ChannelsResponse, ChannelStatus, DeliveryItem, DeliveryPage, DeliveryStatus, DeliveryTarget, GroupDeliveryMissing, SmtpSecurity, SmtpView } from '../types';

export type { ChannelKind, ChannelStatus, DeliveryItem, DeliveryTarget, GroupDeliveryMissing, SmtpSecurity, SmtpView } from '../types';

/** '' = not chosen yet. There is no default: a group channel without a minimum severity sends nothing. */
type GroupSeverity = 'CRITICAL' | 'HIGH' | '';
type Draft = { enabled: boolean; webhookUrl: string; minSeverity: GroupSeverity };
type SmtpDraft = { enabled: boolean; host: string; port: string; security: SmtpSecurity; username: string; password: string; from: string };
type GroupEmailDraft = { enabled: boolean; minSeverity: GroupSeverity; recipients: string };

const DEFAULT_PORT: Record<SmtpSecurity, string> = { STARTTLS: '587', TLS: '465', NONE: '25' };
const TARGETS: { target: DeliveryTarget; title: string; description: string }[] = [
  { target: 'USER_NOTIFICATIONS', get title() { return settingsText('settings.notifications.target.USER_NOTIFICATIONS'); }, get description() { return settingsText('settings.notifications.target.USER_NOTIFICATIONS.description'); } },
  { target: 'GROUP_ALERTS', get title() { return settingsText('settings.notifications.target.GROUP_ALERTS'); }, get description() { return settingsText('settings.notifications.target.GROUP_ALERTS.description'); } },
];
const STATUS: Record<DeliveryStatus, { label: string; badge: string }> = {
  PENDING: { get label() { return settingsText('settings.notifications.status.PENDING'); }, badge: 'pending' },
  SENDING: { get label() { return settingsText('settings.notifications.status.SENDING'); }, badge: 'processing' },
  SENT: { get label() { return settingsText('settings.notifications.status.SENT'); }, badge: 'approved' },
  FAILED: { get label() { return settingsText('settings.notifications.status.FAILED'); }, badge: 'rejected' },
};
const TOPICS = ['TEST', 'OPERATIONAL_ALERT', 'ROLE_REQUEST', 'CRITICAL_ASSET_ATTESTATION', 'LIFECYCLE_DATE', 'SCHEDULED_REPORT'];
const topicLabel = (topic: string) => (TOPICS.includes(topic) ? settingsText(`settings.notifications.topic.${topic}`) : topic);
const FAILURE_CODES = ['SMTP_CONNECTION_FAILED', 'SMTP_HOST_NOT_ALLOWED', 'SMTP_ECONNECTION', 'SMTP_ETIMEDOUT', 'SMTP_ESOCKET', 'SMTP_EDNS', 'SMTP_ETLS', 'SMTP_ENOAUTH', 'SMTP_EENVELOPE', 'SMTP_EPROTOCOL', 'SMTP_ECONFIG', 'SMTP_ERROR', 'RECIPIENT_NO_EMAIL', 'REPORT_UNSUBSCRIBED', 'REPORT_REMOVED', 'TIMEOUT', 'NETWORK_ERROR', 'REDIRECT_BLOCKED', 'CHANNEL_DISABLED', 'CHANNEL_NOT_CONFIGURED', 'KEYRING_UNAVAILABLE', 'SECRET_UNREADABLE', 'TEAMS_WEBHOOK_INVALID', 'DISPATCH_ERROR'];
/** Failure codes are stable API values; the webhook address, SMTP password and e-mail addresses are never part of them. */
export function failureLabel(code: string | null): string {
  if (!code) return '—';
  const http = /^HTTP_(\d{3})$/.exec(code);
  if (http) return settingsText('settings.notifications.failure.http', { status: http[1] });
  const auth = /^SMTP_EAUTH(?:_(\d{3}))?$/.exec(code);
  if (auth) return auth[1] ? settingsText('settings.notifications.failure.smtpAuthCode', { code: auth[1] }) : settingsText('settings.notifications.failure.smtpAuth');
  const smtp = /^SMTP_(\d{3})$/.exec(code);
  if (smtp) return settingsText('settings.notifications.failure.smtpCode', { code: smtp[1] });
  return FAILURE_CODES.includes(code) ? settingsText(`settings.notifications.failure.${code}`) : code;
}
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const draftOf = (channel?: ChannelStatus): Draft => ({ enabled: channel?.enabled ?? false, webhookUrl: '', minSeverity: channel?.minSeverity ?? '' });
const smtpDraftOf = (channel?: ChannelStatus): SmtpDraft => ({
  enabled: channel?.enabled ?? false, host: channel?.smtp?.host ?? '', port: String(channel?.smtp?.port ?? DEFAULT_PORT.STARTTLS),
  security: channel?.smtp?.security ?? 'STARTTLS', username: channel?.smtp?.username ?? '', password: '', from: channel?.smtp?.from ?? '',
});
const groupEmailDraftOf = (channel?: ChannelStatus): GroupEmailDraft => ({ enabled: channel?.enabled ?? false, minSeverity: channel?.minSeverity ?? '', recipients: (channel?.recipients ?? []).join('\n') });
const missingText = (kind: ChannelKind, item: GroupDeliveryMissing) => settingsText(item === 'destination' ? `settings.notifications.missing.destination.${kind}` : `settings.notifications.missing.${item}`);
/** "Não envia alertas: falta escolher a severidade mínima." or null when the channel is ready. */
export function groupDeliveryNote(channel?: ChannelStatus | null): string | null {
  const missing = channel?.delivery?.missing;
  if (!channel || !missing?.length) return null;
  const items = missing.map((item) => missingText(channel.kind ?? 'TEAMS', item));
  return settingsText('settings.notifications.missingNote', { items: new Intl.ListFormat(getFormatLocale(), { type: 'conjunction' }).format(items) });
}
/** Older APIs do not send groupAlertsUnconfigured; derive it the same way. */
export function groupAlertsUnconfigured(state: Pick<ChannelsResponse, 'channels' | 'groupAlertsUnconfigured'>): boolean {
  if (typeof state.groupAlertsUnconfigured === 'boolean') return state.groupAlertsUnconfigured;
  return !state.channels.some((item) => item.target === 'GROUP_ALERTS' && (item.delivery ? item.delivery.ready : item.enabled && item.configured && Boolean(item.minSeverity)));
}
/** No preselected value: the minimum severity is an explicit choice (Joao's rule, #145). */
function GroupSeveritySelect({ value, required, onChange }: { value: GroupSeverity; required: boolean; onChange: (value: GroupSeverity) => void }) {
  const hintId = useId();
  const ui = useUiText();
  return <div className="field-with-hint"><label>{ui('settings.notifications.minSeverity')}<select value={value} aria-describedby={hintId} aria-invalid={required && !value ? true : undefined} onChange={(event) => onChange(event.target.value as GroupSeverity)}>
    <option value="">{ui('settings.notifications.chooseSeverity')}</option><option value="HIGH">{ui('settings.notifications.severity.HIGH')}</option><option value="CRITICAL">{ui('settings.notifications.severity.CRITICAL')}</option>
  </select></label><small id={hintId}>{ui('settings.notifications.noSeverityHint')}</small></div>;
}
const splitRecipients = (value: string) => value.split(/[\s,;]+/).map((item) => item.trim()).filter(Boolean);
const smtpChanged = (draft: SmtpDraft, current?: SmtpView | null) => Boolean(draft.password) || (current
  ? draft.host.trim() !== current.host || Number(draft.port) !== current.port || draft.security !== current.security || draft.username.trim() !== (current.username ?? '') || draft.from.trim() !== current.from
  : Boolean(draft.host.trim() || draft.from.trim() || draft.username.trim()));

/** Definições → Notificações: Microsoft Teams webhooks and the SMTP server (secrets write-only), test messages and delivery log. */
export function NotificationChannelsSettings() {
  const { success, error: toastError } = useToast();
  const ui = useUiText();
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [drafts, setDrafts] = useState<Record<DeliveryTarget, Draft>>({ USER_NOTIFICATIONS: draftOf(), GROUP_ALERTS: draftOf() });
  const [smtpDraft, setSmtpDraft] = useState<SmtpDraft>(smtpDraftOf());
  const [groupEmail, setGroupEmail] = useState<GroupEmailDraft>(groupEmailDraftOf());
  const [channelFilter, setChannelFilter] = useState<ChannelKind | ''>('');
  const [busy, setBusy] = useState('');
  const [feedback, setFeedback] = useState('');
  const [statusFilter, setStatusFilter] = useState<DeliveryStatus | ''>('');

  const channelsQuery = useQuery({ queryKey: settingsKeys.notificationChannels, queryFn: getNotificationChannels, ...settingsQueryOptions });
  const state: ChannelsResponse | null = channelsQuery.data ?? null;
  const loading = channelsQuery.isFetching;
  // The first load, Refresh and every save replace the drafts with what is saved; a background refetch never does.
  const load = useSeedOnLoad(channelsQuery, 'channels', (next) => {
    const find = (kind: ChannelKind, target: DeliveryTarget) => next.channels.find((item) => (item.kind ?? 'TEAMS') === kind && item.target === target);
    setDrafts({ USER_NOTIFICATIONS: draftOf(find('TEAMS', 'USER_NOTIFICATIONS')), GROUP_ALERTS: draftOf(find('TEAMS', 'GROUP_ALERTS')) });
    setSmtpDraft(smtpDraftOf(find('EMAIL', 'USER_NOTIFICATIONS')));
    setGroupEmail(groupEmailDraftOf(find('EMAIL', 'GROUP_ALERTS')));
  });
  // A failed load reports in the feedback line.
  const [seenError, setSeenError] = useState(0);
  if (channelsQuery.error && channelsQuery.errorUpdatedAt !== seenError) {
    setSeenError(channelsQuery.errorUpdatedAt);
    setFeedback(messageOf(channelsQuery.error, settingsText('settings.notifications.loadError')));
  }

  // Delivery log: "Load more" appends the next cursor page; filters start again from the first page.
  const logKey = settingsKeys.notificationDeliveries(statusFilter, channelFilter);
  const logQuery = useInfiniteQuery({
    queryKey: logKey,
    queryFn: ({ pageParam }) => listNotificationDeliveries({ status: statusFilter, channel: channelFilter, cursor: pageParam }),
    initialPageParam: undefined as string | undefined,
    getNextPageParam: (last) => last.nextCursor ?? undefined,
    placeholderData: keepPreviousData,
    ...settingsQueryOptions,
  });
  const log: DeliveryPage | null = logQuery.data?.pages.length ? { ...logQuery.data.pages[logQuery.data.pages.length - 1], items: logQuery.data.pages.flatMap((page) => page.items) } : null;
  const logError = logQuery.error ? messageOf(logQuery.error, settingsText('settings.notifications.logLoadError')) : '';
  /** Reload from the first page only, as the log did before. */
  const loadLog = async () => {
    queryClient.setQueryData<InfiniteData<DeliveryPage, string | undefined>>(logKey, (current) => current && { pages: current.pages.slice(0, 1), pageParams: current.pageParams.slice(0, 1) });
    await logQuery.refetch();
  };
  /** Channel saves, removals and retries; each caller keeps its own busy label and messages. */
  const request = useMutation({ mutationFn: (call: () => Promise<unknown>) => call() });
  const testMutation = useMutation({ mutationFn: ({ kind, target }: { kind: ChannelKind; target: DeliveryTarget }) => testNotificationChannel(kind, target) });

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
      const message = ui('settings.notifications.needSeverity');
      setFeedback(message); toastError(ui('settings.notifications.toast'), message); return;
    }
    setBusy('save');
    try {
      for (const { target } of TARGETS) {
        const draft = drafts[target]; const current = channel(target);
        const url = draft.webhookUrl.trim();
        const changed = url || draft.enabled !== current?.enabled || (target === 'GROUP_ALERTS' && draft.minSeverity !== (current?.minSeverity ?? ''));
        if (!changed) continue;
        await request.mutateAsync(() => updateNotificationChannel('TEAMS', target, { enabled: draft.enabled, ...(url ? { webhookUrl: url } : {}), ...(target === 'GROUP_ALERTS' && draft.minSeverity ? { minSeverity: draft.minSeverity } : {}) }));
      }
      // The SMTP server is saved before the group e-mail settings, which depend on it.
      const serverChanged = smtpChanged(smtpDraft, emailServer?.smtp);
      if (serverChanged || smtpDraft.enabled !== Boolean(emailServer?.enabled)) {
        const smtp = serverChanged ? {
          host: smtpDraft.host.trim(), port: Number(smtpDraft.port), security: smtpDraft.security, username: smtpDraft.username.trim() || null,
          ...(smtpDraft.password ? { password: smtpDraft.password } : {}), from: smtpDraft.from.trim(),
        } : undefined;
        await request.mutateAsync(() => updateNotificationChannel('EMAIL', 'USER_NOTIFICATIONS', { enabled: smtpDraft.enabled, ...(smtp ? { smtp } : {}) }));
      }
      const recipients = splitRecipients(groupEmail.recipients);
      const recipientsChanged = recipients.join(',') !== (emailGroup?.recipients ?? []).join(',');
      if (recipientsChanged || groupEmail.enabled !== Boolean(emailGroup?.enabled) || groupEmail.minSeverity !== (emailGroup?.minSeverity ?? '')) {
        await request.mutateAsync(() => updateNotificationChannel('EMAIL', 'GROUP_ALERTS', { enabled: groupEmail.enabled, ...(groupEmail.minSeverity ? { minSeverity: groupEmail.minSeverity } : {}), ...(recipientsChanged && recipients.length ? { recipients } : {}) }));
      }
      setFeedback(ui('settings.notifications.savedDetail'));
      success(ui('settings.notifications.toast'), ui('settings.notifications.saved'));
      await load();
    } catch (reason) { const message = messageOf(reason, ui('settings.notifications.saveError')); setFeedback(message); toastError(ui('settings.notifications.toast'), message); }
    finally { setBusy(''); }
  };
  const test = async (target: DeliveryTarget, kind: ChannelKind = 'TEAMS') => {
    const label = kind === 'EMAIL' ? 'Email' : 'Microsoft Teams';
    setBusy(`test:${kind}:${target}`); setFeedback('');
    try {
      const result = await testMutation.mutateAsync({ kind, target });
      if (result.status === 'SENT') success(label, ui(`settings.notifications.test.${kind}.sent`));
      else { const message = ui(`settings.notifications.test.${kind}.failed`, undefined, { reason: failureLabel(result.failureReason) }); setFeedback(message); toastError(label, message); }
      await loadLog();
    } catch (reason) { const message = messageOf(reason, ui(`settings.notifications.test.${kind}.error`)); setFeedback(message); toastError(label, message); }
    finally { setBusy(''); }
  };
  const clear = async (target: DeliveryTarget, title: string, kind: ChannelKind = 'TEAMS') => {
    const email = kind === 'EMAIL';
    const message = email ? ui(`settings.notifications.clear.EMAIL.${target}`) : ui('settings.notifications.clear.TEAMS', undefined, { title });
    if (!(await confirm({ title: email ? ui('settings.notifications.clear.EMAIL.title') : ui('settings.notifications.clear.TEAMS.title'), message, confirmLabel: ui('settings.notifications.remove'), destructive: true }))) return;
    setBusy(`clear:${kind}:${target}`);
    try { await request.mutateAsync(() => clearNotificationChannel(kind, target)); success(email ? 'Email' : 'Microsoft Teams', email ? ui('settings.notifications.clear.EMAIL.done') : ui('settings.notifications.clear.TEAMS.done')); await load(); }
    catch (reason) { toastError(email ? 'Email' : 'Microsoft Teams', messageOf(reason, ui('settings.notifications.clear.error'))); }
    finally { setBusy(''); }
  };
  const retry = async (item: DeliveryItem) => {
    setBusy(`retry:${item.id}`);
    try { await request.mutateAsync(() => retryNotificationDelivery(item.id)); success(ui('settings.notifications.toast'), ui('settings.notifications.retried')); await loadLog(); }
    catch (reason) { toastError(ui('settings.notifications.toast'), messageOf(reason, ui('settings.notifications.retryError'))); }
    finally { setBusy(''); }
  };

  const columns: DataTableColumn<DeliveryItem>[] = [
    { id: 'createdAt', header: ui('settings.notifications.col.created'), cell: (item) => formatDateTime(item.createdAt) },
    { id: 'topic', header: ui('settings.notifications.col.type'), cell: (item) => <><strong>{topicLabel(item.topic)}</strong><br /><small>{item.title}</small></> },
    { id: 'target', header: ui('settings.notifications.col.channel'), cell: (item) => <><strong>{item.channel === 'EMAIL' ? 'Email' : 'Teams'}</strong><br /><small>{item.target === 'GROUP_ALERTS' ? ui('settings.notifications.target.GROUP_ALERTS') : item.topic === 'TEST' ? ui('settings.notifications.testTarget') : ui('settings.notifications.personalTarget', undefined, { name: item.recipient?.displayName?.trim() || item.recipient?.username || '—' })}</small></> },
    { id: 'status', header: ui('settings.notifications.col.status'), cell: (item) => <span className={`state-badge ${STATUS[item.status]?.badge ?? ''}`.trim()} data-status={item.status}><i />{STATUS[item.status]?.label ?? item.status}</span> },
    { id: 'attempts', header: ui('settings.notifications.col.attempts'), cell: (item) => `${item.attempts}/${item.attempts > (state?.maxAttempts ?? 5) ? maxTotal : state?.maxAttempts ?? 5}` },
    { id: 'failure', header: ui('settings.notifications.col.reason'), cell: (item) => item.failureReason ? <span title={item.failureReason}>{failureLabel(item.failureReason)}{item.status === 'PENDING' && item.nextAttemptAt ? ` · ${ui('settings.notifications.nextAttempt', undefined, { date: formatDateTime(item.nextAttemptAt) })}` : ''}</span> : '—' },
    { id: 'actions', header: ui('settings.notifications.col.actions'), cell: (item) => item.status === 'FAILED' && item.attempts >= maxTotal ? <small>{ui('settings.notifications.attemptLimit', undefined, { max: maxTotal })}</small> : item.status === 'FAILED' ? <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void retry(item)}><RotateCcw size={14} />{ui('settings.notifications.retry')}</button> : null },
  ];

  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><h2>{ui('settings.notifications.title')}</h2><p className="panel-description">{ui('settings.notifications.description')}</p></div><Bell size={19} /></div>
    {state && !state.keyringAvailable && <div className="ipam-alert error">{ui('settings.notifications.noKeyring')}</div>}
    {state && !state.publicLinks && <div className="ipam-alert warning" role="status">{ui('settings.notifications.noPublicUrl')}<small className="settings-env-help">{ui('settings.reports.noPublicUrlHelp')}</small></div>}
    {state && groupAlertsUnconfigured(state) && <div className="ipam-alert warning" role="alert"><strong>{ui('settings.notifications.groupUnconfigured')}</strong> {ui('settings.notifications.groupUnconfiguredDetail')}</div>}
    {feedback && <div className="ipam-alert">{feedback}</div>}
    <form className="settings-form" id="settings-notifications-form" onSubmit={(event) => void save(event)} aria-busy={loading}>
      <h3 className="notification-channel-heading">Microsoft Teams</h3>
      {TARGETS.map(({ target, title, description }) => {
        const current = channel(target); const draft = drafts[target];
        return <fieldset key={target} className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
          <legend>{title}</legend>
          <p className="panel-description">{description}</p>
          <div className="integration-row"><span><strong>{ui('settings.notifications.state')}</strong><small>{loading ? ui('settings.notifications.loading') : !current?.configured ? ui('settings.notifications.teams.none') : current.enabled ? (current.updatedAt ? ui('settings.notifications.activeUpdated', undefined, { date: formatDateTime(current.updatedAt) }) : ui('settings.notifications.active')) : ui('settings.notifications.teams.savedDisabled')}</small></span></div>
          <label>{ui('settings.notifications.webhookUrl')}<input type="password" autoComplete="off" spellCheck={false} maxLength={2048} placeholder={current?.configured ? ui('settings.notifications.webhookSaved') : ui('settings.notifications.webhookPlaceholder')} value={draft.webhookUrl} onChange={(event) => setDraft(target, { webhookUrl: event.target.value })} /><small>{ui('settings.notifications.webhookHint')}</small></label>
          {target === 'GROUP_ALERTS' && <GroupSeveritySelect value={draft.minSeverity} required={draft.enabled} onChange={(minSeverity) => setDraft(target, { minSeverity })} />}
          {target === 'GROUP_ALERTS' && !loading && groupDeliveryNote(current) && <small className="ipam-alert warning group-delivery-note">{groupDeliveryNote(current)}</small>}
          <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => setDraft(target, { enabled: event.target.checked })} /> {ui('settings.notifications.enableChannel')}</label>
          <div className="modal-actions">
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void test(target)}><Send size={14} />{busy === `test:TEAMS:${target}` ? ui('settings.notifications.sending') : ui('settings.notifications.sendTestMessage')}</button>
            <button type="button" className="secondary-button" disabled={!current?.configured || Boolean(busy)} onClick={() => void clear(target, title)}><Trash2 size={14} />{ui('settings.notifications.remove')}</button>
          </div>
        </fieldset>;
      })}
      <h3 className="notification-channel-heading"><Mail size={15} aria-hidden="true" /> Email (SMTP)</h3>
      <fieldset className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
        <legend>{ui('settings.notifications.smtp.legend')}</legend>
        <p className="panel-description">{ui('settings.notifications.smtp.description')}</p>
        <div className="integration-row"><span><strong>{ui('settings.notifications.state')}</strong><small>{loading ? ui('settings.notifications.loading') : !emailServer?.configured ? ui('settings.notifications.smtp.none') : emailServer.enabled ? (emailServer.updatedAt ? ui('settings.notifications.activeUpdated', undefined, { date: formatDateTime(emailServer.updatedAt) }) : ui('settings.notifications.active')) : ui('settings.notifications.smtp.savedDisabled')}</small></span></div>
        <div className="notification-channel-grid">
          <label>{ui('settings.notifications.smtp.host')}<input autoComplete="off" spellCheck={false} maxLength={253} placeholder="smtp.empresa.pt" value={smtpDraft.host} onChange={(event) => setSmtpDraft({ ...smtpDraft, host: event.target.value })} /></label>
          <label>{ui('settings.notifications.smtp.security')}<select value={smtpDraft.security} onChange={(event) => { const security = event.target.value as SmtpSecurity; setSmtpDraft({ ...smtpDraft, security, port: smtpDraft.port === DEFAULT_PORT[smtpDraft.security] ? DEFAULT_PORT[security] : smtpDraft.port }); }}><option value="STARTTLS">STARTTLS</option><option value="TLS">TLS</option><option value="NONE">{ui('settings.notifications.smtp.noEncryption')}</option></select></label>
          <label>{ui('settings.notifications.smtp.port')}<input type="number" inputMode="numeric" min={1} max={65535} value={smtpDraft.port} onChange={(event) => setSmtpDraft({ ...smtpDraft, port: event.target.value })} /></label>
          <label>{ui('settings.notifications.smtp.from')}<input type="email" autoComplete="off" maxLength={254} placeholder="alertas@empresa.pt" value={smtpDraft.from} onChange={(event) => setSmtpDraft({ ...smtpDraft, from: event.target.value })} /></label>
          <label>{ui('settings.notifications.smtp.username')}<input autoComplete="off" spellCheck={false} maxLength={254} placeholder={ui('settings.notifications.optional')} value={smtpDraft.username} onChange={(event) => setSmtpDraft({ ...smtpDraft, username: event.target.value })} /></label>
          <label>{ui('settings.notifications.smtp.password')}<input type="password" autoComplete="new-password" maxLength={512} placeholder={emailServer?.smtp?.passwordSet ? (passwordReentry ? ui('settings.notifications.smtp.passwordReenter') : ui('settings.notifications.smtp.passwordSaved')) : ui('settings.notifications.optional')} aria-describedby={passwordReentry ? 'smtp-password-reentry' : undefined} value={smtpDraft.password} onChange={(event) => setSmtpDraft({ ...smtpDraft, password: event.target.value })} /></label>
        </div>
        {passwordReentry && !smtpDraft.password && <small id="smtp-password-reentry" className="ipam-alert error">{ui('settings.notifications.smtp.passwordReentryHint')}</small>}
        <small className="panel-description">{ui('settings.notifications.smtp.passwordHint')}</small>
        <label className="settings-check"><input type="checkbox" checked={smtpDraft.enabled} onChange={(event) => setSmtpDraft({ ...smtpDraft, enabled: event.target.checked })} /> {ui('settings.notifications.smtp.enable')}</label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={!emailServer?.configured || Boolean(busy)} onClick={() => void test('USER_NOTIFICATIONS', 'EMAIL')} title={ui('settings.notifications.smtp.testTitle')}><Send size={14} />{busy === 'test:EMAIL:USER_NOTIFICATIONS' ? ui('settings.notifications.sending') : ui('settings.notifications.sendTestEmail')}</button>
          <button type="button" className="secondary-button" disabled={!emailServer?.configured || Boolean(busy)} onClick={() => void clear('USER_NOTIFICATIONS', ui('settings.notifications.smtp.server'), 'EMAIL')}><Trash2 size={14} />{ui('settings.notifications.remove')}</button>
        </div>
      </fieldset>
      <fieldset className="notification-channel-fieldset" disabled={loading || !state?.keyringAvailable}>
        <legend>{ui('settings.notifications.groupEmail.legend')}</legend>
        <p className="panel-description">{ui('settings.notifications.groupEmail.description')}</p>
        <div className="integration-row"><span><strong>{ui('settings.notifications.state')}</strong><small>{loading ? ui('settings.notifications.loading') : !emailGroup?.serverConfigured ? ui('settings.notifications.groupEmail.needServer') : !emailGroup.configured ? ui('settings.notifications.groupEmail.none') : emailGroup.enabled ? ui('settings.notifications.groupEmail.active', undefined, { recipients: emailGroup.recipients?.length ?? 0 }) : ui('settings.notifications.groupEmail.savedDisabled')}</small></span></div>
        <label>{ui('settings.notifications.groupEmail.recipients')}<textarea className="form-textarea" rows={3} spellCheck={false} placeholder={'noc@empresa.pt\nprevenção@empresa.pt'} value={groupEmail.recipients} onChange={(event) => setGroupEmail({ ...groupEmail, recipients: event.target.value })} /><small>{ui('settings.notifications.groupEmail.recipientsHint')}</small></label>
        <GroupSeveritySelect value={groupEmail.minSeverity} required={groupEmail.enabled} onChange={(minSeverity) => setGroupEmail({ ...groupEmail, minSeverity })} />
        {!loading && groupDeliveryNote(emailGroup) && <small className="ipam-alert warning group-delivery-note">{groupDeliveryNote(emailGroup)}</small>}
        <label className="settings-check"><input type="checkbox" checked={groupEmail.enabled} onChange={(event) => setGroupEmail({ ...groupEmail, enabled: event.target.checked })} /> {ui('settings.notifications.groupEmail.enable')}</label>
        <div className="modal-actions">
          <button type="button" className="secondary-button" disabled={!emailGroup?.configured || Boolean(busy)} onClick={() => void test('GROUP_ALERTS', 'EMAIL')}><Send size={14} />{busy === 'test:EMAIL:GROUP_ALERTS' ? ui('settings.notifications.sending') : ui('settings.notifications.sendTestEmail')}</button>
          <button type="button" className="secondary-button" disabled={!emailGroup?.configured || Boolean(busy)} onClick={() => void clear('GROUP_ALERTS', ui('settings.notifications.groupEmail.legend'), 'EMAIL')}><Trash2 size={14} />{ui('settings.notifications.remove')}</button>
        </div>
      </fieldset>
    </form>
    <div className="panel-heading notification-delivery-heading"><div><h3>{ui('settings.notifications.log.title')}</h3><p className="panel-description">{ui('settings.notifications.log.description', undefined, { max: state?.maxAttempts ?? 5 })}</p></div>
      <div className="modal-actions notification-delivery-filters">
        <label>{ui('settings.notifications.col.channel')}<select value={channelFilter} onChange={(event) => setChannelFilter(event.target.value as ChannelKind | '')}><option value="">{ui('settings.notifications.all')}</option><option value="TEAMS">Teams</option><option value="EMAIL">Email</option></select></label>
        <label>{ui('settings.notifications.col.status')}<select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value as DeliveryStatus | '')}><option value="">{ui('settings.notifications.all')}{log ? ` (${Object.values(log.counts).reduce((sum, value) => sum + (value ?? 0), 0)})` : ''}</option>{(Object.keys(STATUS) as DeliveryStatus[]).map((status) => <option key={status} value={status}>{STATUS[status].label}{log ? ` (${log.counts[status] ?? 0})` : ''}</option>)}</select></label>
        <button type="button" className="secondary-button" onClick={() => void loadLog()}><RefreshCw size={14} />{ui('settings.notifications.refresh')}</button>
      </div>
    </div>
    {logError && <div className="ipam-alert error">{logError}</div>}
    {log && <DataTable rows={log.items} columns={columns} rowKey={(item) => item.id} label={ui('settings.notifications.log.title')} empty={<p className="no-data">{ui('settings.notifications.log.empty')}</p>} />}
    {log?.nextCursor && <div className="form-actions"><button type="button" className="secondary-button" onClick={() => void logQuery.fetchNextPage()}>{ui('settings.notifications.loadMore')}</button></div>}
    <PageToolbarPortal><button type="submit" form="settings-notifications-form" className="primary-button" disabled={loading || Boolean(busy) || !state?.keyringAvailable}><Check size={14} />{busy === 'save' ? ui('settings.notifications.saving') : ui('settings.notifications.save')}</button></PageToolbarPortal>
    {confirmDialog}
  </section>;
}
