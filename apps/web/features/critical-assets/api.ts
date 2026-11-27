import { apiFetch } from '@/lib/api/client';
import { NO_OUTCOME, NO_OWNER, type AssetPage, type Attestation, type Correction, type CriticalAssetsResult, type Filters, type Group, type Outcome } from './workbench';

/**
 * Query keys for the critical-assets workbench. The shapes are the ones the page used before this module,
 * so `all` still covers the full list and the paged table (refreshed together after a review or an owner change),
 * while groups, corrections and dependencies keep their own prefixes.
 */
export const criticalAssetsKeys = {
  all: ['critical-assets'] as const,
  list: (siteId: string) => ['critical-assets', siteId] as const,
  page: (siteId: string, filters: Filters, search: string, page: number) => ['critical-assets', 'page', siteId, filters, search, page] as const,
  groups: (siteId: string) => ['critical-asset-groups', siteId] as const,
  correctionsAll: ['critical-asset-corrections'] as const,
  corrections: (siteId: string) => ['critical-asset-corrections', siteId] as const,
  connections: (siteId: string, deviceId?: string) => ['critical-asset-connections', siteId, deviceId] as const,
};

/** A topology connection as the asset detail panel lists it (dependencies). */
export type CriticalAssetConnection = { id: string; label?: string | null; type?: string; sourceDevice: { id: string; name: string }; targetDevice: { id: string; name: string } };
/** One item of POST /critical-assets/confirm-bulk: recorded, or refused with a stable code. */
export type BulkConfirmResult = { id: string; ok: true; outcome: string } | { id: string; ok: false; code: string; message: string };
/** POST /critical-assets/mapping answers the upserted mapping row (no group include). */
export type CriticalAssetMappingRecord = { id: string; siteId: string; assetType: string; groupId: string };
/** POST /critical-assets/corrections/:id/(resolve|reject) answers the plain correction row, without device or group name. */
export type ClosedCorrection = Pick<Correction, 'id' | 'status' | 'closedAt' | 'closeNote' | 'changeReference'>;

/** The server's "no owner" / "no review" filter value (see NO_FILTER_VALUE in the API). */
const SERVER_NONE = 'NONE';

/** Query string for the paged endpoint: the same filters the table shows, applied on the server. */
export function assetsPageUrl(siteId: string, filters: Filters, search: string, page: number, pageSize: number) {
  const params = new URLSearchParams({ siteId, page: String(page), pageSize: String(pageSize) });
  if (search.trim()) params.set('q', search.trim());
  for (const key of ['type', 'owner', 'outcome', 'due', 'tier'] as const) {
    const value = filters[key];
    if (value) params.set(key, value === NO_OWNER || value === NO_OUTCOME ? SERVER_NONE : value);
  }
  return `/api/v1/critical-assets/assets?${params.toString()}`;
}

const site = (siteId: string) => `siteId=${encodeURIComponent(siteId)}`;

export const getCriticalAssets = (siteId: string) => apiFetch<CriticalAssetsResult>(`/api/v1/critical-assets?${site(siteId)}`);
export const listCriticalAssetsPage = (siteId: string, filters: Filters, search: string, page: number, pageSize: number) => apiFetch<AssetPage>(assetsPageUrl(siteId, filters, search, page, pageSize));
/** Access groups assigned to the Site: the owners an ADMIN can map an asset type to. */
export const listOwnerGroups = (siteId: string) => apiFetch<Group[]>(`/api/v1/settings/access-groups?${site(siteId)}`);
export const listCorrections = (siteId: string) => apiFetch<{ items: Correction[] }>(`/api/v1/critical-assets/corrections?${site(siteId)}`);
/** Connections whose search matches the device name; the caller keeps those that name the device at either end. */
export const listAssetConnections = (siteId: string, deviceName: string) => apiFetch<{ items: CriticalAssetConnection[] }>(`/api/v1/topology/connections?${site(siteId)}&search=${encodeURIComponent(deviceName)}&pageSize=100`);

export const confirmAttestation = (attestationId: string, outcome: Outcome, notes?: string) => apiFetch<Attestation>(`/api/v1/critical-assets/${attestationId}/confirm`, { method: 'POST', body: JSON.stringify({ outcome, notes: notes || undefined }) });
/** One request and one transaction per chunk (the server caps it at BULK_CONFIRM_LIMIT); answers a result per item. */
export const confirmAttestations = (attestationIds: string[]) => apiFetch<{ results: BulkConfirmResult[] }>('/api/v1/critical-assets/confirm-bulk', { method: 'POST', body: JSON.stringify({ items: attestationIds.map((id) => ({ id, outcome: 'CONFIRMED' })) }) });
export const closeCorrection = (correctionId: string, outcome: 'RESOLVED' | 'REJECTED', value: string) => apiFetch<ClosedCorrection>(`/api/v1/critical-assets/corrections/${correctionId}/${outcome === 'RESOLVED' ? 'resolve' : 'reject'}`, { method: 'POST', body: JSON.stringify(outcome === 'RESOLVED' ? { changeReference: value } : { note: value }) });
export const saveOwnerMapping = (siteId: string, input: { assetType: string; groupId: string; timezone: string }) => apiFetch<CriticalAssetMappingRecord>(`/api/v1/critical-assets/mapping?${site(siteId)}`, { method: 'POST', body: JSON.stringify(input) });
