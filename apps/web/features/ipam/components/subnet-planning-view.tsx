'use client';

import { formatIpamPercent } from '../utilization';
import { useEffect, useState } from 'react';
import type { Subnet } from '../types';
import { getSubnetPlanning, type SubnetPlanning, type SubnetPlanningAllocationKind, type SubnetPlanningSegment, type SubnetPlanningShortfall } from '../api';

const kindLabel: Record<SubnetPlanningAllocationKind, string> = { SUBNET: 'Subnet existente', HOST: 'Hosts', RESERVED: 'Reservados / excluídos', GATEWAY: 'Gateway' };
const segmentBadge: Record<SubnetPlanningSegment['status'], { className: string; label: string }> = {
  FREE: { className: 'free', label: 'Livre' },
  TAKEN: { className: 'occupied', label: 'Ocupado' },
  PLANNED: { className: 'pending', label: 'Planeado' },
};

export function shortfallMessage(item: SubnetPlanningShortfall) {
  if (item.reason === 'PREFIX_SHORTER_THAN_PARENT') return `Um bloco /${item.prefix} é maior do que a subnet selecionada.`;
  if (item.reason === 'TRUNCATED') return `Foram planeados os primeiros ${item.planned} blocos /${item.prefix}; cabem mais. Indica uma quantidade para limitar a pré-visualização.`;
  if (item.reason === 'NO_FREE_ALIGNED_BLOCK') return `Não existe nenhum bloco /${item.prefix} alinhado e livre nesta subnet.`;
  return `Só cabem ${item.planned} de ${item.requested} blocos /${item.prefix}; faltam ${item.missing}.`;
}

function segmentDetail(segment: SubnetPlanningSegment) {
  if (segment.status === 'FREE') return segment.cidrs.join(', ');
  if (segment.status === 'PLANNED') return segment.cidrs[0] ?? '';
  const kinds = (segment.kinds ?? []).map((kind) => kindLabel[kind]).join(' · ');
  return segment.label ? `${kinds}: ${segment.label}` : kinds;
}

/** Read-only IPv4 planning: what is free inside a subnet and where aligned child blocks would go. Nothing is written. */
export function SubnetPlanningView({ subnets }: { subnets: Subnet[] }) {
  const [subnetId, setSubnetId] = useState('');
  const [prefix, setPrefix] = useState('');
  const [count, setCount] = useState('');
  const [plan, setPlan] = useState<SubnetPlanning | null>(null);
  const [error, setError] = useState('');
  const selected = subnets.find((item) => item.id === subnetId);
  const parentPrefix = selected ? Number(selected.cidr.split('/')[1]) : 0;
  const prefixOptions = selected && selected.version === 4 ? Array.from({ length: 33 - parentPrefix }, (_, index) => parentPrefix + index) : [];
  useEffect(() => { setPrefix(''); setCount(''); }, [subnetId]);
  useEffect(() => {
    if (!subnetId) { setPlan(null); return; }
    let active = true;
    const requestedCount = count && Number(count) > 0 ? Number(count) : null;
    void getSubnetPlanning(subnetId, { prefix: prefix ? Number(prefix) : null, count: requestedCount })
      .then((data) => { if (active) { setPlan(data); setError(''); } })
      .catch((cause) => { if (active) setError(cause instanceof Error ? cause.message : 'Não foi possível calcular o planeamento.'); });
    return () => { active = false; };
  }, [subnetId, prefix, count]);
  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>Intervalos e endereços livres</h2><p>Consulta o espaço livre de uma subnet IPv4 e pré-visualiza onde ficariam novos blocos alinhados (por exemplo /27 ou ligações ponto a ponto /30 e /31). Nada é gravado.</p></div></div>
    <label>Subnet<select value={subnetId} onChange={(event) => setSubnetId(event.target.value)}><option value="">Seleciona uma subnet</option>{subnets.map((item) => <option key={item.id} value={item.id}>{item.cidr}{item.purpose ? ` · ${item.purpose}` : ''}</option>)}</select></label>
    {prefixOptions.length > 0 && <>
      <label>Tamanho dos blocos<select value={prefix} onChange={(event) => setPrefix(event.target.value)}><option value="">Só ver o espaço livre</option>{prefixOptions.map((value) => <option key={value} value={value}>/{value}{value === 31 ? ' · ponto a ponto (RFC 3021)' : value === 30 ? ' · ponto a ponto' : ''}</option>)}</select></label>
      {prefix && <label>Quantidade<input type="number" min="1" max="1024" step="1" placeholder="Todos os que couberem" value={count} onChange={(event) => setCount(event.target.value)} /></label>}
    </>}
    {error && <div className="ipam-alert error">{error}</div>}
    {plan && <div className="activity-list">
      {plan.message ? <div className="no-data">{plan.message}</div> : <>
        <div className="activity-row"><strong>Intervalo utilizável</strong><span>{plan.usableRange?.start ?? '—'} – {plan.usableRange?.end ?? '—'}</span></div>
        <div className="activity-row"><strong>Utilização</strong><span>{plan.unavailable} / {plan.usableTotal} indisponíveis (inclui subnets filhas e reservas) · {formatIpamPercent(plan.utilizationPercent ?? 0)} · {plan.free} livres</span></div>
        <div className="activity-row"><strong>Broadcast</strong><span>{plan.broadcast}</span></div>
        {plan.scope && <div className="activity-row"><strong>Âmbito</strong><span>{plan.scope.vrfName ? `VRF ${plan.scope.vrfName}` : 'Tabela global (sem VRF)'} · {plan.childSubnets ?? 0} subnets dentro desta</span></div>}
        {plan.addressSpace && (plan.planned?.length ?? 0) > 0 && <div className="activity-row"><strong>Após o plano</strong><span>{plan.addressSpace.taken} ocupados · {plan.addressSpace.planned} planeados · {plan.addressSpace.freeAfterPlan} livres de {plan.addressSpace.total}</span></div>}
        {(plan.shortfalls ?? []).map((item) => <div className="ipam-alert" role="status" key={`${item.prefix}-${item.reason}`}>{shortfallMessage(item)}</div>)}
        {prefix && <>
          <h3>Blocos planeados</h3>
          {(plan.planned ?? []).map((block) => <div className="activity-row" key={block.cidr}><strong>{block.cidr}</strong><span>{block.start} – {block.end}</span><small>{block.usable} utilizáveis</small></div>)}
          {!(plan.planned ?? []).length && <div className="no-data">Nenhum bloco planeado.</div>}
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
  </section>;
}
