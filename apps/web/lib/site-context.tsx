'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth';

export type ActiveSite = { id: string; name: string; code: string };
type SiteContextValue = { sites: ActiveSite[]; siteId: string; activeSite?: ActiveSite; loading: boolean; activateSite: (siteId: string) => void; reloadSites: () => Promise<void> };
const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const { apiFetch, authenticated } = useAuth(); const router = useRouter(); const pathname = usePathname();
  const [sites, setSites] = useState<ActiveSite[]>([]); const [siteId, setSiteId] = useState(''); const [loading, setLoading] = useState(true);
  const updateUrl = useCallback((nextSiteId: string) => {
    const url = new URL(window.location.href);
    if (nextSiteId) url.searchParams.set('siteId', nextSiteId); else url.searchParams.delete('siteId');
    ['buildingId', 'roomId', 'rackId', 'deviceId', 'interfaceId', 'vlanId', 'subnetId', 'hostId'].forEach((key) => url.searchParams.delete(key));
    router.replace(`${url.pathname}${url.search}`, { scroll: false });
  }, [router]);
  const choose = useCallback((nextSiteId: string, syncUrl = true) => {
    setSiteId(nextSiteId);
    if (nextSiteId) window.localStorage.setItem('cociber.siteId', nextSiteId); else window.localStorage.removeItem('cociber.siteId');
    if (syncUrl) updateUrl(nextSiteId);
    window.dispatchEvent(new CustomEvent('cociber:site-change', { detail: { siteId: nextSiteId } }));
  }, [updateUrl]);
  const reloadSites = useCallback(async () => {
    if (!authenticated) { setSites([]); setSiteId(''); setLoading(false); return; }
    setLoading(true);
    try {
      const result = await apiFetch<{ items: ActiveSite[] }>('/api/v1/sites?pageSize=100'); const list = result.items ?? [];
      setSites(list);
      const querySite = new URLSearchParams(window.location.search).get('siteId'); const stored = window.localStorage.getItem('cociber.siteId');
      const next = querySite && list.some((site) => site.id === querySite) ? querySite : stored && list.some((site) => site.id === stored) ? stored : list.length === 1 ? list[0].id : '';
      choose(next, Boolean(next && querySite !== next));
    } catch {
      setSites([]); setSiteId('');
    } finally { setLoading(false); }
  }, [apiFetch, authenticated, choose]);
  useEffect(() => { void reloadSites(); }, [reloadSites]);
  useEffect(() => {
    const querySite = new URLSearchParams(window.location.search).get('siteId') ?? '';
    const validQuery = Boolean(querySite && sites.some((site) => site.id === querySite));
    if (validQuery && querySite !== siteId) choose(querySite, false);
    const supportsAggregate = ['/', '/portal', '/auditoria', '/definicoes', '/ajuda', '/perfil'].some((path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)));
    if (!supportsAggregate && !validQuery && !siteId && sites.length) choose(sites[0].id, true);
  }, [pathname, choose, siteId, sites]);
  const value = useMemo(() => ({ sites, siteId, activeSite: sites.find((site) => site.id === siteId), loading, activateSite: (id: string) => choose(id, true), reloadSites }), [sites, siteId, loading, choose, reloadSites]);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
export function useSiteContext() { const value = useContext(SiteContext); if (!value) throw new Error('useSiteContext deve ser usado dentro de SiteProvider'); return value; }
