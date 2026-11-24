'use client';

import { ipStateLabel } from '../ip-state';
import { IP_LIST_PAGE_SIZE } from '../api';
import { useMemo, useState } from 'react';
import { Edit3, ListChecks, Network, Plus, Tags, Trash2 } from 'lucide-react';
import type { IpAddressRow, ReserveNextIpsResult, Subnet, SubnetCapacityHistory, SubnetUsage } from '../types';
import { Empty } from './ipam-modal';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { SubnetCapacityTrend } from './subnet-capacity-trend';
import { NextFreeIpModal } from './next-free-ip-modal';
import { formatDateTime } from '@/lib/format/date';
import { DataTable, SavedViews, sortByColumns, useTableUrlState, type DataTableColumn, type TableStateConfig } from '@/components/data-table';
import { setSubnetTags } from '@/features/tags/api';
import { ManageTagsButton, TagChips, TagEditor, TagFilter, TagManager } from '@/features/tags/tag-components';
import { hasAllTags } from '@/features/tags/types';
import { formatIpamPercent, utilizationBadge, utilizationBandOptions, utilizationSortValue } from '../utilization';

/** `tag` (Step 36) is a comma list of tag ids, all required; saved views keep it with the band. */
export const subnetTableConfig: TableStateConfig<{ band: string; tag: string }> = {
  filters: { band: '', tag: '' },
  sortable: ['cidr', 'vlan', 'ips', 'utilization'],
  prefix: 'subnets',
};

export interface SubnetsViewProps {
  selected: Subnet | null;
  items: Subnet[];
  loading?: boolean;
  usage: SubnetUsage | null;
  usageLoading?: boolean;
  capacityHistory: SubnetCapacityHistory | null;
  capacityHistoryLoading?: boolean;
  ips: IpAddressRow[];
  /** Server paging of the IP list (the API returns at most 200 addresses per page). */
  ipPage?: number;
  ipTotalPages?: number;
  ipTotal?: number;
  setIpPage?: (page: number) => void;
  loadingIps?: boolean;
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
  /** Called after "Próximo IP livre" reserved addresses (the page refreshes IPAM and toasts). */
  reservedNext?: (result: ReserveNextIpsResult) => void;
  /** Step 36: called after tags of a subnet or the site catalogue changed, so the page refetches subnets. */
  tagsChanged?: () => void;
  /** Create, rename, recolour and delete tags (ADMIN / SYSTEMS_OPERATOR). NETWORK_OPERATOR only assigns existing tags. */
  canManageTags?: boolean;
}

function UtilizationCell({ subnet }: { subnet: Subnet }) {
  const badge = utilizationBadge(subnet.utilization);
  if (!badge) return <span className="muted-cell">—</span>;
  return <span className={`state-badge ${badge.tone}`.trim()} title={badge.title || undefined}><i />{badge.label}</span>;
}

/** Site subnets as a sortable table with the utilisation band from GET /subnets. */
function SubnetTable({ items, loading, canEdit, siteId, openSubnet, editSubnet, removeSubnet, tagsChanged, canManageTags = false }: Pick<SubnetsViewProps, 'items' | 'loading' | 'canEdit' | 'siteId' | 'openSubnet' | 'editSubnet' | 'removeSubnet' | 'tagsChanged' | 'canManageTags'>) {
  const [managingTags, setManagingTags] = useState(false);
  const table = useTableUrlState(subnetTableConfig);
  const columns = useMemo<DataTableColumn<Subnet>[]>(() => [
    { id: 'cidr', header: 'Subnet', sortValue: (subnet) => subnet.cidr, cell: (subnet) => <button className="link-button" onClick={() => openSubnet(subnet.id)}><Network size={14} /> <strong>{subnet.cidr}</strong></button> },
    { id: 'vlan', header: 'VLAN', sortValue: (subnet) => subnet.vlan?.name ?? null, cell: (subnet) => <>{`IPv${subnet.version}`} · {subnet.vlan?.name || 'Sem VLAN'}</> },
    { id: 'ips', header: 'IPs', sortValue: (subnet) => subnet._count?.ips ?? 0, cell: (subnet) => subnet._count?.ips ?? 0 },
    { id: 'utilization', header: 'Utilização', sortValue: utilizationSortValue, cell: (subnet) => <UtilizationCell subnet={subnet} /> },
    { id: 'tags', header: 'Etiquetas', cell: (subnet) => subnet.tags?.length ? <TagChips tags={subnet.tags} limit={3} /> : <span className="muted-cell">—</span> },
    ...(canEdit ? [{ id: 'actions', header: 'Ações', className: 'table-actions', cell: (subnet: Subnet) => <><button className="icon-button subtle" title={`Editar subnet ${subnet.cidr}`} aria-label={`Editar subnet ${subnet.cidr}`} onClick={() => editSubnet(subnet)}><Edit3 size={14} /></button><button className="icon-button subtle danger" title={`Eliminar subnet ${subnet.cidr}`} aria-label={`Eliminar subnet ${subnet.cidr}`} onClick={() => removeSubnet(subnet)}><Trash2 size={14} /></button></> }] : []),
  ], [canEdit, editSubnet, openSubnet, removeSubnet]);
  const { band, tag } = table.filters;
  const rows = useMemo(() => sortByColumns(items.filter((subnet) => (!band || (subnet.utilization?.band ?? '') === band) && hasAllTags(subnet, tag)), columns, table.sort), [band, columns, items, tag, table.sort]);
  return <>
    <PageToolbarPortal><div className="interface-toolbar-controls"><label><span className="toolbar-filter-label">Utilização</span><select aria-label="Filtrar subnets por utilização" title="Filtrar subnets por utilização" value={band} onChange={(event) => table.setFilter('band', event.target.value)}><option value="">Utilização</option>{utilizationBandOptions.map(([value, label]) => <option key={value} value={value}>{label}</option>)}</select></label><label><span className="toolbar-filter-label">Etiqueta</span><TagFilter siteId={siteId} value={tag} onChange={(value) => table.setFilter('tag', value)} /></label>{canManageTags && <ManageTagsButton onClick={() => setManagingTags(true)} />}<SavedViews pageId="ipam-subnets" config={subnetTableConfig} table={table} /></div></PageToolbarPortal>
    <DataTable rows={rows} columns={columns} rowKey={(subnet) => subnet.id} label="Subnets do Site" sort={table.sort} onSortChange={table.setSort} defaultSort={table.defaultSort} loading={loading} empty={tag ? <Empty title="Sem subnets com esta etiqueta" text="Escolhe outra etiqueta ou limpa o filtro." /> : band ? <Empty title="Sem subnets nesta faixa de utilização" text="Escolhe outra faixa ou limpa o filtro." /> : null} />
    {managingTags && <TagManager siteId={siteId} canManage={canManageTags} close={() => setManagingTags(false)} onChanged={() => tagsChanged?.()} />}
  </>;
}

