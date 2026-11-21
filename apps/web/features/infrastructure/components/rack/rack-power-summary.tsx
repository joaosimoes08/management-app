'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { IpamModal } from '@/features/ipam/components/ipam-modal';
import { formatNumber } from '@/lib/format/date';
import { getRackPowerSummary, type RackPowerSummary, type RackPowerThresholds } from '../../api';
import { formatWatts, powerLevelFromApi, type PowerLevel } from '../../power';
import type { PowerFeedSource, Rack } from '../../types';

const THRESHOLDS_KEY = 'mgmt.rack-power-thresholds';
const MIN_PERCENT = 1;
const MAX_PERCENT = 200;

/** Thresholds chosen in the browser; empty means the API defaults (80 / 90). */
export function readPowerThresholds(): RackPowerThresholds {
  try {
    const parsed = JSON.parse(localStorage.getItem(THRESHOLDS_KEY) ?? '{}') as RackPowerThresholds;
    const valid = (value: unknown): value is number => typeof value === 'number' && Number.isFinite(value);
    return valid(parsed.warningPercent) && valid(parsed.criticalPercent) ? { warningPercent: parsed.warningPercent, criticalPercent: parsed.criticalPercent } : {};
  } catch {
    return {};
  }
}

export function writePowerThresholds(value: RackPowerThresholds) {
  try {
    if (value.warningPercent == null || value.criticalPercent == null) localStorage.removeItem(THRESHOLDS_KEY);
    else localStorage.setItem(THRESHOLDS_KEY, JSON.stringify(value));
  } catch {
    // Storage may be unavailable (private mode): the thresholds then last for this view only.
  }
}

const errorMessage = (error: unknown) => (error instanceof Error && error.message ? error.message : 'Não foi possível carregar o resumo de energia.');

/**
 * Loads the rack power summary (#86) when the rack has PDUs. Plain state rather than React Query: the rack view is
 * rendered without a QueryClient in tests and the summary must follow every rack refresh (connect / disconnect).
 */
export function useRackPowerSummary(rack: Pick<Rack, 'id' | 'pdus' | 'devices'>, thresholds: RackPowerThresholds) {
  const [summary, setSummary] = useState<RackPowerSummary | null>(null);
  const [error, setError] = useState('');
  const enabled = Boolean(rack.pdus?.length);
  const { warningPercent, criticalPercent } = thresholds;
  useEffect(() => {
    if (!enabled) { setSummary(null); setError(''); return; }
    let active = true;
    getRackPowerSummary(rack.id, { warningPercent, criticalPercent })
      .then((next) => { if (active) { setSummary(next); setError(''); } })
      .catch((reason: unknown) => { if (active) { setSummary(null); setError(errorMessage(reason)); } });
    return () => { active = false; };
    // The rack object changes after every power edit, so the summary refreshes with it.
  }, [enabled, rack, warningPercent, criticalPercent]);
  return { summary, error, setSummary };
}

/** PDU id → level from the summary, so the strips use the same thresholds as the summary. */
export function summaryPduLevels(summary: RackPowerSummary | null): Map<string, PowerLevel> {
  return new Map((summary?.pdus ?? []).map((pdu) => [pdu.id, powerLevelFromApi(pdu.level)]));
}

/** Device id → level for the devices the summary marks near the limit. */
export function summaryDeviceLevels(summary: RackPowerSummary | null): Map<string, PowerLevel> {
  const levels = new Map<string, PowerLevel>();
  for (const device of summary?.nearLimit?.devices ?? []) {
    const level = powerLevelFromApi(device.level);
    if (level !== 'ok') levels.set(device.id, level);
  }
  return levels;
}

const LEVEL_BADGE: Record<PowerLevel, { className: string; label: string }> = {
  ok: { className: 'occupied', label: 'Energia OK' },
  warn: { className: 'reserved', label: 'Energia em aviso' },
  over: { className: 'excluded', label: 'Energia crítica' },
};
const SOURCE_LABEL: Record<PowerFeedSource, string> = { SUPPLIER: 'Rede', UPS: 'UPS' };
const REASON_LABEL: Record<string, string> = { watts: 'potência', failoverWatts: 'failover', outlets: 'tomadas' };

