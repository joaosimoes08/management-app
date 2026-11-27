'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { createNatRule, deleteNatRule, listNatRules, listVrfs, updateNatRule } from '../api';
import type { NatRule, NatRuleInput, NatRuleType, Subnet } from '../types';
import { Empty } from './ipam-modal';
import { CompactModal } from '@/components/ui/compact-modal';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';
import { useUiText } from '@/components/ui/use-ui-text';
import { ipamText } from '../i18n';

export const natTypeLabels: Record<NatRuleType, string> = { get SNAT() { return ipamText('ipam.nat.type.SNAT'); }, get DNAT() { return ipamText('ipam.nat.type.DNAT'); }, get STATIC_1_TO_1() { return ipamText('ipam.nat.type.STATIC_1_TO_1'); }, PAT: 'PAT' };
const natTypes = Object.keys(natTypeLabels) as NatRuleType[];

type NatFormState = {
  id: string; name: string; type: NatRuleType; protocol: string;
  sourceAddress: string; sourcePort: string; translatedAddress: string; translatedPort: string; destinationPort: string;
  sourceSubnetId: string; vrfId: string; enabled: boolean; description: string;
  /** Labels of the rule's current links, so they stay selectable even when the Site lists do not include them. */
  currentSubnetLabel: string; currentVrfLabel: string;
};
const blankNat: NatFormState = { id: '', name: '', type: 'SNAT', protocol: '', sourceAddress: '', sourcePort: '', translatedAddress: '', translatedPort: '', destinationPort: '', sourceSubnetId: '', vrfId: '', enabled: true, description: '', currentSubnetLabel: '', currentVrfLabel: '' };

