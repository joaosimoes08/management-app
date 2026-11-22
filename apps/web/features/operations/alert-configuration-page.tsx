'use client';

import { DateTimeInput } from '@/components/ui/date-time-input';
import { FormEvent, useCallback, useEffect, useState } from 'react';
import { Pencil, RefreshCw, X } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { AppShell } from '@/components/layout/app-shell';
import { useTableUrlState } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { alertListHref } from '@/features/dashboard/drill-through';
import { listSites } from '@/features/infrastructure/api';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api/client';
import { formatDateTime } from '@/lib/format/date';
import { useSiteContext } from '@/lib/site-context';
import { patchAlertRule, patchMaintenanceWindow, type AlertRule as Rule, type AlertRulePatch, type MaintenanceWindowPatch } from './api';
import { AlertList, MaintenanceSummaryPanel, alertListConfig, alertSeverities } from './alerts-overview';

type Window = { id: string; name: string; reason?: string | null; siteId?: string | null; startsAt: string; endsAt: string; site?: { id: string; name: string } | null };
type Site = { id: string; name: string };
const blankRule = { name: '', source: '', siteId: '', minSeverity: 'WARNING', enabled: true };
const blankWindow = { name: '', reason: '', siteId: '', startsAt: '', endsAt: '' };

/** ISO → form value in local time. */
const toLocalInput = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

