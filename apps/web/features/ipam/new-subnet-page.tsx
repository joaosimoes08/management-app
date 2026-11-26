'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ArrowLeft, Check, Network } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { listSites, listVlans, createSubnet } from './api';
import type { Site, SubnetInput, Vlan } from './types';
import { STORAGE_KEYS, getLocalItem } from '@/lib/storage-keys';
import { useUiText } from '@/components/ui/use-ui-text';

export default function NewSubnetPage() {
  const ui = useUiText();
  const [sites, setSites] = useState<Site[]>([]);
  const [vlans, setVlans] = useState<Vlan[]>([]);
  const [siteId, setSiteId] = useState('');
  const [form, setForm] = useState<SubnetInput>({ cidr: '', version: 4, vlanId: '', gateway: '', purpose: '' });
  const [error, setError] = useState('');

  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const id = query.get('siteId') || getLocalItem(STORAGE_KEYS.siteId) || '';
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
      setError(cause instanceof Error ? cause.message : ui('ipam.newSubnet.createError'));
    }
  };

  return <AppShell section="IPAM" actions={<a className="secondary-button" href={`/ipam?siteId=${siteId}&tab=subnets`}><ArrowLeft size={14} /> {ui('ipam.newSubnet.back')}</a>}><div className="ipam-workspace"><section className="ipam-card setup-card"><div className="panel-heading"><div><h1>{ui('ipam.newSubnet.title')}</h1><p>{ui('ipam.newSubnet.description')}</p></div><Network size={22} /></div>{error && <div className="ipam-alert error">{error}</div>}<form className="modal-form" onSubmit={submit}><label>Site<select required value={siteId} onChange={(event) => { setSiteId(event.target.value); void listVlans(event.target.value).then((response) => setVlans(response.items ?? [])); }}><option value="">{ui('ipam.newSubnet.chooseSite')}</option>{sites.map((site) => <option key={site.id} value={site.id}>{site.name} · {site.code}</option>)}</select></label><label>CIDR<input required placeholder={ui('ipam.page.cidrPlaceholder')} value={form.cidr} onChange={(event) => setForm({ ...form, cidr: event.target.value })} /></label><label>{ui('ipam.newSubnet.version')}<select value={form.version} onChange={(event) => setForm({ ...form, version: Number(event.target.value) })}><option value="4">IPv4</option><option value="6">IPv6</option></select></label><label>VLAN<select value={form.vlanId} onChange={(event) => setForm({ ...form, vlanId: event.target.value })}><option value="">{ui('ipam.page.noVlanYet')}</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label><label>Gateway<input value={form.gateway} onChange={(event) => setForm({ ...form, gateway: event.target.value })} /></label><label>{ui('ipam.newSubnet.purpose')}<input value={form.purpose} onChange={(event) => setForm({ ...form, purpose: event.target.value })} /></label><button className="primary-button"><Check size={14} /> {ui('ipam.newSubnet.create')}</button></form></section></div></AppShell>;
}
