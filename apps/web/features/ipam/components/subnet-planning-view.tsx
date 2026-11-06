'use client';

import { useEffect, useState } from 'react';
import type { Subnet } from '../types';
import { getSubnetPlanning, type SubnetPlanning } from '../api';

export function SubnetPlanningView({ subnets }: { subnets: Subnet[] }) {
  const [subnetId, setSubnetId] = useState('');
  const [plan, setPlan] = useState<SubnetPlanning | null>(null);
  const [error, setError] = useState('');
  useEffect(() => { if (!subnetId) { setPlan(null); return; } void getSubnetPlanning(subnetId).then((data) => { setPlan(data); setError(''); }).catch((cause) => setError(cause instanceof Error ? cause.message : 'Não foi possível calcular o planeamento.')); }, [subnetId]);
  return <section className="ipam-card">
    <div className="panel-heading"><div><span className="section-kicker">PLANEAMENTO DE ENDEREÇOS</span><h2>Intervalos e endereços livres</h2><p>Consulta o espaço utilizável de uma subnet IPv4 e os intervalos ainda livres.</p></div></div>
    <label>Subnet<select value={subnetId} onChange={(event) => setSubnetId(event.target.value)}><option value="">Seleciona uma subnet</option>{subnets.map((item) => <option key={item.id} value={item.id}>{item.cidr}{item.purpose ? ` · ${item.purpose}` : ''}</option>)}</select></label>
    {error && <div className="ipam-alert error">{error}</div>}
    {plan && <div className="activity-list">
      {plan.message ? <div className="no-data">{plan.message}</div> : <>
        <div className="activity-row"><strong>Intervalo utilizável</strong><span>{plan.usableRange?.start ?? '—'} – {plan.usableRange?.end ?? '—'}</span></div>
        <div className="activity-row"><strong>Utilização</strong><span>{plan.unavailable} / {plan.usableTotal} indisponíveis (inclui reservas) · {plan.utilizationPercent ?? 0}% · {plan.free} livres</span></div>
        <div className="activity-row"><strong>Broadcast</strong><span>{plan.broadcast}</span></div>
        <h3>Gaps utilizáveis</h3>
        {plan.usableGaps.map((gap) => <div className="activity-row" key={`${gap.start}-${gap.end}`}><span>{gap.start} – {gap.end}</span><small>{gap.count} endereços</small></div>)}
        {!plan.usableGaps.length && <div className="no-data">Não existem gaps utilizáveis nesta subnet.</div>}
      </>}
    </div>}
  </section>;
}
