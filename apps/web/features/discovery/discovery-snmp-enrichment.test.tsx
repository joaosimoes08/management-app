import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { apiFetch } from '@/lib/api/client';
import { DiscoveryResultsTable } from './discovery-results';
import { DiscoverySnmpEnrichmentPanel, DiscoverySnmpRunSummary, snmpChangeText } from './discovery-snmp-enrichment';
import type { DiscoveryResult, DiscoverySnmpEnrichment, DiscoverySnmpSetting } from './api';

const auth = vi.hoisted(() => ({ admin: true }));
vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));
vi.mock('@/lib/auth', () => ({ useAuth: () => ({ hasRole: (role: string) => role === 'ADMIN' && auth.admin }) }));
const mockedFetch = vi.mocked(apiFetch);

const at = '2026-11-24T12:00:00.000Z';
const field = (value: string, oid: string) => ({ value, oid, source: 'SNMP' as const, credentialId: 'cred-1', observedAt: at });
const enrichment = (extra: Partial<DiscoverySnmpEnrichment> = {}): DiscoverySnmpEnrichment => ({
  status: 'OK', credentialId: 'cred-1', observedAt: at, durationMs: 40,
  fields: { sysName: field('sim-c9300-01', '1.3.6.1.2.1.1.5.0'), sysObjectId: field('1.3.6.1.4.1.9.1.2494', '1.3.6.1.2.1.1.2.0'), entityModel: field('C9300-48P', '1.3.6.1.2.1.47.1.1.1.1.13.1000'), entitySerial: field('FOC2601LAB1', '1.3.6.1.2.1.47.1.1.1.1.11.1000') },
  ...extra,
});
const result = (id: string, address: string, snmp: DiscoverySnmpEnrichment | null): DiscoveryResult => ({ id, address, hostname: null, icmpReachable: true, responseMs: 2, openPorts: [], status: 'PENDING', ipam: null, snmp });
const setting = (credentialId: string | null): DiscoverySnmpSetting => {
  const candidate = { id: 'cred-1', deviceId: 'dev-1', deviceName: 'core-sw', managementIp: '10.0.0.1', version: 'V3' as const, label: null, username: 'poller' };
  return { subnetId: 'subnet-1', enabled: Boolean(credentialId), credentialId, credential: credentialId ? candidate : null, candidates: [candidate] };
};
const renderPanel = () => render(<QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}><DiscoverySnmpEnrichmentPanel subnetId="subnet-1" onError={vi.fn()} /></QueryClientProvider>);

beforeEach(() => { mockedFetch.mockReset(); auth.admin = true; window.history.replaceState(null, '', '/descoberta'); });
afterEach(cleanup);

describe('D-P1a discovery SNMP enrichment', () => {
  it('is off by default and an ADMIN switches it on with one READ credential of the Site', async () => {
    mockedFetch.mockResolvedValueOnce(setting(null)).mockResolvedValueOnce(setting('cred-1'));
    renderPanel();
    const select = await screen.findByRole('combobox', { name: 'Credencial SNMP de enriquecimento' }) as HTMLSelectElement;
    expect(select.value).toBe('');
    expect(within(select).getAllByRole('option').map((option) => option.textContent)).toEqual(['Desligado', 'core-sw (10.0.0.1) · v3 poller']);
    fireEvent.change(select, { target: { value: 'cred-1' } });
    await waitFor(() => expect(mockedFetch).toHaveBeenLastCalledWith('/api/v1/subnets/subnet-1/discovery-snmp', { method: 'PATCH', body: JSON.stringify({ credentialId: 'cred-1' }) }));
    await waitFor(() => expect(select.value).toBe('cred-1'));
  });

  it('is read-only for anyone but an ADMIN', async () => {
    auth.admin = false;
    mockedFetch.mockResolvedValueOnce(setting('cred-1'));
    renderPanel();
    expect(await screen.findByRole('combobox', { name: 'Credencial SNMP de enriquecimento' })).toBeDisabled();
    expect(screen.getByText('Só um ADMIN pode alterar esta opção.')).toBeInTheDocument();
  });

  it('adds an SNMP column with values, provenance and per-target failures only when the run tried SNMP', () => {
    const { unmount } = render(<DiscoveryResultsTable results={[result('r1', '10.0.0.1', null)]} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.queryByRole('columnheader', { name: /SNMP/ })).not.toBeInTheDocument();
    unmount();
    render(<DiscoveryResultsTable results={[
      result('r1', '10.0.0.1', enrichment()),
      result('r2', '10.0.0.2', enrichment({ status: 'AUTH_FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED', fields: {} })),
      result('r3', '10.0.0.3', enrichment({ status: 'TIMEOUT', errorCode: 'SNMP_TIMEOUT', fields: {} })),
    ]} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.getByRole('columnheader', { name: /SNMP/ })).toBeInTheDocument();
    const rows = within(screen.getByRole('region', { name: 'Resultados de sondas' })).getAllByRole('row').slice(1);
    expect(rows[0]).toHaveTextContent('sim-c9300-01');
    expect(rows[0]).toHaveTextContent('C9300-48P · S/N FOC2601LAB1');
    expect(within(rows[0]).getByText('S/N FOC2601LAB1')).toHaveAttribute('title', expect.stringContaining('SNMP · OID 1.3.6.1.2.1.47.1.1.1.1.11.1000'));
    expect(rows[1]).toHaveTextContent('Autenticação SNMP falhou');
    expect(rows[2]).toHaveTextContent('SNMP sem resposta');
  });

  it('describes SNMP changes in the comparison and summarises each run', () => {
    const previous = { address: '10.0.0.1', hostname: null, icmpReachable: true, openPorts: [], snmp: enrichment() };
    const current = { ...previous, snmp: enrichment({ fields: { entitySerial: field('FOC9', '1.3.6.1.2.1.47.1.1.1.1.11.1000') } }) };
    expect(snmpChangeText('snmp.entitySerial', { previous, current })).toBe('SNMP entPhysicalSerialNum: FOC2601LAB1 → FOC9');
    expect(snmpChangeText('hostname', { previous, current })).toBeNull();
    const { rerender, container } = render(<DiscoverySnmpRunSummary job={{ snmpCredentialId: null }} />);
    expect(container).toBeEmptyDOMElement();
    rerender(<DiscoverySnmpRunSummary job={{ snmpCredentialId: 'cred-1', snmpEnrichedCount: 10, snmpFailedCount: 2 }} />);
    expect(screen.getByText('Enriquecimento SNMP: 10 hosts lidos · 2 sem leitura')).toBeInTheDocument();
    rerender(<DiscoverySnmpRunSummary job={{ snmpCredentialId: 'cred-1', snmpSkippedReason: 'SNMP_V2C_DISABLED' }} />);
    expect(screen.getByRole('note')).toHaveTextContent('Enriquecimento SNMP não executado: o SNMPv2c está desativado neste servidor.');
  });
});
