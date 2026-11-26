'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, FileText, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { apiDownload, apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { settingsText } from '../i18n';
import { REPORT_SECTIONS, reportCsvFilename, type ReportFrequency, type ReportSection, scheduleLabel, SECTION_LABEL, WEEKDAYS } from '@/features/reports/report-labels';

export type ScheduledReportRecipient = { userId: string; username: string; displayName: string | null; hasEmail: boolean; unsubscribedAt: string | null };
export type ScheduledReport = {
  id: string; name: string; enabled: boolean; frequency: ReportFrequency; dayOfWeek: number | null; dayOfMonth: number | null; hour: number; timezone: string;
  sections: ReportSection[]; siteIds: string[]; sendEmail: boolean; sendTeams: boolean; nextRunAt: string | null; lastRunAt: string | null;
  recipients: ScheduledReportRecipient[];
  lastRun: { id: string; trigger: 'SCHEDULE' | 'MANUAL'; periodStart: string; periodEnd: string; createdAt: string; outputs: number } | null;
};
type UserOption = { id: string; username: string; displayName: string | null; hasEmail: boolean };
export type ScheduledReportsResponse = {
  reports: ScheduledReport[]; users: UserOption[]; sites: { id: string; name: string }[];
  channels: { email: boolean; teams: boolean }; publicLinks: boolean; maxRecipients: number;
};
type RunResult = { runId: string; periodStart: string; periodEnd: string; teams: string; recipients: { userId: string; siteIds: string[]; email: string }[] };
type Draft = {
  name: string; enabled: boolean; frequency: ReportFrequency; dayOfWeek: number; dayOfMonth: number; hour: number; timezone: string;
  sections: ReportSection[]; siteIds: string[]; recipientIds: string[]; sendEmail: boolean; sendTeams: boolean;
};

const ROOT = '/api/v1/settings/scheduled-reports';
const browserZone = () => { try { return Intl.DateTimeFormat().resolvedOptions().timeZone || 'Europe/Lisbon'; } catch { return 'Europe/Lisbon'; } };
const emptyDraft = (): Draft => ({ name: '', enabled: true, frequency: 'WEEKLY', dayOfWeek: 1, dayOfMonth: 1, hour: 8, timezone: browserZone(), sections: REPORT_SECTIONS.map(({ value }) => value), siteIds: [], recipientIds: [], sendEmail: true, sendTeams: false });
const draftOf = (report: ScheduledReport): Draft => ({
  name: report.name, enabled: report.enabled, frequency: report.frequency, dayOfWeek: report.dayOfWeek ?? 1, dayOfMonth: report.dayOfMonth ?? 1, hour: report.hour, timezone: report.timezone,
  sections: report.sections, siteIds: report.siteIds, recipientIds: report.recipients.map(({ userId }) => userId), sendEmail: report.sendEmail, sendTeams: report.sendTeams,
});
const messageOf = (error: unknown, fallback: string) => (error instanceof Error && error.message ? error.message : fallback);
const userLabel = (user: { username: string; displayName: string | null }) => (user.displayName?.trim() ? `${user.displayName.trim()} (${user.username})` : user.username);
const toggle = <T,>(list: T[], value: T, on: boolean) => (on ? [...new Set([...list, value])] : list.filter((item) => item !== value));

