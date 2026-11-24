import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { toCsv } from '@/components/data-table/csv';
import { translateMessage } from '@/lib/i18n/i18n';
import type { DiscoveryComparisonItem, DiscoveryResult } from './api';
import { apiFetch } from '@/lib/api/client';
import { AuthContext, type AuthContextValue } from '@/lib/auth';
import { DiscoveryResultsTable } from './discovery-results';
import { DiscoveryComparisonApprove, discoveryResponseType, discoveryResultsCsvColumns, matchesDiscoveryResultSearch } from './discovery-results-tools';
import { checkDiscoveryScan, discoveryHostCount, DiscoveryScanEstimate, parseDiscoveryPorts } from './discovery-scan-estimate';

const locale = vi.hoisted(() => ({ current: 'pt-PT' as 'pt-PT' | 'en-US' }));
vi.mock('@/lib/i18n/i18n', async () => {
  const real = await vi.importActual<typeof import('@/lib/i18n/i18n')>('@/lib/i18n/i18n');
  return { ...real, useOptionalI18n: () => ({ locale: locale.current, t: (key: string, fallback?: string, params?: Record<string, string | number>) => real.translateMessage(locale.current, key, fallback, params) }) };
});
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const result = (id: string, address: string, extra: Partial<DiscoveryResult> = {}): DiscoveryResult => ({ id, address, hostname: null, icmpReachable: true, responseMs: 2, openPorts: [], status: 'PENDING', ipam: null, ...extra });
const results = [
  result('r1', '10.0.0.10', { hostname: 'srv-a', openPorts: [22, 443], ipam: { ipAddressId: 'ip-1', state: 'OCCUPIED', hostId: 'h1', hostName: 'web-01', activeReservation: null } }),
  result('r2', '10.0.0.2'),
  result('r3', '10.0.0.3', { icmpReachable: false, responseMs: null, openPorts: [80], status: 'APPROVED' }),
  result('r4', '10.0.0.4', { icmpReachable: false, responseMs: null, ipam: { ipAddressId: 'ip-4', state: 'FREE', activeReservation: { id: 'res', expiresAt: '2026-11-30T10:00:00.000Z' } } }),
];
const tableRows = () => within(screen.getByRole('region', { name: 'Resultados de sondas' })).getAllByRole('row').slice(1);
const t = (key: string, fallback?: string, params?: Record<string, string | number>) => translateMessage(locale.current, key, fallback, params);

