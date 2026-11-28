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
import { useUiText } from '@/components/ui/use-ui-text';

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
export function unknownTrapName(t: ReturnType<typeof useUiText>, item: Pick<UnmatchedTrapSource, 'lastTrapLabel' | 'lastTrapOid'>): string | null {
  if (item.lastTrapLabel) return item.lastTrapLabel;
  if (!item.lastTrapOid) return null;
  return item.lastTrapOid === APP_TEST_TRAP_OID ? snmpTrapCategoryLabel(t, 'SELF_TEST') : snmpTrapCategoryLabel(t, 'VENDOR');
}

/** Chips over the unknown sources: pre-registration state and SNMP version, kept in `?traps.registered=` / `?traps.version=`. */
const trapsTableConfig = { filters: { registered: '', version: '' }, sortable: [] as string[], prefix: 'traps.' };
const trapAccessors: ChipAccessors<UnmatchedTrapSource> = { registered: (item) => (item.preRegistered ? 'yes' : 'no'), version: (item) => item.version };
const registeredChipLabels = [['no', 'snmp.unknownTraps.chip.unregistered'], ['yes', 'snmp.unknownTraps.chip.preRegistered']] as const;

export function SnmpUnknownTrapsRestricted() {
  const t = useUiText();
  return <section className="ipam-card" aria-labelledby="snmp-unknown-restricted-title">
    <div className="empty-context"><ShieldAlert size={24} aria-hidden="true" /><strong id="snmp-unknown-restricted-title">{t('snmp.unknownTraps.onlyAdministratorsCanSeeTraps')}</strong><span>{t('snmp.unknownTraps.theseTrapsComeFromIps')}</span></div>
  </section>;
}

export function SnmpUnknownTrapsView() {
  const t = useUiText();
  const queryClient = useQueryClient();
  const { confirm, confirmDialog } = useConfirm();
  const [notice, setNotice] = useState('');
  const { data, error, isLoading } = useQuery({ queryKey: unmatchedTrapSourcesKey, queryFn: listUnmatchedTrapSources, refetchInterval: 30_000, retry: false });
  const ignore = useMutation({
    mutationFn: ignoreUnmatchedTraps,
    onSuccess: async (result) => { setNotice(t('snmp.unknownTraps.hiddenNotice', undefined, { address: result.sourceAddress, count: formatNumber(result.ignored) })); await queryClient.invalidateQueries({ queryKey: unmatchedTrapSourcesKey }); },
  });
  const askIgnore = async (item: UnmatchedTrapSource) => {
    if (!(await confirm({ title: t('snmp.unknownTraps.hideExistingTraps'), message: t('snmp.unknownTraps.hideConfirm', undefined, { address: item.sourceAddress }), confirmLabel: t('snmp.unknownTraps.hideExistingTraps'), cancelLabel: t('snmp.unknownTraps.back') }))) return;
    setNotice('');
    ignore.mutate(item.sourceAddress);
  };
  const items = data?.items ?? [];
  const { filters, setFilter } = useTableUrlState(trapsTableConfig);
  const registeredOptions = chipOptions(registeredChipLabels.map(([value, key]) => [value, t(key)] as const), facetCounts(items, filters, trapAccessors, 'registered'), { complete: true, selected: filters.registered, hideEmpty: true });
  const versionOptions = chipOptions([], facetCounts(items, filters, trapAccessors, 'version'), { complete: true, selected: filters.version, extraLabel: (value) => (value === CHIP_NONE ? t('snmp.unknownTraps.chip.noVersion') : value) });
  const visibleItems = applyChipFilters(items, filters, trapAccessors);
  const columns: DataTableColumn<UnmatchedTrapSource>[] = [
    { id: 'source', header: t('snmp.unknownTraps.sourceIp'), cell: (item) => <><strong className="mono">{item.sourceAddress}</strong>{item.preRegistered ? <small>{t('snmp.unknownTraps.preRegistered')}</small> : null}</> },
    { id: 'first', header: t('snmp.unknownTraps.first'), cell: (item) => item.firstSeenAt ? formatDateTime(item.firstSeenAt) : '—' },
    { id: 'last', header: t('snmp.unknownTraps.last'), cell: (item) => item.lastSeenAt ? formatDateTime(item.lastSeenAt) : '—' },
    { id: 'count', header: 'Traps', cell: (item) => formatNumber(item.count) },
    { id: 'trap', header: t('snmp.unknownTraps.lastTrap'), cell: (item) => { const name = unknownTrapName(t, item); return name ? <span className="snmp-trap-name"><span>{name}</span>{item.lastTrapOid ? <small className="mono">{item.lastTrapOid}</small> : null}</span> : <span className="muted-cell">—</span>; } },
    { id: 'actions', header: null, className: 'table-actions', cell: (item) => <span className="button-row">{!item.preRegistered && <a className="secondary-button snmp-action-button" href={preRegisterHref(item.sourceAddress)} aria-label={t('snmp.unknownTraps.preRegisterNamed', undefined, { address: item.sourceAddress })}><KeyRound size={13} /> {t('snmp.unknownTraps.preRegister')}</a>}<button type="button" className="secondary-button snmp-action-button" disabled={ignore.isPending} onClick={() => void askIgnore(item)} aria-label={t('snmp.unknownTraps.hideNamed', undefined, { address: item.sourceAddress })}><EyeOff size={13} /> {t('snmp.unknownTraps.hideExistingTraps2')}</button></span> },
  ];
  return <>
    {confirmDialog}
    <section className="ipam-card">
      <div className="panel-heading"><div><h2>{t('snmp.unknownTraps.trapsFromUnknownDevices')}</h2><p className="panel-description">{t('snmp.unknownTraps.trapsWhoseSourceIpMatches')}</p></div><RadioTower size={18} /></div>
      {notice && <div className="ipam-alert" role="status"><Check size={15} />{notice}</div>}
      {ignore.error && <div className="ipam-alert error" role="alert"><X size={15} />{ignore.error instanceof Error ? ignore.error.message : t('snmp.unknownTraps.couldNotHideTheTraps')}</div>}
      {error ? <div className="ipam-alert error" role="alert"><X size={15} />{error instanceof Error ? error.message : t('snmp.unknownTraps.couldNotLoadTheUnknown')}</div>
        : isLoading ? <div className="empty-context" aria-busy="true"><RadioTower size={24} /><strong>{t('snmp.unknownTraps.loadingUnknownTraps')}</strong></div>
        : items.length ? <>
          <FilterChipBar>
            <FilterChips label={t('snmp.unknownTraps.record')} value={filters.registered} options={registeredOptions} total={items.length} onChange={(value) => setFilter('registered', value)} />
            {(versionOptions.length > 1 || filters.version !== '') && <FilterChips label={t('snmp.unknownTraps.version')} value={filters.version} options={versionOptions} total={items.length} allLabel={t('snmp.unknownTraps.all')} onChange={(value) => setFilter('version', value)} />}
          </FilterChipBar>
          {visibleItems.length ? <DataTable className="snmp-unknown-table" rows={visibleItems} columns={columns} rowKey={(item) => item.sourceAddress} label={t('snmp.unknownTraps.trapsFromUnknownDevices')} /> : <div className="no-data">{t('snmp.unknownTraps.noSourcesMatchTheseFilters')}</div>}
        </>
        : <div className="no-data">{t('snmp.unknownTraps.noTrapsFromUnknownSources')}</div>}
    </section>
  </>;
}