export default function AlertConfigurationPage() {
  const { hasRole } = useAuth(); const admin = hasRole('ADMIN'); const { siteId } = useSiteContext(); const queryClient = useQueryClient();
  const table = useTableUrlState(alertListConfig);
  const { confirm, confirmDialog } = useConfirm();
  const [rules, setRules] = useState<Rule[]>([]); const [windows, setWindows] = useState<Window[]>([]); const [sites, setSites] = useState<Site[]>([]); const [rule, setRule] = useState(blankRule); const [windowForm, setWindowForm] = useState(blankWindow); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null); const [editingWindow, setEditingWindow] = useState<Window | null>(null);
  const load = useCallback(async () => { const [config, siteResult] = await Promise.all([apiFetch<{ rules: Rule[]; windows: Window[] }>('/api/v1/operations/configuration'), listSites()]); setRules(config.rules); setWindows(config.windows); setSites(siteResult.items ?? []); }, []);
  useEffect(() => { if (admin) void load().catch((cause) => setError(errorText(cause, 'Não foi possível carregar a configuração.'))); }, [admin, load]);
  const refreshOverview = () => queryClient.invalidateQueries({ queryKey: ['operations'] });
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); void refreshOverview(); return true; } catch (cause) { setError(errorText(cause, 'Não foi possível guardar.')); return false; } finally { setBusy(false); } };
  const saveRule = (event: FormEvent) => { event.preventDefault(); void act(() => apiFetch('/api/v1/operations/configuration/rules', { method: 'POST', body: JSON.stringify({ ...rule, siteId: rule.siteId || null }) })); setRule(blankRule); };
  const saveWindow = (event: FormEvent) => { event.preventDefault(); void act(() => apiFetch('/api/v1/operations/configuration/maintenance-windows', { method: 'POST', body: JSON.stringify({ ...windowForm, siteId: windowForm.siteId || null, startsAt: new Date(windowForm.startsAt).toISOString(), endsAt: new Date(windowForm.endsAt).toISOString() }) })); setWindowForm(blankWindow); };
  const toggleRule = (item: Rule) => void act(() => patchAlertRule(item.id, { enabled: !item.enabled }));
  const deleteRule = async (item: Rule) => { if (await confirm({ title: 'Eliminar regra', message: `Eliminar a regra "${item.name}"? Os alertas deste tipo voltam a seguir as restantes regras.`, confirmLabel: 'Eliminar', cancelLabel: 'Voltar', destructive: true })) void act(() => apiFetch(`/api/v1/operations/configuration/rules/${item.id}`, { method: 'DELETE' })); };
  const deleteWindow = async (item: Window) => { if (await confirm({ title: 'Cancelar janela', message: `Cancelar a janela de manutenção "${item.name}"?`, confirmLabel: 'Cancelar janela', cancelLabel: 'Voltar', destructive: true })) void act(() => apiFetch(`/api/v1/operations/configuration/maintenance-windows/${item.id}`, { method: 'DELETE' })); };
  /** Returns an error message, or '' when saved. */
  const submitRule = async (patch: AlertRulePatch) => { if (!editingRule) return ''; try { await patchAlertRule(editingRule.id, patch); setEditingRule(null); await load(); void refreshOverview(); return ''; } catch (cause) { return errorText(cause, 'Não foi possível guardar a regra.'); } };
  const submitWindow = async (patch: MaintenanceWindowPatch) => { if (!editingWindow) return ''; try { await patchMaintenanceWindow(editingWindow.id, patch); setEditingWindow(null); await load(); void refreshOverview(); return ''; } catch (cause) { return errorText(cause, 'Não foi possível guardar a janela.'); } };
  const refresh = () => { void refreshOverview(); if (admin) void load().catch((cause) => setError(errorText(cause, 'Não foi possível carregar a configuração.'))); };

  return <>{confirmDialog}<AppShell section="Alertas" search={{ value: table.search, onChange: table.setSearch, placeholder: 'Pesquisar alertas…', ariaLabel: 'Pesquisar alertas' }} actions={<><button className="topbar-action secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={14} /> Atualizar</button>{(admin || hasRole('AUDITOR')) && <a className="secondary-button" href="/auditoria">Histórico de auditoria</a>}</>}><div className="module-page"><header className="workspace-head"><div><span className="section-kicker">OPERAÇÕES</span><h1>Alertas</h1><p>Alertas por resolver, janelas de manutenção e regras de alerta. Alertas críticos permanecem ativos durante qualquer janela.</p></div></header>
    <AlertList siteId={siteId} table={table} />
    <MaintenanceSummaryPanel siteId={table.filters.scope === 'all' ? '' : siteId} />
    {admin && <>{error && <div className="ipam-alert error">{error}</div>}<section className="panel settings-panel" id="regras"><div className="panel-heading"><div><span className="section-kicker">REGRAS</span><h2>Regras de alerta</h2></div></div><form className="settings-form" onSubmit={saveRule}><label>Nome<input required maxLength={120} value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></label><label>Tipo de evento<input required maxLength={100} placeholder="Ex.: SNMP_DRIFT" value={rule.source} onChange={(e) => setRule({ ...rule, source: e.target.value })} /></label><label>Site<select value={rule.siteId} onChange={(e) => setRule({ ...rule, siteId: e.target.value })}><option value="">Todos os Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><label>Severidade mínima<select value={rule.minSeverity} onChange={(e) => setRule({ ...rule, minSeverity: e.target.value })}>{alertSeverities.map((severity) => <option key={severity}>{severity}</option>)}</select></label><button className="primary-button" disabled={busy}>Adicionar regra</button></form><div className="audit-list">{rules.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{item.source} · {item.site?.name ?? 'Todos os Sites'} · mínimo {item.minSeverity} · {item.enabled ? 'Ativa' : 'Inativa'}</small>{item.activeAlerts && <RuleAlertCountsLine rule={item} />}</span><span className="table-actions"><label className="checkbox-label"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={() => toggleRule(item)} aria-label={`${item.enabled ? 'Desativar' : 'Ativar'} regra ${item.name}`} /> Ativa</label><button className="icon-button subtle" disabled={busy} onClick={() => setEditingRule(item)} aria-label={`Editar regra ${item.name}`} title="Editar"><Pencil size={14} /></button><button className="secondary-button" disabled={busy} onClick={() => void deleteRule(item)}>Eliminar</button></span></div>)}{!rules.length && <div className="no-data">Ainda não existem regras configuradas.</div>}</div></section><section className="panel settings-panel"><div className="panel-heading"><div><span className="section-kicker">JANELAS DE MANUTENÇÃO</span><h2>Períodos agendados</h2></div></div><form className="settings-form" onSubmit={saveWindow}><label>Nome<input required maxLength={120} value={windowForm.name} onChange={(e) => setWindowForm({ ...windowForm, name: e.target.value })} /></label><label>Site<select value={windowForm.siteId} onChange={(e) => setWindowForm({ ...windowForm, siteId: e.target.value })}><option value="">Todos os Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><DateTimeInput label="Início" required value={windowForm.startsAt} onChange={(value) => setWindowForm({ ...windowForm, startsAt: value })} /><DateTimeInput label="Fim" required value={windowForm.endsAt} onChange={(value) => setWindowForm({ ...windowForm, endsAt: value })} /><label>Motivo<textarea maxLength={500} value={windowForm.reason} onChange={(e) => setWindowForm({ ...windowForm, reason: e.target.value })} /></label><button className="primary-button" disabled={busy}>Agendar janela</button></form><div className="audit-list">{windows.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{item.site?.name ?? 'Todos os Sites'} · {formatDateTime(item.startsAt)} — {formatDateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ''}</small></span><span className="table-actions"><button className="icon-button subtle" disabled={busy} onClick={() => setEditingWindow(item)} aria-label={`Editar janela ${item.name}`} title="Editar"><Pencil size={14} /></button><button className="secondary-button" disabled={busy} onClick={() => void deleteWindow(item)}>Cancelar</button></span></div>)}{!windows.length && <div className="no-data">Sem janelas agendadas.</div>}</div></section></>}
    {editingRule && <RuleDialog rule={editingRule} sites={sites} close={() => setEditingRule(null)} save={submitRule} />}
    {editingWindow && <WindowDialog item={editingWindow} sites={sites} close={() => setEditingWindow(null)} save={submitWindow} />}
  </div></AppShell></>;
}

