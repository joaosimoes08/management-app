import { fireEvent, render, screen } from '@testing-library/react';
import { createElement } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { NetworkMap } from './network-map';
import { SubnetsView } from './subnets-view';
import type { NetworkMapVlan, Subnet } from '../types';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';

const subnet: Subnet = { id: 'subnet-1', cidr: '10.0.0.0/24', version: 4, siteId: 'site-1', vlanId: 'vlan-1', vlan: { id: 'vlan-1', vlanId: 10, name: 'Users' }, _count: { ips: 2 } };
const vlan: NetworkMapVlan = { id: 'vlan-1', vlanId: 10, name: 'Users', subnet: { id: subnet.id, cidr: subnet.cidr, ipCount: 2 }, devices: [], interfaces: [] };

describe('IPAM subnet actions', () => {
  it('exposes VLAN subnet detachment without deleting the subnet', () => {
    const detachSubnet = vi.fn();
    render(createElement(NetworkMap, { vlans: [vlan], canEdit: true, newVlan: vi.fn(), newSubnet: vi.fn(), edit: vi.fn(), remove: vi.fn(), associate: vi.fn(), detachSubnet, openSubnet: vi.fn() }));

    fireEvent.click(screen.getByRole('button', { name: 'Desassociar 10.0.0.0/24 da VLAN 10' }));
    expect(detachSubnet).toHaveBeenCalledWith(vlan);
  });

  it('shows map skeletons rather than an empty state while the map loads', () => {
    render(createElement(NetworkMap, { vlans: [], loading: true, canEdit: false, newVlan: vi.fn(), newSubnet: vi.fn(), edit: vi.fn(), remove: vi.fn(), associate: vi.fn(), detachSubnet: vi.fn(), openSubnet: vi.fn() }));

    expect(screen.getByLabelText('A carregar mapa de rede')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Este Site ainda não tem VLANs')).not.toBeInTheDocument();
  });

  it('keeps subnet actions in a non-wrapping row while allowing CIDR truncation', () => {
    const css = readFileSync(resolve(process.cwd(), 'app/globals.css'), 'utf8');
    expect(css).toMatch(/\.vlan-subnet-actions\s*\{[^}]*flex-wrap:\s*nowrap/);
    expect(css).toMatch(/\.vlan-subnet-actions>\.link-button\s*\{[^}]*min-width:\s*0[^}]*text-overflow:\s*ellipsis/);
    expect(css).toMatch(/\.vlan-subnet-actions>\.secondary-button\s*\{[^}]*flex:\s*0 0 auto/);
  });

  it('offers separate edit and delete actions in the subnet list', () => {
    const openSubnet = vi.fn();
    const editSubnet = vi.fn();
    const removeSubnet = vi.fn();

    render(createElement(SubnetsView, { selected: null, items: [subnet], usage: null, capacityHistory: null, ips: [], search: '', setSearch: vi.fn(), openSubnet, openHost: vi.fn(), canEdit: true, canReserve: true, canReleaseReservations: true, siteId: 'site-1', newSubnet: vi.fn(), editSubnet, removeSubnet, editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(), reserveIp: vi.fn(), releaseReservation: vi.fn() }));


    fireEvent.click(screen.getByRole('button', { name: 'Editar subnet 10.0.0.0/24' }));
    fireEvent.click(screen.getByRole('button', { name: 'Eliminar subnet 10.0.0.0/24' }));

    expect(editSubnet).toHaveBeenCalledWith(subnet);
    expect(removeSubnet).toHaveBeenCalledWith(subnet);
    expect(openSubnet).not.toHaveBeenCalled();
  });

  it('shows subnet list skeletons without a false empty state while loading', () => {
    render(createElement(SubnetsView, { selected: null, items: [], loading: true, usage: null, capacityHistory: null, ips: [], search: '', setSearch: vi.fn(), openSubnet: vi.fn(), openHost: vi.fn(), canEdit: false, canReserve: false, canReleaseReservations: false, siteId: 'site-1', newSubnet: vi.fn(), editSubnet: vi.fn(), removeSubnet: vi.fn(), editIp: vi.fn(), newIp: vi.fn(), createHost: vi.fn(), reserveIp: vi.fn(), releaseReservation: vi.fn() }));

    expect(screen.getByLabelText('A carregar subnets')).toHaveAttribute('aria-busy', 'true');
    expect(screen.queryByText('Este Site ainda não tem subnets')).not.toBeInTheDocument();
  });
});
