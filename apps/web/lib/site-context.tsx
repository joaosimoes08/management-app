'use client';

import { Suspense, createContext, useCallback, useContext, useEffect, useMemo, useState } from 'react';
import { useQuery } from '@tanstack/react-query';
import { usePathname, useRouter, useSearchParams } from 'next/navigation';
import { useAuth } from './auth';
import { apiFetch } from '@/lib/api/client';
import { resolveActiveSite, siteUrl } from './site-selection';

export type ActiveSite = { id: string; name: string; code: string };
/** `resolved` turns true once siteId reflects the URL, the stored choice and the accessible sites (or the site list failed). Before that an empty siteId means "not known yet", not "all sites". */
type SiteContextValue = { sites: ActiveSite[]; siteId: string; resolved: boolean; activeSite?: ActiveSite; loading: boolean; activateSite: (siteId: string) => void; reloadSites: () => Promise<void> };
const SiteContext = createContext<SiteContextValue | null>(null);

/** Reports the URL's `siteId`. A link to the same page with another Site (`/infraestrutura?siteId=…`) keeps the pathname, so without this the provider never re-read the URL and kept the old Site while the address showed the new one. Isolated in its own Suspense boundary so useSearchParams does not opt the whole tree out of prerendering. */
function UrlSiteParam({ onChange }: { onChange: (siteId: string | null) => void }) {
  const siteParam = useSearchParams()?.get('siteId') ?? null;
  useEffect(() => { onChange(siteParam); }, [siteParam, onChange]);
  return null;
}

export function SiteProvider({ children }: { children: React.ReactNode }) {
  const { authenticated } = useAuth(); const routerReplace = useRouter().replace; const pathname = usePathname();
  const [siteId, setSiteId] = useState('');
  const [resolved, setResolved] = useState(false);
  const [urlSiteParam, setUrlSiteParam] = useState<string | null>(null);
  const sitesQuery = useQuery({ queryKey: ['sites', 'accessible'], queryFn: () => apiFetch<{ items: ActiveSite[] }>('/api/v1/sites?pageSize=100'), enabled: authenticated });
  const sites = useMemo(() => sitesQuery.data?.items ?? [], [sitesQuery.data]);
  const updateUrl = useCallback((nextSiteId: string) => {
    const url = siteUrl(window.location.pathname, window.location.search, nextSiteId);
    window.history.replaceState(window.history.state, '', url);
    routerReplace(url, { scroll: false });
  }, [routerReplace]);
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
    if (!authenticated) { setSiteId(''); setResolved(false); return; }
    if (sitesQuery.isError && !sitesQuery.data) { setResolved(true); return; }
    if (!sitesQuery.data) return;
    const querySite = new URLSearchParams(window.location.search).get('siteId'); const stored = window.localStorage.getItem('cociber.siteId');
    const supportsAggregate = ['/', '/portal', '/auditoria', '/definicoes', '/ajuda', '/perfil'].some((path) => pathname === path || (path !== '/' && pathname.startsWith(`${path}/`)));
    const resolved = resolveActiveSite(sites, querySite, stored);
    const next = !supportsAggregate && !resolved && sites.length ? sites[0].id : resolved;
    choose(next, Boolean((querySite || next) && querySite !== next));
    setResolved(true);
  }, [authenticated, sitesQuery.data, sitesQuery.isError, sites, pathname, urlSiteParam, choose]);
  const value = useMemo(() => ({ sites, siteId, resolved, activeSite: sites.find((site) => site.id === siteId), loading: sitesQuery.isLoading, activateSite: (id: string) => choose(id, true), reloadSites }), [sites, siteId, resolved, sitesQuery.isLoading, choose, reloadSites]);
  return <SiteContext.Provider value={value}><Suspense fallback={null}><UrlSiteParam onChange={setUrlSiteParam} /></Suspense>{children}</SiteContext.Provider>;
}
export function useSiteContext() { const value = useContext(SiteContext); if (!value) throw new Error('useSiteContext deve ser usado dentro de SiteProvider'); return value; }
