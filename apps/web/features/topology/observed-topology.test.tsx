import { cleanup, render, screen } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { evidenceProtocols, linkProtocol, ObservedTopology } from './observed-topology';
import type { LldpObservation, TopologyProposal } from './observed-api';

vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: () => false }) }));
vi.mock('@/lib/site-context', () => ({ useSiteContext: () => ({ siteId: 'site-1' }) }));
vi.mock('@/features/infrastructure/api', () => ({ listAllDevices: async () => ({ items: [{ id: 'sw1', name: 'core-sw-01', type: 'SWITCH', managementIp: '10.0.0.1' }], total: 1, totalPages: 1 }) }));
const observations = vi.fn<() => Promise<LldpObservation[]>>();
vi.mock('./observed-api', () => ({
  getSnmpDeviceOverview: async () => ({ latestSnapshot: null }),
  listDeviceLldpObservations: () => observations(),
  listDeviceTopologyProposals: async () => [],
  applyTopologyProposal: vi.fn(), rejectTopologyProposal: vi.fn(), undoTopologyProposal: vi.fn(),
}));
afterEach(() => { cleanup(); observations.mockReset(); });

const link = (id: string, protocol?: 'LLDP' | 'CDP' | null): LldpObservation => ({ id, deviceId: 'sw1', source: 'SNMP', protocol, observedAt: new Date().toISOString(), confidence: 90, remoteSystemName: `peer-${id}` });
const renderIt = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><ObservedTopology onToolbarChange={() => undefined} /></QueryClientProvider>);

describe('Observed topology evidence follows the neighbour protocol (#180)', () => {
  it('takes the observation protocol, then the proposal context, then LLDP for older rows', () => {
    expect(linkProtocol(link('a', 'CDP'))).toBe('CDP');
    expect(linkProtocol(link('b'), { context: { protocol: 'CDP' } } as unknown as TopologyProposal)).toBe('CDP');
    expect(linkProtocol(link('c'), { context: { protocol: 'bogus' } } as unknown as TopologyProposal)).toBe('LLDP');
    expect(linkProtocol(link('d', null))).toBe('LLDP');
    expect(evidenceProtocols(['CDP', 'CDP'])).toBe('CDP');
    expect(evidenceProtocols(['LLDP', 'CDP'])).toBe('LLDP e CDP');
    expect(evidenceProtocols([])).toBe('LLDP ou CDP');
  });

  it('labels a CDP-only device as CDP evidence, per link and for the section', async () => {
    observations.mockResolvedValue([link('a', 'CDP')]);
    renderIt();
    expect(await screen.findByText('Evidência CDP')).toBeInTheDocument();
    expect(screen.getByText(/^Evidência CDP da última recolha/)).toBeInTheDocument();
    expect(screen.queryByText(/Evidência LLDP/)).not.toBeInTheDocument();
  });

  it('names both protocols when a device has LLDP and CDP links', async () => {
    observations.mockResolvedValue([link('a', 'LLDP'), link('b', 'CDP')]);
    renderIt();
    expect(await screen.findByText(/^Evidência LLDP e CDP da última recolha/)).toBeInTheDocument();
    expect(screen.getByText('Evidência LLDP')).toBeInTheDocument();
    expect(screen.getByText('Evidência CDP')).toBeInTheDocument();
  });

  it('mentions both protocols when nothing was observed', async () => {
    observations.mockResolvedValue([]);
    renderIt();
    expect(await screen.findByText('Não há vizinhanças LLDP ou CDP registadas para este equipamento.')).toBeInTheDocument();
  });
});
