'use client';

import { formatIpamPercent } from '../utilization';
import { useEffect, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { ApiRequestError } from '@/lib/api/errors';
import { useUiText } from '@/components/ui/use-ui-text';
import { ipamServerText, ipamText } from '../i18n';
import type { Subnet } from '../types';
import { commitSubnetPlanning, getSubnetPlanning, type SubnetPlanCommitProblem, type SubnetPlanning, type SubnetPlanningAllocationKind, type SubnetPlannedBlock, type SubnetPlanningSegment, type SubnetPlanningShortfall, type SubnetSkippedBlock, type SubnetSplitRow } from '../api';

/** The API creates at most this many blocks per confirmation (MAX_COMMIT_BLOCKS in apps/api/src/ipam/subnet-planning.ts). */
export const PLANNING_COMMIT_MAX_BLOCKS = 64;
const planningCommitLimitHint = () => ipamText('ipam.planning.commitLimit', { max: PLANNING_COMMIT_MAX_BLOCKS });

const kindLabel = (kind: SubnetPlanningAllocationKind) => ipamText(`ipam.planning.kind.${kind}`);
const segmentBadge: Record<SubnetPlanningSegment['status'], { className: string; label: string }> = {
  FREE: { className: 'free', get label() { return ipamText('ipam.planning.segment.FREE'); } },
  TAKEN: { className: 'occupied', get label() { return ipamText('ipam.planning.segment.TAKEN'); } },
  PLANNED: { className: 'pending', get label() { return ipamText('ipam.planning.segment.PLANNED'); } },
  RESERVED: { className: 'reserved', get label() { return ipamText('ipam.planning.segment.RESERVED'); } },
  CONFLICT: { className: 'excluded', get label() { return ipamText('ipam.planning.segment.CONFLICT'); } },
};

const ipNumber = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);

/** Planned blocks and the candidates the plan skipped, in address order, so every aligned block is accounted for. */
export function plannedListRows(planned: SubnetPlannedBlock[], skipped: SubnetSkippedBlock[]) {
  return [...planned.map((block) => ({ type: 'planned' as const, block })), ...skipped.map((block) => ({ type: 'skipped' as const, block }))]
    .sort((a, b) => ipNumber(a.block.start) - ipNumber(b.block.start));
}

export function shortfallMessage(item: SubnetPlanningShortfall) {
  if (item.reason === 'PREFIX_SHORTER_THAN_PARENT') return ipamText('ipam.planning.shortfall.tooLarge', { prefix: item.prefix });
  if (item.reason === 'TRUNCATED') return ipamText('ipam.planning.shortfall.truncated', { count: item.planned, prefix: item.prefix });
  if (item.reason === 'NO_FREE_ALIGNED_BLOCK') return ipamText('ipam.planning.shortfall.noFree', { prefix: item.prefix });
  return ipamText('ipam.planning.shortfall.partial', { planned: item.planned ?? '—', requested: item.requested ?? '—', prefix: item.prefix ?? '—', missing: item.missing ?? '—' });
}

function segmentDetail(segment: SubnetPlanningSegment) {
  if (segment.status === 'FREE') return segment.cidrs.join(', ');
  if (segment.status === 'PLANNED') return segment.cidrs[0] ?? '';
  if (segment.status === 'RESERVED') return ipamServerText(segment.label);
  if (segment.status === 'CONFLICT') return segment.breakdown ? ipamText('ipam.planning.conflictDetailFree', { cidr: segment.cidrs[0] ?? '', label: ipamServerText(segment.label), free: segment.breakdown.free }) : ipamText('ipam.planning.conflictDetail', { cidr: segment.cidrs[0] ?? '', label: ipamServerText(segment.label) });
  const kinds = (segment.kinds ?? []).map(kindLabel).join(' · ');
  return segment.label ? `${kinds}: ${ipamServerText(segment.label)}` : kinds;
}

