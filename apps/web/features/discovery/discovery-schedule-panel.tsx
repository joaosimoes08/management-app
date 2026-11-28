'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { CalendarClock, Clock3, Pause, Play, Save } from 'lucide-react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { getDiscoverySchedule, updateDiscoverySchedule, type DiscoveryScheduleInput, type DiscoverySubnet } from './api';
import { formatDateTime } from '@/lib/format/date';
import { discoveryIntervalChoices, formatDiscoveryInterval } from './discovery-intervals';
import { describeDiscoveryError, discoveryStatusLabel } from './discovery-status';
import { DiscoverySnmpEnrichmentPanel } from './discovery-snmp-enrichment';
import { useUiText } from '@/components/ui/use-ui-text';

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

/** `subnetId`/`onSubnetChange` let the page pick the subnet (D-P2c overview row action); without them the panel keeps its own choice. */
export function DiscoverySchedulePanel({ subnets, canEdit, onError, subnetId: selectedSubnetId, onSubnetChange }: { subnets: DiscoverySubnet[]; canEdit: boolean; onError: (message: string) => void; subnetId?: string; onSubnetChange?: (subnetId: string) => void }) {
  const tx = useUiText();
  const [ownSubnetId, setOwnSubnetId] = useState('');
  const subnetId = selectedSubnetId ?? ownSubnetId;
  const setSubnetId = onSubnetChange ?? setOwnSubnetId;
  const [form, setForm] = useState<DiscoveryScheduleInput>(freshForm);
  const [portsText, setPortsText] = useState('22, 80, 443, 3389');
  const [saving, setSaving] = useState(false);
  const [rateText, setRateText] = useState('');
  const [socketsText, setSocketsText] = useState('');
  const [timeZone, setTimeZone] = useState(() => tx('discovery.schedulePanel.localTimeZone'));
  const qc = useQueryClient();
  const scheduleQuery = useQuery({ queryKey: ['discovery', 'schedule', subnetId], queryFn: () => getDiscoverySchedule(subnetId), enabled: Boolean(subnetId) });
  const schedule = scheduleQuery.data;

  useEffect(() => {
    // Also when the Site changes and the chosen subnet is no longer in the list.
    if (subnets[0] && !subnets.some((subnet) => subnet.id === subnetId)) setSubnetId(subnets[0].id);
  }, [subnets, subnetId, setSubnetId]);
  useEffect(() => { setTimeZone(Intl.DateTimeFormat().resolvedOptions().timeZone || tx('discovery.schedulePanel.localTimeZone')); }, [tx]);
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
    if (probesPerSecond === undefined) return tx('groupB.discovery.probesRange', undefined, { min: PROBES_PER_SECOND_RANGE[0], max: PROBES_PER_SECOND_RANGE[1] });
    if (maxSockets === undefined) return tx('groupB.discovery.socketsRange', undefined, { min: MAX_SOCKETS_RANGE[0], max: MAX_SOCKETS_RANGE[1] });
    return { probesPerSecond, maxSockets };
  };

  const save = async (event: FormEvent) => {
    event.preventDefault();
    if (!subnetId) return;
    const ports = portsText.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    if (!form.methods.length) { onError(tx('discovery.schedulePanel.chooseAtLeastOneMethod')); return; }
    if (form.methods.includes('TCP') && (!ports.length || ports.length > 64)) { onError(tx('discovery.schedulePanel.setBetween1And64')); return; }
    const limits = limitsInput();
    if (typeof limits === 'string') { onError(limits); return; }
    setSaving(true);
    try {
      await updateDiscoverySchedule(subnetId, { ...form, tcpPorts: ports, ...limits });
      await qc.invalidateQueries({ queryKey: ['discovery', 'schedule', subnetId] });
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : tx('discovery.schedulePanel.couldNotSaveTheSchedule')); }
    finally { setSaving(false); }
  };

  const toggleMethod = (method: 'ICMP' | 'TCP') => setForm((current) => ({ ...current, methods: current.methods.includes(method) ? current.methods.filter((item) => item !== method) : [...current.methods, method] }));
  const setEnabled = async () => {
    if (!subnetId) return;
    const enabled = !form.enabled;
    const ports = portsText.split(',').map((value) => Number(value.trim())).filter((value) => Number.isInteger(value) && value >= 1 && value <= 65535);
    if (enabled && (!form.methods.length || (form.methods.includes('TCP') && (!ports.length || ports.length > 64)))) { onError(tx('discovery.schedulePanel.configureAtLeastOneMethod')); return; }
    setSaving(true);
    try {
      await updateDiscoverySchedule(subnetId, { ...form, enabled, tcpPorts: ports });
      await qc.invalidateQueries({ queryKey: ['discovery', 'schedule', subnetId] });
      onError('');
    } catch (cause) { onError(cause instanceof Error ? cause.message : tx('discovery.schedulePanel.couldNotChangeTheSchedule')); }
    finally { setSaving(false); }
  };

  return <section id="discovery-schedule-panel" tabIndex={-1} className="ipam-card discovery-schedule-card">
    <div className="panel-heading"><div><h2>{tx('discovery.schedulePanel.discoverySchedules')}</h2><p className="panel-description">{tx('discovery.schedulePanel.oneConfigurationPerSubnetThe')}</p></div><CalendarClock size={18} /></div>
    {!subnets.length ? <div className="no-data">{tx('discovery.schedulePanel.thereAreNoSubnetsAvailable')}</div> : <>
      <label className="schedule-subnet-select">Subnet<select className="context-toolbar-selector" value={subnetId} onChange={(event) => setSubnetId(event.target.value)}>{subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.cidr}</option>)}</select></label>
      {scheduleQuery.isPending ? <div className="no-data">{tx('discoverySchedules.loading')}</div> : scheduleQuery.isError ? <div className="ipam-alert error">{tx('discoverySchedules.loadError')}</div> : <>
        <div className="schedule-run-summary" aria-live="polite">
          <div><span><Clock3 size={13} /> {tx('discoverySchedules.nextRun')}</span><strong>{schedule?.enabled ? dateTime(schedule.nextRunAt, timeZone) : tx('discoverySchedules.state.paused')}</strong></div>
          <div><span>{tx('discoverySchedules.lastRun')}</span><strong>{dateTime(schedule?.lastRunAt ?? null, timeZone)}</strong></div>
          <div><span>{tx('discovery.schedulePanel.latestResult')}</span><strong className={schedule?.lastStatus === 'FAILED' ? 'schedule-error-text' : ''}>{schedule?.lastStatus ? discoveryStatusLabel(tx, schedule.lastStatus) : tx('discoverySchedules.neverRun')}</strong></div>
          <small>{tx('discovery.schedulePanel.timesShownInTheTime')}{timeZone}.</small>
          {schedule?.lastError && <p className="schedule-last-error">{describeDiscoveryError(tx, schedule.lastError)}</p>}
        </div>
        <form className="schedule-form" onSubmit={save}>
          <label>{tx('discoverySchedules.interval')}<select className="context-toolbar-selector" disabled={!canEdit} value={form.intervalHours} onChange={(event) => setForm({ ...form, intervalHours: Number(event.target.value) })}>{discoveryIntervalChoices(form.intervalHours).map((hours) => <option key={hours} value={hours}>{formatDiscoveryInterval(tx, hours)}</option>)}</select></label>
          <fieldset disabled={!canEdit}><legend>{tx('discovery.schedulePanel.methods')}</legend>{(['ICMP', 'TCP'] as const).map((method) => <label key={method}><input type="checkbox" checked={form.methods.includes(method)} onChange={() => toggleMethod(method)} />{method}</label>)}</fieldset>
          <label>{tx('discovery.schedulePanel.tcpPorts')}<input disabled={!canEdit || !form.methods.includes('TCP')} value={portsText} onChange={(event) => setPortsText(event.target.value)} aria-describedby="schedule-port-help" /><small id="schedule-port-help">{tx('discovery.schedulePanel.atMost64PortsBetween')}</small></label>
          <fieldset className="schedule-limits" disabled={!canEdit}><legend>{tx('discovery.schedulePanel.loadLimits')}</legend>
            <label>{tx('discoverySchedules.rate')}<input type="number" inputMode="numeric" min={PROBES_PER_SECOND_RANGE[0]} max={PROBES_PER_SECOND_RANGE[1]} step={1} value={rateText} placeholder={String(schedule?.limits?.effective.probesPerSecond ?? 100)} onChange={(event) => setRateText(event.target.value)} aria-describedby="schedule-limits-help" /></label>
            <label>{tx('discoverySchedules.sockets')}<input type="number" inputMode="numeric" min={MAX_SOCKETS_RANGE[0]} max={MAX_SOCKETS_RANGE[1]} step={1} value={socketsText} placeholder={String(schedule?.limits?.effective.maxSockets ?? 64)} onChange={(event) => setSocketsText(event.target.value)} aria-describedby="schedule-limits-help" /></label>
            <small id="schedule-limits-help">{tx('discovery.schedulePanel.theyApplyToEveryRun')}</small>
          </fieldset>
          <label className="schedule-reverse-dns"><input type="checkbox" disabled={!canEdit} checked={form.reverseDns} onChange={(event) => setForm({ ...form, reverseDns: event.target.checked })} /> {tx('discovery.schedulePanel.resolveReverseDns')}</label>
          {canEdit && <div className="schedule-actions"><button type="button" className="secondary-button" onClick={() => void setEnabled()} disabled={saving}>{form.enabled ? <><Pause size={14} /> {tx('discovery.schedulePanel.pause')}</> : <><Play size={14} /> {tx('discovery.schedulePanel.enable')}</>}</button><button className="primary-button" type="submit" disabled={saving || scheduleQuery.isFetching}><Save size={14} />{saving ? tx('discovery.schedulePanel.saving') : schedule?.id ? tx('discovery.schedulePanel.saveChanges') : tx('discovery.schedulePanel.createPausedSchedule')}</button></div>}
        </form>
        <DiscoverySnmpEnrichmentPanel subnetId={subnetId} onError={onError} />
      </>}
    </>}
  </section>;
}
