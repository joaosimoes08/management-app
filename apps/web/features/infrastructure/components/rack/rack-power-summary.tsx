'use client';

import { useEffect, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { CompactModal } from '@/components/ui/compact-modal';
import { formatNumber } from '@/lib/format/date';
import { getRackPowerSummary, type RackPowerSummary, type RackPowerThresholds } from '../../api';
import { formatWatts, powerLevelFromApi, type PowerLevel } from '../../power';
import type { PowerFeedSource, Rack } from '../../types';
import { useUiText } from '@/components/ui/use-ui-text';
import { isFiniteNumber, isRecord, parseJson } from '@/lib/data-guards';
import { portugueseText, type InfrastructureText } from '../../infrastructure-text';

const THRESHOLDS_KEY = 'mgmt.rack-power-thresholds';
const MIN_PERCENT = 1;
const MAX_PERCENT = 200;

const isPercent = (value: unknown): value is number => isFiniteNumber(value) && value >= MIN_PERCENT && value <= MAX_PERCENT;

/** Stored thresholds when both are percentages the form accepts (1–200); anything else means the API defaults. */
export function parsePowerThresholds(raw: string | null): RackPowerThresholds {
  const value = parseJson(raw);
  return isRecord(value) && isPercent(value.warningPercent) && isPercent(value.criticalPercent) ? { warningPercent: value.warningPercent, criticalPercent: value.criticalPercent } : {};
}

/** Thresholds chosen in the browser; empty means the API defaults (80 / 90). */
export function readPowerThresholds(): RackPowerThresholds {
  try {
    return parsePowerThresholds(localStorage.getItem(THRESHOLDS_KEY));
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

const LOAD_ERROR = 'infrastructure.rackPowerSummary.loadError';
const errorMessage = (error: unknown, ui: InfrastructureText = portugueseText) => (error instanceof Error && error.message ? error.message : ui(LOAD_ERROR));

/**
 * Loads the rack power summary (#86) when the rack has PDUs. Plain state rather than React Query: the rack view is
 * rendered without a QueryClient in tests and the summary must follow every rack refresh (connect / disconnect).
 */
export function useRackPowerSummary(rack: Pick<Rack, 'id' | 'pdus' | 'devices'>, thresholds: RackPowerThresholds) {
  const ui = useUiText();
  const [summary, setSummary] = useState<RackPowerSummary | null>(null);
  const [error, setError] = useState('');
  const enabled = Boolean(rack.pdus?.length);
  const { warningPercent, criticalPercent } = thresholds;
  useEffect(() => {
    if (!enabled) { setSummary(null); setError(''); return; }
    let active = true;
    getRackPowerSummary(rack.id, { warningPercent, criticalPercent })
      .then((next) => { if (active) { setSummary(next); setError(''); } })
      .catch((reason: unknown) => { if (active) { setSummary(null); setError(errorMessage(reason, (key) => key)); } });
    return () => { active = false; };
    // The rack object changes after every power edit, so the summary refreshes with it.
  }, [enabled, rack, warningPercent, criticalPercent]);
  // The fallback message is kept as its key and translated here, so a language change also updates it.
  return { summary, error: error === LOAD_ERROR ? ui(LOAD_ERROR) : error, setSummary };
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
  ok: { className: 'occupied', label: 'infrastructure.rackPowerSummary.level.ok' },
  warn: { className: 'reserved', label: 'infrastructure.rackPowerSummary.level.warn' },
  over: { className: 'excluded', label: 'infrastructure.rackPowerSummary.level.over' },
};
const SOURCE_LABEL: Record<PowerFeedSource, string> = { SUPPLIER: 'infrastructure.rackPowerSummary.source.supplier', UPS: 'infrastructure.rackPowerSummary.source.ups' };
const REASON_LABEL: Record<string, string> = { watts: 'infrastructure.rackPowerSummary.reason.watts', failoverWatts: 'infrastructure.rackPowerSummary.reason.failoverWatts', outlets: 'infrastructure.rackPowerSummary.reason.outlets' };

const percent = (value: number | null | undefined) => (typeof value === 'number' && Number.isFinite(value) ? `${formatNumber(value, { maximumFractionDigits: 1 })}%` : '—');

export interface RackPowerSummaryStripProps {
  summary: RackPowerSummary | null;
  error?: string;
  onEditThresholds: () => void;
}

/** Power summary under the rack heading: totals, utilisation per feed, outlets and what is near the limit. */
export function RackPowerSummaryStrip({ summary, error, onEditThresholds }: RackPowerSummaryStripProps) {
  const ui = useUiText();
  const rackId = summary?.rack?.id;
  useEffect(() => {
    if (rackId && window.location.hash === '#rack-power-summary') {
      const strip = document.getElementById('rack-power-summary');
      // In the rack overview the strip is display:contents (no box of its own), so scroll its row instead.
      (strip?.closest('.rack-overview-row') ?? strip)?.scrollIntoView?.({ block: 'nearest' });
    }
  }, [rackId]);
  if (error) return <div className="ipam-alert error" role="alert" data-testid="rack-power-strip">{error}<button type="button" className="icon-button subtle" onClick={onEditThresholds} aria-label={ui('infrastructure.rackPowerSummary.powerThresholds')} title={ui('infrastructure.rackPowerSummary.powerThresholds')}><SlidersHorizontal size={14} aria-hidden="true" /></button></div>;
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
      <span className={`state-badge ${badge.className}`} data-testid="rack-power-level"><i />{ui(badge.label)}</span>
      <span className="rack-power-threshold-note">{ui('infrastructure.rackPowerSummary.thresholdsNote', undefined, { warning: percent(summary.thresholds.warningPercent), critical: percent(summary.thresholds.criticalPercent) })}</span>
      <button type="button" className="icon-button subtle" onClick={onEditThresholds} aria-label={ui('infrastructure.rackPowerSummary.powerThresholds')} title={ui('infrastructure.rackPowerSummary.powerThresholds')}><SlidersHorizontal size={14} aria-hidden="true" /></button>
    </div>
    <div className="detail-grid">
      <div><span>{ui('infrastructure.rackPowerSummary.estimatedDraw')}</span><strong>{capacity ? ui('infra.rack.powerOf', undefined, { draw: formatWatts(draw), capacity: formatWatts(capacity) }) : formatWatts(draw)}</strong></div>
      {sources.map((source) => <div key={source}><span>{ui(`infra.rack.utilisation.${source}`)}</span><strong>{percent(summary.utilisation?.bySource?.[source])}</strong></div>)}
      {summary.utilisation?.worstFailoverPercent != null && <div><span>{ui('infrastructure.rackPowerSummary.worstCaseFailover')}</span><strong>{percent(summary.utilisation.worstFailoverPercent)}</strong></div>}
      {outlets && <div><span>{ui('infrastructure.rackPowerSummary.usedOutlets')}</span><strong>{`${outlets.used}/${outlets.total} (${percent(outlets.percent)})`}</strong></div>}
      {unconnected > 0 && <div><span>{ui('infrastructure.rackPowerSummary.unpoweredDevices')}</span><strong>{unconnected}</strong></div>}
    </div>
    {missingBudget > 0 && <div className="ipam-alert warning">{missingBudget === 1 ? ui('infrastructure.rackPowerSummary.onePduHasNoPower') : ui('infrastructure.rackPowerSummary.pdusHaveNoBudget', undefined, { count: missingBudget })}</div>}
    {(nearPdus.length > 0 || nearDevices.length > 0) && <div className="ipam-alert warning" data-testid="rack-power-near-limit">
      <strong>{ui('infrastructure.rackPowerSummary.nearTheLimit')}</strong>
      {nearPdus.map((pdu) => {
        const name = pdu.name?.trim() || `PDU ${SOURCE_LABEL[pdu.source] ? ui(SOURCE_LABEL[pdu.source]) : pdu.source}`;
        const reasons = (pdu.reasons ?? []).map((reason) => REASON_LABEL[reason] ? ui(REASON_LABEL[reason]) : reason).join(', ');
        return <span key={pdu.id}>{reasons ? ui('infrastructure.rackPowerSummary.nearLimitReasons', undefined, { name, reasons }) : name}</span>;
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
  const ui = useUiText();
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
      setError(errorMessage(reason, ui));
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
      setError(errorMessage(reason, ui));
    } finally {
      setSaving(false);
    }
  };
  return <CompactModal title={ui('infrastructure.rackPowerSummary.powerThresholds')} close={close}>
    <form className="modal-form" onSubmit={submit}>
      {error && <div className="ipam-alert error" role="alert">{error}</div>}
      <label>{ui('infrastructure.rackPowerSummary.warningOfBudgetOrOutlets')}<input type="number" min={MIN_PERCENT} max={MAX_PERCENT} required value={warning} onChange={(event) => setWarning(event.target.value)} /></label>
      <label>{ui('infrastructure.rackPowerSummary.criticalOfBudgetOrOutlets')}<input type="number" min={MIN_PERCENT} max={MAX_PERCENT} required value={critical} onChange={(event) => setCritical(event.target.value)} /></label>
      <div className="modal-actions">
        <button type="button" className="secondary-button" disabled={saving} onClick={() => void reset()}>{ui('infrastructure.rackPowerSummary.resetToDefault')}</button>
        <button type="button" className="secondary-button" disabled={saving} onClick={close}>{ui('infrastructure.rackPowerSummary.cancel')}</button>
        <button type="submit" className="primary-button" disabled={saving}>{saving ? ui('infrastructure.rackPowerSummary.saving') : ui('infrastructure.rackPowerSummary.save')}</button>
      </div>
    </form>
  </CompactModal>;
}
