'use client';

import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { RefreshCw, Server, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api/client';
import { useToast } from '@/components/ui/toast';
import { getEffectiveAccess } from '@/features/infrastructure/api';
import {
  calculateSubnets,
  getHost,
  getNetworkMap,
  getSubnet,
  getSubnetUsage,
  listIpAddresses,
  listSites,
  listSubnets,
  searchHosts,
} from './api';
import type {
  CalculatorInput,
  CalculatorResult,
  IpAddressRow,
  NetworkMapVlan,
  Site,
  Subnet,
  SubnetInput,
  VlanInput,
} from './types';
import { Empty, IpamModal } from './components/ipam-modal';
import { CalculatorView } from './components/calculator-view';
import { NetworkMap } from './components/network-map';
import { SubnetsView } from './components/subnets-view';
import { HostPanel } from './components/host-panel';
import { CentralIpamPermissions } from './components/central-permissions';

const tabs: [string, string][] = [['map', 'Mapa'], ['subnets', 'Subnets'], ['vrfs', 'VRFs'], ['nat', 'NAT'], ['calculator', 'Calculadora'], ['imports', 'RIPE']];

type VlanFormState = Omit<VlanInput, 'vlanId'> & { id: string; vlanId: string | number };
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
const blankSubnet: SubnetInput = { cidr: '', version: 4, vlanId: '', gateway: '', purpose: '' };
const blankHost: HostFormState = { id: '', address: '', hostname: '', description: '' };

export default function IpamPage() {
  const { hasRole } = useAuth();
  const queryClient = useQueryClient();
  const { success, error: toastError } = useToast();
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR');

  const [siteId, setSiteId] = useState('');
  const [tab, setTab] = useState('map');
  const [search, setSearch] = useState('');
  const [selectedSubnetId, setSelectedSubnetId] = useState('');
  const [hostDetailId, setHostDetailId] = useState('');
  const [modal, setModal] = useState('');
  const [error, setError] = useState('');
  const [origin, setOrigin] = useState<{ deviceId: string; interfaceId: string } | null>(null);
  const [vlan, setVlan] = useState<VlanFormState>(blankVlan);
  const [subnet, setSubnet] = useState<SubnetInput>(blankSubnet);
  const [host, setHost] = useState<HostFormState>(blankHost);
  const [currentVlan, setCurrentVlan] = useState<NetworkMapVlan | null>(null);
  const [calc, setCalc] = useState<CalculatorInput>({ address: '', basePrefix: '24', newPrefix: '27', operation: 'split' });
  const [calcResult, setCalcResult] = useState<CalculatorResult | null>(null);

  // ── Server state (React Query) ───────────────────────────────────────────

  const { data: sitesData } = useQuery({ queryKey: ['infrastructure', 'sites'], queryFn: listSites });
  const { data: mapData, isFetching: fetchingMap } = useQuery({
    queryKey: ['ipam', 'network-map', siteId],
    queryFn: () => getNetworkMap(siteId),
    enabled: Boolean(siteId),
  });
  // Same endpoint/resource as the infrastructure domain: shared cache key.
  const { data: effective, isFetching: fetchingAccess } = useQuery({
    queryKey: ['infrastructure', 'access', siteId],
    queryFn: () => getEffectiveAccess(siteId),
    enabled: Boolean(siteId),
  });
  const { data: subnetsData } = useQuery({
    queryKey: ['ipam', 'subnets', siteId],
    queryFn: () => listSubnets(siteId),
    enabled: Boolean(siteId),
  });
  const { data: selected } = useQuery({
    queryKey: ['ipam', 'subnet', selectedSubnetId],
    queryFn: () => getSubnet(selectedSubnetId),
    enabled: Boolean(selectedSubnetId),
  });
  const { data: usage } = useQuery({
    queryKey: ['ipam', 'usage', selectedSubnetId],
    queryFn: () => getSubnetUsage(selectedSubnetId),
    enabled: Boolean(selectedSubnetId),
  });
  const { data: ipsData } = useQuery({
    queryKey: ['ipam', 'ips', selectedSubnetId, search],
    queryFn: () => listIpAddresses(selectedSubnetId, search),
    enabled: Boolean(selectedSubnetId),
  });
  const { data: hostDetail } = useQuery({
    queryKey: ['ipam', 'host', hostDetailId],
    queryFn: () => getHost(hostDetailId),
    enabled: Boolean(hostDetailId),
  });

  const sites: Site[] = sitesData?.items ?? [];
  const vlans = mapData?.vlans ?? [];
  const subnets: Subnet[] = subnetsData?.items ?? [];
  const ips: IpAddressRow[] = ipsData?.items ?? [];
  const busy = fetchingMap || fetchingAccess;

  const canEdit = roleCanEdit && (effective?.ipamActions ?? []).some((action) => action !== 'READ');

  const updateUrl = (values: Record<string, string | undefined>) => {
    const params = new URLSearchParams(location.search);
    Object.entries(values).forEach(([key, value]) => (value ? params.set(key, value) : params.delete(key)));
    history.replaceState(null, '', `${location.pathname}?${params.toString()}`);
  };

  const invalidateIpam = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });

  const openSubnet = async (id: string) => {
    try {
      const detail = await getSubnet(id);
      queryClient.setQueryData(['ipam', 'subnet', id], detail);
      setSelectedSubnetId(id);
      setTab('subnets');
      updateUrl({ siteId: detail.siteId ?? siteId, vlanId: detail.vlanId ?? undefined, subnetId: id });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível abrir a subnet.');
    }
  };
  const openHost = async (id: string) => {
    setHostDetailId(id);
    updateUrl({ hostId: id });
  };
  const closeHost = () => {
    setHostDetailId('');
    updateUrl({ hostId: undefined });
  };

  useEffect(() => {
    const change = (event: Event) => {
      const id = (event as CustomEvent<{ siteId: string }>).detail.siteId;
      setSiteId(id);
      setSelectedSubnetId('');
      setHostDetailId('');
      if (id) void queryClient.invalidateQueries({ queryKey: ['ipam'] });
    };
    window.addEventListener('cociber:site-change', change);
    return () => window.removeEventListener('cociber:site-change', change);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Bootstrap: pick the initial site and restore deep links (subnetId, hostId).
  useEffect(() => {
    const list = sitesData?.items ?? [];
    if (!list.length) return;
    void (async () => {
      const query = new URLSearchParams(location.search);
      const stored = query.get('siteId') || localStorage.getItem('cociber.siteId');
      const id = stored && list.some((site) => site.id === stored) ? stored : list.length === 1 ? list[0].id : '';
      setSiteId(id);
      if (query.get('fromDeviceId')) setOrigin({ deviceId: query.get('fromDeviceId')!, interfaceId: query.get('fromInterfaceId') ?? '' });
      if (query.get('subnetId')) await openSubnet(query.get('subnetId')!);
      if (query.get('hostId')) await openHost(query.get('hostId')!);
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesData]);

  const save = async (path: string, body: unknown, method = 'POST', after?: () => Promise<void>) => {
    const resource = path.includes('/vlans') ? 'VLAN' : path.includes('/subnets') ? 'subnet' : 'host';
    const operation = method === 'DELETE' ? `Eliminar ${resource}` : method === 'PATCH' ? `Editar ${resource}` : `Criar ${resource}`;
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      setModal('');
      success(operation, method === 'DELETE' ? `O ${resource} foi eliminado.` : method === 'PATCH' ? 'As alterações foram guardadas.' : `O ${resource} foi criado com sucesso.`);
      await invalidateIpam();
      if (after) await after();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Operação falhou.';
      setError(message);
      toastError(operation, message);
    }
  };

  const remove = async (path: string, message: string) => {
    if (confirm(message)) await save(path, {}, 'DELETE');
  };

  const siteName = sites.find((site) => site.id === siteId)?.name ?? 'Seleciona um Site';

  const openNewSubnet = (vlanId = '') => {
    setSubnet({ ...blankSubnet, vlanId });
    setModal('subnet');
  };

  const calculate = async (event: React.FormEvent) => {
    event.preventDefault();
    try {
      setCalcResult(await calculateSubnets({ ...calc, operation: 'split', newPrefix: Number(calc.newPrefix) }));
    } catch (reason) {
      setError(reason instanceof Error ? reason.message : 'Não foi possível calcular as subnets.');
    }
  };

  const normalizedSearch = search.trim().toLowerCase();
  const visibleVlans = normalizedSearch
    ? vlans.filter((item) => `${item.vlanId} ${item.name} ${item.description ?? ''} ${item.subnet?.cidr ?? ''}`.toLowerCase().includes(normalizedSearch))
    : vlans;
  const visibleSubnets = normalizedSearch && !selectedSubnetId
    ? subnets.filter((item) => `${item.cidr} ${item.purpose ?? ''} ${item.vlan?.name ?? ''}`.toLowerCase().includes(normalizedSearch))
    : subnets;
  const tabLabel = tabs.find(([value]) => value === tab)?.[1] ?? tab;

  return <AppShell section="IPAM" context={[siteName, tabLabel, ...(selected ? [selected.cidr] : []), ...(hostDetail ? [hostDetail.name] : [])]} search={tab === 'calculator' ? undefined : { value: search, onChange: setSearch, placeholder: selected ? 'Pesquisar IP ou hostname…' : tab === 'map' ? 'Pesquisar VLAN ou subnet…' : 'Pesquisar subnets…' }} actions={<><button className="topbar-action secondary-button" onClick={() => void invalidateIpam()}><RefreshCw size={14} className={busy ? 'spin' : ''} /> Atualizar</button>{origin && <a className="topbar-action secondary-button" href={`/infraestrutura?siteId=${encodeURIComponent(siteId)}&tab=interfaces&deviceId=${encodeURIComponent(origin.deviceId)}&interfaceId=${encodeURIComponent(origin.interfaceId || '')}`}>← Voltar à porta</a>}</>}>
    <main className="ipam-workspace">
      <header className="workspace-head"><div><span className="section-kicker">IP ADDRESS MANAGEMENT</span><h1>IPAM</h1><p>Site → VLAN → subnet → IP → Host → Service.</p></div></header>
      {error && <div className="ipam-alert error"><X size={15} />{error}</div>}
      {siteId && <nav className="ipam-tabs ipam-feature-tabs">{tabs.map(([value, label]) => <button key={value} className={tab === value ? 'active' : ''} onClick={() => { setTab(value); setSearch(''); }}>{label}</button>)}</nav>}
      {!siteId
        ? <Empty title="Escolhe um Site para começar" text="O mapa mostra as VLANs e subnets do Site selecionado." />
        : tab === 'map'
          ? <NetworkMap vlans={visibleVlans} canEdit={canEdit} edit={(item) => { setVlan({ id: item.id, vlanId: item.vlanId, name: item.name, description: item.description ?? '' }); setModal('vlan'); }} remove={(item) => remove(`/api/v1/vlans/${item.id}`, `Eliminar VLAN ${item.vlanId} — ${item.name}?`)} associate={(item) => { setCurrentVlan(item); setModal('association'); }} openSubnet={openSubnet} newVlan={() => { setVlan({ ...blankVlan }); setModal('vlan'); }} newSubnet={openNewSubnet} />
            : tab === 'subnets'
              ? <SubnetsView selected={selected ?? null} items={visibleSubnets} usage={usage ?? null} ips={ips} search={search} setSearch={setSearch} openSubnet={openSubnet} openHost={openHost} canEdit={canEdit} siteId={siteId} newSubnet={() => openNewSubnet()} editIp={(ip) => { setHost({ id: ip.id, address: ip.address, hostname: ip.hostname ?? '', description: ip.notes ?? '' }); setModal('ip'); }} newIp={() => { setHost({ ...blankHost }); setModal('ip'); }} createHost={(ip) => { setHost({ name: ip.hostname || `host-${ip.address.replace(/[:.]/g, '-')}`, hostname: ip.hostname ?? '', operatingSystem: '', macAddress: ip.macAddress ?? '', notes: ip.notes ?? '', status: 'UNKNOWN', ipAddressId: ip.id }); setModal('create-host'); }} />
                : tab === 'calculator'
                  ? <CalculatorView calc={calc} setCalc={setCalc} result={calcResult} onSubmit={calculate} />
                  : tab === 'permissions'
                    ? <CentralIpamPermissions />
                    : <Empty title={tabLabel} text="Esta área do IPAM está preparada para a próxima configuração." />}
      {hostDetail && <HostPanel host={hostDetail} canEdit={canEdit || hasRole('SYSTEMS_OPERATOR')} close={closeHost} reload={() => openHost(hostDetail.id)} success={success} toastError={toastError} />}

      {modal === 'vlan' && <IpamModal title={vlan.id ? 'Editar VLAN' : 'Criar VLAN'} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(vlan.id ? `/api/v1/vlans/${vlan.id}` : '/api/v1/vlans', { vlanId: Number(vlan.vlanId), name: vlan.name, description: vlan.description, siteId }, vlan.id ? 'PATCH' : 'POST'); }}><label>VLAN ID<input required type="number" min="1" max="4094" value={vlan.vlanId} onChange={(event) => setVlan({ ...vlan, vlanId: event.target.value })} /></label><label>Nome<input required value={vlan.name} onChange={(event) => setVlan({ ...vlan, name: event.target.value })} /></label><label>Descrição<input value={vlan.description || ''} onChange={(event) => setVlan({ ...vlan, description: event.target.value })} /></label><button className="primary-button">Guardar</button></form></IpamModal>}

      {modal === 'subnet' && <IpamModal title="Criar subnet" close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save('/api/v1/subnets', { ...subnet, siteId, version: Number(subnet.version), vlanId: subnet.vlanId || undefined, gateway: subnet.gateway || undefined }); }}><label>CIDR<input required placeholder="10.10.10.0/24 ou 2001:db8::/64" value={subnet.cidr} onChange={(event) => setSubnet({ ...subnet, cidr: event.target.value })} /></label><label>Versão<select value={subnet.version} onChange={(event) => setSubnet({ ...subnet, version: Number(event.target.value) })}><option value="4">IPv4</option><option value="6">IPv6</option></select></label><label>VLAN<select value={subnet.vlanId} onChange={(event) => setSubnet({ ...subnet, vlanId: event.target.value })}><option value="">Sem VLAN por agora</option>{vlans.map((item) => <option key={item.id} value={item.id}>VLAN {item.vlanId} · {item.name}</option>)}</select></label><label>Gateway<input value={subnet.gateway} onChange={(event) => setSubnet({ ...subnet, gateway: event.target.value })} /></label><label>Finalidade<input value={subnet.purpose} onChange={(event) => setSubnet({ ...subnet, purpose: event.target.value })} /></label><button className="primary-button">Criar subnet</button></form></IpamModal>}

      {modal === 'association' && <IpamModal title={`Interfaces associadas à VLAN ${currentVlan?.vlanId}`} close={() => setModal('')}><div className="modal-form associated-interfaces">{currentVlan?.devices?.map((device) => <div className="associated-device" key={device.id}><div className="associated-device-heading"><Server size={16} /><strong>{device.name}</strong><small>{device.hostname || device.type || 'Equipamento'}</small></div>{device.interfaces?.map((item) => <div className="associated-port" key={item.id}><span>{item.name}</span><small>{item.relation} · {item.mode || 'sem modo'}</small></div>)}</div>)}{!currentVlan?.devices?.length && <Empty title="Sem interfaces associadas" text="Esta VLAN ainda não está associada a portas de equipamentos." />}</div></IpamModal>}

      {modal === 'ip' && selected && <IpamModal title={`${host.id ? 'Editar' : 'Novo'} endereço IP`} close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save(host.id ? `/api/v1/ip-addresses/${host.id}` : '/api/v1/ip-addresses', { address: host.address, subnetId: selected.id, hostname: host.hostname, notes: host.description }, host.id ? 'PATCH' : 'POST', async () => openSubnet(selected.id)); }}><label>IP<input required value={host.address ?? ''} onChange={(event) => setHost({ ...host, address: event.target.value })} /></label><label>Hostname<input value={host.hostname ?? ''} onChange={(event) => setHost({ ...host, hostname: event.target.value })} /></label><label>Descrição<input value={host.description ?? ''} onChange={(event) => setHost({ ...host, description: event.target.value })} /></label><button className="primary-button">Guardar</button></form></IpamModal>}

      {modal === 'create-host' && selected && <IpamModal title="Criar Host e associar IP" close={() => setModal('')}><form className="modal-form" onSubmit={(event) => { event.preventDefault(); void save('/api/v1/hosts', { name: host.name, hostname: host.hostname, operatingSystem: host.operatingSystem, macAddress: host.macAddress, notes: host.notes, status: host.status, ipAddressId: host.ipAddressId }, 'POST', async () => { await openSubnet(selected.id); const list = await searchHosts(selected.id, host.name ?? ''); if (list.items?.[0]) await openHost(list.items[0].id); }); }}><label>Nome<input required value={host.name ?? ''} onChange={(event) => setHost({ ...host, name: event.target.value })} /></label><label>Hostname<input value={host.hostname ?? ''} onChange={(event) => setHost({ ...host, hostname: event.target.value })} /></label><label>Sistema operativo<input value={host.operatingSystem ?? ''} onChange={(event) => setHost({ ...host, operatingSystem: event.target.value })} /></label><label>Estado<select value={host.status ?? 'UNKNOWN'} onChange={(event) => setHost({ ...host, status: event.target.value })}>{['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE'].map((status) => <option key={status}>{status}</option>)}</select></label><label>Notas<textarea value={host.notes ?? ''} onChange={(event) => setHost({ ...host, notes: event.target.value })} /></label><button className="primary-button">Criar e associar</button></form></IpamModal>}
    </main>
  </AppShell>;
}
