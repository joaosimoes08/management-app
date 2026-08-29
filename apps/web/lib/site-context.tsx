'use client';

import { createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter } from 'next/navigation';
import { useAuth } from './auth';
import { apiFetch } from '@/lib/api/client';
import { resolveActiveSite, siteUrl } from './site-selection';

export type ActiveSite = { id: string; name: string; code: string };
type SiteContextValue = { sites: ActiveSite[]; siteId: string; activeSite?: ActiveSite; loading: boolean; activateSite: (siteId: string) => void; reloadSites: () => Promise<void> };
const SiteContext = createContext<SiteContextValue | null>(null);

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth(); const router = useRouter(); const pathname = usePathname();
  const [siteId, setSiteId] = useState('');
  const sitesQuery = useQuery({ queryKey: ['sites', 'accessible'], queryFn: () => apiFetch<{ items: ActiveSite[] }>('/api/v1/sites?pageSize=100'), enabled: authenticated });
  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data]);
  const updateUrl = useCallback((nextSiteId: string) => {
    router.replace(siteUrl(window.location.pathname, window.location.search, nextSiteId), { scroll: false });
  }, [router]);
  const choose = useCallback((nextSiteId: string, syncUrl = true) => {
    setSiteId(nextSiteId);
    if (nextSiteId) window.localStorage.setItem('cociber.siteId', nextSiteId); else window.localStorage.removeItem('cociber.siteId');
    window.localStorage.removeItem('cociber.infrastructureContext');
    if (syncUrl) updateUrl(nextSiteId);
  }, [updateUrl]);
  const reloadSites = useCallback(async () => {
    await sitesQuery.refetch();
  }, [sitesQuery]);
  useEffect(() => {
    if (!authenticated) { setSiteId(''); return; }
    if (!sitesQuery.data) return;
    const querySite = new URLSearchParams(window.location.search).get('siteId'); const stored = window.localStorage.getItem('cociber.siteId');
    const next = resolveActiveSite(sites, querySite, stored);
    choose(next, Boolean(next && querySite !== next));
  }, [authenticated, sitesQuery.data, sites, choose]);
  useEffect(() => {
    const querySite = new URLSearchParams(window.location.search).get('siteId') ?? '';
    const validQuery = Boolean(querySite && sites.some((site) => site.id === querySite));
    if (validQuery && querySite !== siteId) choose(querySite, false);
    const supportsAggregate = ['/', '/portal', '/auditoria', '/definicoes', '/ajuda', '/perfil'].some((path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)));
    if (!supportsAggregate && !validQuery && !siteId && sites.length) choose(sites[0].id, true);
  }, [pathname, choose, siteId, sites]);
  const value = useMemo(() => ({ sites, siteId, activeSite: sites.find((site) => site.id === siteId), loading: sitesQuery.isLoading, activateSite: (id: string) => choose(id, true), reloadSites }), [sites, siteId, sitesQuery.isLoading, choose, reloadSites]);
  return <SiteContext.Provider value={value}>{children}</SiteContext.Provider>;
}
export function useSiteContext() { const value = useContext(SiteContext); if (!value) throw new Error('useSiteContext deve ser usado dentro de SiteProvider'); return value; }
