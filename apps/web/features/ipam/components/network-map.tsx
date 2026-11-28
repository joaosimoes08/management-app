'use client';

import { ChevronRight, Edit3, Link2Off, Plus, Server, Trash2 } from 'lucide-react';
import type { NetworkMapVlan, Vlan } from '../types';
import { Empty } from './ipam-modal';
import { PageToolbarPortal } from '@/components/layout/app-shell';
import { useUiText } from '@/components/ui/use-ui-text';

export interface NetworkMapProps {
  vlans: NetworkMapVlan[];
  loading?: boolean;
  canEdit: boolean;
  newVlan: () => void;
  newSubnet: (vlanId: string) => void;
  edit: (vlan: Vlan) => void;
  remove: (vlan: NetworkMapVlan) => void;
  associate: (vlan: NetworkMapVlan) => void;
  detachSubnet: (vlan: NetworkMapVlan) => void;
  openSubnet: (subnetId: string) => void;
}

/** VLAN map of the active site: subnet and associated device ports per VLAN. */
export function NetworkMap({ vlans, loading = false, canEdit, newVlan, newSubnet, edit, remove, associate, detachSubnet, openSubnet }: NetworkMapProps) {
  const ui = useUiText();
  return <section className="ipam-card">
    <div className="panel-heading"><div><h2>{ui('ipam.map.title')}</h2><p className="panel-description">{ui('ipam.map.description')}</p></div></div>{canEdit && <PageToolbarPortal><button className="primary-button" onClick={newVlan}><Plus size={14} /> {ui('ipam.mapView.newVlan')}</button></PageToolbarPortal>}
    {loading
      ? <div className="ipam-loading-skeletons" aria-label={ui('ipam.map.loading')} aria-busy="true">{[0, 1, 2].map((item) => <article className="vlan-card" key={item}><div className="content-skeleton ipam-loading-line wide"/><div className="content-skeleton ipam-loading-line medium"/><div className="content-skeleton ipam-loading-line"/><div className="content-skeleton ipam-loading-row"/></article>)}</div>
      : !vlans.length
      ? <Empty title={ui('ipam.mapView.empty.title')} text={ui('ipam.mapView.empty.text')} />
      : <div className="vlan-map-grid">{vlans.map((vlan) => <article className="vlan-card" key={vlan.id}>
        <div className="vlan-card-head">
          <div><span className="vlan-pill">VLAN {vlan.vlanId}</span><h3>{vlan.name}</h3></div>
          <div className="vlan-actions-top">{canEdit && <>
            <button className="icon-button subtle" title={ui('ipam.mapView.editVlan')} onClick={() => edit({ id: vlan.id, vlanId: vlan.vlanId, name: vlan.name, description: vlan.description ?? '' })}><Edit3 size={14} /></button>
            <button className="icon-button subtle danger" title={ui('ipam.mapView.deleteVlan')} onClick={() => remove(vlan)}><Trash2 size={14} /></button>
          </>}</div>
        </div>
        <span className="vlan-status">{vlan.subnet ? ui('ipam.mapView.configured') : ui('ipam.mapView.noSubnet')}</span>
        <div className="vlan-subnet"><span>{ui('ipam.mapView.primarySubnet')}</span>
          {vlan.subnet
            ? <div className="vlan-subnet-actions"><button className="link-button" onClick={() => openSubnet(vlan.subnet!.id)}>{vlan.subnet.cidr} · {vlan.subnet.ipCount} IPs <ChevronRight size={14} /></button>{canEdit && <button className="secondary-button danger" aria-label={ui('ipam.map.detach', undefined, { cidr: vlan.subnet.cidr, vlan: vlan.vlanId })} onClick={() => detachSubnet(vlan)}><Link2Off size={13} /> {ui('ipam.ipamPage.detach')}</button>}</div>
            : canEdit
              ? <button className="secondary-button" onClick={() => newSubnet(vlan.id)}><Plus size={14} /> {ui('ipam.mapView.createSubnet')}</button>
              : <em>{ui('ipam.mapView.noSubnetConfigured')}</em>}
        </div>
        <div className="vlan-devices"><span><Server size={14} /> {ui('ipam.mapView.devicesAndPorts')}</span><button className="secondary-button" onClick={() => associate(vlan)}>{ui('ipam.mapView.linkedInterfaces')}</button></div>
      </article>)}</div>}
  </section>;
}
