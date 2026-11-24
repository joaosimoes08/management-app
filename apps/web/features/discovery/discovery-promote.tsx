'use client';

import { useContext, useState } from 'react';
import { ExternalLink, Loader2, ServerCog } from 'lucide-react';
import { apiFetch } from '@/lib/api/client';
import { AuthContext } from '@/lib/auth';
import { useUiText } from '@/components/ui/use-ui-text';
import type { DiscoveryResult } from './api';

/** Roles the API lets create a device (POST /api/v1/devices). */
export const DEVICE_CREATE_ROLES = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR'] as const;

/**
 * D-P1b: what a promoted result prefills in the device form. Model and serial come from the optional SNMP enrichment
 * (#179: `snmp.fields.entityModel` / `entitySerial` / `sysName`), read defensively so results without it still work.
 */
export type DiscoveryPromotion = { ip: string; hostname: string; name: string; ipAddressId: string; model: string; serial: string };

type SnmpFieldsShape = { snmp?: { fields?: Partial<Record<'sysName' | 'entityModel' | 'entitySerial', { value?: unknown } | undefined>> } | null };
const snmpValue = (result: DiscoveryResult, field: 'sysName' | 'entityModel' | 'entitySerial') => {
  const value = (result as DiscoveryResult & SnmpFieldsShape).snmp?.fields?.[field]?.value;
  return typeof value === 'string' ? value.trim() : '';
};

export function discoveryPromotion(result: DiscoveryResult): DiscoveryPromotion {
  const hostname = result.hostname?.trim() ?? '';
  const sysName = snmpValue(result, 'sysName');
  return {
    ip: result.address,
    hostname,
    // sysName, else the short host name, else the address: the editor needs a name and the user can change it.
    name: sysName || hostname.split('.')[0] || result.address,
    ipAddressId: result.ipam?.ipAddressId ?? '',
    model: snmpValue(result, 'entityModel'),
    serial: snmpValue(result, 'entitySerial'),
  };
}

/** Infraestrutura → Equipamentos with the create form open and prefilled (read by features/infrastructure/discovery-promotion). */
export function discoveryPromoteHref(siteId: string, promotion: DiscoveryPromotion): string {
  const query = new URLSearchParams({ siteId, tab: 'devices', promote: 'discovery', ip: promotion.ip });
  for (const key of ['hostname', 'name', 'ipAddressId', 'model', 'serial'] as const) if (promotion[key]) query.set(key, promotion[key]);
  return `/infraestrutura?${query.toString()}`;
}

export function deviceHref(siteId: string | null | undefined, deviceId: string): string {
  const query = new URLSearchParams({ ...(siteId ? { siteId } : {}), tab: 'devices', focus: 'device', deviceId });
  return `/infraestrutura?${query.toString()}`;
}

type DeviceMatch = { id: string; name: string; managementIp?: string | null; siteId?: string | null };

/**
 * The device that already uses this management IP, if any. The list API has no exact-IP filter, only a substring search
 * (10.0.0.1 also returns 10.0.0.10, 10.0.0.100, ...), so every page of matches is read until an exact one turns up.
 */
export async function findDeviceByManagementIp(siteId: string, address: string): Promise<DeviceMatch | null> {
  for (let page = 1; ; page += 1) {
    const response = await apiFetch<{ items?: DeviceMatch[]; totalPages?: number }>(`/api/v1/devices?siteId=${encodeURIComponent(siteId)}&search=${encodeURIComponent(address)}&page=${page}&pageSize=100`);
    const items = response.items ?? [];
    const match = items.find((item) => item.managementIp?.trim() === address);
    if (match) return match;
    // Stop at the last page, or on an empty page should totalPages be missing or wrong.
    if (!items.length || page >= (response.totalPages ?? page)) return null;
  }
}

/** Site of the run that found the result (the job's subnet). */
async function siteOfJob(jobId: string): Promise<string> {
  const job = await apiFetch<{ subnet?: { siteId?: string | null; site?: { id?: string } | null } }>(`/api/v1/discovery/jobs/${encodeURIComponent(jobId)}`);
  return job.subnet?.siteId ?? job.subnet?.site?.id ?? '';
}

type Props = {
  result: DiscoveryResult;
  /** Test seam: where the browser goes. */
  navigate?: (href: string) => void;
};

/**
 * D-P1b: "Promover a equipamento" on an approved result. Already linked → open that device. Otherwise the click checks the
 * Site for a device with the same management IP (link to it, no duplicate) and only then opens the prefilled create form.
 */
export function DiscoveryPromoteAction({ result, navigate = (href) => window.location.assign(href) }: Props) {
  const t = useUiText();
  // Outside the auth provider (isolated renders) nobody can create devices, so the action stays hidden.
  const hasRole = useContext(AuthContext)?.hasRole ?? (() => false);
  const [state, setState] = useState<{ busy: boolean; existing: DeviceMatch | null; siteId: string; error: string }>({ busy: false, existing: null, siteId: '', error: '' });
  if (result.status !== 'APPROVED' || !DEVICE_CREATE_ROLES.some((role) => hasRole(role))) return null;

  const linked = result.device ?? (result.deviceId ? { id: result.deviceId, name: result.address } : null);
  const existing = linked ?? state.existing;
  if (existing) {
    return <span className="discovery-promote">
      <a className="secondary-button" href={deviceHref(state.siteId || null, existing.id)} aria-label={t('discoveryPromote.openFor', undefined, { address: result.address, name: existing.name })}>
        <ExternalLink size={13} aria-hidden="true" /> {t('discoveryPromote.open')}
      </a>
      {!linked && <small className="muted-cell" role="status">{t('discoveryPromote.exists', undefined, { name: existing.name })}</small>}
    </span>;
  }

  const promote = async () => {
    setState((current) => ({ ...current, busy: true, error: '' }));
    try {
      const jobId = (result as DiscoveryResult & { jobId?: string }).jobId;
      const siteId = jobId ? await siteOfJob(jobId) : '';
      if (!siteId) throw new Error(t('discoveryPromote.noSite'));
      const match = await findDeviceByManagementIp(siteId, result.address);
      if (match) { setState({ busy: false, existing: match, siteId, error: '' }); return; }
      navigate(discoveryPromoteHref(siteId, discoveryPromotion(result)));
      setState((current) => ({ ...current, busy: false }));
    } catch (cause) {
      setState((current) => ({ ...current, busy: false, error: cause instanceof Error && cause.message ? cause.message : t('discoveryPromote.failed') }));
    }
  };

  return <span className="discovery-promote">
    <button type="button" className="secondary-button" disabled={state.busy} aria-label={t('discoveryPromote.actionFor', undefined, { address: result.address })} onClick={() => void promote()}>
      {state.busy ? <Loader2 size={13} className="spin" aria-hidden="true" /> : <ServerCog size={13} aria-hidden="true" />} {t('discoveryPromote.action')}
    </button>
    {state.error && <small className="form-error" role="alert">{state.error}</small>}
  </span>;
}
