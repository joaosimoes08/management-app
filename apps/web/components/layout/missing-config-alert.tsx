'use client';

import { AlertTriangle, ChevronRight } from 'lucide-react';
import { deviceSettingsHref, tabForMissingKeys } from '@/features/infrastructure/device-requirements';
import type { TopbarAlert } from './topbar-state';

const MAX_LISTED = 5;

/** Short pt-PT name of a missing config key (API registry key or code). */
export function missingConfigLabel(key: string): string {
  const normalized = key.toLowerCase().replace(/[^a-z]/g, '');
  if (/rear|back/.test(normalized)) return 'imagem traseira';
  if (/watt/.test(normalized)) return 'consumo';
  if (/plug|outlet|power/.test(normalized)) return 'fichas';
  return key;
}

/** Link for one device: its settings, opened on the tab of the first thing it lacks. */
export function missingConfigDeviceHref(device: NonNullable<TopbarAlert['devices']>[number]): string {
  return deviceSettingsHref(device.id, tabForMissingKeys(device.missing), device.siteId);
}

/**
 * Grouped "configuração em falta" alert in the bell: the group links to the affected-device list (or, for a single
 * device, straight to its settings tab); the first devices are listed with what each lacks.
 */
export function MissingConfigAlert({ alert }: { alert: TopbarAlert }) {
  const devices = alert.devices ?? [];
  const total = alert.count ?? devices.length;
  const single = total === 1 && devices.length === 1 ? devices[0] : null;
  const href = single ? missingConfigDeviceHref(single) : alert.href;
  return <div className={`alert-group ${alert.severity.toLowerCase()} persistent`} data-testid="missing-config-alert">
    <a href={href} className="alert-group-head">
      <span className="alert-severity"><AlertTriangle size={14} /></span>
      <span><strong>{alert.title}</strong><small>{alert.detail}</small></span>
      <ChevronRight size={13} />
    </a>
    {!single && devices.length > 0 && <ul className="alert-group-devices" aria-label="Equipamentos com configuração em falta">
      {devices.slice(0, MAX_LISTED).map((device) => <li key={device.id}><a href={missingConfigDeviceHref(device)}><span>{device.name}</span><small>{device.missing.map(missingConfigLabel).join(', ')}</small></a></li>)}
      {total > Math.min(devices.length, MAX_LISTED) && <li><a href={alert.href} className="alert-group-more">{`Ver todos (${total})`}</a></li>}
    </ul>}
  </div>;
}
