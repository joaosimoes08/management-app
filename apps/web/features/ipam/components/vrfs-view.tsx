'use client';

import { useState, type FormEvent } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { ChevronRight, Edit3, Network, Plus, Trash2, X } from 'lucide-react';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { createVrf, deleteVrf, getVrf, listVrfs, updateVrf } from '../api';
import type { Vrf, VrfInput } from '../types';
import { Empty, IpamModal } from './ipam-modal';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { DataTable, type DataTableColumn } from '@/components/data-table/data-table';

type VrfFormState = { id: string; name: string; routeDistinguisher: string; description: string; status: string };
const blankVrf: VrfFormState = { id: '', name: '', routeDistinguisher: '', description: '', status: 'ACTIVE' };

export interface VrfsViewProps {
  siteId: string;
  siteName: string;
  search: string;
  canCreate: boolean;
  canUpdate: boolean;
  canDelete: boolean;
  openSubnet: (id: string) => void;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

const message = (cause: unknown) => (cause instanceof Error ? cause.message : 'Operação falhou.');
const statusLabel = (status: string) => (status === 'ACTIVE' ? 'Ativo' : status === 'INACTIVE' ? 'Inativo' : status);

export function filterVrfs(items: Vrf[], search: string): Vrf[] {
  const term = search.trim().toLowerCase();
  if (!term) return items;
  return items.filter((item) => `${item.name} ${item.routeDistinguisher ?? ''} ${item.description ?? ''}`.toLowerCase().includes(term));
}

/** VRFs of the active Site: table, create/edit/delete and the "subnets in this VRF" drill-down. */
export function VrfsView({ siteId, siteName, search, canCreate, canUpdate, canDelete, openSubnet, success, toastError }: VrfsViewProps) {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  const [form, setForm] = useState<VrfFormState | null>(null);
  const [formError, setFormError] = useState('');
  const [saving, setSaving] = useState(false);
  const [detailId, setDetailId] = useState('');

  const { data, isLoading, error } = useQuery({ queryKey: ['ipam', 'vrfs', siteId], queryFn: () => listVrfs(siteId), enabled: Boolean(siteId) });
  const { data: detail, isLoading: loadingDetail } = useQuery({ queryKey: ['ipam', 'vrf', detailId], queryFn: () => getVrf(detailId), enabled: Boolean(detailId) });
  const items = filterVrfs(data ?? [], search);
  const refresh = () => queryClient.invalidateQueries({ queryKey: ['ipam'] });

  const openForm = (item?: Vrf) => {
    setFormError('');
    setForm(item ? { id: item.id, name: item.name, routeDistinguisher: item.routeDistinguisher ?? '', description: item.description ?? '', status: item.status || 'ACTIVE' } : { ...blankVrf });
  };

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!form) return;
    const editing = Boolean(form.id);
    const operation = editing ? 'Editar VRF' : 'Criar VRF';
    // The API validates PATCH with the full create DTO: always send name and siteId; null clears optional fields.
    const body: VrfInput = { name: form.name.trim(), siteId, status: form.status, routeDistinguisher: form.routeDistinguisher.trim() || (editing ? null : undefined), description: form.description.trim() || (editing ? null : undefined) };
    setSaving(true);
    setFormError('');
    try {
      if (editing) await updateVrf(form.id, body);
      else await createVrf(body);
      setForm(null);
      success(operation, editing ? 'As alterações foram guardadas.' : `O VRF ${body.name} foi criado com sucesso.`);
      await refresh();
    } catch (cause) {
      setFormError(message(cause));
      toastError(operation, message(cause));
    } finally {
      setSaving(false);
    }
  };

  const remove = async (item: Vrf) => {
    const subnetCount = item._count?.subnets ?? 0;
    if (!(await askConfirm({ message: subnetCount ? `O VRF ${item.name} tem ${subnetCount} subnet(s) associada(s). Remove-as do VRF antes de o eliminar. Tentar mesmo assim?` : `Eliminar o VRF ${item.name}?`, destructive: true }))) return;
    try {
      await deleteVrf(item.id);
      if (detailId === item.id) setDetailId('');
      success('Eliminar VRF', `O VRF ${item.name} foi eliminado.`);
      await refresh();
    } catch (cause) {
      toastError('Eliminar VRF', message(cause));
    }
  };

  const columns: DataTableColumn<Vrf>[] = [
    { id: 'name', header: 'Nome', cell: (item) => <><button className="link-button" aria-label={`Ver subnets do VRF ${item.name}`} onClick={() => setDetailId(item.id)}>{item.name}</button>{item.description && <small>{item.description}</small>}</> },
    { id: 'rd', header: 'Route distinguisher', className: 'mono', cell: (item) => item.routeDistinguisher || '—' },
    { id: 'site', header: 'Site', cell: () => siteName },
    { id: 'subnets', header: 'Subnets', cell: (item) => item._count?.subnets ?? 0 },
    { id: 'nat', header: 'Regras NAT', cell: (item) => item._count?.natRules ?? 0 },
    { id: 'status', header: 'Estado', cell: (item) => statusLabel(item.status) },
    { id: 'actions', header: 'Ações', className: 'table-actions', cell: (item) => <>{canUpdate && <button className="icon-button subtle" title={`Editar VRF ${item.name}`} aria-label={`Editar VRF ${item.name}`} onClick={() => openForm(item)}><Edit3 size={14} /></button>}{canDelete && <button className="icon-button subtle danger" title={`Eliminar VRF ${item.name}`} aria-label={`Eliminar VRF ${item.name}`} onClick={() => void remove(item)}><Trash2 size={14} /></button>}</> },
  ];

  return <>{confirmDialog}<section className="ipam-card">
    <div className="panel-heading"><div><h2>VRFs do Site</h2><p className="panel-description">Instâncias de routing do Site e as subnets que pertencem a cada uma.</p></div></div>
    {canCreate && <PageToolbarPortal><button className="primary-button" onClick={() => openForm()}><Plus size={14} /> Novo VRF</button></PageToolbarPortal>}
    {error && <div className="ipam-alert error"><X size={15} />{message(error)}</div>}
    <DataTable rows={items} columns={columns} rowKey={(item) => item.id} label="VRFs do Site" loading={isLoading} skeletonRows={3} empty={!error && <Empty title={search ? 'Sem VRFs correspondentes' : 'Este Site ainda não tem VRFs'} text={search ? 'Experimenta outra pesquisa.' : canCreate ? 'Cria um VRF para separar tabelas de routing neste Site.' : 'Ainda não foram configurados VRFs neste Site.'} />} />

    {detailId && <aside className="host-panel" aria-label="Subnets do VRF">
      <div className="host-panel-head"><div><span className="section-kicker">VRF</span><h2>{detail?.name ?? '…'}</h2><span>{detail?.routeDistinguisher || 'Sem route distinguisher'}</span></div><button className="icon-button" onClick={() => setDetailId('')} aria-label="Fechar"><X size={18} /></button></div>
      {loadingDetail || !detail ? <div className="content-skeleton ip-table-skeleton-line" aria-label="A carregar VRF" aria-busy="true" /> : <>
        <div className="host-detail-grid">
          <div><span>Site</span><strong>{detail.site?.name ?? siteName}</strong></div>
          <div><span>Estado</span><strong>{statusLabel(detail.status)}</strong></div>
          <div><span>Subnets</span><strong>{detail.subnets.length}</strong></div>
          <div><span>Regras NAT</span><strong>{detail.natRules.length}</strong></div>
          <div className="wide"><span>Descrição</span><strong>{detail.description || '—'}</strong></div>
        </div>
        <section className="host-section">
          <h3>Subnets neste VRF</h3>
          {detail.subnets.map((subnet) => <div className="subnet-list-item" key={subnet.id}><button className="subnet-list-row" aria-label={`Abrir subnet ${subnet.cidr}`} onClick={() => { setDetailId(''); openSubnet(subnet.id); }}><Network size={17} /><span><strong>{subnet.cidr}</strong><small>IPv{subnet.version}{subnet.purpose ? ` · ${subnet.purpose}` : ''}{subnet.gateway ? ` · gateway ${subnet.gateway}` : ''}</small></span><ChevronRight size={16} /></button></div>)}
          {!detail.subnets.length && <p className="panel-description">Ainda não existem subnets neste VRF. Associa uma subnet ao VRF ao criá-la ou editá-la no separador Subnets.</p>}
        </section>
      </>}
    </aside>}

    {form && <IpamModal title={form.id ? 'Editar VRF' : 'Criar VRF'} close={() => setForm(null)}><form className="modal-form" onSubmit={(event) => void submit(event)}>
      {formError && <div className="ipam-alert error" role="alert"><X size={15} />{formError}</div>}
      <label>Nome<input required maxLength={100} value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Route distinguisher<input maxLength={80} placeholder="65000:100" aria-describedby="vrf-rd-help" value={form.routeDistinguisher} onChange={(event) => setForm({ ...form, routeDistinguisher: event.target.value })} /><small id="vrf-rd-help">Formato ASN:número ou IP:número, por exemplo 65000:100.</small></label>
      <label>Descrição<input maxLength={240} value={form.description} onChange={(event) => setForm({ ...form, description: event.target.value })} /></label>
      <label>Estado<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}><option value="ACTIVE">Ativo</option><option value="INACTIVE">Inativo</option></select></label>
      <button className="primary-button" disabled={saving}>{saving ? 'A guardar…' : form.id ? 'Guardar alterações' : 'Criar VRF'}</button>
    </form></IpamModal>}
  </section></>;
}
