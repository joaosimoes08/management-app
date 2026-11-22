'use client';

import { formatIpamPercent } from '../utilization';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ApiRequestError } from '@/lib/api/errors';
import type { Subnet } from '../types';
import { commitSubnetPlanning, getSubnetPlanning, type SubnetPlanCommitProblem, type SubnetPlanning, type SubnetPlanningAllocationKind, type SubnetPlannedBlock, type SubnetPlanningSegment, type SubnetPlanningShortfall, type SubnetSkippedBlock, type SubnetSplitRow } from '../api';

const kindLabel: Record<SubnetPlanningAllocationKind, string> = { SUBNET: 'Subnet existente', HOST: 'Hosts', RESERVED: 'Reservados / excluídos', GATEWAY: 'Gateway' };
const segmentBadge: Record<SubnetPlanningSegment['status'], { className: string; label: string }> = {
  FREE: { className: 'free', label: 'Livre' },
  TAKEN: { className: 'occupied', label: 'Ocupado' },
  PLANNED: { className: 'pending', label: 'Planeado' },
  RESERVED: { className: 'reserved', label: 'Reservado' },
  CONFLICT: { className: 'excluded', label: 'Conflito' },
};

const ipNumber = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);

/** Planned blocks and the candidates the plan skipped, in address order, so every aligned block is accounted for. */
export function plannedListRows(planned: SubnetPlannedBlock[], skipped: SubnetSkippedBlock[]) {
  return [...planned.map((block) => ({ type: 'planned' as const, block })), ...skipped.map((block) => ({ type: 'skipped' as const, block }))]
    .sort((a, b) => ipNumber(a.block.start) - ipNumber(b.block.start));
}

export function shortfallMessage(item: SubnetPlanningShortfall) {
  if (item.reason === 'PREFIX_SHORTER_THAN_PARENT') return `Um bloco /${item.prefix} é maior do que a subnet selecionada.`;
  if (item.reason === 'TRUNCATED') return `Foram planeados os primeiros ${item.planned} blocos /${item.prefix}; cabem mais. Indica uma quantidade para limitar a pré-visualização.`;
  if (item.reason === 'NO_FREE_ALIGNED_BLOCK') return `Não existe nenhum bloco /${item.prefix} alinhado e livre nesta subnet.`;
  return `Só cabem ${item.planned} de ${item.requested} blocos /${item.prefix}; faltam ${item.missing}.`;
}

function segmentDetail(segment: SubnetPlanningSegment) {
  if (segment.status === 'FREE') return segment.cidrs.join(', ');
  if (segment.status === 'PLANNED') return segment.cidrs[0] ?? '';
  if (segment.status === 'RESERVED') return segment.label ?? '';
  if (segment.status === 'CONFLICT') return `${segment.cidrs[0] ?? ''} não planeado: ${segment.label ?? ''}${segment.breakdown ? ` · ${segment.breakdown.free} livres` : ''}`;
  const kinds = (segment.kinds ?? []).map((kind) => kindLabel[kind]).join(' · ');
  return segment.label ? `${kinds}: ${segment.label}` : kinds;
}

/** Selector label: CIDR · purpose · VRF · Site, so subnets with the same range in different VRFs can be told apart. */
export function subnetOptionLabel(item: Subnet) {
  return [item.cidr, item.purpose, item.vrf?.name ? `VRF ${item.vrf.name}` : item.vrfId ? 'VRF' : 'Global', item.site?.name].filter(Boolean).join(' · ');
}

function splitBadge(row: SubnetSplitRow) {
  if (row.planned) return segmentBadge.PLANNED;
  return row.available ? segmentBadge.FREE : segmentBadge.TAKEN;
}

/** The page search (top bar) narrows the selector by CIDR, purpose, VLAN, VRF or Site; the selected subnet always stays listed. */
export function matchesPlanningSearch(item: Subnet, term: string) {
  return !term || `${subnetOptionLabel(item)} ${item.vlan?.name ?? ''}`.toLowerCase().includes(term);
}

