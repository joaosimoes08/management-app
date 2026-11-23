'use client';

import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import { Check, EyeOff, KeyRound, RadioTower, X } from 'lucide-react';
import { formatDateTime, formatNumber } from '@/lib/format/date';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ignoreUnmatchedTraps, listUnmatchedTrapSources, unmatchedTrapSourcesKey, type UnmatchedTrapSource } from './api';

/** Where "Pré-registar" goes: the SNMP pre-registration dialog in Descoberta, prefilled with the source IP. */
export const preRegisterHref = (sourceAddress: string) => `/descoberta?tab=snmp&preRegister=${encodeURIComponent(sourceAddress)}`;

/**
 * SNMP Phase 1 step 4.3: "Traps de equipamentos desconhecidos". Traps whose source IP matches no device, grouped by IP,
 * with Pré-registar (authorise the IP for 24 h) or Ocultar traps existentes (hide the traps already received
 * from that IP and close its alert; the IP is not blocked, so new traps from it show again). ADMIN only.
 */
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
  const columns: DataTableColumn<UnmatchedTrapSource>[] = [
    { id: 'source', header: 'IP de origem', cell: (item) => <><strong className="mono">{item.sourceAddress}</strong>{item.preRegistered ? <small>Pré-registado</small> : null}</> },
    { id: 'first', header: 'Primeira', cell: (item) => item.firstSeenAt ? formatDateTime(item.firstSeenAt) : '—' },
    { id: 'last', header: 'Última', cell: (item) => item.lastSeenAt ? formatDateTime(item.lastSeenAt) : '—' },
    { id: 'count', header: 'Traps', cell: (item) => formatNumber(item.count) },
    { id: 'trap', header: 'Última trap', cell: (item) => item.lastTrapLabel || (item.lastTrapOid ? <span className="mono">{item.lastTrapOid}</span> : <span className="muted-cell">—</span>) },
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
        : items.length ? <DataTable rows={items} columns={columns} rowKey={(item) => item.sourceAddress} label="Traps de equipamentos desconhecidos" />
        : <div className="no-data">Nenhuma trap de origem desconhecida.</div>}
    </section>
  </>;
}