/** Definições → Relatórios: scheduled weekly/monthly digests per Site, sent by email (with CSV) and Teams. ADMIN only. */
export function ScheduledReportsSettings() {
  const { success, error: toastError } = useToast();
  const ui = useUiText();
  const { confirm, confirmDialog } = useConfirm();
  const [state, setState] = useState<ScheduledReportsResponse | null>(null);
  const [loading, setLoading] = useState(true);
  const [feedback, setFeedback] = useState('');
  const [busy, setBusy] = useState('');
  const [editing, setEditing] = useState<string | 'new' | null>(null);
  const [draft, setDraft] = useState<Draft>(emptyDraft());
  const [recipientQuery, setRecipientQuery] = useState('');

  const load = useCallback(async () => {
    setLoading(true);
    try { setState(await apiFetch<ScheduledReportsResponse>(ROOT)); setFeedback(''); }
    catch (reason) { setFeedback(messageOf(reason, settingsText('settings.reports.loadError'))); }
    finally { setLoading(false); }
  }, []);
  useEffect(() => { void load(); }, [load]);

  const users = useMemo(() => new Map((state?.users ?? []).map((user) => [user.id, user])), [state]);
  const sites = useMemo(() => new Map((state?.sites ?? []).map((site) => [site.id, site.name])), [state]);
  const filteredUsers = useMemo(() => {
    const query = recipientQuery.trim().toLowerCase();
    const list = state?.users ?? [];
    return (query ? list.filter((user) => userLabel(user).toLowerCase().includes(query)) : list).slice(0, 200);
  }, [state, recipientQuery]);
  const set = (change: Partial<Draft>) => setDraft((current) => ({ ...current, ...change }));

  const startNew = () => { setDraft(emptyDraft()); setEditing('new'); setRecipientQuery(''); setFeedback(''); };
  const startEdit = (report: ScheduledReport) => { setDraft(draftOf(report)); setEditing(report.id); setRecipientQuery(''); setFeedback(''); };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!draft.sections.length) { setFeedback(ui('settings.reports.needSection')); return; }
    if (!draft.sendEmail && !draft.sendTeams) { setFeedback(ui('settings.reports.needChannel')); return; }
    setBusy('save'); setFeedback('');
    const body = {
      name: draft.name.trim(), enabled: draft.enabled, frequency: draft.frequency, hour: draft.hour, timezone: draft.timezone.trim(),
      ...(draft.frequency === 'WEEKLY' ? { dayOfWeek: draft.dayOfWeek } : { dayOfMonth: draft.dayOfMonth }),
      sections: draft.sections, siteIds: draft.siteIds, recipientIds: draft.recipientIds, sendEmail: draft.sendEmail, sendTeams: draft.sendTeams,
    };
    try {
      await apiFetch(editing === 'new' ? ROOT : `${ROOT}/${editing}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      success(ui('settings.reports.toast'), editing === 'new' ? ui('settings.reports.created') : ui('settings.reports.saved'));
      setEditing(null);
      await load();
    } catch (reason) { const message = messageOf(reason, ui('settings.reports.saveError')); setFeedback(message); toastError(ui('settings.reports.toast'), message); }
    finally { setBusy(''); }
  };

  const remove = async (report: ScheduledReport) => {
    if (!(await confirm({ title: ui('settings.reports.removeTitle'), message: ui('settings.reports.removeMessage', undefined, { name: report.name }), confirmLabel: ui('settings.reports.remove'), destructive: true }))) return;
    setBusy(`remove:${report.id}`);
    try { await apiFetch(`${ROOT}/${report.id}`, { method: 'DELETE' }); success(ui('settings.reports.toast'), ui('settings.reports.removed')); if (editing === report.id) setEditing(null); await load(); }
    catch (reason) { toastError(ui('settings.reports.toast'), messageOf(reason, ui('settings.reports.removeError'))); }
    finally { setBusy(''); }
  };

  const run = async (report: ScheduledReport) => {
    if (!(await confirm({ title: ui('settings.reports.sendNow'), message: ui('settings.reports.sendMessage', undefined, { name: report.name, recipients: report.recipients.filter((item) => !item.unsubscribedAt).length }), confirmLabel: ui('settings.reports.send') }))) return;
    setBusy(`run:${report.id}`);
    try {
      const result = await apiFetch<RunResult>(`${ROOT}/${report.id}/run`, { method: 'POST' });
      const queued = result.recipients.filter((item) => item.email === 'QUEUED').length;
      const noEmail = result.recipients.filter((item) => item.email === 'NO_EMAIL').length;
      success(ui('settings.reports.toast'), [ui(result.teams === 'QUEUED' ? 'settings.reports.queuedWithTeams' : 'settings.reports.queued', undefined, { emails: queued }), ...(noEmail ? [ui('settings.reports.noEmailCount', undefined, { users: noEmail })] : [])].join(' · '));
      await load();
    } catch (reason) { toastError(ui('settings.reports.toast'), messageOf(reason, ui('settings.reports.sendError'))); }
    finally { setBusy(''); }
  };

  const download = async (report: ScheduledReport) => {
    setBusy(`csv:${report.id}`);
    try { await apiDownload(`${ROOT}/${report.id}/csv`, reportCsvFilename(report.name)); }
    catch (reason) { toastError(ui('settings.reports.toast'), messageOf(reason, ui('settings.reports.csvError'))); }
    finally { setBusy(''); }
  };

  const columns: DataTableColumn<ScheduledReport>[] = [
    { id: 'name', header: ui('settings.reports.col.report'), cell: (report) => <><strong>{report.name}</strong><br /><small>{report.sections.map((section) => SECTION_LABEL[section] ?? section).join(' · ')}</small></> },
    { id: 'schedule', header: ui('settings.reports.col.schedule'), cell: (report) => <><span>{scheduleLabel(report)}</span><br /><small>{!report.enabled ? ui('settings.reports.disabled') : report.nextRunAt ? ui('settings.reports.nextRun', undefined, { date: formatDateTime(report.nextRunAt) }) : '—'}</small></> },
    { id: 'scope', header: ui('settings.reports.col.sites'), cell: (report) => report.siteIds.length ? report.siteIds.map((id) => sites.get(id) ?? id).join(', ') : <small>{ui('settings.reports.allRecipientSites')}</small> },
    { id: 'recipients', header: ui('settings.reports.col.recipients'), cell: (report) => { const unsubscribed = report.recipients.filter((item) => item.unsubscribedAt).length; return <><span>{report.recipients.length}</span>{unsubscribed ? <><br /><small>{ui('settings.reports.unsubscribed', undefined, { count: unsubscribed })}</small></> : null}</>; } },
    { id: 'channels', header: ui('settings.reports.col.channels'), cell: (report) => [report.sendEmail && 'Email', report.sendTeams && 'Teams'].filter(Boolean).join(' + ') },
    { id: 'lastRun', header: ui('settings.reports.col.lastRun'), cell: (report) => report.lastRun ? <><span>{formatDateTime(report.lastRun.createdAt)}</span><br /><small>{report.lastRun.trigger === 'MANUAL' ? ui('settings.reports.manual') : ui('settings.reports.scheduled')} · {ui('settings.reports.outputs', undefined, { outputs: report.lastRun.outputs })}</small></> : '—' },
    { id: 'actions', header: ui('settings.reports.col.actions'), cell: (report) => <div className="modal-actions">
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => startEdit(report)} aria-label={ui('settings.reports.editNamed', undefined, { name: report.name })}><Pencil size={14} />{ui('settings.reports.edit')}</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy) || !report.recipients.length} onClick={() => void run(report)} aria-label={ui('settings.reports.sendNamed', undefined, { name: report.name })}><Send size={14} />{busy === `run:${report.id}` ? ui('settings.reports.sending') : ui('settings.reports.sendNow')}</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void download(report)} aria-label={ui('settings.reports.csvNamed', undefined, { name: report.name })}><Download size={14} />CSV</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void remove(report)} aria-label={ui('settings.reports.removeNamed', undefined, { name: report.name })}><Trash2 size={14} />{ui('settings.reports.remove')}</button>
    </div> },
  ];

  const maxRecipients = state?.maxRecipients ?? 100;
  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><h2>{ui('settings.reports.title')}</h2><p className="panel-description">{ui('settings.reports.description')}</p></div><FileText size={19} /></div>
    {state && !state.channels.email && !state.channels.teams && <div className="ipam-alert">{ui('settings.reports.noChannel')}</div>}
    {state && !state.publicLinks && <div className="ipam-alert warning" role="status">{ui('settings.reports.noPublicUrl')}<small className="settings-env-help">{ui('settings.reports.noPublicUrlHelp')}</small></div>}
    {feedback && <div className="ipam-alert error">{feedback}</div>}

    {editing && <form className="settings-form" id="settings-reports-form" onSubmit={(event) => void save(event)} aria-label={editing === 'new' ? ui('settings.reports.new') : ui('settings.reports.editTitle')}>
      <fieldset className="notification-channel-fieldset" disabled={busy === 'save'}>
        <legend>{editing === 'new' ? ui('settings.reports.new') : ui('settings.reports.editTitle')}</legend>
        <div className="notification-channel-grid">
          <label>{ui('settings.reports.name')}<input required maxLength={120} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder={ui('settings.reports.namePlaceholder')} /></label>
          <label>{ui('settings.reports.frequency')}<select value={draft.frequency} onChange={(event) => set({ frequency: event.target.value as ReportFrequency })}><option value="WEEKLY">{ui('settings.reports.weeklyOption')}</option><option value="MONTHLY">{ui('settings.reports.monthlyOption')}</option></select></label>
          {draft.frequency === 'WEEKLY'
            ? <label>{ui('settings.reports.dayOfWeek')}<select value={draft.dayOfWeek} onChange={(event) => set({ dayOfWeek: Number(event.target.value) })}>{WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
            : <label>{ui('settings.reports.dayOfMonth')}<input type="number" min={1} max={28} value={draft.dayOfMonth} onChange={(event) => set({ dayOfMonth: Number(event.target.value) })} /><small>{ui('settings.reports.dayOfMonthHint')}</small></label>}
          <label>{ui('settings.reports.hour')}<select value={draft.hour} onChange={(event) => set({ hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
          <label>{ui('settings.reports.timezone')}<input required maxLength={64} spellCheck={false} value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })} placeholder="Europe/Lisbon" /></label>
        </div>
        <fieldset className="notification-channel-fieldset"><legend>{ui('settings.reports.sections')}</legend>
          {REPORT_SECTIONS.map(({ value, label, description }) => <label key={value} className="settings-check"><input type="checkbox" checked={draft.sections.includes(value)} onChange={(event) => set({ sections: toggle(draft.sections, value, event.target.checked) })} /> <span><strong>{label}</strong> <small>{description}</small></span></label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>{ui('settings.reports.col.sites')}</legend>
          <p className="panel-description">{ui('settings.reports.sitesHint')}</p>
          {(state?.sites ?? []).map((site) => <label key={site.id} className="settings-check"><input type="checkbox" checked={draft.siteIds.includes(site.id)} onChange={(event) => set({ siteIds: toggle(draft.siteIds, site.id, event.target.checked) })} /> {site.name}</label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>{ui('settings.reports.recipientsLegend', undefined, { selected: draft.recipientIds.length, max: maxRecipients })}</legend>
          <p className="panel-description">{ui('settings.reports.recipientsHint')}</p>
          {draft.recipientIds.length > 0 && <div className="modal-actions">{draft.recipientIds.map((id) => { const user = users.get(id); return <button key={id} type="button" className="secondary-button" onClick={() => set({ recipientIds: toggle(draft.recipientIds, id, false) })} aria-label={ui('settings.reports.removeRecipient', undefined, { name: user ? userLabel(user) : id })}><X size={12} />{user ? userLabel(user) : id}{user && !user.hasEmail ? ` · ${ui('settings.reports.noEmail')}` : ''}</button>; })}</div>}
          <label>{ui('settings.reports.searchUser')}<input type="search" value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder={ui('settings.reports.searchUserPlaceholder')} /></label>
          {filteredUsers.map((user) => <label key={user.id} className="settings-check"><input type="checkbox" disabled={!draft.recipientIds.includes(user.id) && draft.recipientIds.length >= maxRecipients} checked={draft.recipientIds.includes(user.id)} onChange={(event) => set({ recipientIds: toggle(draft.recipientIds, user.id, event.target.checked) })} /> {userLabel(user)}{!user.hasEmail && <small> · {ui('settings.reports.noEmail')}</small>}</label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>{ui('settings.reports.delivery')}</legend>
          <label className="settings-check"><input type="checkbox" checked={draft.sendEmail} onChange={(event) => set({ sendEmail: event.target.checked })} /> {ui('settings.reports.sendEmail')}{state && !state.channels.email && <small> · {ui('settings.reports.smtpDisabled')}</small>}</label>
          <label className="settings-check"><input type="checkbox" checked={draft.sendTeams} onChange={(event) => set({ sendTeams: event.target.checked })} /> {ui('settings.reports.sendTeams')}{state && !state.channels.teams && <small> · {ui('settings.reports.channelDisabled')}</small>}</label>
          <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> {ui('settings.reports.enabled')}</label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => { setEditing(null); setFeedback(''); }}><X size={14} />{ui('settings.reports.cancel')}</button>
          <button type="submit" className="primary-button" disabled={busy === 'save'}><Check size={14} />{busy === 'save' ? ui('settings.reports.saving') : ui('settings.reports.save')}</button>
        </div>
      </fieldset>
    </form>}

    {loading && !state ? <div className="content-skeleton settings-loading-title" aria-label={ui('settings.reports.loading')} />
      : <DataTable rows={state?.reports ?? []} columns={columns} rowKey={(report) => report.id} label={ui('settings.reports.title')} empty={<p className="no-data">{ui('settings.reports.empty')}</p>} />}
    <PageToolbarPortal><button type="button" className="primary-button" disabled={loading || Boolean(editing)} onClick={startNew}><Plus size={14} />{ui('settings.reports.new')}</button></PageToolbarPortal>
    {confirmDialog}
  </section>;
}
