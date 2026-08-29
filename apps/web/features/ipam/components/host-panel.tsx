'use client';

import { useEffect, useState, type FormEvent } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import {
  createService,
  deleteHost,
  deleteService,
  unlinkHostIpAddress,
  updateHost,
} from '../api';
import type { HostDetail, ServiceInput } from '../types';
type ServiceFormState = Omit<ServiceInput, 'port' | 'hostId'> & { port: string | number };

const emptyService: ServiceFormState = { name: '', protocol: 'TCP', port: '', status: 'UNKNOWN', version: '', notes: '' };

export interface HostPanelProps {
  host: HostDetail;
  canEdit: boolean;
  close: () => void;
  reload: () => Promise<void>;
  success: (operation: string, message: string) => void;
  toastError: (operation: string, message: string) => void;
}

type HostFormState = {
  name: string;
  hostname: string;
  operatingSystem: string;
  macAddress: string;
  notes: string;
  status: string;
};

/** Host detail side panel: identity, IPs/VLANs relations and services. */
export function HostPanel({ host, canEdit, close, reload, success, toastError }: HostPanelProps) {
  const [form, setForm] = useState<HostFormState>({ name: host.name, hostname: host.hostname ?? '', operatingSystem: host.operatingSystem ?? '', macAddress: host.macAddress ?? '', notes: host.notes ?? '', status: host.status });
  const [service, setService] = useState<ServiceFormState>(emptyService);
  const [editing, setEditing] = useState(false);
  useEffect(() => setForm({ name: host.name, hostname: host.hostname ?? '', operatingSystem: host.operatingSystem ?? '', macAddress: host.macAddress ?? '', notes: host.notes ?? '', status: host.status }), [host]);

  const act = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
      success(title, 'Operação concluída.');
      await reload();
    } catch (error) {
      toastError(title, error instanceof Error ? error.message : 'Operação falhou.');
    }
  };

  const saveHost = (event: FormEvent) => {
    event.preventDefault();
    void act('Editar Host', () => updateHost(host.id, {
      name: form.name,
      hostname: form.hostname || undefined,
      operatingSystem: form.operatingSystem || undefined,
      macAddress: form.macAddress || undefined,
      notes: form.notes || undefined,
      status: form.status,
    }).then(() => setEditing(false)));
  };

  const createServiceHandler = (event: FormEvent) => {
    event.preventDefault();
    void act('Criar Service', () => createService({
      name: service.name,
      protocol: service.protocol,
      status: service.status,
      version: service.version,
      notes: service.notes,
      hostId: host.id,
      port: service.protocol === 'OTHER' || !service.port ? undefined : Number(service.port),
    }).then(() => setService(emptyService)));
  };

  return <aside className="host-panel" aria-label="Ficha do Host">
    <div className="host-panel-head"><div><span className="section-kicker">FICHA OPERACIONAL</span><h2>{host.name}</h2><span>{host.hostname || host.observedHostname || 'Sem hostname'}</span></div><button className="icon-button" onClick={close} aria-label="Fechar"><X size={18} /></button></div>
    <div className="host-status-line"><span>Manual: <strong>{host.status}</strong></span><span>Observado: <strong>{host.observedStatus || '—'}</strong></span><span>Origem: <strong>{host.source}</strong></span><span>Último avistamento: <strong>{host.lastSeenAt ? new Date(host.lastSeenAt).toLocaleString() : '—'}</strong></span></div>
    {editing ? <form className="modal-form host-edit-form" onSubmit={saveHost}>
      <label>Nome<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Hostname<input value={form.hostname || ''} onChange={(event) => setForm({ ...form, hostname: event.target.value })} /></label>
      <label>Sistema operativo<input value={form.operatingSystem || ''} onChange={(event) => setForm({ ...form, operatingSystem: event.target.value })} /></label>
      <label>MAC<input value={form.macAddress || ''} onChange={(event) => setForm({ ...form, macAddress: event.target.value })} /></label>
      <label>Estado<select value={form.status} onChange={(event) => setForm({ ...form, status: event.target.value })}>{['UNKNOWN', 'ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED'].map((status) => <option key={status}>{status}</option>)}</select></label>
      <label>Notas<textarea value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>Cancelar</button><button className="primary-button">Guardar</button></div>
    </form> : <>
      <div className="host-detail-grid">
        <div><span>SO</span><strong>{host.operatingSystem || '—'}</strong></div>
        <div><span>MAC</span><strong>{host.macAddress || '—'}</strong></div>
        <div className="wide"><span>Notas</span><strong>{host.notes || '—'}</strong></div>
        <div className="wide"><span>Device / localização</span><strong>{host.device ? `${host.device.name} · ${host.device.model?.manufacturer || ''} ${host.device.model?.model || ''} · ${host.device.rack?.room?.building?.name || 'sem localização'} / ${host.device.rack?.room?.name || '—'} / ${host.device.rack?.name || '—'}` : 'Não associado'}</strong></div>
      </div>
      {canEdit && <div className="form-actions">
        <button className="secondary-button" onClick={() => setEditing(true)}><Edit3 size={14} /> Editar</button>
        <button className="secondary-button danger" onClick={() => confirm('Retirar este Host?') && void act('Retirar Host', () => deleteHost(host.id))}>Retirar</button>
      </div>}
    </>}
    <section className="host-section">
      <h3>IPs, VLANs, subnets e interfaces</h3>
      {host.ipAddresses.map((ip) => <article className="host-relation" key={ip.id}>
        <div><strong className="mono">{ip.address}</strong><span>{ip.subnet?.site?.name} · VLAN {ip.subnet?.vlan?.vlanId ?? '—'} · {ip.subnet?.cidr}</span><small>{ip.interface ? `${ip.interface.device?.name} / ${ip.interface.name}` : 'Sem interface associada'}</small></div>
        {canEdit && <button className="icon-button subtle danger" title="Desassociar IP" onClick={() => void act('Desassociar IP', () => unlinkHostIpAddress(host.id, ip.id))}><X size={14} /></button>}
      </article>)}
    </section>
    <section className="host-section">
      <h3>Services</h3>
      {host.services.map((item) => <article className="service-row" key={item.id}>
        <div><strong>{item.name}</strong><span>{item.protocol || 'OTHER'} {item.port ? `:${item.port}` : ''} · manual {item.status || 'UNKNOWN'} · observado {item.observedStatus || '—'}</span><small>{item.version || ''}{item.notes ? ` · ${item.notes}` : ''} · {item.source}</small></div>
        {canEdit && <button className="icon-button subtle danger" title="Eliminar Service" onClick={() => confirm(`Eliminar ${item.name}?`) && void act('Eliminar Service', () => deleteService(item.id))}><Trash2 size={14} /></button>}
      </article>)}
      {canEdit && <form className="service-form" onSubmit={createServiceHandler}>
        <input required placeholder="Nome do serviço" value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })} />
        <select value={service.protocol} onChange={(event) => setService({ ...service, protocol: event.target.value })}><option>TCP</option><option>UDP</option><option>OTHER</option></select>
        <input type="number" min="1" max="65535" required={service.protocol !== 'OTHER'} disabled={service.protocol === 'OTHER'} placeholder="Porta" value={service.port} onChange={(event) => setService({ ...service, port: event.target.value })} />
        <input placeholder="Versão" value={service.version} onChange={(event) => setService({ ...service, version: event.target.value })} />
        <button className="primary-button"><Plus size={14} /> Service</button>
      </form>}
    </section>
  </aside>;
}
