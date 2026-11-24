'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, KeyRound, RadioTower, ShieldAlert, X } from 'lucide-react';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { useTableUrlState } from '@/components/data-table/use-table-url-state';
import { FilterChipBar, FilterChips } from '@/components/ui/filter-chips';
import { applyChipFilters, chipOptions, CHIP_NONE, facetCounts, type ChipAccessors } from '@/lib/filter-chips';
import { snmpTrapCategoryLabel } from './snmp-trap-labels';
import { ignoreUnmatchedTraps, listUnmatchedTrapSources, unmatchedTrapSourcesKey, type UnmatchedTrapSource } from './api';

/** Where "Pré-registar" goes: the SNMP pre-registration dialog in Descoberta, prefilled with the source IP. */
/** The unknown-traps view on the SNMP page (ADMIN only; other roles get an explanation there). */
export const UNKNOWN_TRAPS_HREF = '/snmp?view=unknown';

export const preRegisterHref = (sourceAddress: string) => `/descoberta?tab=snmp&preRegister=${encodeURIComponent(sourceAddress)}`;

/**
 * SNMP Phase 1 step 4.3: "Traps de equipamentos desconhecidos". Traps whose source IP matches no device, grouped by IP,
 * with Pré-registar (authorise the IP for 24 h) or Ocultar traps existentes (hide the traps already received
 * from that IP and close its alert; the IP is not blocked, so new traps from it show again). ADMIN only.
 */
/** The app's own "Enviar trap de teste" uses the Net-SNMP example heartbeat OID. */
export const APP_TEST_TRAP_OID = '1.3.6.1.4.1.8072.2.3.0.1';

/** Readable name for the latest trap of an unknown source: catalogue label, the app test trap, else a vendor trap. The raw OID shows below it. */
export function unknownTrapName(item: Pick<UnmatchedTrapSource, 'lastTrapLabel' | 'lastTrapOid'>): string | null {
  if (item.lastTrapLabel) return item.lastTrapLabel;
  if (!item.lastTrapOid) return null;
  return item.lastTrapOid === APP_TEST_TRAP_OID ? snmpTrapCategoryLabel('SELF_TEST') : snmpTrapCategoryLabel('VENDOR');
}

/** Chips over the unknown sources: pre-registration state and SNMP version, kept in `?traps.registered=` / `?traps.version=`. */
const trapsTableConfig = { filters: { registered: '', version: '' }, sortable: [] as string[], prefix: 'traps.' };
const trapAccessors: ChipAccessors<UnmatchedTrapSource> = { registered: (item) => (item.preRegistered ? 'yes' : 'no'), version: (item) => item.version };
const registeredChipLabels = [['no', 'Por registar'], ['yes', 'Pré-registado']] as const;
const versionChipLabel = (value: string) => (value === CHIP_NONE ? 'Sem versão' : value);

export function SnmpUnknownTrapsRestricted() {
  return <section className="ipam-card" aria-labelledby="snmp-unknown-restricted-title">
    <div className="empty-context"><ShieldAlert size={24} aria-hidden="true" /><strong id="snmp-unknown-restricted-title">Só administradores veem as traps de equipamentos desconhecidos.</strong><span>Estas traps vêm de IPs que ainda não estão no inventário. Pede a um administrador para as rever e pré-registar o equipamento em Descoberta.</span></div>
  </section>;
}

