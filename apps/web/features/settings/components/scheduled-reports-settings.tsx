'use client';

import { FormEvent, useCallback, useEffect, useMemo, useState } from 'react';
import { Check, Download, FileText, Pencil, Plus, Send, Trash2, X } from 'lucide-react';
import { DataTable, type DataTableColumn } from '@/components/data-table';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useToast } from '@/components/ui/toast';
import { apiDownload, apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
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
    catch (reason) { setFeedback(messageOf(reason, 'Não foi possível carregar os relatórios agendados.')); }
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
    if (!draft.sections.length) { setFeedback('Escolhe pelo menos uma secção.'); return; }
    if (!draft.sendEmail && !draft.sendTeams) { setFeedback('Escolhe pelo menos um canal de envio.'); return; }
    setBusy('save'); setFeedback('');
    const body = {
      name: draft.name.trim(), enabled: draft.enabled, frequency: draft.frequency, hour: draft.hour, timezone: draft.timezone.trim(),
      ...(draft.frequency === 'WEEKLY' ? { dayOfWeek: draft.dayOfWeek } : { dayOfMonth: draft.dayOfMonth }),
      sections: draft.sections, siteIds: draft.siteIds, recipientIds: draft.recipientIds, sendEmail: draft.sendEmail, sendTeams: draft.sendTeams,
    };
    try {
      await apiFetch(editing === 'new' ? ROOT : `${ROOT}/${editing}`, { method: editing === 'new' ? 'POST' : 'PUT', body: JSON.stringify(body) });
      success('Relatórios', editing === 'new' ? 'Relatório criado' : 'Relatório guardado');
      setEditing(null);
      await load();
    } catch (reason) { const message = messageOf(reason, 'Não foi possível guardar o relatório.'); setFeedback(message); toastError('Relatórios', message); }
    finally { setBusy(''); }
  };

  const remove = async (report: ScheduledReport) => {
    if (!(await confirm({ title: 'Remover relatório', message: `Remover “${report.name}”? Os destinatários deixam de o receber e os relatórios gerados são apagados.`, confirmLabel: 'Remover', destructive: true }))) return;
    setBusy(`remove:${report.id}`);
    try { await apiFetch(`${ROOT}/${report.id}`, { method: 'DELETE' }); success('Relatórios', 'Relatório removido'); if (editing === report.id) setEditing(null); await load(); }
    catch (reason) { toastError('Relatórios', messageOf(reason, 'Não foi possível remover o relatório.')); }
    finally { setBusy(''); }
  };

  const run = async (report: ScheduledReport) => {
    if (!(await confirm({ title: 'Enviar agora', message: `Enviar “${report.name}” agora a ${report.recipients.filter((item) => !item.unsubscribedAt).length} destinatário(s)? Cada um recebe apenas os Sites a que tem acesso.`, confirmLabel: 'Enviar' }))) return;
    setBusy(`run:${report.id}`);
    try {
      const result = await apiFetch<RunResult>(`${ROOT}/${report.id}/run`, { method: 'POST' });
      const queued = result.recipients.filter((item) => item.email === 'QUEUED').length;
      const noEmail = result.recipients.filter((item) => item.email === 'NO_EMAIL').length;
      success('Relatórios', `${queued} email(s) em envio${result.teams === 'QUEUED' ? ' e resumo no Teams' : ''}${noEmail ? ` · ${noEmail} sem email` : ''}`);
      await load();
    } catch (reason) { toastError('Relatórios', messageOf(reason, 'Não foi possível enviar o relatório.')); }
    finally { setBusy(''); }
  };

  const download = async (report: ScheduledReport) => {
    setBusy(`csv:${report.id}`);
    try { await apiDownload(`${ROOT}/${report.id}/csv`, reportCsvFilename(report.name)); }
    catch (reason) { toastError('Relatórios', messageOf(reason, 'Não foi possível descarregar o CSV.')); }
    finally { setBusy(''); }
  };

  const columns: DataTableColumn<ScheduledReport>[] = [
    { id: 'name', header: 'Relatório', cell: (report) => <><strong>{report.name}</strong><br /><small>{report.sections.map((section) => SECTION_LABEL[section] ?? section).join(' · ')}</small></> },
    { id: 'schedule', header: 'Agendamento', cell: (report) => <><span>{scheduleLabel(report)}</span><br /><small>{!report.enabled ? 'Desativado' : report.nextRunAt ? `Próximo envio ${formatDateTime(report.nextRunAt)}` : '—'}</small></> },
    { id: 'scope', header: 'Sites', cell: (report) => report.siteIds.length ? report.siteIds.map((id) => sites.get(id) ?? id).join(', ') : <small>Todos os Sites de cada destinatário</small> },
    { id: 'recipients', header: 'Destinatários', cell: (report) => { const unsubscribed = report.recipients.filter((item) => item.unsubscribedAt).length; return <><span>{report.recipients.length}</span>{unsubscribed ? <><br /><small>{unsubscribed} cancelou a subscrição</small></> : null}</>; } },
    { id: 'channels', header: 'Canais', cell: (report) => [report.sendEmail && 'Email', report.sendTeams && 'Teams'].filter(Boolean).join(' + ') },
    { id: 'lastRun', header: 'Último envio', cell: (report) => report.lastRun ? <><span>{formatDateTime(report.lastRun.createdAt)}</span><br /><small>{report.lastRun.trigger === 'MANUAL' ? 'Manual' : 'Agendado'} · {report.lastRun.outputs} relatório(s)</small></> : '—' },
    { id: 'actions', header: 'Ações', cell: (report) => <div className="modal-actions">
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => startEdit(report)} aria-label={`Editar ${report.name}`}><Pencil size={14} />Editar</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy) || !report.recipients.length} onClick={() => void run(report)} aria-label={`Enviar ${report.name} agora`}><Send size={14} />{busy === `run:${report.id}` ? 'A enviar…' : 'Enviar agora'}</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void download(report)} aria-label={`Descarregar CSV de ${report.name}`}><Download size={14} />CSV</button>
      <button type="button" className="secondary-button" disabled={Boolean(busy)} onClick={() => void remove(report)} aria-label={`Remover ${report.name}`}><Trash2 size={14} />Remover</button>
    </div> },
  ];

  const maxRecipients = state?.maxRecipients ?? 100;
  return <section className="ipam-card settings-panel">
    <div className="panel-heading"><div><h2>Relatórios agendados</h2><p className="panel-description">Resumo semanal ou mensal por Site: conformidade das atestações, datas de ciclo de vida, qualidade do inventário, capacidade e alterações. Cada destinatário recebe apenas os Sites a que tem acesso. O email inclui o relatório e um CSV; o Teams recebe só um resumo com ligação, sem números.</p></div><FileText size={19} /></div>
    {state && !state.channels.email && !state.channels.teams && <div className="ipam-alert">Nenhum canal de envio está ativo. Ativa o email (servidor SMTP) ou os alertas operacionais do Teams no separador Notificações; até lá, os relatórios só podem ser descarregados.</div>}
    {state && !state.publicLinks && <div className="ipam-alert warning" role="status">APP_PUBLIC_URL não está definido: os emails seguem sem ligação para a aplicação nem ligação de cancelamento (o destinatário pode cancelar em Perfil → Notificações).</div>}
    {feedback && <div className="ipam-alert error">{feedback}</div>}

    {editing && <form className="settings-form" id="settings-reports-form" onSubmit={(event) => void save(event)} aria-label={editing === 'new' ? 'Novo relatório' : 'Editar relatório'}>
      <fieldset className="notification-channel-fieldset" disabled={busy === 'save'}>
        <legend>{editing === 'new' ? 'Novo relatório' : 'Editar relatório'}</legend>
        <div className="notification-channel-grid">
          <label>Nome<input required maxLength={120} value={draft.name} onChange={(event) => set({ name: event.target.value })} placeholder="Ex.: Operação semanal" /></label>
          <label>Frequência<select value={draft.frequency} onChange={(event) => set({ frequency: event.target.value as ReportFrequency })}><option value="WEEKLY">Semanal (7 dias anteriores)</option><option value="MONTHLY">Mensal (mês anterior)</option></select></label>
          {draft.frequency === 'WEEKLY'
            ? <label>Dia da semana<select value={draft.dayOfWeek} onChange={(event) => set({ dayOfWeek: Number(event.target.value) })}>{WEEKDAYS.map((label, index) => <option key={label} value={index + 1}>{label}</option>)}</select></label>
            : <label>Dia do mês<input type="number" min={1} max={28} value={draft.dayOfMonth} onChange={(event) => set({ dayOfMonth: Number(event.target.value) })} /><small>1 a 28, para existir em todos os meses.</small></label>}
          <label>Hora<select value={draft.hour} onChange={(event) => set({ hour: Number(event.target.value) })}>{Array.from({ length: 24 }, (_, hour) => <option key={hour} value={hour}>{String(hour).padStart(2, '0')}:00</option>)}</select></label>
          <label>Fuso horário<input required maxLength={64} spellCheck={false} value={draft.timezone} onChange={(event) => set({ timezone: event.target.value })} placeholder="Europe/Lisbon" /></label>
        </div>
        <fieldset className="notification-channel-fieldset"><legend>Secções</legend>
          {REPORT_SECTIONS.map(({ value, label, description }) => <label key={value} className="settings-check"><input type="checkbox" checked={draft.sections.includes(value)} onChange={(event) => set({ sections: toggle(draft.sections, value, event.target.checked) })} /> <span><strong>{label}</strong> <small>{description}</small></span></label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>Sites</legend>
          <p className="panel-description">Sem nenhum escolhido, o relatório inclui todos os Sites a que cada destinatário tem acesso.</p>
          {(state?.sites ?? []).map((site) => <label key={site.id} className="settings-check"><input type="checkbox" checked={draft.siteIds.includes(site.id)} onChange={(event) => set({ siteIds: toggle(draft.siteIds, site.id, event.target.checked) })} /> {site.name}</label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>Destinatários ({draft.recipientIds.length}/{maxRecipients})</legend>
          <p className="panel-description">Quem cancelar a subscrição continua na lista mas deixa de receber, até voltar a subscrever em Perfil → Notificações.</p>
          {draft.recipientIds.length > 0 && <div className="modal-actions">{draft.recipientIds.map((id) => { const user = users.get(id); return <button key={id} type="button" className="secondary-button" onClick={() => set({ recipientIds: toggle(draft.recipientIds, id, false) })} aria-label={`Retirar ${user ? userLabel(user) : id}`}><X size={12} />{user ? userLabel(user) : id}{user && !user.hasEmail ? ' · sem email' : ''}</button>; })}</div>}
          <label>Procurar utilizador<input type="search" value={recipientQuery} onChange={(event) => setRecipientQuery(event.target.value)} placeholder="Nome ou utilizador" /></label>
          {filteredUsers.map((user) => <label key={user.id} className="settings-check"><input type="checkbox" disabled={!draft.recipientIds.includes(user.id) && draft.recipientIds.length >= maxRecipients} checked={draft.recipientIds.includes(user.id)} onChange={(event) => set({ recipientIds: toggle(draft.recipientIds, user.id, event.target.checked) })} /> {userLabel(user)}{!user.hasEmail && <small> · sem email</small>}</label>)}
        </fieldset>
        <fieldset className="notification-channel-fieldset"><legend>Envio</legend>
          <label className="settings-check"><input type="checkbox" checked={draft.sendEmail} onChange={(event) => set({ sendEmail: event.target.checked })} /> Email a cada destinatário (relatório + CSV){state && !state.channels.email && <small> · servidor SMTP desativado</small>}</label>
          <label className="settings-check"><input type="checkbox" checked={draft.sendTeams} onChange={(event) => set({ sendTeams: event.target.checked })} /> Resumo no canal de alertas operacionais do Teams (sem números){state && !state.channels.teams && <small> · canal desativado</small>}</label>
          <label className="settings-check"><input type="checkbox" checked={draft.enabled} onChange={(event) => set({ enabled: event.target.checked })} /> Envio agendado ativo</label>
        </fieldset>
        <div className="modal-actions">
          <button type="button" className="secondary-button" onClick={() => { setEditing(null); setFeedback(''); }}><X size={14} />Cancelar</button>
          <button type="submit" className="primary-button" disabled={busy === 'save'}><Check size={14} />{busy === 'save' ? 'A guardar…' : 'Guardar relatório'}</button>
        </div>
      </fieldset>
    </form>}

    {loading && !state ? <div className="content-skeleton settings-loading-title" aria-label="A carregar" />
      : <DataTable rows={state?.reports ?? []} columns={columns} rowKey={(report) => report.id} label="Relatórios agendados" empty={<p className="no-data">Sem relatórios agendados.</p>} />}
    <PageToolbarPortal><button type="button" className="primary-button" disabled={loading || Boolean(editing)} onClick={startNew}><Plus size={14} />Novo relatório</button></PageToolbarPortal>
    {confirmDialog}
  </section>;
}