beforeEach(() => { locale.current = 'pt-PT'; window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('D-P2b results helpers', () => {
  it('classifies what answered the probes', () => {
    expect(results.map(discoveryResponseType)).toEqual(['ICMP_TCP', 'ICMP', 'TCP', 'NONE']);
  });

  it('matches every search word across address, hostname, ports, IPAM and review state', () => {
    expect(matchesDiscoveryResultSearch(results[0], '')).toBe(true);
    expect(matchesDiscoveryResultSearch(results[0], 'web-01 443')).toBe(true);
    expect(matchesDiscoveryResultSearch(results[0], 'SRV')).toBe(true);
    expect(matchesDiscoveryResultSearch(results[0], 'srv 80')).toBe(false);
    expect(matchesDiscoveryResultSearch(results[2], 'approved')).toBe(true);
    expect(matchesDiscoveryResultSearch(results[1], '10.0.0.2')).toBe(true);
    expect(matchesDiscoveryResultSearch(results[1], '10.0.0.3')).toBe(false);
  });

  it('exports the rows as localized CSV', () => {
    const csv = toCsv(results.slice(0, 4), discoveryResultsCsvColumns(t), { bom: false });
    const lines = csv.trim().split(/\r?\n/);
    expect(lines[0]).toContain('Endereço;Hostname;Resposta;ICMP;Tempo de resposta (ms);Portas TCP abertas;Estado IPAM;Host IPAM;Revisão');
    expect(lines[1]).toContain('10.0.0.10;srv-a;ICMP e TCP;Sim;2;22 443;OCCUPIED;web-01;PENDING');
    expect(lines[4]).toContain('10.0.0.4;;Sem resposta;Não;;;RESERVED;;PENDING');
    locale.current = 'en-US';
    expect(discoveryResultsCsvColumns(t).map((column) => column.header)).toEqual(['Address', 'Hostname', 'Response', 'ICMP', 'Response time (ms)', 'Open TCP ports', 'IPAM state', 'IPAM host', 'Review']);
  });
});

describe('D-P2b results table tools', () => {
  it('narrows the table by text search and response type, kept in the URL next to the table state', () => {
    render(<DiscoveryResultsTable results={results} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(tableRows()).toHaveLength(4);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar resultados' }), { target: { value: 'web-01' } });
    expect(tableRows()).toHaveLength(1);
    expect(tableRows()[0]).toHaveTextContent('10.0.0.10');
    expect(window.location.search).toContain('probeSearch=web-01');
    expect(screen.getByRole('button', { name: /Exportar CSV \(1\)/ })).toBeTruthy();

    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar resultados' }), { target: { value: '' } });
    const type = screen.getByRole('group', { name: 'Resposta' });
    fireEvent.click(within(type).getByRole('button', { name: /Só TCP\s*1/ }));
    expect(tableRows()).toHaveLength(1);
    expect(tableRows()[0]).toHaveTextContent('10.0.0.3');
    expect(window.location.search).toContain('probeType=TCP');
    // The review chips count only what the search and type chips leave.
    expect(within(screen.getByRole('group', { name: 'Revisão' })).getByRole('button', { name: /Aprovados\s*1/ })).toBeEnabled();
  });

  it('keeps the table sort when the tools change', () => {
    window.history.replaceState(null, '', '/descoberta?resultssort=hostname');
    render(<DiscoveryResultsTable results={results} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    fireEvent.change(screen.getByRole('searchbox', { name: 'Pesquisar resultados' }), { target: { value: '10.0' } });
    expect(window.location.search).toContain('resultssort=hostname');
  });

  it('renders in en-US', () => {
    locale.current = 'en-US';
    render(<DiscoveryResultsTable results={results} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.getByRole('searchbox', { name: 'Search results' })).toHaveAttribute('placeholder', 'Address, hostname, port or IPAM host');
    expect(within(screen.getByRole('group', { name: 'Response' })).getByRole('button', { name: /No response\s*1/ })).toBeTruthy();
    expect(screen.getByRole('button', { name: /Export CSV \(4\)/ })).toBeTruthy();
  });
});

describe('D-P2b approve from the comparison', () => {
  const item = (address: string): DiscoveryComparisonItem => ({ address, previous: null, current: { address, hostname: null, icmpReachable: true, openPorts: [] }, changes: [] });

  it('approves a pending address of the current run', () => {
    const review = vi.fn().mockResolvedValue(undefined);
    render(<DiscoveryComparisonApprove item={item('10.0.0.2')} results={results} review={review} />);
    fireEvent.click(screen.getByRole('button', { name: 'Aprovar 10.0.0.2' }));
    expect(review).toHaveBeenCalledWith('r2', 'APPROVED');
  });

  it('shows the review state of a reviewed address and nothing for one no longer reachable', () => {
    locale.current = 'en-US';
    const { container } = render(<>
      <DiscoveryComparisonApprove item={item('10.0.0.3')} results={results} review={vi.fn()} />
      <DiscoveryComparisonApprove item={{ ...item('10.0.0.2'), current: null }} results={results} review={vi.fn()} />
    </>);
    expect(screen.getByText('Approved')).toBeTruthy();
    expect(container.querySelectorAll('button')).toHaveLength(0);
  });
});

describe('Promover a equipamento from the comparison list', () => {
  const item = (address: string): DiscoveryComparisonItem => ({ address, previous: null, current: { address, hostname: null, icmpReachable: true, openPorts: [] }, changes: [] });
  const asRole = (roles: string[]) => ({ hasRole: (role: string) => roles.includes(role) }) as unknown as AuthContextValue;
  const approved = result('r3', '10.0.0.3', { status: 'APPROVED', hostname: 'ap-03.lab', jobId: 'job-1' } as Partial<DiscoveryResult>);

  it('offers the promote action next to an approved address, for roles that can create devices', async () => {
    vi.mocked(apiFetch).mockImplementation(async (path: string) => (path.startsWith('/api/v1/discovery/jobs/') ? { subnet: { siteId: 'site-lx' } } : { items: [], totalPages: 1 }) as never);
    const assign = vi.fn();
    const original = window.location;
    Object.defineProperty(window, 'location', { configurable: true, value: { ...original, assign } });
    try {
    render(<AuthContext.Provider value={asRole(['NETWORK_OPERATOR'])}><DiscoveryComparisonApprove item={item('10.0.0.3')} results={[approved]} review={vi.fn()} /></AuthContext.Provider>);
    expect(screen.getByText('Aprovado')).toBeTruthy();
    fireEvent.click(screen.getByRole('button', { name: 'Promover 10.0.0.3 a equipamento' }));
    await waitFor(() => expect(assign).toHaveBeenCalledWith('/infraestrutura?siteId=site-lx&tab=devices&promote=discovery&ip=10.0.0.3&hostname=ap-03.lab&name=ap-03'));
    } finally { Object.defineProperty(window, 'location', { configurable: true, value: original }); }
  });

  it('hides it from roles that cannot create devices, and on ignored addresses', () => {
    locale.current = 'en-US';
    render(<>
      <AuthContext.Provider value={asRole(['READ_ONLY'])}><DiscoveryComparisonApprove item={item('10.0.0.3')} results={[approved]} review={vi.fn()} /></AuthContext.Provider>
      <AuthContext.Provider value={asRole(['ADMIN'])}><DiscoveryComparisonApprove item={item('10.0.0.3')} results={[{ ...approved, status: 'IGNORED' }]} review={vi.fn()} /></AuthContext.Provider>
    </>);
    expect(screen.queryByRole('button', { name: /Promote/ })).toBeNull();
  });

  it('speaks English in en-US', () => {
    locale.current = 'en-US';
    render(<AuthContext.Provider value={asRole(['ADMIN'])}><DiscoveryComparisonApprove item={item('10.0.0.3')} results={[approved]} review={vi.fn()} /></AuthContext.Provider>);
    expect(screen.getByRole('button', { name: 'Promote 10.0.0.3 to a device' })).toHaveTextContent('Promote to device');
  });
});

describe('D-P2b scan form check', () => {
  it('counts hosts and parses ports as the API does', () => {
    expect(discoveryHostCount('10.0.0.0/24')).toBe(254);
    expect(discoveryHostCount('10.0.0.0/20')).toBe(4094);
    expect(discoveryHostCount('10.0.0.1/32')).toBe(1);
    expect(discoveryHostCount('10.0.0.0/31')).toBe(2);
    expect(discoveryHostCount('2001:db8::/64')).toBeNull();
    expect(parseDiscoveryPorts('22, 443,22, abc, 70000')).toEqual({ ports: [22, 443], invalid: ['abc', '70000'] });
  });

  it('estimates probes and duration with the #148 defaults', () => {
    const check = checkDiscoveryScan({ cidr: '10.0.0.0/24', methods: ['ICMP', 'TCP'], tcpPorts: '22,80,443' });
    expect(check).toMatchObject({ hosts: 254, probesPerHost: 4, probes: 1016, blocked: false, problems: [], limits: { probesPerSecond: 100, maxSockets: 64 } });
    expect(check.seconds).toEqual({ min: 10.16, max: 1016 / 64 });
  });

  it('blocks too many hosts, IPv6, bad or missing ports and too many ports', () => {
    expect(checkDiscoveryScan({ cidr: '10.0.0.0/19', methods: ['ICMP'], tcpPorts: '' }).problems).toEqual([{ level: 'error', key: 'discoveryScan.tooManyHosts', params: { hosts: 8190, max: 4096 } }]);
    expect(checkDiscoveryScan({ cidr: '2001:db8::/120', methods: ['ICMP'], tcpPorts: '' }).problems[0].key).toBe('discoveryScan.ipv4Only');
    expect(checkDiscoveryScan({ cidr: '10.0.0.0/24', methods: ['TCP'], tcpPorts: '22, x' }).problems[0]).toMatchObject({ key: 'discoveryScan.portsInvalid', params: { ports: 'x' } });
    expect(checkDiscoveryScan({ cidr: '10.0.0.0/24', methods: ['TCP'], tcpPorts: ' ' }).problems[0].key).toBe('discoveryScan.portsMissing');
    const many = Array.from({ length: 65 }, (_, index) => index + 1).join(',');
    expect(checkDiscoveryScan({ cidr: '10.0.0.0/24', methods: ['TCP'], tcpPorts: many })).toMatchObject({ blocked: true, problems: [{ key: 'discoveryScan.portsTooMany', params: { count: 65, max: 64 } }] });
  });

  it('warns when the probe or duration caps would stop the run, using the subnet limits', () => {
    const ports = Array.from({ length: 30 }, (_, index) => index + 1).join(',');
    const check = checkDiscoveryScan({ cidr: '10.0.0.0/20', methods: ['ICMP', 'TCP'], tcpPorts: ports, limits: { probesPerSecond: 10, maxSockets: 4 } });
    expect(check.blocked).toBe(false);
    expect(check.problems.map((problem) => problem.key)).toEqual(['discoveryScan.probeLimit', 'discoveryScan.durationLimit']);
  });

  it('shows the estimate and the blocking reason in both languages', () => {
    const { rerender } = render(<DiscoveryScanEstimate check={checkDiscoveryScan({ cidr: '10.0.0.0/24', methods: ['ICMP', 'TCP'], tcpPorts: '22,80,443' })} />);
    expect(screen.getByText(/254 hosts · 1016 sondas · duração estimada 10 s a 16 s/)).toBeTruthy();
    expect(screen.getByText(/100 sondas\/s e 64 ligações/)).toBeTruthy();
    locale.current = 'en-US';
    rerender(<DiscoveryScanEstimate check={checkDiscoveryScan({ cidr: '10.0.0.0/19', methods: ['ICMP'], tcpPorts: '' })} />);
    expect(screen.getByRole('alert')).toHaveTextContent('This subnet has 8190 hosts; each discovery run is limited to 4096 hosts');
  });
});
