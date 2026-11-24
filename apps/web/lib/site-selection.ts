export type SelectableSite = { id: string };

// Site IDs are UUIDs. Treat URL fragments and other placeholder values as absent.
export function isValidSiteId(value: string | null | undefined): value is string {
  return Boolean(value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value));
}

export function resolveActiveSite(sites: SelectableSite[], querySiteId: string | null, storedSiteId: string | null) {
  if (isValidSiteId(querySiteId) && sites.some((site) => site.id === querySiteId)) return querySiteId;
  if (isValidSiteId(storedSiteId) && sites.some((site) => site.id === storedSiteId)) return storedSiteId;
  return sites.length === 1 ? sites[0].id : '';
}

export const DESCENDANT_SITE_PARAMS = ['buildingId', 'roomId', 'rackId', 'deviceId', 'interfaceId', 'vlanId', 'subnetId', 'hostId', 'pduId', 'trendKind', 'trendKey'] as const;

export function siteUrl(pathname: string, search: string, siteId: string) {
  const params = new URLSearchParams(search);
  if (siteId) params.set('siteId', siteId); else params.delete('siteId');
  DESCENDANT_SITE_PARAMS.forEach((key) => params.delete(key));
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
