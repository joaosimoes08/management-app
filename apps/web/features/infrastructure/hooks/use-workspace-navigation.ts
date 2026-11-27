'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { serializeTableState, type TableState } from '@/components/data-table';
import { clearDeviceUrlFilters, deviceUrlConfig, emptyDeviceUrlFilters, hasDeviceUrlFilters, readDeviceUrlFilters, type DeviceUrlFilters } from '../device-filters';
import { missingConfigAllSitesFromSearch, missingConfigFromSearch } from '../device-requirements';

/** Tabs that `?tab=` can open directly. */
export const INFRASTRUCTURE_URL_TABS = ['sites', 'racks', 'devices', 'lifecycle', 'models', 'interfaces', 'assets', 'permissions'];
/** Host filters of the Linux hosts panel (shown in Equipamentos when Tipo = Servidores). */
const HOST_URL_PARAMS = ['hosts-site', 'hosts-state'];

const dropHostParams = () => {
  const url = new URL(window.location.href);
  HOST_URL_PARAMS.forEach((param) => url.searchParams.delete(param));
  return url;
};

/**
 * The Servidores tab was folded into Equipamentos: `?tab=hosts` links (bookmarks, Device 360, Help) are rewritten to
 * `?tab=devices&type=SERVER`, keeping their `hosts-site` / `hosts-state` filters. Returns true when it rewrote the URL.
 */
function redirectLegacyHostsTab(): boolean {
  const url = new URL(window.location.href);
  if (url.searchParams.get('tab') !== 'hosts') return false;
  url.searchParams.set('tab', 'devices');
  url.searchParams.set('type', 'SERVER');
  history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  return true;
}

/**
 * URL-backed navigation state of the Infrastructure workspace: the open tab, the search box, the Equipamentos
 * drill-through filters and the missing-configuration filter. It reads `?tab=`, the device filters and
 * `?missingConfig=` on mount, follows Back/Forward, and writes every change back to the URL.
 */
export function useWorkspaceNavigation(siteId: string) {
  const [tab, setTab] = useState('racks');
  const [deviceFilters, setDeviceFilters] = useState<DeviceUrlFilters>(emptyDeviceUrlFilters);
  // `?tab=devices` (and drill-through filters) open the Equipamentos list directly.
  useEffect(() => {
    redirectLegacyHostsTab();
    const filters = readDeviceUrlFilters(window.location.search);
    setDeviceFilters(filters);
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'devices' || hasDeviceUrlFilters(filters)) setTab('devices');
    else if (requestedTab && INFRASTRUCTURE_URL_TABS.includes(requestedTab)) setTab(requestedTab);
    // Back/Forward restores the tab kept in `?tab=` (selectTab writes it), so returning from Help lands on the same tab.
    const restoreTab = () => {
      if (redirectLegacyHostsTab()) {
        setDeviceFilters(readDeviceUrlFilters(window.location.search));
        setTab('devices');
        return;
      }
      const next = new URLSearchParams(window.location.search).get('tab');
      setTab((current) => next && INFRASTRUCTURE_URL_TABS.includes(next) ? next : current);
    };
    window.addEventListener('popstate', restoreTab);
    return () => window.removeEventListener('popstate', restoreTab);
  }, []);
  const clearDeviceFilters = () => {
    setDeviceFilters(emptyDeviceUrlFilters);
    history.replaceState(history.state, '', `${location.pathname}${clearDeviceUrlFilters(location.search)}${location.hash}`);
  };
  /** Tier and tag filters (Step 36) stay in the URL so links and saved views reproduce the list. */
  const applyDeviceFilters = useCallback((next: DeviceUrlFilters) => {
    setDeviceFilters(next);
    history.replaceState(history.state, '', `${location.pathname}${serializeTableState(location.search, { search: '', filters: next, sort: null }, deviceUrlConfig)}${location.hash}`);
  }, []);
  /** Tipo filter: leaving Servidores also drops the Linux hosts panel's own URL filters. */
  const chooseDeviceType = (type: string) => {
    applyDeviceFilters({ ...deviceFilters, type });
    if (type === 'SERVER') return;
    const url = dropHostParams();
    history.replaceState(history.state, '', `${url.pathname}${url.search}${url.hash}`);
  };
  const deviceSavedViewsTable = useMemo<TableState<DeviceUrlFilters> & { applyState: (state: TableState<DeviceUrlFilters>) => void }>(() => ({ search: '', filters: deviceFilters, sort: null, applyState: (state) => applyDeviceFilters(state.filters) }), [applyDeviceFilters, deviceFilters]);

  /** ?missingConfig=rearImage|power (bell alert link): the device list shows only devices missing that config. */
  const [missingConfig, setMissingConfig] = useState('');
  /** `allSites=1` (or a missingConfig link without siteId): cross-site list, not narrowed to the active Site. */
  const [missingConfigAllSites, setMissingConfigAllSites] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'lifecycle') setTab('lifecycle');
  }, []);
  useEffect(() => {
    const requested = missingConfigFromSearch(window.location.search);
    if (!requested) return;
    setMissingConfig(requested);
    setMissingConfigAllSites(missingConfigAllSitesFromSearch(window.location.search));
    setTab('devices');
  }, []);
  const clearMissingConfig = () => {
    setMissingConfig('');
    setMissingConfigAllSites(false);
    const query = new URLSearchParams(window.location.search);
    query.delete('missingConfig');
    query.delete('allSites');
    if (!query.get('siteId') && siteId) query.set('siteId', siteId);
    history.replaceState({}, '', `/infraestrutura?${query.toString()}`);
  };

  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  // Debounced device search (matches the original 250ms delay).
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const clickRef = useRef({ key: '', at: 0 });
  /** Opens a tab and keeps it in `?tab=`; a double click on the open tab calls `reset` (back to the Site root). */
  const selectTab = (key: string, reset: () => void) => {
    if (tab === 'devices' && key !== 'devices') window.history.replaceState(history.state, '', dropHostParams());
    const now = Date.now();
    const double = tab === key && clickRef.current.key === key && now - clickRef.current.at < 500;
    clickRef.current = { key, at: now };
    setSearch('');
    if (double) {
      reset();
      setTab(key);
      clickRef.current = { key: '', at: 0 };
    } else setTab(key);
    // Keep the tab in the URL (Bastidores is the default and has none), so Help, reloads and shared links return to it.
    const url = new URL(window.location.href);
    if (key === 'racks') url.searchParams.delete('tab');
    else url.searchParams.set('tab', key);
    history.replaceState(history.state, '', `${url.pathname}${url.search}`);
  };

  return {
    tab, setTab, selectTab,
    search, setSearch, debouncedSearch,
    deviceFilters, applyDeviceFilters, clearDeviceFilters, chooseDeviceType, deviceSavedViewsTable,
    missingConfig, missingConfigAllSites, clearMissingConfig,
  };
}
