'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useDialogFocusRef } from '@/components/ui/use-dialog-focus';
import { useEffect, useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { getInventoryQualityAssignees } from '@/features/operations/api';
import { listInfrastructureGroups } from '../api';
import type { Device, InfrastructureAccessGroup } from '../types';
import { formatDate } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';

type LifecycleKind = 'LICENSE' | 'WARRANTY' | 'SUPPORT';
type LifecycleDate = {
  id: string; deviceId: string; device: Pick<Device, 'id' | 'name' | 'type' | 'siteId'>;
  kind: LifecycleKind; dueDate: string; reminderDays: number[];
  responsibleUserId: string | null; responsibleGroupId: string | null;
  responsibleUser?: { id: string; displayName?: string | null; username?: string } | null;
  responsibleGroup?: { id: string; name: string } | null; site: { id: string; name: string };
};
type Person = { id: string; username: string; displayName?: string | null };
type Draft = { id?: string; deviceId: string; kind: LifecycleKind; dueDate: string; reminderDays: number[]; ownerType: 'group' | 'user' | 'default'; ownerId: string };
const lifecycleKinds: LifecycleKind[] = ['LICENSE', 'WARRANTY', 'SUPPORT'];
const weekdays = [0, 1, 2, 3, 4, 5, 6];
const defaultReminders = [30, 7, 0];
const pad = (n: number) => String(n).padStart(2, '0');
const dateText = (date: Date) => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
const startOfMonth = (date: Date) => new Date(date.getFullYear(), date.getMonth(), 1);
const monthRange = (date: Date) => ({ from: dateText(new Date(date.getFullYear(), date.getMonth(), 1)), to: dateText(new Date(date.getFullYear(), date.getMonth() + 1, 0)) });
const severity = (dueDate: string) => {
  const days = Math.ceil((new Date(`${dueDate}T00:00:00`).getTime() - new Date(new Date().toDateString()).getTime()) / 86400000);
  return days < 0 ? 'overdue' : days <= 7 ? 'soon' : 'upcoming';
};

function fetchLifecycle(siteId: string, from: string, to: string) {
  return apiFetch<{ items: LifecycleDate[] }>(`/api/v1/lifecycle-dates?siteId=${encodeURIComponent(siteId)}&from=${from}&to=${to}`);
}

export function LifecycleDates({ siteId, devices, canEdit }: { siteId: string; devices: Device[]; canEdit: boolean }) {
  const ui = useUiText();
  const kindLabel = (kind: LifecycleKind) => ui(`infra.lifecycle.kind.${kind}`);
  const reminderLabel = (day: number) => day === 0 ? ui('infra.lifecycle.onTheDate') : ui('infra.lifecycle.daysBefore', undefined, { count: day });
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  const [draft, setDraft] = useState<Draft | null>(null);
  useEscapeClose(() => setDraft(null), Boolean(draft));
  const dialogRef = useDialogFocusRef<HTMLElement>(Boolean(draft));
  const [error, setError] = useState('');
  const [linkedDateId, setLinkedDateId] = useState('');
  useEffect(() => {
    const query = new URLSearchParams(window.location.search);
    const id = query.get('lifecycleId');
    const due = query.get('due');
    if (!id || !due || !/^\d{4}-\d{2}-\d{2}$/.test(due)) return;
    const date = new Date(`${due}T00:00:00`);
    if (!Number.isFinite(date.getTime())) return;
    setMonth(startOfMonth(date));
    setLinkedDateId(id);
  }, []);
  const range = monthRange(month);
  const queryKey = ['infrastructure', 'lifecycle-dates', siteId, range.from, range.to];
  const datesQuery = useQuery({ queryKey, queryFn: () => fetchLifecycle(siteId, range.from, range.to), enabled: Boolean(siteId) });
  const groupsQuery = useQuery({ queryKey: ['infrastructure', 'groups', siteId], queryFn: () => listInfrastructureGroups(siteId), enabled: Boolean(siteId && canEdit) });
  const usersQuery = useQuery({ queryKey: ['infrastructure', 'lifecycle-assignees', siteId], queryFn: () => getInventoryQualityAssignees(siteId), enabled: Boolean(siteId && canEdit) });
  const saveMutation = useMutation({
    mutationFn: async (value: Draft) => {
      if (!canEdit) throw new Error(ui('infra.lifecycle.noEditPermission'));
      const body = { kind: value.kind, dueDate: value.dueDate, reminderDays: [...value.reminderDays].sort((a, b) => b - a), responsibleUserId: value.ownerType === 'user' ? value.ownerId : null, responsibleGroupId: value.ownerType === 'group' ? value.ownerId : null };
      if (value.id) return apiFetch(`/api/v1/lifecycle-dates/${encodeURIComponent(value.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      return apiFetch(`/api/v1/devices/${encodeURIComponent(value.deviceId)}/lifecycle-dates`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async () => { setDraft(null); setError(''); await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'lifecycle-dates', siteId] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : ui('infra.lifecycle.saveFailed')),
  });
  const deleteMutation = useMutation({ mutationFn: (id: string) => { if (!canEdit) throw new Error(ui('infra.lifecycle.noDeletePermission')); return apiFetch(`/api/v1/lifecycle-dates/${encodeURIComponent(id)}`, { method: 'DELETE' }); }, onSuccess: async () => { setDraft(null); await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'lifecycle-dates', siteId] }); }, onError: (cause) => setError(cause instanceof Error ? cause.message : ui('infra.lifecycle.deleteFailed')) });
  const items = useMemo(() => datesQuery.data?.items ?? [], [datesQuery.data]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.device.name.localeCompare(b.device.name)), [items]);
  const monthLabel = formatDate(month, { month: 'long', year: 'numeric' });
  const firstDay = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const startCreate = (dueDate = dateText(new Date())) => setDraft({ deviceId: devices[0]?.id ?? '', kind: 'WARRANTY', dueDate, reminderDays: [...defaultReminders], ownerType: 'default', ownerId: '' });
  const edit = (item: LifecycleDate) => setDraft(dateDraft(item));
  function dateDraft(item: LifecycleDate): Draft { return { id: item.id, deviceId: item.deviceId, kind: item.kind, dueDate: item.dueDate, reminderDays: item.reminderDays ?? [...defaultReminders], ownerType: item.responsibleUserId ? 'user' : item.responsibleGroupId ? 'group' : 'default', ownerId: item.responsibleUserId ?? item.responsibleGroupId ?? '' }; }
  useEffect(() => {
    const linked = items.find((item) => item.id === linkedDateId);
    if (!linked) return;
    setDraft(dateDraft(linked));
    setLinkedDateId('');
  }, [items, linkedDateId]);
  const toggleReminder = (day: number) => setDraft((old) => old ? { ...old, reminderDays: old.reminderDays.includes(day) ? old.reminderDays.filter((item) => item !== day) : [...old.reminderDays, day] } : old);

  return <section className="lifecycle-workspace" aria-labelledby="lifecycle-heading">
    <div className="panel-heading"><div><h2 id="lifecycle-heading">{ui('infra.lifecycle.heading')}</h2></div></div><PageToolbarPortal><div className="lifecycle-toolbar-actions"><button type="button" className="secondary-button" onClick={() => void datesQuery.refetch()} aria-label={ui('infra.lifecycle.refreshCalendar')}><RefreshCw size={14} /> {ui('infra.lifecycle.refresh')}</button>{canEdit && <button type="button" className="primary-button" onClick={() => startCreate()} disabled={!devices.length}><Plus size={14} /> {ui('infra.lifecycle.newDate')}</button>}</div></PageToolbarPortal>
    {error && <div className="ipam-alert error" role="alert">{error}<button type="button" aria-label={ui('infra.lifecycle.closeError')} onClick={() => setError('')}><X size={14} /></button></div>}
    {datesQuery.isError && <div className="ipam-alert error" role="alert">{datesQuery.error instanceof Error ? datesQuery.error.message : ui('infra.lifecycle.loadFailed')}<button type="button" className="secondary-button" onClick={() => void datesQuery.refetch()}>{ui('infra.lifecycle.retry')}</button></div>}
    <div className="lifecycle-controls"><div className="button-row"><button className="secondary-button" type="button" aria-label={ui('infra.lifecycle.previousMonth')} onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><h3 aria-live="polite">{monthLabel}</h3><button className="secondary-button" type="button" aria-label={ui('infra.lifecycle.nextMonth')} onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div><div className="button-row" role="group" aria-label={ui('infra.lifecycle.calendarView')}><button type="button" className={`secondary-button ${mode === 'calendar' ? 'active' : ''}`} aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}><CalendarDays size={14} /> {ui('infra.lifecycle.calendar')}</button><button type="button" className={`secondary-button ${mode === 'list' ? 'active' : ''}`} aria-pressed={mode === 'list'} onClick={() => setMode('list')}><List size={14} /> {ui('infra.lifecycle.list')}</button></div></div>
    {datesQuery.isLoading ? <div className="ipam-card lifecycle-empty" role="status">{ui('infra.lifecycle.loading')}</div> : mode === 'calendar' ? <div className="lifecycle-calendar" aria-label={ui('infra.lifecycle.calendarOf', undefined, { month: monthLabel })}><div className="lifecycle-weekdays">{weekdays.map((day) => <span key={day}>{ui(`infra.lifecycle.weekday.${day}`)}</span>)}</div><div className="lifecycle-days">{cells.map((day, index) => { const key = day ? `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}` : `blank-${index}`; const forDay = day ? sorted.filter((item) => item.dueDate === key) : []; return <div key={key} className={`lifecycle-day ${day ? '' : 'empty'}`}><span className="lifecycle-day-number">{day}</span>{forDay.map((item) => <button key={item.id} type="button" className={`lifecycle-event ${severity(item.dueDate)}`} onClick={() => edit(item)} aria-label={ui('infra.lifecycle.eventLabel', undefined, { kind: kindLabel(item.kind), device: item.device.name, date: formatDate(`${item.dueDate}T00:00:00`) })}><strong>{item.device.name}</strong><small>{kindLabel(item.kind)}</small></button>)}{day && !forDay.length && canEdit && <button type="button" className="lifecycle-add-day" aria-label={ui('infra.lifecycle.addOnDay', undefined, { day, month: monthLabel })} onClick={() => startCreate(key)}><Plus size={12} /></button>}</div>; })}</div></div> : <div className="ipam-card lifecycle-list"><div className="lifecycle-list-head"><span>{ui('infra.lifecycle.col.date')}</span><span>{ui('infra.lifecycle.col.type')}</span><span>{ui('infra.lifecycle.col.device')}</span><span>{ui('infra.lifecycle.col.owner')}</span></div>{sorted.map((item) => <button type="button" className="lifecycle-list-row" key={item.id} onClick={() => edit(item)}><time dateTime={item.dueDate}>{formatDate(`${item.dueDate}T00:00:00`)}</time><span className={`lifecycle-tag ${severity(item.dueDate)}`}>{kindLabel(item.kind)}</span><span><strong>{item.device.name}</strong><small>{item.device.type}</small></span><span>{item.responsibleUser?.displayName || item.responsibleUser?.username || item.responsibleGroup?.name || ui('infra.lifecycle.siteCoordinator')}</span></button>)}{!sorted.length && <div className="lifecycle-empty">{ui('infra.lifecycle.emptyMonth')}</div>}</div>}
    {mode === 'calendar' && !datesQuery.isLoading && !items.length && <p className="lifecycle-hint">{canEdit ? ui('infra.lifecycle.emptyMonthHint') : ui('infra.lifecycle.emptyMonth')}</p>}
    {draft && <div className="lifecycle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><section ref={dialogRef} className="lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="lifecycle-dialog-title"><header><div><h3 id="lifecycle-dialog-title">{draft.id ? (canEdit ? ui('infra.lifecycle.editCoverage') : ui('infra.lifecycle.coverageDetail')) : ui('infra.lifecycle.newCoverage')}</h3></div><button type="button" className="icon-button" aria-label={ui('ui.close')} onClick={() => setDraft(null)}><X size={17} /></button></header>{canEdit ? <div className="lifecycle-form"><label>{ui('infra.lifecycle.col.device')}<select value={draft.deviceId} onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })} disabled={Boolean(draft.id)} required><option value="">{ui('infra.lifecycle.selectDevice')}</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><label>{ui('infra.lifecycle.coverageType')}<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as LifecycleKind })}>{lifecycleKinds.map((kind) => <option key={kind} value={kind}>{kindLabel(kind)}</option>)}</select></label><label>{ui('infra.lifecycle.endDate')}<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} required /></label><fieldset><legend>{ui('infra.lifecycle.reminders')}</legend>{defaultReminders.map((day) => <label className="lifecycle-check" key={day}><input type="checkbox" checked={draft.reminderDays.includes(day)} onChange={() => toggleReminder(day)} />{reminderLabel(day)}</label>)}</fieldset><label>{ui('infra.lifecycle.col.owner')}<select value={draft.ownerType === 'default' ? '' : `${draft.ownerType}:${draft.ownerId}`} onChange={(event) => { const [ownerType, ownerId] = event.target.value ? event.target.value.split(':') : ['default', '']; setDraft({ ...draft, ownerType: ownerType as Draft['ownerType'], ownerId }); }}><option value="">{ui('infra.lifecycle.siteCoordinatorDefault')}</option><optgroup label={ui('infra.lifecycle.groups')}>{(groupsQuery.data ?? []).map((group: InfrastructureAccessGroup) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</optgroup><optgroup label={ui('infra.lifecycle.people')}>{(usersQuery.data ?? []).map((person: Person) => <option key={person.id} value={`user:${person.id}`}>{person.displayName || person.username}</option>)}</optgroup></select><small>{ui('infra.lifecycle.ownerHint')}</small></label></div> : <dl className="lifecycle-form"><div><dt>{ui('infra.lifecycle.col.device')}</dt><dd>{draft.deviceId ? items.find((item) => item.id === draft.id)?.device.name : ''}</dd></div><div><dt>{ui('infra.lifecycle.coverageType')}</dt><dd>{kindLabel(draft.kind)}</dd></div><div><dt>{ui('infra.lifecycle.endDate')}</dt><dd>{formatDate(`${draft.dueDate}T00:00:00`)}</dd></div><div><dt>{ui('infra.lifecycle.reminders')}</dt><dd>{draft.reminderDays.length ? [...draft.reminderDays].sort((a, b) => b - a).map(reminderLabel).join(', ') : ui('infra.lifecycle.noReminders')}</dd></div><div><dt>{ui('infra.lifecycle.col.owner')}</dt><dd>{items.find((item) => item.id === draft.id)?.responsibleUser?.displayName || items.find((item) => item.id === draft.id)?.responsibleUser?.username || items.find((item) => item.id === draft.id)?.responsibleGroup?.name || ui('infra.lifecycle.siteCoordinator')}</dd></div></dl>}<footer>{canEdit && draft.id && <button type="button" className="secondary-button danger-button" disabled={deleteMutation.isPending} onClick={() => void deleteMutation.mutate(draft.id!)}><Trash2 size={14} /> {ui('infra.lifecycle.remove')}</button>}{canEdit && <span className="lifecycle-spacer" />}{canEdit && <button type="button" className="secondary-button" onClick={() => setDraft(null)}>{ui('infra.lifecycle.cancel')}</button>}{canEdit && <button type="button" className="primary-button" disabled={!draft.deviceId || !draft.dueDate || saveMutation.isPending} onClick={() => void saveMutation.mutate(draft)}>{saveMutation.isPending ? ui('infra.lifecycle.saving') : ui('infra.lifecycle.save')}</button>}{!canEdit && <button type="button" className="secondary-button" onClick={() => setDraft(null)}>{ui('ui.close')}</button>}</footer></section></div>}
  </section>;
}
