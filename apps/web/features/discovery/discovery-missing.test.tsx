import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MissingIp } from './api';
import { DiscoveryMissingSection, missingIpEvidence } from './discovery-missing';

const mocks = vi.hoisted(() => ({ listMissingIps: vi.fn(), markMissingIpsFree: vi.fn() }));
vi.mock('./api', () => ({ listMissingIps: mocks.listMissingIps, markMissingIpsFree: mocks.markMissingIpsFree }));

afterEach(() => { cleanup(); vi.clearAllMocks(); });

const item = (overrides: Partial<MissingIp> = {}): MissingIp => ({ ipId: 'ip-1', address: '10.0.0.20', subnetId: 'sub-1', cidr: '10.0.0.0/24', siteId: 'site-1', hostname: 'old-srv', lastSeenAt: null, lastScanAt: '2026-11-21T10:00:00.000Z', scanCount: 2, ...overrides });
const renderSection = (canEdit = true) => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DiscoveryMissingSection siteId="site-1" canEdit={canEdit} searching={false} search="" /></QueryClientProvider>);

describe('Discovery Desaparecidos', () => {
  it('describes the evidence for a missing address', () => {
    const format = (value: string) => value.slice(0, 10);
    expect(missingIpEvidence(item(), format)).toBe('nunca visto por uma descoberta · 2 descobertas sem resposta · última 2026-11-21');
    expect(missingIpEvidence(item({ lastSeenAt: '2026-09-01T00:00:00.000Z', scanCount: 1 }), format)).toBe('visto pela última vez 2026-09-01 · 1 descoberta sem resposta · última 2026-11-21');
  });

  it('lists missing IPs for the Site and frees one only after confirmation, showing a per-item refusal', async () => {
    mocks.listMissingIps.mockResolvedValue({ windowDays: 30, total: 2, items: [item(), item({ ipId: 'ip-2', address: '10.0.0.21', hostname: null })] });
    mocks.markMissingIpsFree.mockResolvedValueOnce({ results: [{ ipId: 'ip-2', ok: false, code: 'IP_IN_USE', message: 'O endereço está associado a um equipamento, host ou regra NAT; remove a associação no IPAM primeiro.' }], succeeded: 0, failed: 1 });
    renderSection();
    expect(await screen.findByText('10.0.0.20')).toBeInTheDocument();
    expect(mocks.listMissingIps).toHaveBeenCalledWith('site-1');
    expect(screen.getAllByRole('link', { name: 'Abrir no IPAM' })[0]).toHaveAttribute('href', '/ipam?siteId=site-1&subnetId=sub-1&ipId=ip-1');

    const buttons = screen.getAllByRole('button', { name: /Marcar livre/ });
    fireEvent.click(buttons[1]);
    const dialog = await screen.findByRole('alertdialog', { name: 'Marcar livre' });
    expect(dialog).toHaveTextContent('Marcar 10.0.0.21 como livre?');
    expect(mocks.markMissingIpsFree).not.toHaveBeenCalled();
    fireEvent.click(within(dialog).getByRole('button', { name: 'Marcar livre' }));
    await waitFor(() => expect(mocks.markMissingIpsFree).toHaveBeenCalledWith(['ip-2']));
    expect(await screen.findByRole('alert')).toHaveTextContent('remove a associação no IPAM primeiro');
    expect(mocks.listMissingIps).toHaveBeenCalledTimes(2);
  });

  it('hides the action for read-only users and shows the empty state', async () => {
    mocks.listMissingIps.mockResolvedValue({ windowDays: 30, total: 0, items: [] });
    renderSection(false);
    expect(await screen.findByText('Nenhum IP ocupado deixou de responder')).toBeInTheDocument();
    expect(screen.queryByRole('button', { name: /Marcar livre/ })).toBeNull();
  });
});
