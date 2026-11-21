import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { LinuxHosts } from './linux-hosts';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/i18n', () => ({
  useI18n: () => ({
    t: (key: string, _fallback?: string, params?: { name?: string }) => params?.name ? `${key}: ${params.name}` : key,
    formatDate: (value?: string) => value ?? '—',
  }),
}));

const endpoint = '/api/v1/linux-agents';
const sites = [{ id: 'site-a', name: 'Lisboa', code: 'LIS' }, { id: 'site-b', name: 'Porto', code: 'OPO' }];
const device = { id: 'device-a', name: 'Equipamento A', siteId: sites[0].id };
const host = {
  id: 'host-a', name: 'Host A', hostname: 'a.example', operatingSystem: 'Debian',
  device, ipAddresses: [{ id: 'ip-a', address: '192.0.2.1', subnet: { id: 'subnet-a', siteId: sites[0].id } }],
};
const agent = { id: 'agent-a', enrolledAt: '2026-11-21T11:00:00Z', lastHeartbeatAt: null, revokedAt: null, agentVersion: null, state: 'PENDING' };

function mount(canManage = false) {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } });
  return render(<QueryClientProvider client={client}><LinuxHosts sites={sites} canManage={canManage} canAudit={canManage} /></QueryClientProvider>);
}

beforeEach(() => {
  Object.defineProperties(HTMLDialogElement.prototype, {
    showModal: { configurable: true, value(this: HTMLDialogElement) { this.open = true; } },
    close: { configurable: true, value(this: HTMLDialogElement) { this.open = false; } },
  });
  vi.mocked(apiFetch).mockReset();
  window.history.replaceState(null, '', '/infraestrutura?tab=hosts');
});

afterEach(cleanup);

describe('Linux hosts', () => {
  it('keeps the site and status filters in the URL and shows read-only host details', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path) => {
      if (path.endsWith('/services')) return [{ id: 'service-a', name: 'SSH', protocol: 'TCP', port: 22, version: '9.9', observedStatus: 'ONLINE', lastSeenAt: null }];
      return { staleMinutes: 15, items: [
        { ...host, agent: { ...agent, state: 'STALE' } },
        ...(path.includes('siteId=') ? [] : [{ ...host, id: 'host-b', name: 'Host B', agent: null }]),
      ] };
    });
    window.history.replaceState(null, '', '/infraestrutura?tab=hosts&hosts-state=STALE');
    mount();
    await screen.findByRole('button', { name: 'Host A' });
    expect(screen.queryByRole('button', { name: 'Host B' })).toBeNull();
    expect(screen.queryByRole('button', { name: /linuxHosts\.(enroll|revoke)/ })).toBeNull();

    fireEvent.change(screen.getByRole('combobox', { name: 'linuxHosts.site' }), { target: { value: 'site-a' } });
    expect(window.location.search).toContain('hosts-site=site-a');
    expect(window.location.search).toContain('hosts-state=STALE');
    await waitFor(() => expect(apiFetch).toHaveBeenCalledWith(`${endpoint}/hosts?siteId=site-a`));
    fireEvent.click(await screen.findByRole('button', { name: 'Host A' }));
    const drawer = screen.getByRole('dialog', { name: 'Host A' });
    expect(await within(drawer).findByText('SSH')).toBeInTheDocument();
    expect(within(drawer).getByRole('link', { name: '192.0.2.1' })).toHaveAttribute('href', '/ipam?siteId=site-a&subnetId=subnet-a&ipId=ip-a');
    expect(within(drawer).getByRole('link', { name: 'Equipamento A' })).toHaveAttribute('href', '/infraestrutura?siteId=site-a&tab=devices&deviceId=device-a&focus=device');
    fireEvent.click(within(drawer).getByRole('button', { name: 'linuxHosts.close' }));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('keeps a new token in the enrol dialog and reopens without it', async () => {
    const token = 'synthetic-test-fixture';
    let issued = false;
    vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
      if (options?.method === 'POST') { issued = true; return { token }; }
      return { staleMinutes: 15, items: [{ ...host, agent: issued ? agent : null }] };
    });
    mount(true);
    const open = await screen.findByRole('button', { name: 'linuxHosts.enroll' });
    await waitFor(() => expect(open).toBeEnabled());
    fireEvent.click(open);
    const dialog = screen.getByRole('dialog', { name: 'linuxHosts.enroll' });
    fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: host.id } });
    fireEvent.click(within(dialog).getByRole('button', { name: 'linuxHosts.enroll' }));
    expect(await within(dialog).findByDisplayValue(token)).toBeInTheDocument();
    expect(within(dialog).getByText(/MANAGEMENT_API_URL/)).toBeInTheDocument();
    const close = within(dialog).getByRole('button', { name: 'linuxHosts.close' });
    await waitFor(() => expect(close).toBeEnabled());
    fireEvent.click(close);
    expect(screen.queryByDisplayValue(token)).toBeNull();

    await screen.findByRole('button', { name: 'linuxHosts.revokeHost: Host A' });
    fireEvent.click(open);
    const reopened = screen.getByRole('dialog', { name: 'linuxHosts.enroll' });
    fireEvent.change(within(reopened).getByRole('combobox'), { target: { value: host.id } });
    expect(within(reopened).getByRole('status')).toHaveTextContent('linuxHosts.tokenIssued');
    expect(within(reopened).getByRole('button', { name: 'linuxHosts.enroll' })).toBeDisabled();
    expect(screen.queryByDisplayValue(token)).toBeNull();
  });

  it('requires confirmation and refreshes the agent state after revocation', async () => {
    let revoked = false;
    vi.mocked(apiFetch).mockImplementation(async (_path, options) => {
      if (options?.method === 'DELETE') { revoked = true; return {}; }
      return { staleMinutes: 15, items: [{ ...host, agent: { ...agent, state: revoked ? 'REVOKED' : 'ONLINE' } }] };
    });
    mount(true);
    fireEvent.click(await screen.findByRole('button', { name: 'linuxHosts.revokeHost: Host A' }));
    let dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'common.cancel' }));
    expect(apiFetch).not.toHaveBeenCalledWith(`${endpoint}/agent-a`, expect.anything());
    fireEvent.click(screen.getByRole('button', { name: 'linuxHosts.revokeHost: Host A' }));
    dialog = screen.getByRole('alertdialog');
    fireEvent.click(within(dialog).getByRole('button', { name: 'linuxHosts.revoke' }));
    expect(await screen.findByText('linuxHosts.state.REVOKED')).toBeInTheDocument();
    expect(apiFetch).toHaveBeenCalledWith(`${endpoint}/agent-a`, { method: 'DELETE' });
  });
});
