import { apiFetch } from '@/lib/api/client';

/**
 * Data for the Device 360 page. Each section reads an existing endpoint on its own, so one slow or forbidden
 * source never blanks the page. Keys keep the shapes the page used before this module: everything for one
 * device sits under `device360Keys.device(deviceId)`, which the tag save invalidates.
 */
export const device360Keys = {
  device: (deviceId: string) => ['device-360', deviceId] as const,
  interfaces: (deviceId: string) => ['device-360', deviceId, 'interfaces'] as const,
  ips: (deviceId: string, siteId: string) => ['device-360', deviceId, 'ips', siteId] as const,
  connections: (deviceId: string) => ['device-360', deviceId, 'connections'] as const,
  snmp: (deviceId: string) => ['device-360', deviceId, 'snmp'] as const,
  lifecycle: (deviceId: string, siteId: string) => ['device-360', deviceId, 'lifecycle', siteId] as const,
  attestation: (deviceId: string, siteId: string) => ['device-360', deviceId, 'attestation', siteId] as const,
  changes: (deviceId: string, siteId: string) => ['device-360', deviceId, 'changes', siteId] as const,
  hosts: (deviceId: string, siteId: string) => ['device-360', deviceId, 'hosts', siteId] as const,
  audit: (deviceId: string) => ['device-360', deviceId, 'audit'] as const,
};

export type Device360Connection = { id: string; type?: string; label?: string | null; sourceDeviceId: string; targetDeviceId: string; sourceDevice?: { id: string; name: string } | null; targetDevice?: { id: string; name: string } | null; sourceInterface?: { name: string } | null; targetInterface?: { name: string } | null };
export type SnmpOverview = { config?: { enabled?: boolean } | null; latestSnapshot?: { observedAt?: string; collectedAt?: string; createdAt?: string; status?: string } | null; drifts?: Array<{ id: string; status?: string }>; traps?: Array<{ id: string }> };
export type LifecycleDate = { id: string; deviceId: string; kind: string; dueDate: string };
type ChangeItem = { entityType: string; entityId: string };
export type ChangePlan = { id: string; title: string; status: string; plannedStartAt: string; items?: ChangeItem[] };
export type DeviceAttestation = { id: string; latestOutcome?: string | null; latestConfirmedAt?: string | null; dueState?: string; dueDate?: string | null };
export type AuditEvent = { id: string; action: string; createdAt: string; user?: { username: string; displayName?: string | null } | null; actor?: { username: string; displayName?: string | null } | null };
/** Linux host inventory (Step 26): `GET /api/v1/linux-agents/hosts` and `/hosts/:id/services`. */
export type LinuxHost = { id: string; name: string; hostname?: string | null; operatingSystem?: string | null; device?: { id: string } | null; agent?: { state?: string; lastHeartbeatAt?: string | null } | null };
export type HostService = { id: string; name: string; protocol?: string | null; port?: number | null; version?: string | null; observedStatus?: string | null };
export type HostWithServices = LinuxHost & { services: HostService[] };

const CLOSED_CHANGE = new Set(['COMPLETED', 'CANCELLED', 'REJECTED', 'CLOSED', 'IMPLEMENTED']);

/** `?a=1&b=2` from the values that are set, or '' when none are; the page also uses it for its links. */
export const q = (values: Record<string, string | null | undefined>) => { const p = new URLSearchParams(); for (const [k, v] of Object.entries(values)) if (v) p.set(k, v); const s = p.toString(); return s ? `?${s}` : ''; };
/** Lists come back either as an array or as `{ items }`, depending on the endpoint. */
const itemsOf = <T,>(value: unknown): T[] => (Array.isArray(value) ? value as T[] : Array.isArray((value as { items?: unknown })?.items) ? (value as { items: T[] }).items : []);

/** Connections whose search matches the device name, kept when the device is at either end. */
export const listDevice360Connections = async (siteId: string, deviceId: string, deviceName?: string) => itemsOf<Device360Connection>(await apiFetch(`/api/v1/topology/connections${q({ siteId, search: deviceName, pageSize: '200' })}`)).filter((c) => c.sourceDeviceId === deviceId || c.targetDeviceId === deviceId);
export const getDeviceSnmpOverview = (deviceId: string) => apiFetch<SnmpOverview>(`/api/v1/snmp/devices/${encodeURIComponent(deviceId)}`);
export const listDeviceLifecycleDates = async (siteId: string, deviceId: string) => itemsOf<LifecycleDate>(await apiFetch(`/api/v1/lifecycle-dates${q({ siteId, deviceId })}`)).filter((d) => d.deviceId === deviceId);
/** The device's row in the Site's critical-assets list (assigned or unassigned), or null when it is not there. */
export const getDeviceAttestation = async (siteId: string, deviceId: string) => { const r = await apiFetch<{ assets?: DeviceAttestation[]; unassigned?: DeviceAttestation[] }>(`/api/v1/critical-assets${q({ siteId })}`); return [...(r.assets ?? []), ...(r.unassigned ?? [])].find((a) => a.id === deviceId) ?? null; };
/** Change plans that are still open or scheduled and name this device. */
export const listDeviceOpenChanges = async (siteId: string, deviceId: string) => itemsOf<ChangePlan>(await apiFetch(`/api/v1/change-plans${q({ siteId })}`)).filter((p) => !CLOSED_CHANGE.has(p.status) && (p.items ?? []).some((i) => i.entityType === 'DEVICE' && i.entityId === deviceId));
/** Linux hosts linked to this device, each with its observed services. */
export const listDeviceHosts = async (siteId: string, deviceId: string): Promise<HostWithServices[]> => {
  const linked = itemsOf<LinuxHost>(await apiFetch(`/api/v1/linux-agents/hosts${q({ siteId })}`)).filter((h) => h.device?.id === deviceId);
  return Promise.all(linked.map(async (h) => ({ ...h, services: itemsOf<HostService>(await apiFetch(`/api/v1/linux-agents/hosts/${encodeURIComponent(h.id)}/services`)) })));
};
export const listDeviceAuditEvents = async (deviceId: string) => itemsOf<AuditEvent>(await apiFetch(`/api/v1/audit/events/page${q({ entityType: 'Device', entityId: deviceId, limit: '10' })}`));
