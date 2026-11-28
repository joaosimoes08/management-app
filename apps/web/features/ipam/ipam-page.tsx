'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useDebouncedValue } from '@/lib/use-debounced-value';
import { useQueryClient } from '@tanstack/react-query';
import { ArrowLeftRight, Calculator, CalendarRange, KeyRound, Map, Network, RefreshCw, Route, Server, Upload, X } from 'lucide-react';
import { PageShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { canManageTagCatalog } from '@/features/tags/types';
import { rememberRecentItem } from '@/lib/recent-items';
import { useI18n } from '@/lib/i18n';
import { useUiText } from '@/components/ui/use-ui-text';
import { useSiteContext } from '@/lib/site-context';
import { apiFetch } from '@/lib/api/client';
import { useToast } from '@/components/ui/toast';
import { useEffectiveAccess } from '@/features/infrastructure/hooks/infrastructure-queries';
import { useFilteredSubnets, useHost, useNetworkMap, useSubnet, useSubnetPanels, useSubnets, useVrfs } from './hooks/ipam-queries';
import {
  calculateSubnets,
  createIpReservation,
  getSubnet,
  releaseIpReservation,
  searchHosts,
} from './api';
import type {
  CalculatorInput,
  CalculatorResult,
  IpAddressRow,
  IpReservation,
  NetworkMapVlan,
  Subnet,
  SubnetInput,
  VlanInput,
} from './types';
import { prefetchSubnetDetail } from './subnet-detail-queries';
import { Empty } from './components/ipam-modal';
import { CompactModal } from '@/components/ui/compact-modal';
import { CalculatorView } from './components/calculator-view';
import { SubnetPlanningView } from './components/subnet-planning-view';
import { NetworkMap } from './components/network-map';
import { SubnetsView } from './components/subnets-view';
import { formatDateTime } from '@/lib/format/date';
import { HostPanel } from './components/host-panel';
import { IpAddressPanel } from './components/ip-address-panel';
import { IpReservationModal } from './components/ip-reservation-modal';
import { CentralIpamPermissions } from './components/central-permissions';
import { VrfsView } from './components/vrfs-view';
import { NatView } from './components/nat-view';
import { RipeView } from './components/ripe-view';
import { applyIpReservationOverrides, reconcileIpReservationOverrides, syncIpReservationCache, type IpReservationOverrideState } from './reservation-cache';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { clearSubnetUrlFilters, emptySubnetUrlFilters, hasSubnetUrlFilters, readSubnetUrlFilters, subnetFilterLabels, type SubnetUrlFilters } from './subnet-filters';

const tabs: [string, string, typeof Map][] = [['map', 'Mapa', Map], ['subnets', 'Subnets', Network], ['planning', 'Planeamento', CalendarRange], ['vrfs', 'VRFs', Route], ['nat', 'NAT', ArrowLeftRight], ['calculator', 'Calculadora', Calculator], ['imports', 'RIPE', Upload]];

type VlanFormState = Omit<VlanInput, 'vlanId'> & { id: string; vlanId: string | number };
type SubnetFormState = Omit<SubnetInput, 'vlanId' | 'gateway' | 'purpose'> & { id: string; vlanId: string; vrfId: string; gateway: string; purpose: string };
type HostFormState = {
  id?: string;
  address?: string;
  hostname?: string;
  description?: string;
  name?: string;
  operatingSystem?: string;
  macAddress?: string;
  notes?: string;
  status?: string;
  ipAddressId?: string;
};

const blankVlan: VlanFormState = { id: '', vlanId: '', name: '', description: '' };
const blankSubnet: SubnetFormState = { id: '', cidr: '', version: 4, vlanId: '', vrfId: '', gateway: '', purpose: '' };
const blankHost: HostFormState = { id: '', address: '', hostname: '', description: '' };

export default function IpamPage() {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const { hasRole, user } = useAuth();
  const { t } = useI18n();
  const ui = useUiText();
  const { siteId, activeSite } = useSiteContext();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');

  const [tab, setTab] = useState('map');
  const [subnetFilters, setSubnetFilters] = useState<SubnetUrlFilters>(emptySubnetUrlFilters);
  // `?tab=` opens a tab directly; drill-through subnet filters open the Subnets list.
  useEffect(() => {
    const filters = readSubnetUrlFilters(window.location.search);
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    setSubnetFilters(filters);
    if (hasSubnetUrlFilters(filters)) setTab('subnets');
    else if (requestedTab && tabs.some(([value]) => value === requestedTab)) setTab(requestedTab);
  }, []);
  const activeSubnetFilters = hasSubnetUrlFilters(subnetFilters) ? subnetFilters : null;
  const clearSubnetFilters = () => {
    setSubnetFilters(emptySubnetUrlFilters);
    history.replaceState(history.state, '', `${location.pathname}${clearSubnetUrlFilters(location.search)}${location.hash}`);
  };
  const [search, setSearch] = useState('');
  // The IP list asks the server once typing pauses, not on every key.
  const ipSearch = useDebouncedValue(search.trim());
  const [selectedSubnetId, setSelectedSubnetId] = useState('');
  const [hostDetailId, setHostDetailId] = useState('');
  const [ipDetail, setIpDetail] = useState<IpAddressRow | null>(null);
  const [reservationIp, setReservationIp] = useState<IpAddressRow | null>(null);
  const reservationMutationEpoch = useRef(0);
  const [reservationOverrideState, setReservationOverrideState] = useState<IpReservationOverrideState>({ values: {}, epochs: {} });
  const [modal, setModal] = useState('');
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<{ deviceId: string; interfaceId: string } | null>(null);
  const [vlan, setVlan] = useState<VlanFormState>(blankVlan);
  const [subnet, setSubnet] = useState<SubnetFormState>(blankSubnet);
  const [host, setHost] = useState<HostFormState>(blankHost);
  const [currentVlan, setCurrentVlan] = useState<NetworkMapVlan | null>(null);
  const [calc, setCalc] = useState<CalculatorInput>({ address: '', basePrefix: '24', newPrefix: '27', operation: 'split', cidr: '', containsAddress: '', cidrsText: '' });
  const [calcResult, setCalcResult] = useState<CalculatorResult | null>(null);
  const [calcPending, setCalcPending] = useState(false);

  // ── Server state (React Query) ───────────────────────────────────────────

  const { data: mapData, isFetching: fetchingMap } = useNetworkMap(siteId);
  // Same endpoint/resource as the infrastructure domain: shared cache key.
  const { data: effective, isFetching: fetchingAccess } = useEffectiveAccess(siteId);
  const { data: subnetsData, isLoading: loadingSubnets } = useSubnets(siteId);
  const { data: filteredSubnetsData, isLoading: loadingFilteredSubnets, error: filteredSubnetsError } = useFilteredSubnets(siteId, activeSubnetFilters);
  const { data: vrfsData } = useVrfs(siteId);
  const { data: selected } = useSubnet(selectedSubnetId);
  // The IP list is paged on the server; a new subnet or search starts again at page 1.
  const ipListKey = `${selectedSubnetId}\n${ipSearch}`;
  const [ipPageState, setIpPageState] = useState({ key: ipListKey, page: 1 });
  const ipPage = ipPageState.key === ipListKey ? ipPageState.page : 1;
  const setIpPage = (page: number) => setIpPageState({ key: ipListKey, page });
  const subnetPanels = useSubnetPanels(selectedSubnetId, ipSearch, reservationMutationEpoch, ipPage);
  const { data: usage, isLoading: loadingUsage } = subnetPanels.usage;
  const { data: capacityHistory, isLoading: loadingCapacityHistory } = subnetPanels.capacityHistory;
  const { data: ipsData, isLoading: loadingIps } = subnetPanels.ips;
  const { data: hostDetail } = useHost(hostDetailId);

  const vlans = mapData?.vlans ?? [];
  const subnets: Subnet[] = subnetsData?.items ?? [];
  const ipTotalPages = ipsData?.totalPages;
  useEffect(() => { if (ipTotalPages && ipPage > ipTotalPages) setIpPageState({ key: ipListKey, page: ipTotalPages }); }, [ipTotalPages, ipPage, ipListKey]);
  const ips: IpAddressRow[] = useMemo(() => applyIpReservationOverrides(ipsData?.items ?? [], reservationOverrideState.values), [ipsData?.items, reservationOverrideState.values]);
  useEffect(() => {
    const serverRows = ipsData?.items;
    if (!serverRows?.length) return;
    const requestEpoch = ipsData?.reservationRequestEpoch ?? -1;
    setReservationOverrideState((current) => reconcileIpReservationOverrides(serverRows, current, requestEpoch));
  }, [ipsData?.items, ipsData?.reservationRequestEpoch]);

  const setReservationOverride = (ipAddressId: string, reservation: IpReservation | null) => {
    const epoch = ++reservationMutationEpoch.current;
    setReservationOverrideState((current) => ({
      values: { ...current.values, [ipAddressId]: reservation },
      epochs: { ...current.epochs, [ipAddressId]: epoch },
    }));
  };
  const busy = fetchingMap || fetchingAccess;

  const canEdit = roleCanEdit && (effective?.ipamActions ?? []).some((action) => action !== 'READ');
  const canUpdateIp = roleCanEdit && (effective?.ipamActions ?? []).includes('UPDATE');
  const canCheckIp = roleCanEdit && (effective?.ipamActions ?? []).includes('DISCOVER');
  const canReserve = roleCanEdit && (effective?.ipamActions ?? []).includes('UPDATE');
  const canReleaseReservations = roleCanEdit && (effective?.ipamActions ?? []).includes('UPDATE');
  // VRF/NAT/RIPE writes are ADMIN/NETWORK_OPERATOR on the API, then scoped by the Site's IPAM actions.
  const canCreateIpam = roleCanEdit && (effective?.ipamActions ?? []).includes('CREATE');
  const canUpdateIpam = roleCanEdit && (effective?.ipamActions ?? []).includes('UPDATE');
  const canDeleteIpam = roleCanEdit && (effective?.ipamActions ?? []).includes('DELETE');
  const canImportIpam = roleCanEdit && (effective?.ipamActions ?? []).includes('IMPORT');
  const unavailableIpamActions = [
    !(effective?.ipamActions ?? []).includes('CREATE') && t('ipam.action.create'),
    !(effective?.ipamActions ?? []).includes('UPDATE') && t('ipam.action.update'),
    !(effective?.ipamActions ?? []).includes('DELETE') && t('ipam.action.delete'),
    !(effective?.ipamActions ?? []).includes('DISCOVER') && t('ipam.action.discover'),
    !(effective?.ipamActions ?? []).includes('IMPORT') && t('ipam.action.import'),
  ].filter(Boolean);

  const updateUrl = (values: Record<string, string | undefined>) => {
    const params = new URLSearchParams(location.search);
    Object.entries(values).forEach(([key, value]) => (value ? params.set(key, value) : params.delete(key)));
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };

  const invalidateIpam = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const invalidateReservationRelatedIpam = () => queryClient.invalidateQueries({
    predicate: (query) => query.queryKey[0] === 'ipam' && query.queryKey[1] !== 'ips',
  });

  const openSubnet = async (id: string, preserveIp = false) => {
    try {
      prefetchSubnetDetail(queryClient, id, ipSearch, reservationMutationEpoch);
      const detail = await getSubnet(id);
      queryClient.setQueryData(['ipam', 'subnet', id], detail);
      setSelectedSubnetId(id);
      rememberRecentItem(user?.id, { id: `subnet:${id}`, kind: 'Subnet', label: detail.cidr, href: `/ipam?siteId=${encodeURIComponent(detail.siteId ?? siteId)}&subnetId=${encodeURIComponent(id)}` });
      setTab('subnets');
      updateUrl({ siteId: detail.siteId ?? siteId, vlanId: detail.vlanId ?? undefined, subnetId: id, ipId: preserveIp ? new URLSearchParams(location.search).get('ipId') ?? undefined : undefined });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : ui('ipam.ipamPage.openSubnetError'));
    }
  };
  const openHost = async (id: string) => {
    setHostDetailId(id);
    const known = hostDetail?.id === id ? hostDetail : null;
    rememberRecentItem(user?.id, { id: `host:${id}`, kind: 'Host', label: known?.name ?? 'Host', href: `/ipam?siteId=${encodeURIComponent(siteId)}&hostId=${encodeURIComponent(id)}` });
    updateUrl({ hostId: id });
  };
  const closeHost = () => {
    setHostDetailId('');
    updateUrl({ hostId: undefined });
  };

  // Restore feature-specific deep links. Site selection belongs to SiteProvider.
  useEffect(() => {
    if (!siteId) return;
    void (async () => {
      const query = new URLSearchParams(location.search);
      if (query.get('fromDeviceId')) setOrigin({ deviceId: query.get('fromDeviceId')!, interfaceId: query.get('fromInterfaceId') ?? '' });
      if (query.get('subnetId')) await openSubnet(query.get('subnetId')!, Boolean(query.get('ipId')));
      if (query.get('hostId')) await openHost(query.get('hostId')!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId]);

  useEffect(() => {
    const ipId = new URLSearchParams(location.search).get('ipId');
    const ip = ipId ? ips.find((item) => item.id === ipId) : null;
    if (ip) setIpDetail(ip);
  }, [ips]);

  useEffect(() => {
    setSelectedSubnetId('');
    setHostDetailId('');
    setIpDetail(null);
  }, [siteId]);

  useEffect(() => {
    if (hostDetail) rememberRecentItem(user?.id, { id: `host:${hostDetail.id}`, kind: 'Host', label: hostDetail.name, href: `/ipam?siteId=${encodeURIComponent(siteId)}&hostId=${encodeURIComponent(hostDetail.id)}` });
  }, [hostDetail, siteId, user?.id]);

  const save = async (path: string, body: unknown, method = 'POST', after?: () => Promise<void>) => {
    const resource = path.includes('/vlans') ? 'vlan' : path.includes('/subnets') ? 'subnet' : 'host';
    const operation = ui(`ipam.page.${method === 'DELETE' ? 'delete' : method === 'PATCH' ? 'edit' : 'create'}.${resource}`);
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      setModal('');
      success(operation, method === 'DELETE' ? ui(`ipam.page.deleted.${resource}`) : method === 'PATCH' ? ui('ipam.common.changesSaved') : ui(`ipam.page.created.${resource}`));
      await invalidateIpam();
      if (after) await after();
      return true;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : ui('ipam.common.operationFailed');
      setError(message);
      toastError(operation, message);
      return false;
    }
  };

  const remove = async (path: string, message: string) => {
    if (await askConfirm({ message, destructive: true })) await save(path, {}, 'DELETE');
  };

  const siteName = activeSite?.name ?? ui('ipam.ipamPage.chooseSite');

  const openNewSubnet = (vlanId = '') => {
    setSubnet({ ...blankSubnet, vlanId });
    setModal('subnet');
  };

  const editSubnet = (item: Subnet) => {
    setSubnet({ id: item.id, cidr: item.cidr, version: item.version, vlanId: item.vlanId ?? '', vrfId: item.vrfId ?? '', gateway: item.gateway ?? '', purpose: item.purpose ?? '' });
    setModal('subnet');
  };

  const removeSubnet = async (item: Pick<Subnet, 'id' | 'cidr'>) => {
    if (!(await askConfirm({ message: ui('ipam.page.deleteSubnetConfirm', undefined, { cidr: item.cidr }), destructive: true }))) return;
    const removed = await save(`/api/v1/subnets/${item.id}`, {}, 'DELETE');
    if (removed && selectedSubnetId === item.id) {
      setSelectedSubnetId('');
      setHostDetailId('');
      updateUrl({ subnetId: undefined, vlanId: undefined, hostId: undefined });
    }
  };

  const detachSubnet = async (item: NetworkMapVlan) => {
    if (!item.subnet || !(await askConfirm({ title: ui('ipam.ipamPage.detachTitle'), message: ui('ipam.page.disassociateConfirm', undefined, { cidr: item.subnet.cidr, vlan: item.vlanId }), confirmLabel: ui('ipam.ipamPage.detach') }))) return;
    await save(`/api/v1/subnets/${item.subnet.id}`, { vlanId: null }, 'PATCH');
  };

  const calculate = async (event: React.FormEvent) => {
    event.preventDefault();
    setCalcResult(null);
    setError('');
    setCalcPending(true);
    try {
      const operation = calc.operation ?? 'split';
      const request = operation === 'split'
        ? { address: calc.address, basePrefix: calc.basePrefix, operation, newPrefix: Number(calc.newPrefix) }
        : operation === 'summary'
          ? { operation, cidr: calc.cidr ?? '' }
          : operation === 'contains'
            ? { operation, cidr: calc.cidr ?? '', address: calc.containsAddress ?? '' }
            : { operation, cidr: calc.cidr ?? '', cidrs: (calc.cidrsText ?? '').split(/[\n,;]+/).map((cidr) => cidr.trim()).filter(Boolean) };
      setCalcResult(await calculateSubnets(request));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : ui('ipam.ipamPage.calcError'));
    } finally {
      setCalcPending(false);
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleVlans = normalizedSearch
    ? vlans.filter((item) => `${item.vlanId} ${item.name} ${item.description ?? ''} ${item.subnet?.cidr ?? ''}`.toLowerCase().includes(normalizedSearch))
    : vlans;
  const searchSubnets = (items: Subnet[]) => normalizedSearch && !selectedSubnetId
    ? items.filter((item) => `${item.cidr} ${item.purpose ?? ''} ${item.vlan?.name ?? ''}`.toLowerCase().includes(normalizedSearch))
    : items;
  const visibleSubnets = searchSubnets(subnets);
  /** The Subnets list honours the drill-through filters (server-side); pickers and planning keep the whole Site. */
  const listedSubnets = activeSubnetFilters ? searchSubnets(filteredSubnetsData?.items ?? []) : visibleSubnets;
  const visibleTabs: [string, string, typeof Map][] = [...tabs.map(([value, label, Icon]) => [value, ui(`ipam.page.tab.${value}`, label), Icon] as [string, string, typeof Map]), ...(effective?.tabs?.permissions ? [['permissions', ui('ipam.page.tab.permissions'), KeyRound] as [string, string, typeof Map]] : [])];
  const tabLabel = visibleTabs.find(([value]) => value === tab)?.[1] ?? tab;
  const searchPlaceholder = selected && tab === 'subnets'
    ? ui('ipam.ipamPage.search.ips')
    : tab === 'map' ? ui('ipam.ipamPage.search.map')
      : tab === 'vrfs' ? ui('ipam.ipamPage.search.vrfs')
        : tab === 'nat' ? ui('ipam.ipamPage.search.nat')
          : tab === 'imports' ? ui('ipam.ipamPage.search.imports')
            : tab === 'planning' ? ui('ipam.ipamPage.search.planning')
              : ui('ipam.ipamPage.search.subnets');

  return <>{confirmDialog}<PageShell section="IPAM" toolbarKey={tab} context={[siteName, ...(tab === 'map' ? [] : [tabLabel]), ...(selected ? [selected.cidr] : []), ...(hostDetail ? [hostDetail.name] : [])]} search={tab === 'calculator' ? undefined : { value: search, onChange: setSearch, placeholder: searchPlaceholder, scopeLabel: selected && tab === 'subnets' ? ui('ipam.ipamPage.ipAddresses') : tabLabel }} actions={<><button className="secondary-button" onClick={() => void invalidateIpam()} disabled={busy}><RefreshCw size={14} /> {ui('ipam.ipamPage.refresh')}</button>{origin && <a className="secondary-button" href={`/infraestrutura?siteId=${encodeURIComponent(siteId)}&tab=interfaces&deviceId=${encodeURIComponent(origin.deviceId)}&interfaceId=${encodeURIComponent(origin.interfaceId || '')}`}>{ui('ipam.ipamPage.backToPort')}</a>}</>} moduleTabs={siteId ? <nav className="ipam-tabs ipam-feature-tabs" aria-label={t('nav.ipam')}>{visibleTabs.map(([value, label, Icon]) => <button key={value} className={tab === value ? 'active' : ''} aria-current={tab === value ? 'page' : undefined} onClick={() => { setTab(value); setSearch(''); }}><Icon size={15} />{label}</button>)}</nav> : null}>
    <div className="ipam-workspace aligned-workspace">
      {error && <div className="ipam-alert error"><X size={15} />{error}</div>}
      {tab === 'subnets' && activeSubnetFilters && !selectedSubnetId && <>{filteredSubnetsError && <div className="ipam-alert error" role="alert"><X size={15} />{filteredSubnetsError instanceof Error ? filteredSubnetsError.message : ui('ipam.ipamPage.filtersError')}</div>}<p className="ipam-scope-note" role="status">{ui('ipam.ipamPage.filtersApplied')} <strong>{subnetFilterLabels(activeSubnetFilters).join(' · ')}</strong> <button type="button" className="text-button" onClick={clearSubnetFilters}><X size={12} /> {ui('ipam.ipamPage.clearFilters')}</button></p></>}
      {siteId && unavailableIpamActions.length > 0 && !fetchingAccess && <p className="ipam-scope-note">{t('ipam.scope.limited', undefined, { site: siteName, actions: unavailableIpamActions.join(', ') })}</p>}
      {!siteId
        ? <Empty title={ui('ipam.ipamPage.noSite.title')} text={ui('ipam.ipamPage.noSite.text')} />
        : tab === 'map'
          ? <NetworkMap vlans={visibleVlans} loading={fetchingMap && !mapData} canEdit={canEdit} edit={(item) => { setVlan({ id: item.id, vlanId: item.vlanId, name: item.name, description: item.description ?? '' }); setModal('vlan'); }} remove={(item) => remove(`/api/v1/vlans/${item.id}`, ui('ipam.page.deleteVlanConfirm', undefined, { vlan: item.vlanId, name: item.name }))} associate={(item) => { setCurrentVlan(item); setModal('association'); }} detachSubnet={(item) => void detachSubnet(item)} openSubnet={openSubnet} newVlan={() => { setVlan({ ...blankVlan }); setModal('vlan'); }} newSubnet={openNewSubnet} />
            : tab === 'subnets'
              ? <SubnetsView selected={selected ?? null} items={listedSubnets} loading={activeSubnetFilters ? loadingFilteredSubnets : loadingSubnets} usage={usage ?? null} usageLoading={loadingUsage} capacityHistory={capacityHistory ?? null} capacityHistoryLoading={loadingCapacityHistory} ips={ips} loadingIps={loadingIps} ipPage={ipsData?.page ?? ipPage} ipTotalPages={ipsData?.totalPages ?? 1} ipTotal={ipsData?.total ?? ips.length} setIpPage={setIpPage} search={search} setSearch={setSearch} openSubnet={openSubnet} openHost={openHost} canEdit={canEdit} canReserve={canReserve} canReleaseReservations={canReleaseReservations} siteId={siteId} newSubnet={() => openNewSubnet()} editSubnet={editSubnet} removeSubnet={(item) => void removeSubnet(item)} editIp={(ip) => { setIpDetail(ip); updateUrl({ ipId: ip.id }); rememberRecentItem(user?.id, { id: `ip:${ip.id}`, kind: t('ipam.recent.ip'), label: ip.address, href: `/ipam?siteId=${encodeURIComponent(siteId)}&subnetId=${encodeURIComponent(selectedSubnetId)}&ipId=${encodeURIComponent(ip.id)}` }); }} newIp={() => { setHost({ ...blankHost }); setModal('ip'); }} createHost={(ip) => { setHost({ name: ip.hostname || `host-${ip.address.replace(/[:.]/g, '-')}`, hostname: ip.hostname ?? '', operatingSystem: '', macAddress: ip.macAddress ?? '', notes: ip.notes ?? '', status: 'UNKNOWN', ipAddressId: ip.id }); setModal('create-host'); }} reserveIp={setReservationIp} releaseReservation={(ip) => { const reservation = ip.reservation ?? ip.reservations?.find((item) => item.status === 'ACTIVE'); if (!reservation) return; void releaseIpReservation(reservation.id).then(() => { setReservationOverride(ip.id, null); void syncIpReservationCache(queryClient, ip.id, null, invalidateReservationRelatedIpam).catch((cause) => toastError(ui('ipam.ipamPage.refreshError'), cause instanceof Error ? cause.message : ui('ipam.page.tryAgain'))); success(ui('ipam.page.released'), ui('ipam.page.releasedMessage', undefined, { address: ip.address })); }).catch((cause) => toastError(ui('ipam.ipamPage.releaseError'), cause instanceof Error ? cause.message : ui('ipam.page.tryAgain'))); }} tagsChanged={() => { void invalidateIpam(); void queryClient.invalidateQueries({ queryKey: ['tags'] }); }} canManageTags={canManageTagCatalog(hasRole)} reservedNext={(result) => { void invalidateIpam(); success(ui('ipam.page.reservedMany'), ui('ipam.page.reservedUntil', undefined, { addresses: result.reservations.map((item) => item.ipAddress.address).join(', '), date: formatDateTime(result.expiresAt) })); }} />
                : tab === 'planning'
                  ? <SubnetPlanningView subnets={subnets} search={normalizedSearch} canCreate={canCreateIpam} />
                : tab === 'permissions' && effective?.tabs?.permissions
                  ? <CentralIpamPermissions siteId={siteId} />
                  : tab === 'vrfs'
                  ? <VrfsView siteId={siteId} siteName={siteName} search={search} canCreate={canCreateIpam} canUpdate={canUpdateIpam} canDelete={canDeleteIpam} openSubnet={(id) => void openSubnet(id)} success={success} toastError={toastError} />
                  : tab === 'nat'
                  ? <NatView siteId={siteId} siteName={siteName} search={search} subnets={subnets} canCreate={canCreateIpam} canUpdate={canUpdateIpam} canDelete={canDeleteIpam} success={success} toastError={toastError} />
                  : tab === 'imports'
                  ? <RipeView siteId={siteId} search={search} vlans={vlans} canPreview={roleCanEdit} canImport={canImportIpam} success={success} toastError={toastError} />
                  : tab === 'calculator'
                  ? <CalculatorView calc={calc} setCalc={setCalc} result={calcResult} clearResult={() => setCalcResult(null)} pending={calcPending} onSubmit={calculate} />
                  : <Empty title={tabLabel} text={ui('ipam.ipamPage.comingSoon')} />}
      {hostDetail && <HostPanel host={hostDetail} canEdit={canEdit} close={closeHost} reload={() => openHost(hostDetail.id)} success={success} toastError={toastError} />}
      {reservationIp && <IpReservationModal ip={reservationIp} close={() => setReservationIp(null)} submit={async (durationHours, reason) => { const reservation = await createIpReservation(reservationIp.id, { durationHours, reason }); setReservationOverride(reservationIp.id, reservation); void syncIpReservationCache(queryClient, reservationIp.id, reservation, invalidateReservationRelatedIpam).catch((cause) => toastError(ui('ipam.ipamPage.refreshError'), cause instanceof Error ? cause.message : ui('ipam.page.tryAgain'))); setReservationIp(null); success(ui('ipam.page.reserved'), ui('ipam.page.reservedFor', undefined, { address: reservationIp.address, count: durationHours })); }} />}
      {ipDetail && <IpAddressPanel ip={ipDetail} canUpdate={canUpdateIp} canCheck={canCheckIp} close={() => { setIpDetail(null); updateUrl({ ipId: undefined }); }} updated={(item) => { setIpDetail(item); void invalidateIpam(); }} saved={() => success(ui('ipam.page.ipUpdated'), ui('ipam.page.ipUpdatedMessage'))} error={(message) => toastError(ui('ipam.ipamPage.ipamOperation'), message)} />}

      {modal === 'vlan' && <CompactModal title={vlan.id ? ui('ipam.page.edit.vlan') : ui('ipam.page.create.vlan')} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(vlan.id ? `/api/v1/vlans/${vlan.id}` : '/api/v1/vlans', { vlanId: Number(vlan.vlanId), name: vlan.name, description: vlan.description, siteId }, vlan.id ? 'PATCH' : 'POST'); }}><label>VLAN ID<input required type="number" min="1" max="4094" value={vlan.vlanId} onChange={(event) => setVlan({ ...vlan, vlanId: event.target.value })} /></label><label>{ui('ipam.common.name')}<input required value={vlan.name} onChange={(event) => setVlan({ ...vlan, name: event.target.value })} /></label><label>{ui('ipam.common.description')}<input value={vlan.description || ''} onChange={(event) => setVlan({ ...vlan, description: event.target.value })} /></label><button className="primary-button">{ui('ipam.common.save')}</button></form></CompactModal>}

      {modal === 'subnet' && <CompactModal title={subnet.id ? ui('ipam.page.edit.subnet') : ui('ipam.page.create.subnet')} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); const editing = Boolean(subnet.id); void save(editing ? `/api/v1/subnets/${subnet.id}` : '/api/v1/subnets', { cidr: subnet.cidr, siteId, version: Number(subnet.version), vlanId: subnet.vlanId || (editing ? null : undefined), vrfId: subnet.vrfId || (editing ? null : undefined), gateway: subnet.gateway || (editing ? null : undefined), purpose: subnet.purpose || (editing ? null : undefined) }, editing ? 'PATCH' : 'POST'); }}><label>CIDR<input required aria-describedby="subnet-cidr-help" placeholder={ui('ipam.page.cidrPlaceholder')} value={subnet.cidr} onChange={(event) => setSubnet({ ...subnet, cidr: event.target.value })} /><small id="subnet-cidr-help">{ui('ipam.page.cidrHelp')}</small></label><label>{ui('ipam.newSubnet.version')}<select value={subnet.version} onChange={(event) => setSubnet({ ...subnet, version: Number(event.target.value) })}><option value="4">IPv4</option><option value="6">IPv6</option></select></label><label>VLAN<select value={subnet.vlanId} onChange={(event) => setSubnet({ ...subnet, vlanId: event.target.value })}><option value="">{ui('ipam.page.noVlanYet')}</option>{vlans.map((item) => <option key={item.id} value={item.id}>VLAN {item.vlanId} · {item.name}</option>)}</select></label><label>VRF<select value={subnet.vrfId} onChange={(event) => setSubnet({ ...subnet, vrfId: event.target.value })}><option value="">{ui('ipam.common.noVrf')}</option>{(vrfsData ?? []).map((item) => <option key={item.id} value={item.id}>{item.name}{item.routeDistinguisher ? ` · ${item.routeDistinguisher}` : ''}</option>)}</select></label><label>Gateway<input value={subnet.gateway} onChange={(event) => setSubnet({ ...subnet, gateway: event.target.value })} /></label><label>{ui('ipam.newSubnet.purpose')}<input value={subnet.purpose} onChange={(event) => setSubnet({ ...subnet, purpose: event.target.value })} /></label><button className="primary-button">{subnet.id ? ui('ipam.common.saveChanges') : ui('ipam.page.create.subnet')}</button></form></CompactModal>}

      {modal === 'association' && <CompactModal title={ui('ipam.page.vlanInterfaces', undefined, { vlan: currentVlan?.vlanId ?? '' })} close={() => setModal('')}><div className="modal-form associated-interfaces">{currentVlan?.devices?.map((device) => <div className="associated-device" key={device.id}><div className="associated-device-heading"><Server size={16} /><strong>{device.name}</strong><small>{device.hostname || device.type || ui('ipam.ipamPage.device')}</small></div>{device.interfaces?.map((item) => <div className="associated-port" key={item.id}><span>{item.name}</span><small>{item.relation} · {item.mode || ui('ipam.ipamPage.noMode')}</small></div>)}</div>)}{!currentVlan?.devices?.length && <Empty title={ui('ipam.ipamPage.noInterfaces.title')} text={ui('ipam.ipamPage.noInterfaces.text')} />}</div></CompactModal>}

      {modal === 'ip' && selected && <CompactModal title={host.id ? ui('ipam.page.editIp') : ui('ipam.page.newIp')} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(host.id ? `/api/v1/ip-addresses/${host.id}` : '/api/v1/ip-addresses', { address: host.address, subnetId: selected.id, hostname: host.hostname, notes: host.description }, host.id ? 'PATCH' : 'POST', async () => openSubnet(selected.id)); }}><label>IP<input required value={host.address ?? ''} onChange={(event) => setHost({ ...host, address: event.target.value })} /></label><label>Hostname<input value={host.hostname ?? ''} onChange={(event) => setHost({ ...host, hostname: event.target.value })} /></label><label>{ui('ipam.common.description')}<input value={host.description ?? ''} onChange={(event) => setHost({ ...host, description: event.target.value })} /></label><button className="primary-button">{ui('ipam.common.save')}</button></form></CompactModal>}

      {modal === 'create-host' && selected && <CompactModal title={ui('ipam.ipamPage.createHostTitle')} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save('/api/v1/hosts', { name: host.name, hostname: host.hostname, operatingSystem: host.operatingSystem, macAddress: host.macAddress, notes: host.notes, status: host.status, ipAddressId: host.ipAddressId }, 'POST', async () => { await openSubnet(selected.id); const list = await searchHosts(selected.id, host.name ?? ''); if (list.items?.[0]) await openHost(list.items[0].id); }); }}><label>{ui('ipam.common.name')}<input required value={host.name ?? ''} onChange={(event) => setHost({ ...host, name: event.target.value })} /></label><label>Hostname<input value={host.hostname ?? ''} onChange={(event) => setHost({ ...host, hostname: event.target.value })} /></label><label>{ui('ipam.ipamPage.operatingSystem')}<input value={host.operatingSystem ?? ''} onChange={(event) => setHost({ ...host, operatingSystem: event.target.value })} /></label><label>{ui('ipam.common.status')}<select value={host.status ?? 'UNKNOWN'} onChange={(event) => setHost({ ...host, status: event.target.value })}>{['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE'].map((status) => <option key={status}>{status}</option>)}</select></label><label>{ui('ipam.ipamPage.notes')}<textarea value={host.notes ?? ''} onChange={(event) => setHost({ ...host, notes: event.target.value })} /></label><button className="primary-button">{ui('ipam.ipamPage.createAndLink')}</button></form></CompactModal>}
    </div>
  </PageShell></>;
}
