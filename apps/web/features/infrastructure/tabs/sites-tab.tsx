'use client';

import { SiteCapacityOutlook } from '../components/sites/capacity-outlook';

/** Sites: capacity outlook of the active Site. */
export function SitesTab({ siteId, siteName }: { siteId: string; siteName: string }) {
  return <SiteCapacityOutlook key={siteId} siteId={siteId} siteName={siteName} />;
}