/** Open alerts this rule matches, with the governed split; links to the alert list filtered by its event type. */
function RuleAlertCountsLine({ rule }: { rule: Rule }) {
  const counts = rule.activeAlerts!;
  const href = alertListHref(rule.siteId ?? undefined, { source: rule.source, scope: rule.siteId ? undefined : 'all' });
  return <small>Alertas ativos: <a className="text-button" href={href} aria-label={`Ver ${counts.matching} alertas ativos de ${rule.name}`}>{counts.matching}</a>{counts.governed > 0 && ` · ${counts.shown} visíveis · ${counts.belowThreshold} abaixo do mínimo · ${counts.inMaintenance} em manutenção`}</small>;
}

function RuleDialog({ rule, sites, close, save }: { rule: Rule; sites: Site[]; close: () => void; save: (patch: AlertRulePatch) => Promise<string> }) {
  const [form, setForm] = useState({ name: rule.name, source: rule.source, siteId: rule.siteId ?? '', minSeverity: rule.minSeverity, enabled: rule.enabled });
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    // Only the changed fields are sent (partial update).
    const patch: AlertRulePatch = {};
    if (form.name.trim() !== rule.name) patch.name = form.name.trim();
    if (form.source.trim() !== rule.source) patch.source = form.source.trim();
    if (form.siteId !== (rule.siteId ?? '')) patch.siteId = form.siteId || null;
    if (form.minSeverity !== rule.minSeverity) patch.minSeverity = form.minSeverity;
    if (form.enabled !== rule.enabled) patch.enabled = form.enabled;
    if (!Object.keys(patch).length) { close(); return; }
    setSaving(true); setError('');
    const failure = await save(patch);
    setSaving(false);
    if (failure) setError(failure);
  };
  return <IpamModal title={`Editar regra ${rule.name}`} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>Nome<input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
    <label>Tipo de evento<input required maxLength={100} value={form.source} onChange={(e) => setForm({ ...form, source: e.target.value })} /></label>
    <label>Site<select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">Todos os Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <label>Severidade mínima<select value={form.minSeverity} onChange={(e) => setForm({ ...form, minSeverity: e.target.value })}>{alertSeverities.map((severity) => <option key={severity}>{severity}</option>)}</select></label>
    <label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> Regra ativa</label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'A guardar…' : 'Guardar regra'}</button></div>
  </form></IpamModal>;
}

function WindowDialog({ item, sites, close, save }: { item: Window; sites: Site[]; close: () => void; save: (patch: MaintenanceWindowPatch) => Promise<string> }) {
  const initial = { name: item.name, reason: item.reason ?? '', siteId: item.siteId ?? '', startsAt: toLocalInput(item.startsAt), endsAt: toLocalInput(item.endsAt) };
  const [form, setForm] = useState(initial);
  const [error, setError] = useState(''); const [saving, setSaving] = useState(false);
  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    const patch: MaintenanceWindowPatch = {};
    if (form.name.trim() !== item.name) patch.name = form.name.trim();
    if (form.reason !== initial.reason) patch.reason = form.reason.trim() || null;
    if (form.siteId !== initial.siteId) patch.siteId = form.siteId || null;
    if (form.startsAt !== initial.startsAt) patch.startsAt = new Date(form.startsAt).toISOString();
    if (form.endsAt !== initial.endsAt) patch.endsAt = new Date(form.endsAt).toISOString();
    if (!Object.keys(patch).length) { close(); return; }
    setSaving(true); setError('');
    const failure = await save(patch);
    setSaving(false);
    if (failure) setError(failure);
  };
  return <IpamModal title={`Editar janela ${item.name}`} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>Nome<input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
    <label>Site<select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">Todos os Sites</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <DateTimeInput label="Início" required value={form.startsAt} onChange={(value) => setForm({ ...form, startsAt: value })} />
    <DateTimeInput label="Fim" required value={form.endsAt} onChange={(value) => setForm({ ...form, endsAt: value })} />
    <label>Motivo<textarea maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button className="primary-button" disabled={saving}>{saving ? 'A guardar…' : 'Guardar janela'}</button></div>
  </form></IpamModal>;
}
