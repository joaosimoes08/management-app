'use client';

import { DateTimeInput } from '@/components/ui/date-time-input';
import { FormEvent, useId, useState } from 'react';
import { Pencil, RefreshCw, X } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { PageShell } from '@/components/layout/app-shell';
import { useTableUrlState } from '@/components/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { CompactModal } from '@/components/ui/compact-modal';
import { alertListHref } from '@/features/dashboard/drill-through';
import { useAuth } from '@/lib/auth';
import { formatDateTime } from '@/lib/format/date';
import { useSiteContext } from '@/lib/site-context';
import {
  createAlertRule, createMaintenanceWindow, deleteAlertRule, deleteMaintenanceWindow, getAlertConfigurationPageData, listAlertSources, operationsKeys, patchAlertRule, patchMaintenanceWindow,
  type AlertRule as Rule, type AlertRulePatch, type MaintenanceWindow as Window, type MaintenanceWindowPatch,
} from './api';
import { AlertList, MaintenanceSummaryPanel, alertListConfig, alertSeverities } from './alerts-overview';
import { ALERT_SOURCES, alertSourceLabel, isKnownAlertSource, severityMeaning, severityName } from './alert-meta';
import { useUiText } from '@/components/ui/use-ui-text';

type Site = { id: string; name: string };
const blankRule = { name: '', source: '', siteId: '', minSeverity: 'WARNING', enabled: true };
const blankWindow = { name: '', reason: '', siteId: '', startsAt: '', endsAt: '' };

/** ISO → form value in local time. */
const toLocalInput = (iso: string) => { const date = new Date(iso); return Number.isNaN(date.getTime()) ? '' : new Date(date.getTime() - date.getTimezoneOffset() * 60_000).toISOString().slice(0, 16); };
const errorText = (cause: unknown, fallback: string) => (cause instanceof Error ? cause.message : fallback);

