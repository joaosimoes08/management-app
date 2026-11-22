import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { SubnetsView } from './subnets-view';
import type { IpAddressRow, Subnet } from '../types';

vi.mock('@/components/layout/app-shell', () => ({ PageToolbarPortal: ({ children }: { children: React.ReactNode }) => <>{children}</> }));

const subnet = { id: 'subnet-1', cidr: '10.20.0.0/22', version: 4, siteId: 'site-1' } as Subnet;
const ips: IpAddressRow[] = [{ id: 'ip-1', address: '10.20.1.145', subnetId: subnet.id, state: 'FREE', reservations: [] } as IpAddressRow];

function renderView(paging: { ipPage?: number; ipTotalPages?: number; ipTotal?: number; setIpPage?: (page: number) => void }) {
  return render(<SubnetsView selected={subnet} items={[subnet]} usage={null} capacityHistory={null} ips={ips} search="" setSearch={vi.fn()} openSubnet={vi.fn()} openHost={vi.fn()}
    canEdit={false} canReserve={false} canReleaseReservations={false} siteId="site-1" newSubnet={vi.fn()} editSubnet={vi.fn()} removeSubnet={vi.fn()}
    editIp={vi.fn()} newIp={vi.fn()} createHost={vi.fn()} reserveIp={vi.fn()} releaseReservation={vi.fn()} {...paging} />);
}

afterEach(cleanup);

describe('SubnetsView IP paging', () => {
  it('shows no pager when every address fits in one page', () => {
    renderView({ ipPage: 1, ipTotalPages: 1, ipTotal: 1, setIpPage: vi.fn() });
    expect(screen.queryByRole('navigation', { name: 'Páginas dos endereços IP' })).not.toBeInTheDocument();
  });

  it('pages past the first 200 addresses of a large subnet', () => {
    const setIpPage = vi.fn();
    renderView({ ipPage: 2, ipTotalPages: 5, ipTotal: 812, setIpPage });
    const pager = screen.getByRole('navigation', { name: 'Páginas dos endereços IP' });
    expect(pager).toHaveTextContent('201-400 de 812');
    expect(pager).toHaveTextContent('Página 2 de 5');
    fireEvent.click(within(pager).getByRole('button', { name: 'Página seguinte' }));
    expect(setIpPage).toHaveBeenLastCalledWith(3);
    fireEvent.click(within(pager).getByRole('button', { name: 'Página anterior' }));
    expect(setIpPage).toHaveBeenLastCalledWith(1);
  });

  it('disables the buttons at the ends of the list', () => {
    renderView({ ipPage: 5, ipTotalPages: 5, ipTotal: 812, setIpPage: vi.fn() });
    const pager = screen.getByRole('navigation', { name: 'Páginas dos endereços IP' });
    expect(pager).toHaveTextContent('801-812 de 812');
    expect(within(pager).getByRole('button', { name: 'Página seguinte' })).toBeDisabled();
    expect(within(pager).getByRole('button', { name: 'Página anterior' })).toBeEnabled();
  });
});
