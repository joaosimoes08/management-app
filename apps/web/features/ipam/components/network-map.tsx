'use client';

import { ChevronRight, Edit3, Plus, Server, Trash2 } from 'lucide-react';
import type { NetworkMapVlan, Vlan } from '../types';
import { Empty } from './ipam-modal';

export interface NetworkMapProps {
  vlans: NetworkMapVlan[];
  canEdit: boolean;
  newVlan: () => void;
  newSubnet: (vlanId: string) => void;
  edit: (vlan: Vlan) => void;
  remove: (vlan: NetworkMapVlan) => void;
  associate: (vlan: NetworkMapVlan) => void;
  openSubnet: (subnetId: string) => void;
}

/** VLAN map of the active site: subnet and associated device ports per VLAN. */
export function NetworkMap({ vlans, canEdit, newVlan, newSubnet, edit, remove, associate, openSubnet }: NetworkMapProps) {
  return <section className="ipam-card">
    <div className="panel-heading"><div><span className="section-kicker">SITE → VLAN → SUBNET</span><h2>Mapa de rede</h2><p className="panel-description">As ações da VLAN ficam no cabeçalho do cartão.</p></div>{canEdit && <button className="primary-button" onClick={newVlan}><Plus size={14} /> Nova VLAN</button>}</div>
    {!vlans.length
      ? <Empty title="Este Site ainda não tem VLANs" text="Cria a tua primeira VLAN para começares." />
      : <div className="vlan-map-grid">{vlans.map((vlan) => <article className="vlan-card" key={vlan.id}>
        <div className="vlan-card-head">
          <div><span className="vlan-pill">VLAN {vlan.vlanId}</span><h3>{vlan.name}</h3></div>
          <div className="vlan-actions-top">{canEdit && <>
            <button className="icon-button subtle" title="Editar VLAN" onClick={() => edit({ id: vlan.id, vlanId: vlan.vlanId, name: vlan.name, description: vlan.description ?? '' })}><Edit3 size={14} /></button>
            <button className="icon-button subtle danger" title="Eliminar VLAN" onClick={() => remove(vlan)}><Trash2 size={14} /></button>
          </>}</div>
        </div>
        <span className="vlan-status">{vlan.subnet ? 'Configurada' : 'Sem subnet'}</span>
        <div className="vlan-subnet"><span>Subnet principal</span>
          {vlan.subnet
            ? <button className="link-button" onClick={() => openSubnet(vlan.subnet!.id)}>{vlan.subnet.cidr} · {vlan.subnet.ipCount} IPs <ChevronRight size={14} /></button>
            : canEdit
              ? <button className="secondary-button" onClick={() => newSubnet(vlan.id)}><Plus size={14} /> Criar subnet</button>
              : <em>Sem subnet configurada</em>}
        </div>
        <div className="vlan-devices"><span><Server size={14} /> Equipamentos e portas</span><button className="secondary-button" onClick={() => associate(vlan)}>Interfaces associadas</button></div>
      </article>)}</div>}
  </section>;
}