/**
 * IPv4 planning: free space inside a subnet, where aligned child blocks would go, and how the parent splits.
 * The preview never writes; child subnets are only created after "Rever e confirmar" and an explicit confirmation.
 */
export function SubnetPlanningView({ subnets, search = '', canCreate = false }: { subnets: Subnet[]; search?: string; canCreate?: boolean }) {
  const { confirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [subnetId, setSubnetId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [count, setCount] = useState('');
  const [purpose, setPurpose] = useState('');
  const [error, setError] = useState('');
  const [committing, setCommitting] = useState(false);
  const [conflicts, setConflicts] = useState<SubnetPlanCommitProblem[]>([]);
  const [created, setCreated] = useState<string[]>([]);
  const selected = subnets.find((item) => item.id === subnetId);
  const term = search.trim().toLowerCase();
  const options = subnets.filter((item) => item.id === subnetId || matchesPlanningSearch(item, term));
  const parentPrefix = selected ? Number(selected.cidr.split('/')[1]) : 0;
  const prefixOptions = selected && selected.version === 4 ? Array.from({ length: 33 - parentPrefix }, (_, index) => parentPrefix + index) : [];
  useEffect(() => { setPrefix(''); setCount(''); setPurpose(''); setConflicts([]); setCreated([]); }, [subnetId]);
  useEffect(() => { setConflicts([]); setCreated([]); }, [prefix, count]);
  const requestedCount = count && Number(count) > 0 ? Number(count) : null;
  // Keyed per selection: a changed selection drops (and aborts) the previous request, so a slow answer for an
  // old selection never replaces a newer one, and the page's Atualizar (invalidates ['ipam']) refreshes the plan.
  const planQuery = useQuery({
    queryKey: ['ipam', 'planning', subnetId, prefix, requestedCount],
    queryFn: ({ signal }) => getSubnetPlanning(subnetId, { prefix: prefix ? Number(prefix) : null, count: requestedCount }, signal),
    enabled: Boolean(subnetId),
    retry: false,
  });
  const plan: SubnetPlanning | null = subnetId ? planQuery.data ?? null : null;
  const loading = Boolean(subnetId) && planQuery.isFetching;
  const loadError = planQuery.error ? (planQuery.error instanceof Error ? planQuery.error.message : 'Não foi possível calcular o planeamento.') : '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const planned = plan && plan.subnet?.id === subnetId ? plan.planned ?? [] : [];
  const skipped = plan && plan.subnet?.id === subnetId ? plan.skipped ?? [] : [];
  const review = async () => {
    if (!planned.length || committing) return;
    const label = purpose.trim();
    const ok = await confirm({
      title: 'Criar subnets planeadas',
      message: `Vão ser criadas ${planned.length} subnet(s) dentro de ${selected?.cidr ?? ''}, no mesmo Site e VRF:\n${planned.map((block) => `${block.cidr} (${block.start} – ${block.end})`).join('\n')}${label ? `\nFinalidade: ${label}` : ''}\nA disponibilidade é verificada de novo antes de gravar.`,
      confirmLabel: 'Confirmar e criar',
    });
    if (!ok) return;
    setCommitting(true); setConflicts([]); setCreated([]); setError('');
    try {
      const result = await commitSubnetPlanning(subnetId, planned.map((block) => (label ? { cidr: block.cidr, purpose: label } : { cidr: block.cidr })));
      setCreated(result.created.map((item) => item.cidr));
      void refresh();
    } catch (cause) {
      const problems = cause instanceof ApiRequestError ? (cause.payload as { conflicts?: SubnetPlanCommitProblem[] } | undefined)?.conflicts : undefined;
      if (problems?.length) { setConflicts(problems); void refresh(); }
      else setError(cause instanceof Error ? cause.message : 'Não foi possível criar as subnets.');
    } finally {
      setCommitting(false);
    }
  };
  return <section className="ipam-card" aria-busy={loading}>
    <div className="panel-heading"><div><h2>Intervalos e endereços livres</h2><p>Consulta o espaço livre de uma subnet IPv4 e pré-visualiza onde ficariam novos blocos alinhados (por exemplo /27 ou ligações ponto a ponto /30 e /31). Nada é criado sem confirmação.</p></div></div>
    <div className="modal-form">
      <label>Subnet<select value={subnetId} onChange={(event) => setSubnetId(event.target.value)}><option value="">{options.length || !term ? 'Seleciona uma subnet' : 'Nenhuma subnet corresponde à pesquisa'}</option>{options.map((item) => <option key={item.id} value={item.id}>{subnetOptionLabel(item)}</option>)}</select></label>
      {prefixOptions.length > 0 && <>
        <label>Tamanho dos blocos<select value={prefix} onChange={(event) => setPrefix(event.target.value)}><option value="">Só ver o espaço livre</option>{prefixOptions.map((value) => <option key={value} value={value}>/{value}{value === 31 ? ' · ponto a ponto (RFC 3021)' : value === 30 ? ' · ponto a ponto' : ''}</option>)}</select></label>
        {prefix && <label>Quantidade<input type="number" min="1" max="1024" step="1" placeholder="Todos os que couberem" value={count} onChange={(event) => setCount(event.target.value)} /></label>}
      </>}
    </div>
    {loading && <div className="no-data" role="status">A calcular…</div>}
    {(error || loadError) && <div className="ipam-alert error">{error || loadError}</div>}
    {created.length > 0 && <div className="ipam-alert success" role="status">Subnets criadas: {created.join(', ')}.</div>}
    {conflicts.length > 0 && <>
      <div className="ipam-alert error" role="alert">Nada foi criado: {conflicts.length === 1 ? 'um bloco já não está disponível' : `${conflicts.length} blocos já não estão disponíveis`}. O plano foi recalculado.</div>
      {conflicts.map((item) => <div className="ipam-alert warning" key={`${item.cidr}-${item.reason}`}>{item.message}</div>)}
    </>}
    {plan && <div className="activity-list">
      {plan.message ? <div className="no-data">{plan.message}</div> : <>
        <div className="activity-row"><strong>Intervalo utilizável</strong><span>{plan.usableRange?.start ?? '—'} – {plan.usableRange?.end ?? '—'}</span></div>
        <div className="activity-row"><strong>Utilização</strong><span>{plan.unavailable} / {plan.usableTotal} indisponíveis (inclui subnets filhas e reservas) · {formatIpamPercent(plan.utilizationPercent ?? 0)} · {plan.free} livres</span></div>
        <div className="activity-row"><strong>Broadcast</strong><span>{plan.broadcast}</span></div>
        {plan.scope && <div className="activity-row"><strong>Âmbito</strong><span>{plan.scope.vrfName ? `VRF ${plan.scope.vrfName}` : 'Tabela global (sem VRF)'}{plan.scope.siteName ? ` · Site ${plan.scope.siteName}` : ''} · {plan.childSubnets ?? 0} subnets dentro desta</span></div>}
        {plan.addressSpace && planned.length > 0 && <div className="activity-row"><strong>Após o plano</strong><span>{plan.addressSpace.taken} ocupados{plan.addressSpace.reserved ? ` · ${plan.addressSpace.reserved} reservados (rede e broadcast)` : ''} · {plan.addressSpace.planned} planeados · {plan.addressSpace.freeAfterPlan} livres de {plan.addressSpace.total}</span></div>}
        {(plan.shortfalls ?? []).map((item) => <div className="ipam-alert" role="status" key={`${item.prefix}-${item.reason}`}>{shortfallMessage(item)}</div>)}
        {prefix && <>
          <h3>Blocos planeados</h3>
          {plannedListRows(planned, skipped).map((row) => row.type === 'planned'
            ? <div className="activity-row" key={`planned-${row.block.cidr}`}><strong>{row.block.cidr}</strong><span>{row.block.start} – {row.block.end}</span><span className={`state-badge ${segmentBadge.PLANNED.className}`}><i />{segmentBadge.PLANNED.label}</span><small>{row.block.usable} utilizáveis</small></div>
            : <div className="activity-row" key={`skipped-${row.block.cidr}`}><strong>{row.block.cidr}</strong><span>{row.block.start} – {row.block.end} · {row.block.conflicts.map((item) => item.label).join(' · ')}</span><span className={`state-badge ${segmentBadge.CONFLICT.className}`}><i />{segmentBadge.CONFLICT.label}</span><small>{row.block.insideExisting && row.block.blocks > 1 ? `${row.block.blocks} blocos /${row.block.prefix} não planeados` : 'Não planeado'}</small></div>)}
          {plan.skippedTruncated && <div className="no-data">A lista mostra só os primeiros {skipped.length} blocos não planeados.</div>}
          {!planned.length && <div className="no-data">Nenhum bloco planeado.</div>}
          {canCreate && planned.length > 0 && <div className="modal-form">
            <label>Finalidade das novas subnets<input maxLength={100} placeholder="Opcional" value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
            <button type="button" className="primary-button" onClick={() => void review()} disabled={committing || loading}>{committing ? 'A criar…' : 'Rever e confirmar'}</button>
          </div>}
          {plan.split && plan.split.rows.length > 0 && <>
            <h3>Divisão em /{prefix}</h3>
            <div className="ip-table-wrap" role="region" aria-label={`Divisão em /${prefix}`} tabIndex={0}><table className="ip-table">
              <thead><tr><th>Bloco</th><th>Estado</th><th>Usados</th><th>Livres</th><th>Ocupado por</th></tr></thead>
              <tbody>{plan.split.rows.map((row) => <tr key={row.cidr}><td>{row.cidr}</td><td><span className={`state-badge ${splitBadge(row).className}`}><i />{splitBadge(row).label}</span></td><td>{row.used}</td><td>{row.free}</td><td>{row.conflicts.map((item) => item.label).join(' · ') || '—'}</td></tr>)}</tbody>
            </table></div>
            {plan.split.truncated && <div className="no-data">A divisão mostra só os primeiros {plan.split.rows.length} de {plan.split.total} blocos.</div>}
          </>}
        </>}
        <h3>Mapa da subnet</h3>
        {plan.segments?.length ? <div className="ip-table-wrap" role="region" aria-label="Mapa da subnet" tabIndex={0}><table className="ip-table">
          <thead><tr><th>Estado</th><th>Intervalo</th><th>Endereços</th><th>Detalhe</th></tr></thead>
          <tbody>{plan.segments.map((segment) => <tr key={`${segment.status}-${segment.start}`}><td><span className={`state-badge ${segmentBadge[segment.status].className}`}><i />{segmentBadge[segment.status].label}</span></td><td>{segment.start} – {segment.end}</td><td>{segment.count}</td><td>{segmentDetail(segment)}</td></tr>)}</tbody>
        </table></div> : plan.segments ? <div className="no-data">Não existem gaps utilizáveis nesta subnet.</div> : <>
          {/* An API that predates the parent map still returns the flat list of gaps. */}
          {plan.usableGaps.map((gap) => <div className="activity-row" key={`${gap.start}-${gap.end}`}><span>{gap.start} – {gap.end}</span><small>{gap.count} endereços</small></div>)}
          {!plan.usableGaps.length && <div className="no-data">Não existem gaps utilizáveis nesta subnet.</div>}
        </>}
        {plan.segmentsTruncated && <div className="no-data">O mapa mostra só as primeiras linhas.</div>}
      </>}
    </div>}
    {confirmDialog}
  </section>;
}
