'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Clock3, Pause, Play, Save } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDiscoverySchedule, updateDiscoverySchedule, type DiscoveryScheduleInput, type DiscoverySubnet } from './api';
import { formatDateTime } from '@/lib/format/date';
import { discoveryIntervalChoices, formatDiscoveryInterval } from './discovery-intervals';
import { describeDiscoveryError, discoveryStatusLabel } from './discovery-status';

const freshForm = (): DiscoveryScheduleInput => ({ enabled: false, intervalHours: 12, methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443, 3389], reverseDns: true });
/** Discovery P0: '' keeps the default; otherwise a whole number inside [min, max]. Returns undefined when invalid. */
export function parseLimitField(text: string, min: number, max: number): number | null | undefined {
  const trimmed = text.trim();
  if (!trimmed) return null;
  const value = Number(trimmed);
  return Number.isInteger(value) && value >= min && value <= max ? value : undefined;
}
export const PROBES_PER_SECOND_RANGE = [1, 2000] as const;
export const MAX_SOCKETS_RANGE = [1, 1024] as const;

const dateTime = (value: string | null, timeZone: string) => value ? formatDateTime(value, { dateStyle: 'medium', timeStyle: 'short', timeZone }) : '—';

export function DiscoverySchedulePanel({ subnets, canEdit, onError }: { subnets: DiscoverySubnet[]; canEdit: boolean; onError: (message: string) => void }) {
  const [subnetId, setSubnetId] = useState('');
  const [form, setForm] = useState<DiscoveryScheduleInput>(freshForm);
  const [portsText, setPortsText] = useState('22, 80, 443, 3389');
  const [saving, setSaving] = useState(false);
  const [rateText, setRateText] = useState('');
  const [socketsText, setSocketsText] = useState('');
  const [timeZone, setTimeZone] = useState('fuso local');
  const qc = useQueryClient();
  const scheduleQuery = useQuery({ queryKey: ['discovery', 'schedule', subnetId], queryFn: () => getDiscoverySchedule(subnetId), enabled: Boolean(subnetId) });
  const schedule = scheduleQuery.data;

  useEffect(() => {
    if (!subnetId && subnets[0]) setSubnetId(subnets[0].id);
  }, [subnets, subnetId]);
  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || 'fuso local'); }, []);
  useEffect(() => {
    if (!schedule) return;
    setForm({ enabled: schedule.enabled, intervalHours: schedule.intervalHours, methods: schedule.methods, tcpPorts: schedule.tcpPorts, reverseDns: schedule.reverseDns });
    setPortsText(schedule.tcpPorts.join(', '));
    setRateText(schedule.limits?.probesPerSecond != null ? String(schedule.limits.probesPerSecond) : '');
    setSocketsText(schedule.limits?.maxSockets != null ? String(schedule.limits.maxSockets) : '');
  }, [schedule]);

  /** The limits to send, or an error message when one is out of range. */
  const limitsInput = (): { probesPerSecond: number | null; maxSockets: number | null } | string => {
    const probesPerSecond = parseLimitField(rateText, ...PROBES_PER_SECOND_RANGE);
    const maxSockets = parseLimitField(socketsText, ...MAX_SOCKETS_RANGE);
    if (probesPerSecond === undefined) return `O limite de sondas por segundo tem de ser um número inteiro entre ${PROBES_PER_SECOND_RANGE[0]} e ${PROBES_PER_SECOND_RANGE[1]}.`;
    if (maxSockets === undefined) return `O máximo de ligações simultâneas tem de ser um número inteiro entre ${MAX_SOCKETS_RANGE[0]} e ${MAX_SOCKETS_RANGE[1]}.`;
    return { probesPerSecond, maxSockets };
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!subnetId) return;
    const ports = portsText.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    if (!form.methods.length) { onError('Escolhe pelo menos um método para a descoberta agendada.'); return; }
    if (form.methods.includes('TCP') && (!ports.length || ports.length > 64)) { onError('Define entre 1 e 64 portas TCP válidas (1–65535).'); return; }
    const limits = limitsInput();
    if (typeof limits === 'string') { onError(limits); return; }
    setSaving(true);
    try {
      await updateDiscoverySchedule(subnetId, { ...form, tcpPorts: ports, ...limits });
      await qc.invalidateQueries({ queryKey: ['discovery', 'schedule', subnetId] });
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Não foi possível guardar o schedule.'); }
    finally { setSaving(false); }
  };

  const toggleMethod = (method: 'ICMP' | 'TCP') => setForm((current) => ({ ...current, methods: current.methods.includes(method) ? current.methods.filter((item) => item !== method) : [...current.methods, method] }));
  const setEnabled = async () => {
    if (!subnetId) return;
    const enabled = !form.enabled;
    const ports = portsText.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    if (enabled && (!form.methods.length || (form.methods.includes('TCP') && (!ports.length || ports.length > 64)))) { onError('Configura pelo menos um método e, para TCP, entre 1 e 64 portas válidas.'); return; }
    setSaving(true);
    try {
      await updateDiscoverySchedule(subnetId, { ...form, enabled, tcpPorts: ports });
      await qc.invalidateQueries({ queryKey: ['discovery', 'schedule', subnetId] });
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : 'Não foi possível alterar o schedule.'); }
    finally { setSaving(false); }
  };

  return <section className="ipam-card discovery-schedule-card">
    <div className="panel-heading"><div><h2>Schedules de Discovery</h2><p className="panel-description">Uma configuração por subnet. O intervalo permitido é de 1 a 168 horas.</p></div><CalendarClock size={18} /></div>
    {!subnets.length ? <div className="no-data">Não há subnets disponíveis neste Site.</div> : <>
      <label className="schedule-subnet-select">Subnet<select className="context-toolbar-selector" value={subnetId} onChange={(event) => setSubnetId(event.target.value)}>{subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.cidr}</option>)}</select></label>
      {scheduleQuery.isPending ? <div className="no-data">A carregar schedule…</div> : scheduleQuery.isError ? <div className="ipam-alert error">Não foi possível consultar o schedule desta subnet.</div> : <>
        <div className="schedule-run-summary" aria-live="polite">
          <div><span><Clock3 size={13} /> Próxima execução</span><strong>{schedule?.enabled ? dateTime(schedule.nextRunAt, timeZone) : 'Pausado'}</strong></div>
          <div><span>Última execução</span><strong>{dateTime(schedule?.lastRunAt ?? null, timeZone)}</strong></div>
          <div><span>Último resultado</span><strong className={schedule?.lastStatus === 'FAILED' ? 'schedule-error-text' : ''}>{schedule?.lastStatus ? discoveryStatusLabel(schedule.lastStatus) : 'Sem execuções'}</strong></div>
          <small>Horas apresentadas no fuso {timeZone}.</small>
          {schedule?.lastError && <p className="schedule-last-error">{describeDiscoveryError(schedule.lastError)}</p>}
        </div>
        <form className="schedule-form" onSubmit={save}>
          <label>Intervalo<select className="context-toolbar-selector" disabled={!canEdit} value={form.intervalHours} onChange={(event) => setForm({ ...form, intervalHours: Number(event.target.value) })}>{discoveryIntervalChoices(form.intervalHours).map((hours) => <option key={hours} value={hours}>{formatDiscoveryInterval(hours)}</option>)}</select></label>
          <fieldset disabled={!canEdit}><legend>Métodos</legend>{(['ICMP', 'TCP'] as const).map((method) => <label key={method}><input type="checkbox" checked={form.methods.includes(method)} onChange={() => toggleMethod(method)} />{method}</label>)}</fieldset>
          <label>Portas TCP<input disabled={!canEdit || !form.methods.includes('TCP')} value={portsText} onChange={(event) => setPortsText(event.target.value)} aria-describedby="schedule-port-help" /><small id="schedule-port-help">Máximo 64 portas, entre 1 e 65535.</small></label>
          <fieldset className="schedule-limits" disabled={!canEdit}><legend>Limites de carga</legend>
            <label>Sondas por segundo<input type="number" inputMode="numeric" min={PROBES_PER_SECOND_RANGE[0]} max={PROBES_PER_SECOND_RANGE[1]} step={1} value={rateText} placeholder={String(schedule?.limits?.effective.probesPerSecond ?? 100)} onChange={(event) => setRateText(event.target.value)} aria-describedby="schedule-limits-help" /></label>
            <label>Ligações simultâneas<input type="number" inputMode="numeric" min={MAX_SOCKETS_RANGE[0]} max={MAX_SOCKETS_RANGE[1]} step={1} value={socketsText} placeholder={String(schedule?.limits?.effective.maxSockets ?? 64)} onChange={(event) => setSocketsText(event.target.value)} aria-describedby="schedule-limits-help" /></label>
            <small id="schedule-limits-help">Aplicam-se a todas as execuções desta subnet, manuais e agendadas. Cada ping ou ligação TCP conta como uma sonda. Vazio usa o valor predefinido (em cinzento).</small>
          </fieldset>
          <label className="schedule-reverse-dns"><input type="checkbox" disabled={!canEdit} checked={form.reverseDns} onChange={(event) => setForm({ ...form, reverseDns: event.target.checked })} /> Resolver reverse DNS</label>
          {canEdit && <div className="schedule-actions"><button type="button" className="secondary-button" onClick={() => void setEnabled()} disabled={saving}>{form.enabled ? <><Pause size={14} /> Pausar</> : <><Play size={14} /> Ativar</>}</button><button className="primary-button" type="submit" disabled={saving || scheduleQuery.isFetching}><Save size={14} />{saving ? 'A guardar…' : schedule?.subnetId ? 'Guardar alterações' : 'Criar schedule pausado'}</button></div>}
        </form>
      </>}
    </>}
  </section>;
}
