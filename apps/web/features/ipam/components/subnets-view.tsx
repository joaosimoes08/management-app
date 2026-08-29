'use client';

import { ChevronRight, Edit3, Network, Plus } from 'lucide-react';
import type { IpAddressRow, Subnet, SubnetUsage } from '../types';
import { Empty } from './ipam-modal';

export interface SubnetsViewProps {
  selected: Subnet | null;
  items: Subnet[];
  usage: SubnetUsage | null;
  ips: IpAddressRow[];
  search: string;
  setSearch: (search: string) => void;
  openSubnet: (id: string) => void;
  openHost: (id: string) => void;
  canEdit: boolean;
  siteId: string;
  newSubnet: () => void;
  editIp: (ip: IpAddressRow) => void;
  newIp: () => void;
  createHost: (ip: IpAddressRow) => void;
}

/** Subnet list of the site, or the selected subnet with its IP table. */
export function SubnetsView({ selected, items, usage, ips, search, setSearch, openSubnet, openHost, canEdit, newSubnet, editIp, newIp, createHost }: SubnetsViewProps) {
  if (!selected) return <section className="ipam-card">
    <div className="panel-heading"><h2>Subnets do Site</h2>{canEdit && <button className="primary-button" onClick={newSubnet}><Plus size={14} /> Nova subnet</button>}</div>
    {items.map((subnet) => <button className="subnet-list-row" key={subnet.id} onClick={() => openSubnet(subnet.id)}><Network size={17} /><span><strong>{subnet.cidr}</strong><small>IPv{subnet.version} · {subnet.vlan?.name || 'Sem VLAN'} · {subnet._count?.ips ?? 0} IPs</small></span><ChevronRight size={16} /></button>)}
    {!items.length && <Empty title={search ? 'Sem subnets correspondentes' : 'Este Site ainda não tem subnets'} text={search ? 'Experimenta outra pesquisa.' : 'Cria uma subnet diretamente nesta página.'} />}
  </section>;

  return <section className="ipam-card">
    <div className="panel-heading"><div><button className="text-button" onClick={() => { setSearch(''); location.href = `/ipam?siteId=${selected.siteId}` }}>← Todas as subnets</button><span className="section-kicker">SUBNET SELECIONADA</span><h2>{selected.cidr}</h2></div>{canEdit && <button className="primary-button" onClick={newIp}><Plus size={14} /> Novo endereço IP</button>}</div>
    <div className="usage-summary"><strong>{usage?.free ?? '—'} livres</strong><span>{usage?.occupied ?? 0} ocupados</span><span>{usage?.utilizationPercent ?? 0}% utilização</span></div>
    <div className="subnet-ip-toolbar"><strong>Hosts e endereços IP</strong></div>
    <table className="ip-table">
      <thead><tr><th>IP</th><th>Estado manual / observado</th><th>Host</th><th>Hostname</th><th>Ações</th></tr></thead>
      <tbody>{ips.map((ip) => <tr key={ip.id}>
        <td className="mono">{ip.address}</td>
        <td>{ip.state} / {ip.observedState || '—'}</td>
        <td>{ip.host
          ? <button className="link-button" onClick={() => openHost(ip.host!.id)}>{ip.host.name} · {ip.host._count?.services ?? 0} services</button>
          : canEdit ? <button className="secondary-button" onClick={() => createHost(ip)}><Plus size={13} /> Criar/associar Host</button> : '—'}</td>
        <td>{ip.hostname || '—'}</td>
        <td className="table-actions">{canEdit && <button className="icon-button subtle" title="Editar IP" onClick={() => editIp(ip)}><Edit3 size={14} /></button>}</td>
      </tr>)}</tbody>
    </table>
    {!ips.length && <Empty title={search ? 'Sem IPs correspondentes' : 'Ainda não existem endereços nesta subnet'} text={search ? 'Experimenta outra pesquisa.' : 'Adiciona o primeiro IP ou executa Discovery.'} />}
  </section>;
}