export default function AlertConfigurationPage() {
  const tx = useUiText();
  const { hasRole } = useAuth(); const admin = hasRole('ADMIN'); const { siteId } = useSiteContext(); const queryClient = useQueryClient();
  const table = useTableUrlState(alertListConfig);
  const { confirm, confirmDialog } = useConfirm();
  const [rule, setRule] = useState(blankRule); const [windowForm, setWindowForm] = useState(blankWindow); const [error, setError] = useState(''); const [busy, setBusy] = useState(false);
  const [editingRule, setEditingRule] = useState<Rule | null>(null); const [editingWindow, setEditingWindow] = useState<Window | null>(null);
  // Rules, windows and Sites load together (ADMIN only), on every visit and after every change, as before.
  const config = useQuery({ queryKey: operationsKeys.configuration, queryFn: getAlertConfigurationPageData, enabled: admin, retry: false, staleTime: 0, refetchOnReconnect: false });
  const rules: Rule[] = config.data?.rules ?? []; const windows: Window[] = config.data?.windows ?? []; const sites: Site[] = config.data?.sites ?? [];
  // A failed load reports in the page's error line; an action clears it, as before.
  const [seenError, setSeenError] = useState(0);
  if (config.error && config.errorUpdatedAt !== seenError) { setSeenError(config.errorUpdatedAt); setError(errorText(config.error, tx('operations.config.loadError'))); }
  const load = () => config.refetch({ throwOnError: true });
  const refreshOverview = () => queryClient.invalidateQueries({ queryKey: operationsKeys.all });
  const act = async (fn: () => Promise<unknown>) => { setBusy(true); setError(''); try { await fn(); await load(); void refreshOverview(); return true; } catch (cause) { setError(errorText(cause, tx('operations.config.saveError'))); return false; } finally { setBusy(false); } };
  const saveRule = (event: FormEvent) => { event.preventDefault(); void act(() => createAlertRule({ ...rule, siteId: rule.siteId || null })); setRule(blankRule); };
  const saveWindow = (event: FormEvent) => { event.preventDefault(); void act(() => createMaintenanceWindow({ ...windowForm, siteId: windowForm.siteId || null, startsAt: new Date(windowForm.startsAt).toISOString(), endsAt: new Date(windowForm.endsAt).toISOString() })); setWindowForm(blankWindow); };
  const toggleRule = (item: Rule) => void act(() => patchAlertRule(item.id, { enabled: !item.enabled }));
  const deleteRule = async (item: Rule) => { if (await confirm({ title: tx('operations.config.deleteRuleTitle'), message: tx('operations.config.deleteRuleMessage', undefined, { name: item.name }), confirmLabel: tx('operations.config.delete'), cancelLabel: tx('operations.config.back'), destructive: true })) void act(() => deleteAlertRule(item.id)); };
  const deleteWindow = async (item: Window) => { if (await confirm({ title: tx('operations.config.cancelWindowTitle'), message: tx('operations.config.cancelWindowMessage', undefined, { name: item.name }), confirmLabel: tx('operations.config.cancelWindowTitle'), cancelLabel: tx('operations.config.back'), destructive: true })) void act(() => deleteMaintenanceWindow(item.id)); };
  /** Returns an error message, or '' when saved. */
  const submitRule = async (patch: AlertRulePatch) => { if (!editingRule) return ''; try { await patchAlertRule(editingRule.id, patch); setEditingRule(null); await load(); void refreshOverview(); return ''; } catch (cause) { return errorText(cause, tx('operations.config.ruleSaveError')); } };
  const submitWindow = async (patch: MaintenanceWindowPatch) => { if (!editingWindow) return ''; try { await patchMaintenanceWindow(editingWindow.id, patch); setEditingWindow(null); await load(); void refreshOverview(); return ''; } catch (cause) { return errorText(cause, tx('operations.config.windowSaveError')); } };
  const refresh = () => { void refreshOverview(); if (admin) void load().catch((cause) => setError(errorText(cause, tx('operations.config.loadError')))); };

  return <>{confirmDialog}<PageShell section={tx('operations.config.section')} search={{ value: table.search, onChange: table.setSearch, placeholder: tx('operations.config.searchPlaceholder'), ariaLabel: tx('operations.config.searchAria') }} actions={<><button className="topbar-action secondary-button" disabled={busy} onClick={refresh}><RefreshCw size={14} /> {tx('operations.config.refresh')}</button>{(admin || hasRole('AUDITOR')) && <a className="secondary-button" href="/auditoria">{tx('operations.config.auditHistory')}</a>}</>}><div className="module-page"><header className="workspace-head"><div><h1>{tx('operations.config.section')}</h1><p>{tx('operations.config.intro')}</p></div></header>
    <AlertList siteId={siteId} table={table} />
    <MaintenanceSummaryPanel siteId={table.filters.scope === 'all' ? '' : siteId} />
    {admin && <>{error && <div className="ipam-alert error">{error}</div>}<section className="panel settings-panel" id="regras"><div className="panel-heading"><div><h2>{tx('operations.config.rulesTitle')}</h2></div></div><form className="settings-form" onSubmit={saveRule}><label>{tx('operations.config.name')}<input required maxLength={120} value={rule.name} onChange={(e) => setRule({ ...rule, name: e.target.value })} /></label><SourceSelect value={rule.source} onChange={(source) => setRule({ ...rule, source })} /><label>{tx('operations.alerts.field.site')}<select value={rule.siteId} onChange={(e) => setRule({ ...rule, siteId: e.target.value })}><option value="">{tx('operations.alerts.allSites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><SeveritySelect value={rule.minSeverity} onChange={(minSeverity) => setRule({ ...rule, minSeverity })} /><button className="primary-button" disabled={busy}>{tx('operations.config.addRule')}</button></form><div className="audit-list">{rules.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{alertSourceLabel(item.source, tx)} <code>{item.source}</code> · {item.site?.name ?? tx('operations.alerts.allSites')} · {tx('operations.config.minimumSeverityOf', undefined, { severity: severityName(item.minSeverity, tx) })} · {item.enabled ? tx('operations.config.ruleActive') : tx('operations.config.ruleInactive')}</small>{item.activeAlerts && <RuleAlertCountsLine rule={item} />}</span><span className="table-actions"><label className="checkbox-label"><input type="checkbox" checked={item.enabled} disabled={busy} onChange={() => toggleRule(item)} aria-label={tx(item.enabled ? 'groupB.alerts.disableRule' : 'groupB.alerts.enableRule', undefined, { rule: item.name })} /> {tx('operations.config.ruleActive')}</label><button className="icon-button subtle" disabled={busy} onClick={() => setEditingRule(item)} aria-label={tx('groupB.alerts.editRule', undefined, { rule: item.name })} title={tx('operations.config.edit')}><Pencil size={14} /></button><button className="secondary-button" disabled={busy} onClick={() => void deleteRule(item)}>{tx('operations.config.delete')}</button></span></div>)}{!rules.length && <div className="no-data">{tx('operations.config.noRules')}</div>}</div></section><section className="panel settings-panel"><div className="panel-heading"><div><h2>{tx('operations.config.windowsTitle')}</h2></div></div><form className="settings-form" onSubmit={saveWindow}><label>{tx('operations.config.name')}<input required maxLength={120} value={windowForm.name} onChange={(e) => setWindowForm({ ...windowForm, name: e.target.value })} /></label><label>{tx('operations.alerts.field.site')}<select value={windowForm.siteId} onChange={(e) => setWindowForm({ ...windowForm, siteId: e.target.value })}><option value="">{tx('operations.alerts.allSites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label><DateTimeInput label={tx('operations.config.start')} required value={windowForm.startsAt} onChange={(value) => setWindowForm({ ...windowForm, startsAt: value })} /><DateTimeInput label={tx('operations.config.end')} required value={windowForm.endsAt} onChange={(value) => setWindowForm({ ...windowForm, endsAt: value })} /><label>{tx('operations.config.reason')}<textarea maxLength={500} value={windowForm.reason} onChange={(e) => setWindowForm({ ...windowForm, reason: e.target.value })} /></label><button className="primary-button" disabled={busy}>{tx('operations.config.scheduleWindow')}</button></form><div className="audit-list">{windows.map((item) => <div className="audit-row" key={item.id}><span><strong>{item.name}</strong><small>{item.site?.name ?? tx('operations.alerts.allSites')} · {formatDateTime(item.startsAt)} — {formatDateTime(item.endsAt)}{item.reason ? ` · ${item.reason}` : ''}</small></span><span className="table-actions"><button className="icon-button subtle" disabled={busy} onClick={() => setEditingWindow(item)} aria-label={tx('operations.config.editWindowNamed', undefined, { name: item.name })} title={tx('operations.config.edit')}><Pencil size={14} /></button><button className="secondary-button" disabled={busy} onClick={() => void deleteWindow(item)}>{tx('operations.config.cancel')}</button></span></div>)}{!windows.length && <div className="no-data">{tx('operations.config.noWindows')}</div>}</div></section></>}
    {editingRule && <RuleDialog rule={editingRule} sites={sites} close={() => setEditingRule(null)} save={submitRule} />}
    {editingWindow && <WindowDialog item={editingWindow} sites={sites} close={() => setEditingWindow(null)} save={submitWindow} />}
  </div></PageShell></>;
}

/** Open alerts this rule matches, with the governed split; links to the alert list filtered by its event type. */
function RuleAlertCountsLine({ rule }: { rule: Rule }) {
  const tx = useUiText();
  const counts = rule.activeAlerts!;
  const href = alertListHref(rule.siteId ?? undefined, { source: rule.source, scope: rule.siteId ? undefined : 'all' });
  return <small>{tx('operations.config.activeAlertsLabel')} <a className="text-button" href={href} aria-label={tx('groupB.alerts.viewRuleAlerts', undefined, { count: counts.matching, rule: rule.name })}>{counts.matching}</a>{counts.governed > 0 && ` · ${tx('operations.config.governed', undefined, { shown: counts.shown, belowThreshold: counts.belowThreshold, inMaintenance: counts.inMaintenance })}`}</small>;
}

/**
 * Event type of a rule: the sources the back end raises plus any source already stored
 * (GET /operations/alerts/sources). A rule saved with another code keeps it as an option.
 */
function SourceSelect({ value, onChange }: { value: string; onChange: (source: string) => void }) {
  const query = useQuery({ queryKey: operationsKeys.alertSources, queryFn: listAlertSources, retry: false, staleTime: 60_000 });
  const known: string[] = query.data?.items ?? [...ALERT_SOURCES];
  const options = value && !known.includes(value) ? [...known, value] : known;
  const tx = useUiText();
  // "Label (CODE)" is one text, so the label is translated by key here; the page-wide pass cannot split it.
  const optionLabel = (source: string) => (isKnownAlertSource(source) ? `${tx(`alerts.source.${source}`, alertSourceLabel(source, tx))} (${source})` : source);
  return <label>{tx('operations.config.eventType')}<select required value={value} onChange={(event) => onChange(event.target.value)}>
    <option value="">{tx('operations.config.chooseEventType')}</option>
    {options.map((source) => <option key={source} value={source}>{optionLabel(source)}</option>)}
  </select></label>;
}

/** Minimum severity in Portuguese, with what each level means. */
function SeveritySelect({ value, onChange }: { value: string; onChange: (severity: string) => void }) {
  const tx = useUiText();
  const meaningId = useId();
  return <div className="field-with-hint"><label>{tx('operations.config.minimumSeverity')}<select value={value} onChange={(event) => onChange(event.target.value)} aria-describedby={meaningId}>
    {alertSeverities.map((severity) => <option key={severity} value={severity}>{severityName(severity, tx)}</option>)}
  </select></label><small id={meaningId}>{severityMeaning(value, tx) ?? ''}</small></div>;
}

function RuleDialog({ rule, sites, close, save }: { rule: Rule; sites: Site[]; close: () => void; save: (patch: AlertRulePatch) => Promise<string> }) {
  const tx = useUiText();
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
  return <CompactModal title={tx('groupB.alerts.editRule', undefined, { rule: rule.name })} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{tx('operations.config.name')}<input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
    <SourceSelect value={form.source} onChange={(source) => setForm({ ...form, source })} />
    <label>{tx('operations.alerts.field.site')}<select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">{tx('operations.alerts.allSites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <SeveritySelect value={form.minSeverity} onChange={(minSeverity) => setForm({ ...form, minSeverity })} />
    <label className="checkbox-label"><input type="checkbox" checked={form.enabled} onChange={(e) => setForm({ ...form, enabled: e.target.checked })} /> {tx('operations.config.ruleEnabled')}</label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('operations.config.cancel')}</button><button className="primary-button" disabled={saving}>{saving ? tx('operations.config.saving') : tx('operations.config.saveRule')}</button></div>
  </form></CompactModal>;
}

function WindowDialog({ item, sites, close, save }: { item: Window; sites: Site[]; close: () => void; save: (patch: MaintenanceWindowPatch) => Promise<string> }) {
  const tx = useUiText();
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
  return <CompactModal title={tx('operations.config.editWindowNamed', undefined, { name: item.name })} close={close}><form className="modal-form" onSubmit={(event) => void onSubmit(event)}>
    {error && <div className="ipam-alert error" role="alert"><X size={15} />{error}</div>}
    <label>{tx('operations.config.name')}<input required autoFocus maxLength={120} value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} /></label>
    <label>{tx('operations.alerts.field.site')}<select value={form.siteId} onChange={(e) => setForm({ ...form, siteId: e.target.value })}><option value="">{tx('operations.alerts.allSites')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name}</option>)}</select></label>
    <DateTimeInput label={tx('operations.config.start')} required value={form.startsAt} onChange={(value) => setForm({ ...form, startsAt: value })} />
    <DateTimeInput label={tx('operations.config.end')} required value={form.endsAt} onChange={(value) => setForm({ ...form, endsAt: value })} />
    <label>{tx('operations.config.reason')}<textarea maxLength={500} value={form.reason} onChange={(e) => setForm({ ...form, reason: e.target.value })} /></label>
    <div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>{tx('operations.config.cancel')}</button><button className="primary-button" disabled={saving}>{saving ? tx('operations.config.saving') : tx('operations.config.saveWindow')}</button></div>
  </form></CompactModal>;
}
