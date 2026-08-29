'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { ChevronLeft, ChevronRight, Search } from 'lucide-react';
import { Modal } from '@/components/ui/modal';
import type { DeviceInterface, InterfaceInput, Vlan } from '../../types';

export type InterfaceFormState = Omit<InterfaceInput, 'speedMbps'> & {
  id: string;
  speedMbps: string | number;
};

export interface InterfaceEditorProps {
  modal: string;
  close: () => void;
  form: { interface: InterfaceFormState };
  setForm: { interface: React.Dispatch<React.SetStateAction<InterfaceFormState>> };
  vlans: Vlan[];
  save: (path: string, body: Record<string, unknown>, method: string) => Promise<void>;
}

/** Interface configuration modal: mode, VLANs (access/native/allowed) and speed. */
export function InterfaceEditor({ modal, close, form, setForm, vlans, save }: InterfaceEditorProps) {
  const [vlanSearch, setVlanSearch] = useState('');
  const [vlanPage, setVlanPage] = useState(0);

  useEffect(() => {
    if (modal === 'interface') {
      setVlanSearch('');
      setVlanPage(0);
    }
  }, [modal, form.interface?.id]);

  if (modal !== 'interface') return null;
  const update = (patch: Partial<InterfaceFormState>) => setForm.interface({ ...form.interface, ...patch });
  const mode = form.interface.mode || 'ACCESS';
  const vlanPageSize = 12;
  const filteredVlans = vlans.filter((vlan) => {
    const query = vlanSearch.trim().toLocaleLowerCase();
    return !query || `${vlan.vlanId} ${vlan.name ?? ''}`.toLocaleLowerCase().includes(query);
  });
  const vlanPageCount = Math.max(1, Math.ceil(filteredVlans.length / vlanPageSize));
  const activeVlanPage = Math.min(vlanPage, vlanPageCount - 1);
  const visibleVlans = filteredVlans.slice(activeVlanPage * vlanPageSize, (activeVlanPage + 1) * vlanPageSize);

  const submit = (event: FormEvent) => {
    event.preventDefault();
    const data = {
      ...form.interface,
      accessVlanId: mode === 'ACCESS' ? (form.interface.accessVlanId || null) : null,
      nativeVlanId: mode === 'TRUNK' ? (form.interface.nativeVlanId || null) : null,
      allowedVlanIds: mode === 'TRUNK' ? (form.interface.allowedVlanIds ?? []).filter(Boolean) : [],
      speedMbps: form.interface.speedMbps ? Number(form.interface.speedMbps) : null,
    };
    const { id, device: _device, ...payload } = data as InterfaceFormState & { device?: unknown };
    void save(`/api/v1/interfaces/${id}`, payload, 'PATCH');
  };

  return <Modal title={`Configurar interface ${form.interface.name}`} close={close}><form className="modal-form" onSubmit={submit}><label>Nome<input required value={form.interface.name ?? ''} onChange={(event) => update({ name: event.target.value })} /></label><div className="form-row"><label>Port key<input value={form.interface.portKey ?? ''} onChange={(event) => update({ portKey: event.target.value })} /></label><label>Tipo<select value={form.interface.interfaceType ?? 'ETHERNET'} onChange={(event) => update({ interfaceType: event.target.value })}><option>FAST_ETHERNET</option><option>ETHERNET</option><option>GIGABIT_ETHERNET</option><option>SFP</option><option>SFP_PLUS</option><option>QSFP</option><option>MANAGEMENT</option><option>CONSOLE</option><option>FIBRE_CHANNEL</option><option>OTHER</option></select></label></div><label>Descrição<input value={form.interface.description ?? ''} onChange={(event) => update({ description: event.target.value })} /></label><div className="form-row"><label>Modo<select value={mode} onChange={(event) => update({ mode: event.target.value, accessVlanId: '', nativeVlanId: '', allowedVlanIds: [] })}><option>ACCESS</option><option>TRUNK</option><option>ROUTED</option></select></label><label>Velocidade Mbps<input type="number" value={form.interface.speedMbps ?? ''} onChange={(event) => update({ speedMbps: event.target.value })} /></label></div>{mode === 'ACCESS' && <label>VLAN access<select value={form.interface.accessVlanId ?? ''} onChange={(event) => update({ accessVlanId: event.target.value })}><option value="">Sem VLAN</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label>}{mode === 'TRUNK' && <><label>VLAN nativa<select value={form.interface.nativeVlanId ?? ''} onChange={(event) => update({ nativeVlanId: event.target.value })}><option value="">Sem VLAN</option>{vlans.map((vlan) => <option key={vlan.id} value={vlan.id}>VLAN {vlan.vlanId} · {vlan.name}</option>)}</select></label><div className="vlan-allowed-heading"><span>VLANs permitidas</span><div className="vlan-search-actions"><div className="vlan-search-slide open"><Search size={13} /><input aria-label="Pesquisar VLANs" placeholder="Pesquisar por número ou nome" value={vlanSearch} onChange={(event) => { setVlanSearch(event.target.value); setVlanPage(0); }} /></div></div></div><div className="multi-select-list">{visibleVlans.map((vlan) => <label key={vlan.id}><input type="checkbox" checked={(form.interface.allowedVlanIds ?? []).includes(vlan.id)} onChange={(event) => update({ allowedVlanIds: event.target.checked ? [...(form.interface.allowedVlanIds ?? []), vlan.id] : (form.interface.allowedVlanIds ?? []).filter((id) => id !== vlan.id) })} /><span className="vlan-option-text">{vlan.name}</span></label>)}{!visibleVlans.length && <span className="vlan-search-empty">Nenhuma VLAN encontrada.</span>}</div><div className="vlan-pagination"><button type="button" className="icon-button subtle" aria-label="Página anterior" disabled={activeVlanPage === 0} onClick={() => setVlanPage(activeVlanPage - 1)}><ChevronLeft size={14} /></button><span>Página {activeVlanPage + 1} de {vlanPageCount}</span><button type="button" className="icon-button subtle" aria-label="Página seguinte" disabled={activeVlanPage >= vlanPageCount - 1} onClick={() => setVlanPage(activeVlanPage + 1)}><ChevronRight size={14} /></button></div></>}<div className="modal-actions"><button type="button" className="secondary-button" onClick={close}>Cancelar</button><button type="submit" className="primary-button">Guardar configuração</button></div></form></Modal>;
}