/** Selector label: CIDR · purpose · VRF · Site, so subnets with the same range in different VRFs can be told apart. */
export function subnetOptionLabel(item: Subnet) {
  return [item.cidr, item.purpose, item.vrf?.name ? `VRF ${item.vrf.name}` : item.vrfId ? 'VRF' : ipamText('ipam.planning.globalVrf'), item.site?.name].filter(Boolean).join(' · ');
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
  const ui = useUiText();
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
  const loadError = planQuery.error ? (planQuery.error instanceof Error ? planQuery.error.message : ui('ipam.planning.loadError')) : '';
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });
  const planned = plan && plan.subnet?.id === subnetId ? plan.planned ?? [] : [];
  const skipped = plan && plan.subnet?.id === subnetId ? plan.skipped ?? [] : [];
  const overCommitLimit = planned.length > PLANNING_COMMIT_MAX_BLOCKS;
  const review = async () => {
    if (!planned.length || overCommitLimit || committing) return;
    const label = purpose.trim();
    const ok = await confirm({
      title: ui('ipam.planning.confirmTitle'),
      message: [ui('ipam.planning.confirmMessage', undefined, { count: planned.length, cidr: selected?.cidr ?? '' }), ...planned.map((block) => `${block.cidr} (${block.start} – ${block.end})`), ...(label ? [ui('ipam.planning.confirmPurpose', undefined, { purpose: label })] : []), ui('ipam.planning.confirmRecheck')].join('\n'),
      confirmLabel: ui('ipam.planning.confirmCreate'),
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
      else setError(cause instanceof Error ? cause.message : ui('ipam.planning.createError'));
    } finally {
      setCommitting(false);
    }
  };
  return <section className="ipam-card" aria-busy={loading}>
    <div className="panel-heading"><div><h2>{ui('ipam.planning.title')}</h2><p>{ui('ipam.planning.description')}</p></div></div>
    <div className="modal-form">
      <label>{ui('ipam.planning.subnet')}<select value={subnetId} onChange={(event) => setSubnetId(event.target.value)}><option value="">{options.length || !term ? ui('ipam.planning.selectSubnet') : ui('ipam.planning.noMatch')}</option>{options.map((item) => <option key={item.id} value={item.id}>{subnetOptionLabel(item)}</option>)}</select></label>
      {prefixOptions.length > 0 && <>
        <label>{ui('ipam.planning.blockSize')}<select value={prefix} onChange={(event) => setPrefix(event.target.value)}><option value="">{ui('ipam.planning.freeOnly')}</option>{prefixOptions.map((value) => <option key={value} value={value}>/{value}{value === 31 ? ` · ${ui('ipam.planning.pointToPointRfc')}` : value === 30 ? ` · ${ui('ipam.planning.pointToPoint')}` : ''}</option>)}</select></label>
        {prefix && <label>{ui('ipam.planning.count')}<input type="number" min="1" max="1024" step="1" placeholder={ui('ipam.planning.countAll')} value={count} onChange={(event) => setCount(event.target.value)} /></label>}
      </>}
    </div>
    {loading && <div className="no-data" role="status">{ui('ipam.calc.calculating')}</div>}
    {(error || loadError) && <div className="ipam-alert error">{error || loadError}</div>}
    {created.length > 0 && <div className="ipam-alert success" role="status">{ui('ipam.planning.created', undefined, { cidrs: created.join(', ') })}</div>}
    {conflicts.length > 0 && <>
      <div className="ipam-alert error" role="alert">{ui('ipam.planning.nothingCreated', undefined, { count: conflicts.length })}</div>
      {conflicts.map((item) => <div className="ipam-alert warning" key={`${item.cidr}-${item.reason}`}>{ipamServerText(item.message)}</div>)}
    </>}
    {plan && <div className="activity-list">
      {plan.message ? <div className="no-data">{plan.message}</div> : <>
        <div className="activity-row"><strong>{ui('ipam.planning.usableRange')}</strong><span>{plan.usableRange?.start ?? '—'} – {plan.usableRange?.end ?? '—'}</span></div>
        <div className="activity-row"><strong>{ui('ipam.planning.utilization')}</strong><span>{ui('ipam.planning.utilizationDetail', undefined, { unavailable: plan.unavailable ?? '', total: plan.usableTotal ?? '', percent: formatIpamPercent(plan.utilizationPercent ?? 0), free: plan.free ?? '' })}</span></div>
        <div className="activity-row"><strong>{ui('ipam.planning.broadcast')}</strong><span>{plan.broadcast}</span></div>
        {plan.scope && <div className="activity-row"><strong>{ui('ipam.planning.scope')}</strong><span>{[plan.scope.vrfName ? `VRF ${plan.scope.vrfName}` : ui('ipam.planning.globalTable'), ...(plan.scope.siteName ? [`Site ${plan.scope.siteName}`] : []), ui('ipam.planning.childSubnets', undefined, { count: plan.childSubnets ?? 0 })].join(' · ')}</span></div>}
        {plan.addressSpace && planned.length > 0 && <div className="activity-row"><strong>{ui('ipam.planning.afterPlan')}</strong><span>{[ui('ipam.planning.taken', undefined, { count: plan.addressSpace.taken }), ...(plan.addressSpace.reserved ? [ui('ipam.planning.reserved', undefined, { count: plan.addressSpace.reserved })] : []), ui('ipam.planning.planned', undefined, { count: plan.addressSpace.planned }), ui('ipam.planning.freeOf', undefined, { free: plan.addressSpace.freeAfterPlan, total: plan.addressSpace.total })].join(' · ')}</span></div>}
        {(plan.shortfalls ?? []).map((item) => <div className="ipam-alert" role="status" key={`${item.prefix}-${item.reason}`}>{shortfallMessage(item)}</div>)}
        {prefix && <>
          <h3>{ui('ipam.planning.plannedBlocks')}</h3>
          {plannedListRows(planned, skipped).map((row) => row.type === 'planned'
            ? <div className="activity-row" key={`planned-${row.block.cidr}`}><strong>{row.block.cidr}</strong><span>{row.block.start} – {row.block.end}</span><span className={`state-badge ${segmentBadge.PLANNED.className}`}><i />{segmentBadge.PLANNED.label}</span><small>{ui('ipam.planning.usable', undefined, { count: row.block.usable })}</small></div>
            : <div className="activity-row" key={`skipped-${row.block.cidr}`}><strong>{row.block.cidr}</strong><span>{row.block.start} – {row.block.end} · {row.block.conflicts.map((item) => ipamServerText(item.label)).join(' · ')}</span><span className={`state-badge ${segmentBadge.CONFLICT.className}`}><i />{segmentBadge.CONFLICT.label}</span><small>{row.block.insideExisting && row.block.blocks > 1 ? ui('ipam.planning.skippedBlocks', undefined, { count: row.block.blocks, prefix: row.block.prefix }) : ui('ipam.planning.notPlanned')}</small></div>)}
          {plan.skippedTruncated && <div className="no-data">{ui('ipam.planning.skippedTruncated', undefined, { count: skipped.length })}</div>}
          {!planned.length && <div className="no-data">{ui('ipam.planning.noneplanned')}</div>}
          {canCreate && planned.length > 0 && <div className="modal-form">
            <label>{ui('ipam.planning.purpose')}<input maxLength={100} placeholder={ui('ipam.planning.optional')} value={purpose} onChange={(event) => setPurpose(event.target.value)} /></label>
            {overCommitLimit && <div className="ipam-alert warning" role="status" id="planning-commit-limit">{planningCommitLimitHint()}</div>}
            <div className="modal-actions"><button type="button" className="primary-button" onClick={() => void review()} disabled={committing || loading || overCommitLimit} aria-describedby={overCommitLimit ? 'planning-commit-limit' : undefined}>{committing ? ui('ipam.planning.creating') : ui('ipam.planning.review')}</button></div>
          </div>}
          {plan.split && plan.split.rows.length > 0 && <>
            <h3>{ui('ipam.planning.split', undefined, { prefix })}</h3>
            <div className="ip-table-wrap" role="region" aria-label={ui('ipam.planning.split', undefined, { prefix })} tabIndex={0}><table className="ip-table">
              <thead><tr><th>{ui('ipam.planning.col.block')}</th><th>{ui('ipam.planning.col.state')}</th><th>{ui('ipam.planning.col.used')}</th><th>{ui('ipam.planning.col.free')}</th><th>{ui('ipam.planning.col.takenBy')}</th></tr></thead>
              <tbody>{plan.split.rows.map((row) => <tr key={row.cidr}><td>{row.cidr}</td><td><span className={`state-badge ${splitBadge(row).className}`}><i />{splitBadge(row).label}</span></td><td>{row.used}</td><td>{row.free}</td><td>{row.conflicts.map((item) => item.label).join(' · ') || '—'}</td></tr>)}</tbody>
            </table></div>
            {plan.split.truncated && <div className="no-data">{ui('ipam.planning.splitTruncated', undefined, { shown: plan.split.rows.length, total: plan.split.total })}</div>}
          </>}
        </>}
        <h3>{ui('ipam.planning.map')}</h3>
        {plan.segments?.length ? <div className="ip-table-wrap" role="region" aria-label={ui('ipam.planning.map')} tabIndex={0}><table className="ip-table">
          <thead><tr><th>{ui('ipam.planning.col.state')}</th><th>{ui('ipam.planning.col.range')}</th><th>{ui('ipam.planning.col.addresses')}</th><th>{ui('ipam.planning.col.detail')}</th></tr></thead>
          <tbody>{plan.segments.map((segment) => <tr key={`${segment.status}-${segment.start}`}><td><span className={`state-badge ${segmentBadge[segment.status].className}`}><i />{segmentBadge[segment.status].label}</span></td><td>{segment.start} – {segment.end}</td><td>{segment.count}</td><td>{segmentDetail(segment)}</td></tr>)}</tbody>
        </table></div> : plan.segments ? <div className="no-data">{ui('ipam.planning.noGaps')}</div> : <>
          {/* An API that predates the parent map still returns the flat list of gaps. */}
          {plan.usableGaps.map((gap) => <div className="activity-row" key={`${gap.start}-${gap.end}`}><span>{gap.start} – {gap.end}</span><small>{ui('ipam.planning.addresses', undefined, { count: gap.count })}</small></div>)}
          {!plan.usableGaps.length && <div className="no-data">{ui('ipam.planning.noGaps')}</div>}
        </>}
        {plan.segmentsTruncated && <div className="no-data">{ui('ipam.planning.mapTruncated')}</div>}
      </>}
    </div>}
    {confirmDialog}
  </section>;
}
