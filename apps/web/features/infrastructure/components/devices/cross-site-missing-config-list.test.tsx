import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissingConfigDevice } from '../../api';
import { CrossSiteMissingConfigList } from './cross-site-missing-config-list';

const listMissingConfigDevices = vi.fn();
vi.mock('../../api', () => ({ listMissingConfigDevices: (...args: unknown[]) => listMissingConfigDevices(...args) }));
afterEach(() => { cleanup(); listMissingConfigDevices.mockReset(); });

const row = (id: string, siteId: string, siteName: string): MissingConfigDevice => ({ id, name: `SW-${id}`, type: 'SWITCH', status: 'ACTIVE', siteId, siteName, rackName: 'R1', rackUnitStart: 10, model: { manufacturer: 'Acme', model: 'X' }, href: `/infraestrutura?siteId=${siteId}&tab=devices&deviceId=${id}&settingsTab=energia` });

function renderList() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return render(<QueryClientProvider client={client}><CrossSiteMissingConfigList config="power" label="Tomadas de energia" /></QueryClientProvider>);
}

describe('CrossSiteMissingConfigList', () => {
  it('lists every Site without a siteId, with the API total (the bell count) in the header and each device link', async () => {
    const items = [row('1', 'lx', 'LX'), row('2', 'lx', 'LX'), row('3', 'lx', 'LX'), row('4', 'lx', 'LX'), row('5', 'qa', 'QA-PILOT'), row('6', 'qa', 'QA-PILOT')];
    listMissingConfigDevices.mockResolvedValue({ items, total: 6, totalPages: 1 });
    renderList();
    expect(await screen.findByRole('heading', { name: '6 equipamentos em falta · 2 Sites' })).toBeInTheDocument();
    expect(listMissingConfigDevices).toHaveBeenCalledWith('power', 1, 50);
    const links = screen.getAllByRole('link');
    expect(links).toHaveLength(6);
    expect(within(links[4]).getByText('QA-PILOT')).toBeInTheDocument();
    expect(links[4]).toHaveAttribute('href', '/infraestrutura?siteId=qa&tab=devices&deviceId=5&settingsTab=energia');
    expect(screen.queryByRole('button', { name: 'Seguinte' })).not.toBeInTheDocument();
  });

  it('pages through a long list, keeping the total from the API', async () => {
    listMissingConfigDevices.mockImplementation((_config: string, page: number) => Promise.resolve({ items: [row(`p${page}`, 'lx', 'LX')], total: 51, totalPages: 2, siteCount: 3 }));
    renderList();
    expect(await screen.findByRole('heading', { name: '51 equipamentos em falta · 3 Sites' })).toBeInTheDocument();
    fireEvent.click(screen.getByRole('button', { name: 'Seguinte' }));
    expect(await screen.findByText('SW-p2')).toBeInTheDocument();
    expect(listMissingConfigDevices).toHaveBeenLastCalledWith('power', 2, 50);
    expect(screen.getByText('2 / 2')).toBeInTheDocument();
  });
});