export interface NatViewProps {
  siteId: string;
  siteName: string;
  search: string;
  subnets: Subnet[];
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Operação falhou.');
const endpoint = (address?: string | null, port?: number | null) => `${address || ipamText('ipam.nat.any')}${port ? `:${port}` : ''}`;
export const natInside = (rule: NatRule) => endpoint(rule.sourceAddress || rule.sourceIp?.address || rule.sourceSubnet?.cidr, rule.sourcePort);
export const natOutside = (rule: NatRule) => endpoint(rule.translatedAddress || rule.translatedIp?.address || rule.translatedSubnet?.cidr, rule.translatedPort);

export function filterNatRules(items: NatRule[], search: string): NatRule[] {
  const term = search.trim().toLowerCase();
  if (!term) return items;
  return items.filter((rule) => `${rule.name} ${rule.description ?? ''} ${natInside(rule)} ${natOutside(rule)} ${rule.vrf?.name ?? ''} ${rule.device?.name ?? ''}`.toLowerCase().includes(term));
}

/** NAT rules of the active Site: filters by type/VRF, table and create/edit/delete with API validation messages. */
export function NatView({ siteId, siteName, search, subnets, canCreate, canUpdate, canDelete, success, toastError }: NatViewProps) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [type, setType] = useState<NatRuleType | ''>('');
  const [vrfId, setVrfId] = useState('');
  const [form, setForm] = useState<NatFormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);

  const { data, isLoading, error } = useQuery({ queryKey: ['ipam', 'nat-rules', siteId, type, vrfId], queryFn: () => listNatRules(siteId, { type, vrfId }), enabled: Boolean(siteId) });
  const { data: vrfs } = useQuery({ queryKey: ['ipam', 'vrfs', siteId], queryFn: () => listVrfs(siteId), enabled: Boolean(siteId) });
  const items = filterNatRules(data ?? [], search);
  const filtered = Boolean(search || type || vrfId);

  const openForm = (rule?: NatRule) => {
    setFormError('');
    setForm(rule ? {
      id: rule.id, name: rule.name, type: rule.type, protocol: rule.protocol ?? '',
      sourceAddress: rule.sourceAddress ?? '', sourcePort: rule.sourcePort ? String(rule.sourcePort) : '',
      translatedAddress: rule.translatedAddress ?? '', translatedPort: rule.translatedPort ? String(rule.translatedPort) : '',
      destinationPort: rule.destinationPort ? String(rule.destinationPort) : '', sourceSubnetId: rule.sourceSubnetId ?? '', vrfId: rule.vrfId ?? '',
      enabled: rule.enabled, description: rule.description ?? '',
      currentSubnetLabel: rule.sourceSubnet?.cidr ?? rule.sourceSubnetId ?? '', currentVrfLabel: rule.vrf?.name ?? rule.vrfId ?? '',
    } : { ...blankNat, vrfId });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const editing = Boolean(form.id);
    const operation = editing ? 'Editar regra NAT' : 'Criar regra NAT';
    // Empty optional fields: omitted on create, null on edit so they are cleared. Ports are sent as numbers and validated by the API.
    const optional = (value: string) => value.trim() || (editing ? null : undefined);
    const port = (value: string) => (value.trim() ? Number(value) : editing ? null : undefined);
    const body: NatRuleInput = {
      name: form.name.trim(), type: form.type, siteId, enabled: form.enabled,
      protocol: optional(form.protocol), sourceAddress: optional(form.sourceAddress), translatedAddress: optional(form.translatedAddress),
      sourcePort: port(form.sourcePort), translatedPort: port(form.translatedPort), destinationPort: port(form.destinationPort),
      sourceSubnetId: optional(form.sourceSubnetId), vrfId: optional(form.vrfId), description: optional(form.description),
    };
    setSaving(true);
    setFormError('');
    try {
      if (editing) await updateNatRule(form.id, body);
      else await createNatRule(body);
      setForm(null);
      success(operation, editing ? 'As alterações foram guardadas.' : ui('ipam.nat.created', undefined, { name: body.name }));
      await queryClient.invalidateQueries({ queryKey: ['ipam'] });
    } catch (cause) {
      setFormError(message(cause));
      toastError(operation, message(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (rule: NatRule) => {
    if (!(await askConfirm({ message: ui('ipam.nat.deleteConfirm', undefined, { name: rule.name }), destructive: true }))) return;
    try {
      await deleteNatRule(rule.id);
      success('Eliminar regra NAT', ui('ipam.nat.deleted', undefined, { name: rule.name }));
      await queryClient.invalidateQueries({ queryKey: ['ipam'] });
    } catch (cause) {
      toastError('Eliminar regra NAT', message(cause));
    }
  };

  const columns: DataTableColumn<NatRule>[] = [
    { id: 'name', header: 'Nome', cell: (rule) => <><strong>{rule.name}</strong>{rule.description && <small>{rule.description}</small>}</> },
    { id: 'type', header: 'Tipo', cell: (rule) => natTypeLabels[rule.type] ?? rule.type },
    { id: 'addresses', header: 'Interno ↔ Externo', className: 'mono', cell: (rule) => <>{natInside(rule)} ↔ {natOutside(rule)}{rule.destinationPort ? <small>porta de destino {rule.destinationPort}</small> : null}</> },
    { id: 'protocol', header: 'Protocolo', cell: (rule) => rule.protocol || 'Qualquer' },
    { id: 'vrf', header: 'VRF', cell: (rule) => rule.vrf?.name || '—' },
    { id: 'site', header: 'Site', cell: () => siteName },
    { id: 'status', header: 'Estado', cell: (rule) => (rule.enabled ? 'Ativa' : 'Desativada') },
    { id: 'actions', header: 'Ações', className: 'table-actions', cell: (rule) => <>{canUpdate && <button className="icon-button subtle" title={ui('ipam.nat.editRule', undefined, { name: rule.name })} aria-label={ui('ipam.nat.editRule', undefined, { name: rule.name })} onClick={() => openForm(rule)}><Edit3 size={14} /></button>}{canDelete && <button className="icon-button subtle danger" title={ui('ipam.nat.deleteRule', undefined, { name: rule.name })} aria-label={ui('ipam.nat.deleteRule', undefined, { name: rule.name })} onClick={() => void remove(rule)}><Trash2 size={14} /></button>}</> },
  ];

  return <>{confirmDialog}<section className="ipam-card">
    <div className="panel-heading"><div><h2>Regras NAT do Site</h2><p className="panel-description">Traduções entre endereços internos e externos, por tipo e VRF.</p></div></div>
    <PageToolbarPortal>
      <select className="context-toolbar-selector" aria-label={ui('ipam.nat.filterType')} value={type} onChange={(event) => setType(event.target.value as NatRuleType | '')}><option value="">Todos os tipos</option>{natTypes.map((value) => <option key={value} value={value}>{natTypeLabels[value]}</option>)}</select>
      <select className="context-toolbar-selector" aria-label={ui('ipam.nat.filterVrf')} value={vrfId} onChange={(event) => setVrfId(event.target.value)}><option value="">Todos os VRFs</option>{(vrfs ?? []).map((vrf) => <option key={vrf.id} value={vrf.id}>{vrf.name}</option>)}</select>
      {canCreate && <button className="primary-button" onClick={() => openForm()}><Plus size={14} /> Nova regra NAT</button>}
    </PageToolbarPortal>
    {error && <div className="ipam-alert error"><X size={15} />{message(error)}</div>}
    <DataTable rows={items} columns={columns} rowKey={(rule) => rule.id} label="Regras NAT do Site" loading={isLoading} skeletonRows={3} empty={!error && <Empty title={filtered ? 'Sem regras NAT correspondentes' : 'Este Site ainda não tem regras NAT'} text={filtered ? 'Experimenta outra pesquisa ou limpa os filtros.' : canCreate ? 'Cria a primeira regra NAT deste Site.' : 'Ainda não foram configuradas regras NAT neste Site.'} />} />

    {form && <CompactModal title={form.id ? 'Editar regra NAT' : 'Criar regra NAT'} close={() => setForm(null)}><form className="modal-form" onSubmit={(event) => void submit(event)}>
      {formError && <div className="ipam-alert error" role="alert"><X size={15} />{formError}</div>}
      <label>Nome<input required maxLength={120} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Tipo<select value={form.type} onChange={(event) => setForm({ ...form, type: event.target.value as NatRuleType })}>{natTypes.map((value) => <option key={value} value={value}>{natTypeLabels[value]}</option>)}</select></label>
      <label>Protocolo<select value={form.protocol} onChange={(event) => setForm({ ...form, protocol: event.target.value })}><option value="">Qualquer</option><option value="TCP">TCP</option><option value="UDP">UDP</option><option value="ICMP">ICMP</option></select></label>
      <label>Endereço interno<input placeholder={ui('ipam.nat.insidePlaceholder')} value={form.sourceAddress} onChange={(event) => setForm({ ...form, sourceAddress: event.target.value })} /></label>
      <label>Porta interna<input type="number" value={form.sourcePort} onChange={(event) => setForm({ ...form, sourcePort: event.target.value })} /></label>
      <label>Endereço externo<input placeholder="203.0.113.10" value={form.translatedAddress} onChange={(event) => setForm({ ...form, translatedAddress: event.target.value })} /></label>
      <label>Porta externa<input type="number" value={form.translatedPort} onChange={(event) => setForm({ ...form, translatedPort: event.target.value })} /></label>
      <label>Porta de destino<input type="number" value={form.destinationPort} onChange={(event) => setForm({ ...form, destinationPort: event.target.value })} /></label>
      <label>Subnet interna<select value={form.sourceSubnetId} onChange={(event) => setForm({ ...form, sourceSubnetId: event.target.value })}><option value="">Sem subnet associada</option>{form.sourceSubnetId && !subnets.some((subnet) => subnet.id === form.sourceSubnetId) && <option value={form.sourceSubnetId}>{form.currentSubnetLabel || form.sourceSubnetId}</option>}{subnets.map((subnet) => <option key={subnet.id} value={subnet.id}>{subnet.cidr}</option>)}</select></label>
      <label>VRF<select value={form.vrfId} onChange={(event) => setForm({ ...form, vrfId: event.target.value })}><option value="">Sem VRF</option>{form.vrfId && !(vrfs ?? []).some((vrf) => vrf.id === form.vrfId) && <option value={form.vrfId}>{form.currentVrfLabel || form.vrfId}</option>}{(vrfs ?? []).map((vrf) => <option key={vrf.id} value={vrf.id}>{vrf.name}</option>)}</select></label>
      <label>Descrição<textarea maxLength={500} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label className="settings-check"><input type="checkbox" checked={form.enabled} onChange={(event) => setForm({ ...form, enabled: event.target.checked })} /> Regra ativa</label>
      <button className="primary-button" disabled={saving}>{saving ? 'A guardar…' : form.id ? 'Guardar alterações' : 'Criar regra NAT'}</button>
    </form></CompactModal>}
  </section></>;
}
