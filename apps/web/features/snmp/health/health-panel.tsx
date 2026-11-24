'use client';

import { useQuery } from '@tanstack/react-query';
import { useUiText } from '@/components/ui/use-ui-text';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { getSnmpDeviceHealth, type EnvironmentState, type SnmpDeviceHealth } from './health-api';
import { SnmpHealthBadge } from './health-badge';

type UiText = ReturnType<typeof useUiText>;
type EnvironmentItem = { index: number; description: string | null; state: EnvironmentState };

export const snmpDeviceHealthKey = (deviceId: string) => ['snmp', 'device-health', deviceId] as const;

const percent = (value: number | null | undefined) => (value === null || value === undefined ? '—' : `${formatNumber(Math.round(value))}%`);
const NOT_NORMAL = (state: EnvironmentState) => state !== 'normal' && state !== 'notPresent';

/** Bytes (sent as a string because they can exceed 2^53) to a short binary unit. */
export function formatBytes(value: string | null | undefined) {
  if (!value) return '—';
  const bytes = Number(value);
  if (!Number.isFinite(bytes) || bytes < 0) return '—';
  const units = ['B', 'KiB', 'MiB', 'GiB', 'TiB'];
  let amount = bytes; let unit = 0;
  while (amount >= 1024 && unit < units.length - 1) { amount /= 1024; unit += 1; }
  return `${formatNumber(Number(amount.toFixed(unit === 0 ? 0 : 1)))} ${units[unit]}`;
}

/** Environment list (fans, PSUs): every entry that is not normal is listed; normal ones collapse into a count. */
function EnvironmentValue({ t, items, unavailable }: { t: UiText; items: EnvironmentItem[] | undefined; unavailable: boolean }) {
  if (unavailable || !items?.length) return <span className="muted-cell">{t('snmpHealth.notReported')}</span>;
  const faults = items.filter((item) => NOT_NORMAL(item.state));
  const normal = items.filter((item) => item.state === 'normal').length;
  return <ul className="device-360-list snmp-health-list">
    {faults.map((item) => <li key={item.index}><span className={`state-badge ${item.state === 'warning' ? 'reserved' : 'excluded'}`}><i aria-hidden="true" />{t(`snmpHealth.env.${item.state}`, item.state)}</span> {item.description ?? `#${item.index}`}</li>)}
    {normal > 0 && <li>{faults.length ? t('snmpHealth.env.normal') + ` (${normal})` : t('snmpHealth.allNormal', undefined, { count: normal })}</li>}
  </ul>;
}

function TemperatureValue({ t, health, unavailable }: { t: UiText; health: SnmpDeviceHealth; unavailable: boolean }) {
  const items = health.details?.temperatures ?? [];
  if (unavailable || !items.length) return <span className="muted-cell">{t('snmpHealth.notReported')}</span>;
  return <ul className="device-360-list snmp-health-list">{items.map((item) => <li key={item.index}>
    {item.description ?? `#${item.index}`}: {item.celsius === null ? '—' : `${formatNumber(item.celsius)} °C`}{item.thresholdCelsius !== null ? ` / ${formatNumber(item.thresholdCelsius)} °C` : ''}
    {NOT_NORMAL(item.state) && <> <span className={`state-badge ${item.state === 'warning' ? 'reserved' : 'excluded'}`}><i aria-hidden="true" />{t(`snmpHealth.env.${item.state}`, item.state)}</span></>}
  </li>)}</ul>;
}

function StackValue({ t, health, unavailable }: { t: UiText; health: SnmpDeviceHealth; unavailable: boolean }) {
  const stack = health.details?.stack;
  if (unavailable) return <span className="muted-cell">{t('snmpHealth.notReported')}</span>;
  if (!stack || stack.members.length <= 1) return <span>{t('snmpHealth.stackStandalone')}</span>;
  const ready = stack.members.filter((member) => member.ready).length;
  const ring = stack.ringRedundant === null ? '' : ` · ${t(stack.ringRedundant ? 'snmpHealth.stackRingRedundant' : 'snmpHealth.stackRingNotRedundant')}`;
  return <span>{t('snmpHealth.stackMembers', undefined, { ready, total: stack.members.length })}{ring}</span>;
}

function RebootValue({ t, health }: { t: UiText; health: SnmpDeviceHealth }) {
  return <>
    {health.rebootDetectedAt ? <span>{t('snmpHealth.rebootDetected', undefined, { date: formatDateTime(health.rebootDetectedAt), count: health.rebootCount })}</span> : <span>{t('snmpHealth.noReboot')}</span>}
    {health.bootedAt && <small className="snmp-health-sub">{t('snmpHealth.bootedAt', undefined, { date: formatDateTime(health.bootedAt) })}</small>}
  </>;
}