const percent = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value, { maximumFractionDigits: 1 })}%` : '—');

export interface RackPowerSummaryStripProps {
  summary: RackPowerSummary | null;
  error?: string;
  onEditThresholds: () => void;
}

/** Power summary under the rack heading: totals, utilisation per feed, outlets and what is near the limit. */
export function RackPowerSummaryStrip({ summary, error, onEditThresholds }: RackPowerSummaryStripProps) {
  const rackId = summary?.rack?.id;
  useEffect(() => {
    if (rackId && window.location.hash === '#rack-power-summary') {
      document.getElementById('rack-power-summary')?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [rackId]);
  if (error) return <div className="ipam-alert error" role="alert" data-testid="rack-power-strip">{error}<button type="button" className="icon-button subtle" onClick={onEditThresholds} aria-label="Limiares de energia" title="Limiares de energia"><SlidersHorizontal size={14} aria-hidden="true" /></button></div>;
  if (!summary) return null;
  const level = powerLevelFromApi(summary.level);
  const badge = LEVEL_BADGE[level];
  const capacity = summary.capacity?.watts;
  const draw = summary.draw?.estimatedWatts ?? 0;
  const sources = (Object.keys(summary.utilisation?.bySource ?? {}) as PowerFeedSource[]).filter((source) => source in SOURCE_LABEL);
  const outlets = summary.outlets;
  const nearPdus = summary.nearLimit?.pdus ?? [];
  const nearDevices = (summary.nearLimit?.devices ?? []).filter((device) => powerLevelFromApi(device.level) !== 'ok');
  const unconnected = summary.devices?.unconnected?.length ?? 0;
  const missingBudget = summary.capacity?.missingBudgetPduIds?.length ?? 0;
  return <div id="rack-power-summary" data-testid="rack-power-strip" data-level={level}>
    <div className="table-actions">
      <span className={`state-badge ${badge.className}`} data-testid="rack-power-level"><i />{badge.label}</span>
      <span className="rack-power-threshold-note">{`Limiares: aviso ${percent(summary.thresholds.warningPercent)} · crítico ${percent(summary.thresholds.criticalPercent)}`}</span>
      <button type="button" className="icon-button subtle" onClick={onEditThresholds} aria-label="Limiares de energia" title="Limiares de energia"><SlidersHorizontal size={14} aria-hidden="true" /></button>
    </div>
    <div className="detail-grid">
      <div><span>Consumo estimado</span><strong>{capacity ? `${formatWatts(draw)} de ${formatWatts(capacity)}` : formatWatts(draw)}</strong></div>
      {sources.map((source) => <div key={source}><span>{`Utilização ${SOURCE_LABEL[source]}`}</span><strong>{percent(summary.utilisation?.bySource?.[source])}</strong></div>)}
      {summary.utilisation?.worstFailoverPercent != null && <div><span>Pior caso em failover</span><strong>{percent(summary.utilisation.worstFailoverPercent)}</strong></div>}
      {outlets && <div><span>Tomadas ocupadas</span><strong>{`${outlets.used}/${outlets.total} (${percent(outlets.percent)})`}</strong></div>}
      {unconnected > 0 && <div><span>Equipamentos sem energia</span><strong>{unconnected}</strong></div>}
    </div>
    {missingBudget > 0 && <div className="ipam-alert warning">{missingBudget === 1 ? 'Uma PDU não tem orçamento de potência definido.' : `${missingBudget} PDUs não têm orçamento de potência definido.`}</div>}
    {(nearPdus.length > 0 || nearDevices.length > 0) && <div className="ipam-alert warning" data-testid="rack-power-near-limit">
      <strong>Perto do limite</strong>
      {nearPdus.map((pdu) => {
        const name = pdu.name?.trim() || `PDU ${SOURCE_LABEL[pdu.source] ?? pdu.source}`;
        const reasons = (pdu.reasons ?? []).map((reason) => REASON_LABEL[reason] ?? reason).join(', ');
        return <span key={pdu.id}>{reasons ? `${name} — perto do limite em: ${reasons}` : name}</span>;
      })}
      {nearDevices.length > 0 && <div className="table-actions">{nearDevices.map((device) => {
        const deviceLevel = powerLevelFromApi(device.level);
        return <span key={device.id} className={`state-badge ${LEVEL_BADGE[deviceLevel].className}`}><i />{typeof device.estimatedWatts === 'number' ? `${device.name} · ${formatWatts(device.estimatedWatts)}` : device.name}</span>;
      })}</div>}
    </div>}
  </div>;
}

export interface RackPowerThresholdsModalProps {
  rackId: string;
  value: { warningPercent: number; criticalPercent: number };
  onSaved: (thresholds: RackPowerThresholds, summary: RackPowerSummary) => void;
  close: () => void;
}

/** Edits the warning / critical thresholds. The API validates them; its 400 message is shown as is. */
export function RackPowerThresholdsModal({ rackId, value, onSaved, close }: RackPowerThresholdsModalProps) {
  const [warning, setWarning] = useState(String(value.warningPercent));
  const [critical, setCritical] = useState(String(value.criticalPercent));
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    const thresholds = { warningPercent: Number(warning), criticalPercent: Number(critical) };
    setSaving(true);
    setError('');
    try {
      const summary = await getRackPowerSummary(rackId, thresholds);
      writePowerThresholds(thresholds);
      onSaved(thresholds, summary);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };
  const reset = async () => {
    setSaving(true);
    setError('');
    try {
      const summary = await getRackPowerSummary(rackId);
      writePowerThresholds({});
      onSaved({}, summary);
    } catch (reason) {
      setError(errorMessage(reason));
    } finally {
      setSaving(false);
    }
  };
  return <IpamModal title="Limiares de energia" close={close}>
    <form className="modal-form" onSubmit={submit}>
      {error && <div className="ipam-alert error" role="alert">{error}</div>}
      <label>Aviso (% do orçamento ou das tomadas)<input type="number" min={MIN_PERCENT} max={MAX_PERCENT} required value={warning} onChange={(event) => setWarning(event.target.value)} /></label>
      <label>Crítico (% do orçamento ou das tomadas)<input type="number" min={MIN_PERCENT} max={MAX_PERCENT} required value={critical} onChange={(event) => setCritical(event.target.value)} /></label>
      <div className="modal-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={() => void reset()}>Repor predefinição</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={close}>Cancelar</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? 'A guardar…' : 'Guardar'}</button>
      </div>
    </form>
  </IpamModal>;
}