/** Subnet list of the site, or the selected subnet with its IP table. */
export function SubnetsView({ selected, items, loading = false, usage, usageLoading = false, capacityHistory, capacityHistoryLoading = false, ips, loadingIps = false, ipPage = 1, ipTotalPages = 1, ipTotal = 0, setIpPage, search, setSearch, openSubnet, openHost, canEdit, canReserve, canReleaseReservations, siteId, newSubnet, editSubnet, removeSubnet, editIp, newIp, createHost, reserveIp, releaseReservation, reservedNext, tagsChanged, canManageTags = false }: SubnetsViewProps) {
  const [nextFreeOpen, setNextFreeOpen] = useState(false);
  const [editingTags, setEditingTags] = useState(false);

  if (!selected) return <section className="ipam-card">
    <div className="panel-heading"><h2>Subnets do Site</h2></div>{canEdit && <PageToolbarPortal><button className="primary-button" onClick={newSubnet}><Plus size={14} /> Nova subnet</button></PageToolbarPortal>}
    {loading ? <div className="ipam-loading-skeletons subnet-loading-skeletons" aria-label="A carregar subnets" aria-busy="true">{[0, 1, 2].map((item) => <div className="content-skeleton ipam-subnet-skeleton" key={item}/>)}</div> : items.length > 0 && <SubnetTable items={items} loading={loading} canEdit={canEdit} siteId={siteId} openSubnet={openSubnet} editSubnet={editSubnet} removeSubnet={removeSubnet} tagsChanged={tagsChanged} canManageTags={canManageTags} />}
    {!loading && !items.length && <Empty title={search ? 'Sem subnets correspondentes' : 'Este Site ainda não tem subnets'} text={search ? 'Experimenta outra pesquisa.' : 'Cria uma subnet diretamente nesta página.'} />}
  </section>;

  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>{selected.cidr}</h2>{selected.tags?.length ? <TagChips tags={selected.tags} className="subnet-heading-tags" /> : null}</div></div><PageToolbarPortal><div className="subnet-actions"><button className="secondary-button" onClick={() => { setSearch(''); location.href = `/ipam?siteId=${selected.siteId}` }}>← Todas as subnets</button><button className="secondary-button" onClick={() => setNextFreeOpen(true)}><ListChecks size={14} /> Próximo IP livre</button>{canEdit && <><button className="secondary-button" onClick={() => editSubnet(selected)}><Edit3 size={14} /> Editar subnet</button>{selected.siteId && <button className="secondary-button" onClick={() => setEditingTags(true)}><Tags size={14} /> Etiquetas</button>}<button className="secondary-button danger" onClick={() => removeSubnet(selected)}><Trash2 size={14} /> Eliminar subnet</button><button className="primary-button" onClick={newIp}><Plus size={14} /> Novo endereço IP</button></>}</div></PageToolbarPortal>
    <div className="usage-summary" aria-busy={usageLoading}>{usageLoading ? <div className="usage-summary-skeletons"><span className="content-skeleton usage-skeleton-primary"/><span className="content-skeleton usage-skeleton-detail"/><span className="content-skeleton usage-skeleton-detail short"/></div> : usage?.version === 6
      ? <><strong>{usage.known} endereços geridos</strong><span>{usage.occupied} ocupados · {usage.reserved} reservados · {usage.excluded} excluídos</span><span>Capacidade livre do prefixo não enumerada</span></>
      : usage?.version === 4
        ? <><strong>{usage.free ?? '—'} livres</strong><span>{usage.occupied} ocupados · {usage.reserved} reservados · {usage.excluded} excluídos</span><span>{formatIpamPercent(usage.utilizationPercent ?? 0)} capacidade alocada</span></>
        : <><strong>—</strong><span>Capacidade indisponível</span></>}</div>
    <SubnetCapacityTrend history={capacityHistory} loading={capacityHistoryLoading} />
    <div className="subnet-ip-toolbar"><strong>Hosts e endereços IP</strong></div>
    <div className="ip-table-wrap" role="region" aria-label="Endereços IP da subnet" aria-busy={loadingIps} tabIndex={0}><table className="ip-table">
      <thead><tr><th>IP</th><th>Estado manual / observado</th><th>Host</th><th>Hostname</th><th>Ações</th></tr></thead>
      <tbody>{loadingIps ? [0, 1, 2].map((item) => <tr className="ip-table-skeleton-row" aria-hidden="true" key={item}><td colSpan={5}><span className="content-skeleton ip-table-skeleton-line"/></td></tr>) : ips.map((ip) => { const reservation = ip.reservation ?? ip.reservations?.find((item) => item.status === 'ACTIVE') ?? null; return <tr key={ip.id}>
        <td className="mono">{ip.address}</td>
        <td>{ipStateLabel(reservation ? 'RESERVED' : ip.state)} / {ipStateLabel(ip.observedState)}{reservation && <small className="reservation-summary">Até {formatDateTime(reservation.expiresAt)} · {reservation.reason}</small>}</td>
        <td>{ip.host
          ? <button className="link-button" onClick={() => openHost(ip.host!.id)}>{ip.host.name} · {ip.host._count?.services ?? 0} services</button>
          : canEdit && !reservation && ip.state === 'FREE' ? <button className="secondary-button" onClick={() => createHost(ip)}><Plus size={13} /> Criar/associar Host</button> : '—'}</td>
        <td>{ip.hostname || '—'}</td>
        <td className="table-actions">{canReleaseReservations && reservation ? <button className="secondary-button danger" aria-label={`Libertar reserva de ${ip.address}`} onClick={() => releaseReservation(ip)}>Libertar</button> : canReserve && ip.state === 'FREE' && !reservation && !ip.host && !ip.interface ? <button className="secondary-button" aria-label={`Reservar ${ip.address}`} onClick={() => reserveIp(ip)}>Reservar</button> : null}<button className="icon-button subtle" title={`Abrir endereço IP ${ip.address}`} aria-label={`Abrir endereço IP ${ip.address}`} onClick={() => editIp(ip)}><Edit3 size={14} /></button></td>
      </tr>; })}</tbody>
    </table></div>
    {setIpPage && ipTotalPages > 1 && <nav className="calculator-pagination" aria-label="Páginas dos endereços IP"><span>{(ipPage - 1) * IP_LIST_PAGE_SIZE + 1}-{Math.min(ipPage * IP_LIST_PAGE_SIZE, ipTotal)} de {ipTotal}</span><div className="calculator-page-buttons"><button type="button" aria-label="Página anterior" disabled={ipPage <= 1 || loadingIps} onClick={() => setIpPage(ipPage - 1)}>‹</button><span aria-live="polite">Página {ipPage} de {ipTotalPages}</span><button type="button" aria-label="Página seguinte" disabled={ipPage >= ipTotalPages || loadingIps} onClick={() => setIpPage(ipPage + 1)}>›</button></div></nav>}
    {!loadingIps && !ips.length && <Empty title={search ? 'Sem IPs correspondentes' : 'Ainda não existem endereços nesta subnet'} text={search ? 'Experimenta outra pesquisa.' : 'Adiciona o primeiro IP ou executa Discovery.'} />}
    {editingTags && selected.siteId && <TagEditor siteId={selected.siteId} canCreate={canManageTags} itemLabel={selected.cidr} selected={selected.tags ?? []} save={async (tagIds) => { await setSubnetTags(selected.id, tagIds); tagsChanged?.(); }} close={() => setEditingTags(false)} />}
    {nextFreeOpen && <NextFreeIpModal subnet={selected} canReserve={canReserve} close={() => setNextFreeOpen(false)} reserved={(result) => { setNextFreeOpen(false); reservedNext?.(result); }} />}
  </section>;
}
