'use client';

import { ChevronRight, Edit3, Network, Plus, Trash2 } from 'lucide-react';
import type { IpAddressRow, Subnet, SubnetCapacityHistory, SubnetUsage } from '../types';
import { Empty } from './ipam-modal';
import { SubnetCapacityTrend } from './subnet-capacity-trend';

export interface SubnetsViewProps {
  selected: Subnet | null;
  items: Subnet[];
  usage: SubnetUsage | null;
  capacityHistory: SubnetCapacityHistory | null;
  ips: IpAddressRow[];
  search: string;
  setSearch: (search: string) => void;
  openSubnet: (id: string) => void;
  openHost: (id: string) => void;
  canEdit: boolean;
  canReserve: boolean;
  canReleaseReservations: boolean;
  siteId: string;
  newSubnet: () => void;
  editSubnet: (subnet: Subnet) => void;
  removeSubnet: (subnet: Subnet) => void;
  editIp: (ip: IpAddressRow) => void;
  newIp: () => void;
  createHost: (ip: IpAddressRow) => void;
  reserveIp: (ip: IpAddressRow) => void;
  releaseReservation: (ip: IpAddressRow) => void;
}

/** Subnet list of the site, or the selected subnet with its IP table. */
export function SubnetsView({ selected, items, usage, capacityHistory, ips, search, setSearch, openSubnet, openHost, canEdit, canReserve, canReleaseReservations, newSubnet, editSubnet, removeSubnet, editIp, newIp, createHost, reserveIp, releaseReservation }: SubnetsViewProps) {

  if (!selected) return <section className="ipam-card">
    <div className="panel-heading"><h2>Subnets do Site</h2>{canEdit && <button className="primary-button" onClick={newSubnet}><Plus size={14} /> Nova subnet</button>}</div>
    {items.map((subnet) => <div className="subnet-list-item" key={subnet.id}><button className="subnet-list-row" onClick={() => openSubnet(subnet.id)}><Network size={17} /><span><strong>{subnet.cidr}</strong><small>IPv{subnet.version} · {subnet.vlan?.name || 'Sem VLAN'} · {subnet._count?.ips ?? 0} IPs</small></span><ChevronRight size={16} /></button>{canEdit && <div className="subnet-actions"><button className="icon-button subtle" title={`Editar subnet ${subnet.cidr}`} aria-label={`Editar subnet ${subnet.cidr}`} onClick={() => editSubnet(subnet)}><Edit3 size={14} /></button><button className="icon-button subtle danger" title={`Eliminar subnet ${subnet.cidr}`} aria-label={`Eliminar subnet ${subnet.cidr}`} onClick={() => removeSubnet(subnet)}><Trash2 size={14} /></button></div>}</div>)}
    {!items.length && <Empty title={search ? 'Sem subnets correspondentes' : 'Este Site ainda não tem subnets'} text={search ? 'Experimenta outra pesquisa.' : 'Cria uma subnet diretamente nesta página.'} />}
  </section>;

  return <section className="ipam-card">
    <div className="panel-heading"><div><button className="text-button" onClick={() => { setSearch(''); location.href = `/ipam?siteId=${selected.siteId}` }}>← Todas as subnets</button><span className="section-kicker">SUBNET SELECIONADA</span><h2>{selected.cidr}</h2></div>{canEdit && <div className="subnet-actions"><button className="secondary-button" onClick={() => editSubnet(selected)}><Edit3 size={14} /> Editar subnet</button><button className="secondary-button danger" onClick={() => removeSubnet(selected)}><Trash2 size={14} /> Eliminar subnet</button><button className="primary-button" onClick={newIp}><Plus size={14} /> Novo endereço IP</button></div>}</div>
    <div className="usage-summary">{usage?.version === 6
      ? <><strong>{usage.known} endereços geridos</strong><span>{usage.occupied} ocupados · {usage.reserved} reservados · {usage.excluded} excluídos</span><span>Capacidade livre do prefixo não enumerada</span></>
      : usage?.version === 4
        ? <><strong>{usage.free ?? '—'} livres</strong><span>{usage.occupied} ocupados · {usage.reserved} reservados · {usage.excluded} excluídos</span><span>{usage.utilizationPercent ?? 0}% capacidade alocada</span></>
        : <><strong>—</strong><span>A carregar capacidade IPv4</span></>}</div>
    <SubnetCapacityTrend history={capacityHistory} />
    <div className="subnet-ip-toolbar"><strong>Hosts e endereços IP</strong></div>
    <div className="ip-table-wrap" role="region" aria-label="Endereços IP da subnet" tabIndex={0}><table className="ip-table">
      <thead><tr><th>IP</th><th>Estado manual / observado</th><th>Host</th><th>Hostname</th><th>Ações</th></tr></thead>
      <tbody>{ips.map((ip) => { const reservation = ip.reservation ?? ip.reservations?.find((item) => item.status === 'ACTIVE') ?? null; return <tr key={ip.id}>
        <td className="mono">{ip.address}</td>
        <td>{reservation ? 'RESERVED' : ip.state} / {ip.observedState || '—'}{reservation && <small className="reservation-summary">Até {new Date(reservation.expiresAt).toLocaleString('pt-PT')} · {reservation.reason}</small>}</td>
        <td>{ip.host
          ? <button className="link-button" onClick={() => openHost(ip.host!.id)}>{ip.host.name} · {ip.host._count?.services ?? 0} services</button>
          : canEdit && !reservation && ip.state === 'FREE' ? <button className="secondary-button" onClick={() => createHost(ip)}><Plus size={13} /> Criar/associar Host</button> : '—'}</td>
        <td>{ip.hostname || '—'}</td>
        <td className="table-actions">{canReleaseReservations && reservation ? <button className="secondary-button danger" aria-label={`Libertar reserva de ${ip.address}`} onClick={() => releaseReservation(ip)}>Libertar</button> : canReserve && ip.state === 'FREE' && !reservation && !ip.host && !ip.interface ? <button className="secondary-button" aria-label={`Reservar ${ip.address}`} onClick={() => reserveIp(ip)}>Reservar</button> : null}<button className="icon-button subtle" title={`Abrir endereço IP ${ip.address}`} aria-label={`Abrir endereço IP ${ip.address}`} onClick={() => editIp(ip)}><Edit3 size={14} /></button></td>
      </tr>; })}</tbody>
    </table></div>
    {!ips.length && <Empty title={search ? 'Sem IPs correspondentes' : 'Ainda não existem endereços nesta subnet'} text={search ? 'Experimenta outra pesquisa.' : 'Adiciona o primeiro IP ou executa Discovery.'} />}
  </section>;
}
