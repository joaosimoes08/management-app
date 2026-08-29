export type SelectableSite = { id: string };

export function resolveActiveSite(sites: SelectableSite[], querySiteId: string | null, storedSiteId: string | null) {
  if (querySiteId && sites.some((site) => site.id === querySiteId)) return querySiteId;
  if (storedSiteId && sites.some((site) => site.id === storedSiteId)) return storedSiteId;
  return sites.length === 1 ? sites[0].id : '';
}

export const DESCENDANT_SITE_PARAMS = ['buildingId', 'roomId', 'rackId', 'deviceId', 'interfaceId', 'vlanId', 'subnetId', 'hostId'] as const;

export function siteUrl(pathname: string, search: string, siteId: string) {
  const params = new URLSearchParams(search);
  if (siteId) params.set('siteId', siteId); else params.delete('siteId');
  DESCENDANT_SITE_PARAMS.forEach((key) => params.delete(key));
  const query = params.toString();
  return `${pathname}${query ? `?${query}` : ''}`;
}
