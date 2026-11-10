'use client';

import { useMemo, useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { CalendarDays, ChevronLeft, ChevronRight, List, Plus, RefreshCw, Trash2, X } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { getInventoryQualityAssignees } from '@/features/operations/api';
import { listInfrastructureGroups } from '../api';
import type { Device, InfrastructureAccessGroup } from '../types';

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
const kinds: Record<LifecycleKind, string> = { LICENSE: 'Licença', WARRANTY: 'Garantia', SUPPORT: 'Suporte' };
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
  const queryClient = useQueryClient();
  const [month, setMonth] = useState(() => startOfMonth(new Date()));
  const [mode, setMode] = useState<'calendar' | 'list'>('calendar');
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState('');
  const range = monthRange(month);
  const queryKey = ['infrastructure', 'lifecycle-dates', siteId, range.from, range.to];
  const datesQuery = useQuery({ queryKey, queryFn: () => fetchLifecycle(siteId, range.from, range.to), enabled: Boolean(siteId) });
  const groupsQuery = useQuery({ queryKey: ['infrastructure', 'groups', siteId], queryFn: () => listInfrastructureGroups(siteId), enabled: Boolean(siteId && canEdit) });
  const usersQuery = useQuery({ queryKey: ['infrastructure', 'lifecycle-assignees', siteId], queryFn: () => getInventoryQualityAssignees(siteId), enabled: Boolean(siteId && canEdit) });
  const saveMutation = useMutation({
    mutationFn: async (value: Draft) => {
      if (!canEdit) throw new Error('Sem permissão para editar datas de ciclo de vida.');
      const body = { kind: value.kind, dueDate: value.dueDate, reminderDays: [...value.reminderDays].sort((a, b) => b - a), responsibleUserId: value.ownerType === 'user' ? value.ownerId : null, responsibleGroupId: value.ownerType === 'group' ? value.ownerId : null };
      if (value.id) return apiFetch(`/api/v1/lifecycle-dates/${encodeURIComponent(value.id)}`, { method: 'PATCH', body: JSON.stringify(body) });
      return apiFetch(`/api/v1/devices/${encodeURIComponent(value.deviceId)}/lifecycle-dates`, { method: 'POST', body: JSON.stringify(body) });
    },
    onSuccess: async () => { setDraft(null); setError(''); await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'lifecycle-dates', siteId] }); },
    onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível guardar a data.'),
  });
  const deleteMutation = useMutation({ mutationFn: (id: string) => { if (!canEdit) throw new Error('Sem permissão para remover datas de ciclo de vida.'); return apiFetch(`/api/v1/lifecycle-dates/${encodeURIComponent(id)}`, { method: 'DELETE' }); }, onSuccess: async () => { setDraft(null); await queryClient.invalidateQueries({ queryKey: ['infrastructure', 'lifecycle-dates', siteId] }); }, onError: (cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível remover a data.') });
  const items = useMemo(() => datesQuery.data?.items ?? [], [datesQuery.data]);
  const sorted = useMemo(() => [...items].sort((a, b) => a.dueDate.localeCompare(b.dueDate) || a.device.name.localeCompare(b.device.name)), [items]);
  const monthLabel = month.toLocaleDateString('pt-PT', { month: 'long', year: 'numeric' });
  const firstDay = (month.getDay() + 6) % 7;
  const daysInMonth = new Date(month.getFullYear(), month.getMonth() + 1, 0).getDate();
  const cells = [...Array(firstDay).fill(null), ...Array.from({ length: daysInMonth }, (_, index) => index + 1)];
  const startCreate = (dueDate = dateText(new Date())) => setDraft({ deviceId: devices[0]?.id ?? '', kind: 'WARRANTY', dueDate, reminderDays: [...defaultReminders], ownerType: 'default', ownerId: '' });
  const edit = (item: LifecycleDate) => setDraft({ id: item.id, deviceId: item.deviceId, kind: item.kind, dueDate: item.dueDate, reminderDays: item.reminderDays ?? [...defaultReminders], ownerType: item.responsibleUserId ? 'user' : item.responsibleGroupId ? 'group' : 'default', ownerId: item.responsibleUserId ?? item.responsibleGroupId ?? '' });
  const toggleReminder = (day: number) => setDraft((old) => old ? { ...old, reminderDays: old.reminderDays.includes(day) ? old.reminderDays.filter((item) => item !== day) : [...old.reminderDays, day] } : old);

  return <section className="lifecycle-workspace" aria-labelledby="lifecycle-heading">
    <header className="lifecycle-toolbar"><div><span className="section-kicker">COBERTURA E LEMBRETES</span><h2 id="lifecycle-heading">Datas de ciclo de vida</h2><p>Licenças, garantias e suporte por equipamento.</p></div><div className="button-row"><button type="button" className="secondary-button" onClick={() => void datesQuery.refetch()} aria-label="Atualizar calendário"><RefreshCw size={14} /> Atualizar</button>{canEdit && <button type="button" className="primary-button" onClick={() => startCreate()} disabled={!devices.length}><Plus size={14} /> Nova data</button>}</div></header>
    {error && <div className="ipam-alert error" role="alert">{error}<button type="button" aria-label="Fechar erro" onClick={() => setError('')}><X size={14} /></button></div>}
    {datesQuery.isError && <div className="ipam-alert error" role="alert">{datesQuery.error instanceof Error ? datesQuery.error.message : 'Não foi possível carregar as datas.'}<button type="button" className="secondary-button" onClick={() => void datesQuery.refetch()}>Tentar novamente</button></div>}
    <div className="lifecycle-controls"><div className="button-row"><button className="secondary-button" type="button" aria-label="Mês anterior" onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() - 1, 1))}><ChevronLeft size={16} /></button><h3 aria-live="polite">{monthLabel}</h3><button className="secondary-button" type="button" aria-label="Mês seguinte" onClick={() => setMonth((value) => new Date(value.getFullYear(), value.getMonth() + 1, 1))}><ChevronRight size={16} /></button></div><div className="button-row" role="group" aria-label="Vista do calendário"><button type="button" className={`secondary-button ${mode === 'calendar' ? 'active' : ''}`} aria-pressed={mode === 'calendar'} onClick={() => setMode('calendar')}><CalendarDays size={14} /> Calendário</button><button type="button" className={`secondary-button ${mode === 'list' ? 'active' : ''}`} aria-pressed={mode === 'list'} onClick={() => setMode('list')}><List size={14} /> Lista</button></div></div>
    {datesQuery.isLoading ? <div className="ipam-card lifecycle-empty" role="status">A carregar datas…</div> : mode === 'calendar' ? <div className="lifecycle-calendar" aria-label={`Calendário de ${monthLabel}`}><div className="lifecycle-weekdays">{['Seg', 'Ter', 'Qua', 'Qui', 'Sex', 'Sáb', 'Dom'].map((day) => <span key={day}>{day}</span>)}</div><div className="lifecycle-days">{cells.map((day, index) => { const key = day ? `${month.getFullYear()}-${pad(month.getMonth() + 1)}-${pad(day)}` : `blank-${index}`; const forDay = day ? sorted.filter((item) => item.dueDate === key) : []; return <div key={key} className={`lifecycle-day ${day ? '' : 'empty'}`}><span className="lifecycle-day-number">{day}</span>{forDay.map((item) => <button key={item.id} type="button" className={`lifecycle-event ${severity(item.dueDate)}`} onClick={() => edit(item)} aria-label={`${kinds[item.kind]}: ${item.device.name}, ${new Date(`${item.dueDate}T00:00:00`).toLocaleDateString('pt-PT')}`}><strong>{item.device.name}</strong><small>{kinds[item.kind]}</small></button>)}{day && !forDay.length && canEdit && <button type="button" className="lifecycle-add-day" aria-label={`Adicionar data em ${day} ${monthLabel}`} onClick={() => startCreate(key)}><Plus size={12} /></button>}</div>; })}</div></div> : <div className="ipam-card lifecycle-list"><div className="lifecycle-list-head"><span>Data</span><span>Tipo</span><span>Equipamento</span><span>Responsável</span></div>{sorted.map((item) => <button type="button" className="lifecycle-list-row" key={item.id} onClick={() => edit(item)}><time dateTime={item.dueDate}>{new Date(`${item.dueDate}T00:00:00`).toLocaleDateString('pt-PT')}</time><span className={`lifecycle-tag ${severity(item.dueDate)}`}>{kinds[item.kind]}</span><span><strong>{item.device.name}</strong><small>{item.device.type}</small></span><span>{item.responsibleUser?.displayName || item.responsibleUser?.username || item.responsibleGroup?.name || 'Coordenador do Site'}</span></button>)}{!sorted.length && <div className="lifecycle-empty">Sem datas neste mês.</div>}</div>}
    {mode === 'calendar' && !datesQuery.isLoading && !items.length && <p className="lifecycle-hint">Sem datas neste mês.{canEdit ? ' Selecione + numa data para adicionar cobertura.' : ''}</p>}
    {draft && <div className="lifecycle-backdrop" role="presentation" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><section className="lifecycle-dialog" role="dialog" aria-modal="true" aria-labelledby="lifecycle-dialog-title"><header><div><span className="section-kicker">{draft.id ? (canEdit ? 'EDITAR DATA' : 'DETALHE DA DATA') : 'NOVA DATA'}</span><h3 id="lifecycle-dialog-title">{draft.id ? (canEdit ? 'Editar cobertura' : 'Detalhe da cobertura') : 'Registar cobertura'}</h3></div><button type="button" className="icon-button" aria-label="Fechar" onClick={() => setDraft(null)}><X size={17} /></button></header>{canEdit ? <div className="lifecycle-form"><label>Equipamento<select value={draft.deviceId} onChange={(event) => setDraft({ ...draft, deviceId: event.target.value })} disabled={Boolean(draft.id)} required><option value="">Selecione equipamento</option>{devices.map((device) => <option key={device.id} value={device.id}>{device.name}</option>)}</select></label><label>Tipo de cobertura<select value={draft.kind} onChange={(event) => setDraft({ ...draft, kind: event.target.value as LifecycleKind })}>{Object.entries(kinds).map(([kind, label]) => <option key={kind} value={kind}>{label}</option>)}</select></label><label>Data de fim<input type="date" value={draft.dueDate} onChange={(event) => setDraft({ ...draft, dueDate: event.target.value })} required /></label><fieldset><legend>Lembretes</legend>{defaultReminders.map((day) => <label className="lifecycle-check" key={day}><input type="checkbox" checked={draft.reminderDays.includes(day)} onChange={() => toggleReminder(day)} />{day === 0 ? 'Na data' : `${day} dias antes`}</label>)}</fieldset><label>Responsável<select value={draft.ownerType === 'default' ? '' : `${draft.ownerType}:${draft.ownerId}`} onChange={(event) => { const [ownerType, ownerId] = event.target.value ? event.target.value.split(':') : ['default', '']; setDraft({ ...draft, ownerType: ownerType as Draft['ownerType'], ownerId }); }}><option value="">Coordenador do Site (predefinição)</option><optgroup label="Grupos">{(groupsQuery.data ?? []).map((group: InfrastructureAccessGroup) => <option key={group.id} value={`group:${group.id}`}>{group.name}</option>)}</optgroup><optgroup label="Pessoas">{(usersQuery.data ?? []).map((person: Person) => <option key={person.id} value={`user:${person.id}`}>{person.displayName || person.username}</option>)}</optgroup></select><small>Sem seleção, as notificações ficam com o grupo de coordenação do Site.</small></label></div> : <dl className="lifecycle-form"><div><dt>Equipamento</dt><dd>{draft.deviceId ? items.find((item) => item.id === draft.id)?.device.name : ''}</dd></div><div><dt>Tipo de cobertura</dt><dd>{kinds[draft.kind]}</dd></div><div><dt>Data de fim</dt><dd>{new Date(`${draft.dueDate}T00:00:00`).toLocaleDateString('pt-PT')}</dd></div><div><dt>Lembretes</dt><dd>{draft.reminderDays.length ? [...draft.reminderDays].sort((a, b) => b - a).map((day) => day === 0 ? 'Na data' : `${day} dias antes`).join(', ') : 'Sem lembretes'}</dd></div><div><dt>Responsável</dt><dd>{items.find((item) => item.id === draft.id)?.responsibleUser?.displayName || items.find((item) => item.id === draft.id)?.responsibleUser?.username || items.find((item) => item.id === draft.id)?.responsibleGroup?.name || 'Coordenador do Site'}</dd></div></dl>}<footer>{canEdit && draft.id && <button type="button" className="secondary-button danger-button" disabled={deleteMutation.isPending} onClick={() => void deleteMutation.mutate(draft.id!)}><Trash2 size={14} /> Remover</button>}{canEdit && <span className="lifecycle-spacer" />}{canEdit && <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Cancelar</button>}{canEdit && <button type="button" className="primary-button" disabled={!draft.deviceId || !draft.dueDate || saveMutation.isPending} onClick={() => void saveMutation.mutate(draft)}>{saveMutation.isPending ? 'A guardar…' : 'Guardar'}</button>}{!canEdit && <button type="button" className="secondary-button" onClick={() => setDraft(null)}>Fechar</button>}</footer></section></div>}
  </section>;
}