/** Body of the Device 360 "Saúde do equipamento" section, from GET /api/v1/snmp/devices/:deviceId/health. */
export function SnmpHealthDetails({ health }: { health: SnmpDeviceHealth }) {
  const t = useUiText();
  const unavailable = new Set(health.details?.unavailable ?? []);
  const issues = health.details?.issues ?? [];
  const cpuMissing = unavailable.has('cpu') || [health.cpu.fiveSecondPercent, health.cpu.oneMinutePercent, health.cpu.fiveMinutePercent].every((value) => value === null);
  const memoryMissing = unavailable.has('memory') || (health.memory.usedPercent === null && !health.memory.totalBytes);
  const environment = unavailable.has('environment');
  return <div className="snmp-health-details">
    <p className="snmp-health-summary"><SnmpHealthBadge item={{ status: health.status, issueCount: health.issueCount, observedAt: health.observedAt, stale: false }} /> <span className="panel-description">{t('snmpHealth.observed', undefined, { date: formatDateTime(health.observedAt) })}</span></p>
    {issues.length > 0 && <div className="snmp-health-issues" role="group" aria-label={t('snmpHealth.issuesTitle')}>
      <strong>{t('snmpHealth.issuesTitle')}</strong>
      <ul className="device-360-list">{issues.map((issue, index) => <li key={`${issue.code}:${issue.component}:${index}`}>{t(`snmpHealth.issue.${issue.code}`, issue.code)} · {issue.component}{issue.code === 'REBOOT_DETECTED' ? '' : ` · ${t(`snmpHealth.env.${issue.state}`, issue.state)}`}</li>)}</ul>
    </div>}
    <dl className="device-360-facts snmp-health-facts">
      <dt>{t('snmpHealth.cpu')}</dt><dd>{cpuMissing ? <span className="muted-cell">{t('snmpHealth.notReported')}</span> : t('snmpHealth.cpuValue', undefined, { fiveSecond: percent(health.cpu.fiveSecondPercent), oneMinute: percent(health.cpu.oneMinutePercent), fiveMinute: percent(health.cpu.fiveMinutePercent) })}</dd>
      <dt>{t('snmpHealth.memory')}</dt><dd>{memoryMissing ? <span className="muted-cell">{t('snmpHealth.notReported')}</span> : t('snmpHealth.memoryValue', undefined, { percent: percent(health.memory.usedPercent), used: formatBytes(health.memory.usedBytes), total: formatBytes(health.memory.totalBytes) })}</dd>
      <dt>{t('snmpHealth.temperature')}</dt><dd><TemperatureValue t={t} health={health} unavailable={environment} /></dd>
      <dt>{t('snmpHealth.powerSupplies')}</dt><dd><EnvironmentValue t={t} items={health.details?.powerSupplies} unavailable={environment} /></dd>
      <dt>{t('snmpHealth.fans')}</dt><dd><EnvironmentValue t={t} items={health.details?.fans} unavailable={environment} /></dd>
      <dt>{t('snmpHealth.stack')}</dt><dd><StackValue t={t} health={health} unavailable={unavailable.has('stack')} /></dd>
      <dt>{t('snmpHealth.lastReboot')}</dt><dd><RebootValue t={t} health={health} /></dd>
      {unavailable.size > 0 && <><dt>{t('snmpHealth.unavailable')}</dt><dd><span>{[...unavailable].map((section) => t(`snmpHealth.section.${section}`, section)).join(', ')}</span><small className="snmp-health-sub">{t('snmpHealth.unavailableHint')}</small></dd></>}
    </dl>
  </div>;
}

/** One device's latest health reading; the header badge and the panel share this query (one request). */
export function useSnmpDeviceHealth(deviceId: string, enabled = true) {
  return useQuery({ queryKey: snmpDeviceHealthKey(deviceId), queryFn: () => getSnmpDeviceHealth(deviceId), enabled: enabled && Boolean(deviceId), refetchInterval: 60_000, retry: false });
}

/** Compact badge for the Device 360 header; nothing while loading or when the reading cannot be loaded. */
export function SnmpDeviceHealthBadge({ deviceId, enabled = true }: { deviceId: string; enabled?: boolean }) {
  const query = useSnmpDeviceHealth(deviceId, enabled);
  if (!query.data) return null;
  const health = query.data.health;
  return <SnmpHealthBadge item={health ? { status: health.status, issueCount: health.issueCount, observedAt: health.observedAt, stale: false } : null} />;
}

/** Loads one device's health and renders loading, error, "Sem dados" or the details. */
export function SnmpHealthPanel({ deviceId, enabled = true }: { deviceId: string; enabled?: boolean }) {
  const t = useUiText();
  const query = useSnmpDeviceHealth(deviceId, enabled);
  if (query.isLoading) return <p className="panel-description" role="status">{t('snmpHealth.panel.loading')}</p>;
  if (query.error) return <p className="ipam-scope-note" role="alert">{t('snmpHealth.panel.loadError')} <button type="button" className="text-button" onClick={() => void query.refetch()}>{t('snmpHealth.panel.retry')}</button></p>;
  const health = query.data?.health;
  if (!health) return <div className="snmp-health-details"><p className="snmp-health-summary"><SnmpHealthBadge item={null} /></p><p className="panel-description">{t('snmpHealth.noData')}</p></div>;
  return <SnmpHealthDetails health={health} />;
}
