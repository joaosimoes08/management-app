'use client';

import { useEscapeClose } from '@/components/ui/use-escape-close';
import { useEffect, useState, type FormEvent } from 'react';
import { Edit3, Plus, Trash2, X } from 'lucide-react';
import { BookStackContextLink } from '@/features/runbooks/bookstack-context-link';
import {
  createService,
  deleteHost,
  deleteService,
  unlinkHostIpAddress,
  updateHost,
  updateService,
} from '../api';
import type { AssetStatus } from '@/features/infrastructure/types';
import type { HostDetail, Service, ServiceInput } from '../types';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { formatDateTime } from '@/lib/format/date';
import { useUiText } from '@/components/ui/use-ui-text';
import { ASSET_STATUSES, SERVICE_STATUSES, hostStatusLabel, isAssetStatus, isServiceStatus, observedStatusLabel, sourceLabel } from '../ip-state';
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
  status: AssetStatus;
};

/** Host detail side panel: identity, IPs/VLANs relations and services. */
export function HostPanel({ host, canEdit, close, reload, success, toastError }: HostPanelProps) {
  const ui = useUiText();
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  useEscapeClose(close);
  const [form, setForm] = useState<HostFormState>({ name: host.name, hostname: host.hostname ?? '', operatingSystem: host.operatingSystem ?? '', macAddress: host.macAddress ?? '', notes: host.notes ?? '', status: host.status });
  const [service, setService] = useState<ServiceFormState>(emptyService);
  const [editingServiceId, setEditingServiceId] = useState('');
  const [editing, setEditing] = useState(false);
  useEffect(() => setForm({ name: host.name, hostname: host.hostname ?? '', operatingSystem: host.operatingSystem ?? '', macAddress: host.macAddress ?? '', notes: host.notes ?? '', status: host.status }), [host]);

  const act = async (title: string, action: () => Promise<unknown>) => {
    try {
      await action();
      success(title, ui('ipam.common.operationDone'));
      await reload();
    } catch (error) {
      toastError(title, error instanceof Error ? error.message : ui('ipam.common.operationFailed'));
    }
  };

  const saveHost = (event: FormEvent) => {
    event.preventDefault();
    void act(ui('ipam.hostView.editTitle'), () => updateHost(host.id, {
      name: form.name,
      hostname: form.hostname || null,
      operatingSystem: form.operatingSystem || null,
      macAddress: form.macAddress || null,
      notes: form.notes || null,
      status: form.status,
    }).then(() => setEditing(false)));
  };

  const createServiceHandler = (event: FormEvent) => {
    event.preventDefault();
    void act(ui('ipam.hostView.createServiceTitle'), () => createService({
      name: service.name,
      protocol: service.protocol,
      status: service.status,
      version: service.version,
      notes: service.notes || undefined,
      hostId: host.id,
      port: service.protocol === 'OTHER' || !service.port ? undefined : Number(service.port),
    }).then(() => setService(emptyService)));
  };

  const beginServiceEdit = (item: Service) => {
    setService({ name: item.name, protocol: item.protocol || 'OTHER', port: item.port ?? '', status: item.status || 'UNKNOWN', version: item.version || '', notes: item.notes || '' });
    setEditingServiceId(item.id);
  };

  const cancelServiceEdit = () => {
    setEditingServiceId('');
    setService(emptyService);
  };

  const saveServiceHandler = (event: FormEvent) => {
    event.preventDefault();
    if (!editingServiceId) return;
    void act(ui('ipam.hostPanel.editService'), () => updateService(editingServiceId, {
      name: service.name,
      protocol: service.protocol,
      status: service.status,
      version: service.version || null,
      notes: service.notes || null,
      port: service.protocol === 'OTHER' ? null : service.port ? Number(service.port) : undefined,
    }).then(() => cancelServiceEdit()));
  };

  const serviceForm = (onSubmit: (event: FormEvent) => void, submitLabel: string) => <form className="service-form" onSubmit={onSubmit}>
    <label>{ui('ipam.common.name')}<input required placeholder={ui('ipam.hostView.serviceName')} value={service.name} onChange={(event) => setService({ ...service, name: event.target.value })} /></label>
    <label>{ui('ipam.natView.protocol')}<select value={service.protocol} onChange={(event) => setService({ ...service, protocol: event.target.value })}><option>TCP</option><option>UDP</option><option>OTHER</option></select></label>
    <label>{ui('ipam.hostView.port')}<input type="number" min="1" max="65535" required={service.protocol !== 'OTHER'} disabled={service.protocol === 'OTHER'} placeholder={ui('ipam.hostView.port')} value={service.port} onChange={(event) => setService({ ...service, port: event.target.value })} /></label>
    <label>{ui('ipam.common.status')}<select value={service.status} onChange={(event) => { const status = event.target.value; if (isServiceStatus(status)) setService({ ...service, status }); }}>{SERVICE_STATUSES.map((status) => <option key={status} value={status}>{observedStatusLabel(status)}</option>)}</select></label>
    <label>{ui('ipam.newSubnet.version')}<input placeholder={ui('ipam.newSubnet.version')} value={service.version} onChange={(event) => setService({ ...service, version: event.target.value })} /></label>
    <label>{ui('ipam.ipamPage.notes')}<textarea placeholder={ui('ipam.ipamPage.notes')} value={service.notes} onChange={(event) => setService({ ...service, notes: event.target.value })} /></label>
    <div className="form-actions"><button type="button" className="secondary-button" onClick={cancelServiceEdit}>{ui('ipam.common.cancel')}</button><button className="primary-button">{submitLabel}</button></div>
  </form>;

  return <>{confirmDialog}<aside className="host-panel" aria-label={ui('ipam.hostView.label')}>
    <div className="host-panel-head"><div><h2>{host.name}</h2><span>{host.hostname || host.observedHostname || ui('ipam.common.noHostname')}</span></div><button className="icon-button" onClick={close} aria-label={ui('ipam.common.close')}><X size={18} /></button></div>
    <div className="host-status-line"><span>{ui('ipam.hostPanel.manualLabel')} <strong>{hostStatusLabel(host.status)}</strong></span><span>{ui('ipam.common.observedLabel')} <strong>{observedStatusLabel(host.observedStatus)}</strong></span><span>{ui('ipam.hostView.sourceLabel')} <strong>{sourceLabel(host.source)}</strong></span><span>{ui('ipam.hostPanel.lastSeenLabel')} <strong>{host.lastSeenAt ? formatDateTime(host.lastSeenAt) : '—'}</strong></span></div>
    {editing ? <form className="modal-form host-edit-form" onSubmit={saveHost}>
      <label>{ui('ipam.common.name')}<input required value={form.name} onChange={(event) => setForm({ ...form, name: event.target.value })} /></label>
      <label>Hostname<input value={form.hostname || ''} onChange={(event) => setForm({ ...form, hostname: event.target.value })} /></label>
      <label>{ui('ipam.ipamPage.operatingSystem')}<input value={form.operatingSystem || ''} onChange={(event) => setForm({ ...form, operatingSystem: event.target.value })} /></label>
      <label>MAC<input value={form.macAddress || ''} onChange={(event) => setForm({ ...form, macAddress: event.target.value })} /></label>
      <label>{ui('ipam.common.status')}<select value={form.status} onChange={(event) => { const status = event.target.value; if (isAssetStatus(status)) setForm({ ...form, status }); }}>{ASSET_STATUSES.map((status) => <option key={status} value={status}>{hostStatusLabel(status)}</option>)}</select></label>
      <label>{ui('ipam.ipamPage.notes')}<textarea value={form.notes || ''} onChange={(event) => setForm({ ...form, notes: event.target.value })} /></label>
      <div className="form-actions"><button type="button" className="secondary-button" onClick={() => setEditing(false)}>{ui('ipam.common.cancel')}</button><button className="primary-button">{ui('ipam.common.save')}</button></div>
    </form> : <>
      <div className="host-detail-grid">
        <div><span>{ui('ipam.hostView.os')}</span><strong>{host.operatingSystem || '—'}</strong></div>
        <div><span>MAC</span><strong>{host.macAddress || '—'}</strong></div>
        <div className="wide"><span>{ui('ipam.ipamPage.notes')}</span><strong>{host.notes || '—'}</strong></div>
        <div className="wide"><span>{ui('ipam.hostView.deviceLocation')}</span><strong>{host.device ? `${host.device.name} · ${host.device.model?.manufacturer || ''} ${host.device.model?.model || ''} · ${host.device.rack?.room?.building?.name || ui('ipam.hostPanel.noLocation')} / ${host.device.rack?.room?.name || '—'} / ${host.device.rack?.name || '—'}` : ui('ipam.hostView.notLinked')}</strong></div>
      </div>
      {canEdit && <div className="form-actions">
        <button className="secondary-button" onClick={() => setEditing(true)}><Edit3 size={14} /> {ui('ipam.hostView.edit')}</button>
        <button className="secondary-button danger" onClick={() => void askConfirm({ title: ui('ipam.hostView.retireTitle'), message: ui('ipam.hostView.retireConfirm'), confirmLabel: ui('ipam.hostView.retire'), destructive: true }).then((confirmed) => { if (confirmed) void act(ui('ipam.hostView.retireTitle'), () => deleteHost(host.id)); })}>{ui('ipam.hostView.retire')}</button>
      </div>}
    </>}
    <section className="host-section">
      <h3>{ui('ipam.hostView.relations')}</h3>
      {host.ipAddresses.map((ip) => <article className="host-relation" key={ip.id}>
        <div><strong className="mono">{ip.address}</strong><span>{ip.subnet?.site?.name} · VLAN {ip.subnet?.vlan?.vlanId ?? '—'} · {ip.subnet?.cidr}</span><small>{ip.interface ? `${ip.interface.device?.name} / ${ip.interface.name}` : ui('ipam.hostView.noInterface')}</small></div>
        {canEdit && <button className="icon-button subtle danger" title={ui('ipam.hostView.unlinkIp')} onClick={() => void act(ui('ipam.hostView.unlinkIp'), () => unlinkHostIpAddress(host.id, ip.id))}><X size={14} /></button>}
      </article>)}
    </section>
    <section className="host-section">
      <h3>Services</h3>
      {host.services.map((item) => <article className="service-row" key={item.id}>
        <div><strong>{item.name}</strong><span>{item.protocol || 'OTHER'} {item.port ? `:${item.port}` : ''} · {ui('ipam.hostPanel.serviceStates', undefined, { manual: observedStatusLabel(item.status || 'UNKNOWN'), observed: observedStatusLabel(item.observedStatus) })}</span><small>{item.version || ''}{item.notes ? ` · ${item.notes}` : ''} · {item.source}</small><BookStackContextLink type="service" id={item.id} /></div>
        {canEdit && <div className="form-actions"><button className="icon-button subtle" title={ui('ipam.hostPanel.editService')} aria-label={ui('ipam.hostPanel.editServiceNamed', undefined, { name: item.name })} onClick={() => beginServiceEdit(item)}><Edit3 size={14} /></button><button className="icon-button subtle danger" title={ui('ipam.hostView.deleteService')} onClick={() => void askConfirm({ message: ui('ipam.hostPanel.deleteServiceConfirm', undefined, { name: item.name }), destructive: true }).then((confirmed) => { if (confirmed) void act(ui('ipam.hostView.deleteService'), () => deleteService(item.id)); })}><Trash2 size={14} /></button></div>}
        {editingServiceId === item.id && serviceForm(saveServiceHandler, ui('ipam.hostPanel.saveService'))}
      </article>)}
      {canEdit && !editingServiceId && serviceForm(createServiceHandler, ui('ipam.hostPanel.createService'))}
    </section>
  </aside></>;
}
