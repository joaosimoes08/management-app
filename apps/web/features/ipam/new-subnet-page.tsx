'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Network } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { listSites, listVlans, createSubnet } from './api';
import type { Site, SubnetInput, Vlan } from './types';

export default function NewSubnetPage() {
  const [sites, setSites] = useState<Site[]>([]);
  const [vlans, setVlans] = useState<Vlan[]>([]);
  const [siteId, setSiteId] = useState('');
  const [form, setForm] = useState<SubnetInput>({ cidr: '', version: 4, vlanId: '', gateway: '', purpose: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const id = query.get('siteId') || localStorage.getItem('cociber.siteId') || '';
    setSiteId(id);
    void listSites().then((response) => setSites(response.items ?? []));
    if (id) void listVlans(id).then((response) => setVlans(response.items ?? []));
  }, []);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    try {
      await createSubnet({ ...form, siteId, version: Number(form.version), vlanId: form.vlanId || undefined, gateway: form.gateway || undefined });
      location.href = `/ipam?siteId=${siteId}&tab=subnets`;
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a subnet.');
    }
  };

  return <AppShell section="IPAM"><main className="ipam-workspace"><a className="text-button" href={`/ipam?siteId=${siteId}&tab=subnets`}><ArrowLeft size={14} /> Voltar às subnets</a><section className="ipam-card setup-card"><div className="panel-heading"><div><span className="section-kicker">IP ADDRESS MANAGEMENT</span><h1>Nova subnet</h1><p>Associa a subnet ao Site e, opcionalmente, a uma VLAN.</p></div><Network size={22} /></div>{error && <div className="ipam-alert error">{error}</div>}<form className="modal-form" onSubmit={submit}><label>Site<select required value={siteId} onChange={(event) => { setSiteId(event.target.value); void listVlans(event.target.value).then((response) => setVlans(response.items ?? [])); }}><option value="">Seleciona um Site</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}</select></label><label>CIDR<input required placeholder="10.10.10.0/24 ou 2001:db8::/64" value={form.cidr} onChange={(event) => setForm({ ...form, cidr: event.target.value })} /></label><label>Versão<select value={form.version} onChange={(event) => setForm({ ...form, version: Number(event.target.value) })}><option value="4">IPv4</option><option value="6">IPv6</option></select></label><label>VLAN<select value={form.vlanId} onChange={(event) => setForm({ ...form, vlanId: event.target.value })}><option value="">Sem VLAN por agora</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label><label>Gateway<input value={form.gateway} onChange={(event) => setForm({ ...form, gateway: event.target.value })} /></label><label>Finalidade<input value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label><button className="primary-button"><Check size={14} /> Criar subnet</button></form></section></main></AppShell>;
}