export function SnmpUnknownTrapsView() {
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [notice, setNotice] = useState('');
  const { data, error, isLoading } = useQuery({ queryKey: unmatchedTrapSourcesKey, queryFn: listUnmatchedTrapSources, refetchInterval: 30_000, retry: false });
  const ignore = useMutation({
    mutationFn: ignoreUnmatchedTraps,
    onSuccess: async (result) => { setNotice(`${result.sourceAddress}: ${formatNumber(result.ignored)} traps existentes ocultadas.`); await queryClient.invalidateQueries({ queryKey: unmatchedTrapSourcesKey }); },
  });
  const askIgnore = async (item: UnmatchedTrapSource) => {
    if (!(await confirm({ title: 'Ocultar traps existentes', message: `Ocultar as traps já recebidas de ${item.sourceAddress}? Deixam de aparecer nesta lista e o alerta desta origem fecha. O IP não fica bloqueado: traps novas deste IP voltam a aparecer aqui.`, confirmLabel: 'Ocultar traps existentes', cancelLabel: 'Voltar' }))) return;
    setNotice('');
    ignore.mutate(item.sourceAddress);
  };
  const items = data?.items ?? [];
  const { filters, setFilter } = useTableUrlState(trapsTableConfig);
  const registeredOptions = chipOptions(registeredChipLabels, facetCounts(items, filters, trapAccessors, 'registered'), { complete: true, selected: filters.registered, hideEmpty: true });
  const versionOptions = chipOptions([], facetCounts(items, filters, trapAccessors, 'version'), { complete: true, selected: filters.version, extraLabel: versionChipLabel });
  const visibleItems = applyChipFilters(items, filters, trapAccessors);
  const columns: DataTableColumn<UnmatchedTrapSource>[] = [
    { id: 'source', header: 'IP de origem', cell: (item) => <><strong className="mono">{item.sourceAddress}</strong>{item.preRegistered ? <small>Pré-registado</small> : null}</> },
    { id: 'first', header: 'Primeira', cell: (item) => item.firstSeenAt ? formatDateTime(item.firstSeenAt) : '—' },
    { id: 'last', header: 'Última', cell: (item) => item.lastSeenAt ? formatDateTime(item.lastSeenAt) : '—' },
    { id: 'count', header: 'Traps', cell: (item) => formatNumber(item.count) },
    { id: 'trap', header: 'Última trap', cell: (item) => { const name = unknownTrapName(item); return name ? <span className="snmp-trap-name"><span>{name}</span>{item.lastTrapOid ? <small className="mono">{item.lastTrapOid}</small> : null}</span> : <span className="muted-cell">—</span>; } },
    { id: 'actions', header: null, className: 'table-actions', cell: (item) => <span className="button-row">{!item.preRegistered && <a className="secondary-button snmp-action-button" href={preRegisterHref(item.sourceAddress)} aria-label={`Pré-registar ${item.sourceAddress}`}><KeyRound size={13} /> Pré-registar</a>}<button type="button" className="secondary-button snmp-action-button" disabled={ignore.isPending} onClick={() => void askIgnore(item)} aria-label={`Ocultar as traps existentes de ${item.sourceAddress}`}><EyeOff size={13} /> Ocultar traps existentes</button></span> },
  ];
  return <>
    {confirmDialog}
    <section className="ipam-card">
      <div className="panel-heading"><div><h2>Traps de equipamentos desconhecidos</h2><p className="panel-description">Traps cujo IP de origem não corresponde ao IP de gestão de nenhum equipamento. Pré-regista o IP para o adicionar, ou corrige o trap-source no switch.</p></div><RadioTower size={18} /></div>
      {notice && <div className="ipam-alert" role="status"><Check size={15} />{notice}</div>}
      {ignore.error && <div className="ipam-alert error" role="alert"><X size={15} />{ignore.error instanceof Error ? ignore.error.message : 'Não foi possível ocultar as traps.'}</div>}
      {error ? <div className="ipam-alert error" role="alert"><X size={15} />{error instanceof Error ? error.message : 'Não foi possível carregar as traps desconhecidas.'}</div>
        : isLoading ? <div className="empty-context" aria-busy="true"><RadioTower size={24} /><strong>A carregar traps desconhecidas…</strong></div>
        : items.length ? <>
          <FilterChipBar>
            <FilterChips label="Registo" value={filters.registered} options={registeredOptions} total={items.length} onChange={(value) => setFilter('registered', value)} />
            {(versionOptions.length > 1 || filters.version !== '') && <FilterChips label="Versão" value={filters.version} options={versionOptions} total={items.length} allLabel="Todas" onChange={(value) => setFilter('version', value)} />}
          </FilterChipBar>
          {visibleItems.length ? <DataTable className="snmp-unknown-table" rows={visibleItems} columns={columns} rowKey={(item) => item.sourceAddress} label="Traps de equipamentos desconhecidos" /> : <div className="no-data">Nenhuma origem com estes filtros.</div>}
        </>
        : <div className="no-data">Nenhuma trap de origem desconhecida.</div>}
    </section>
  </>;
}
