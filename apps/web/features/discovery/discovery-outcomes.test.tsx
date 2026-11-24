import { cleanup, render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { translateLegacyText } from '@/lib/i18n/legacy-messages';
import { DiscoveryResultsTable } from './discovery-results';
import { DiscoveryOutcomeCell, DiscoveryRunOutcomeSummary } from './discovery-outcomes';
import type { DiscoveryHostOutcome, DiscoveryOutcomeCounts, DiscoveryResult } from './api';

vi.mock('@/lib/api/client', () => ({ apiFetch: vi.fn() }));

const outcome = (extra: Partial<DiscoveryHostOutcome> = {}): DiscoveryHostOutcome => ({
  v: 1, result: 'RESPONDED', icmp: 'REPLY', tcp: [{ port: 22, state: 'OPEN' }, { port: 443, state: 'REFUSED' }, { port: 80, state: 'TIMEOUT' }], dns: 'LOOKUP_FAILED', dnsError: 'ETIMEOUT', snmp: 'AUTH_FAILED', ...extra,
});
const result = (id: string, address: string, value: DiscoveryHostOutcome | null): DiscoveryResult => ({ id, address, hostname: null, icmpReachable: true, responseMs: 2, openPorts: [22], status: 'PENDING', ipam: null, snmp: null, outcome: value });
const counts: DiscoveryOutcomeCounts = {
  v: 1, responded: 12, noResponse: 50, icmpReply: 12, icmpNoReply: 49, icmpError: 1, tcpOpen: 1, tcpRefused: 61, tcpTimeout: 62, tcpError: 0,
  dnsPtr: 0, dnsNoPtr: 0, dnsLookupFailed: 0, snmpOk: 10, snmpPartial: 0, snmpAuthFailed: 1, snmpTimeout: 1, snmpError: 0, snmpSkippedPolicy: 0,
};

beforeEach(() => window.history.replaceState(null, '', '/descoberta'));
afterEach(cleanup);

describe('D-P2a structured scan outcomes', () => {
  it('shows one line per method for a host, and leaves out methods the run did not use', () => {
    render(<DiscoveryOutcomeCell outcome={outcome()} />);
    expect(within(screen.getByRole('list', { name: 'Resultado por método' })).getAllByRole('listitem').map((item) => item.textContent))
      .toEqual(['ICMP: respondeu', 'TCP 22: aberta', 'TCP 443: recusada', 'TCP 80: sem resposta', 'DNS: pesquisa falhou (ETIMEOUT)', 'SNMP: autenticação falhou']);
    cleanup();
    render(<DiscoveryOutcomeCell outcome={outcome({ icmp: 'NOT_PROBED', tcp: null, dns: 'NOT_REQUESTED', dnsError: undefined, snmp: 'SKIPPED_POLICY', snmpSkipReason: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' })} />);
    expect(screen.getAllByRole('listitem').map((item) => item.textContent)).toEqual(['SNMP: não tentado (política da execução)']);
  });

  it('replaces the probe summary in the results table only for rows that carry an outcome', () => {
    render(<DiscoveryResultsTable results={[result('a', '10.0.0.5', outcome()), result('b', '10.0.0.6', null)]} canEdit={false} review={vi.fn()} bulkDone={vi.fn()} />);
    expect(screen.getByText('TCP 443: recusada')).toBeTruthy();
    expect(screen.getByText('ICMP respondeu em 2ms · Ligação TCP aceite na(s) porta(s) 22')).toBeTruthy();
    expect(screen.queryByRole('button', { name: /Aprovar/ })).toBeNull();
  });

  it('summarises the run, including hosts not scanned, and hides methods with nothing counted', () => {
    render(<DiscoveryRunOutcomeSummary job={{ outcomeCounts: counts, totalCount: 62, processedCount: 48 }} />);
    expect(within(screen.getByRole('group', { name: 'Resultado por método' })).getAllByText(/.+/).map((item) => item.textContent)).toEqual([
      'Hosts: 12 responderam · 50 sem resposta · 14 não sondados',
      'ICMP: 12 respostas · 49 sem resposta · 1 erros',
      'Portas TCP: 1 abertas · 61 recusadas · 62 sem resposta · 0 erros',
      'SNMP: 10 lidos · 0 parciais · 1 autenticação falhou · 1 sem resposta · 0 erros · 0 não tentados (política)',
    ]);
    cleanup();
    const { container } = render(<DiscoveryRunOutcomeSummary job={{ outcomeCounts: null, totalCount: 62, processedCount: 62 }} />);
    expect(container.textContent).toBe('');
  });

  it('every outcome text has an en-US translation', () => {
    const texts: Array<[string, string]> = [
      ['ICMP: erro na sonda', 'ICMP: probe error'], ['TCP 443: recusada', 'TCP 443: refused'], ['TCP 80: sem resposta', 'TCP 80: no answer'], ['TCP 23: erro', 'TCP 23: error'],
      ['DNS: sem registo PTR', 'DNS: no PTR record'], ['DNS: pesquisa falhou (ETIMEOUT)', 'DNS: lookup failed (ETIMEOUT)'], ['SNMP: não tentado (política da execução)', 'SNMP: not tried (run policy)'],
      ['Hosts: 12 responderam · 50 sem resposta · 14 não sondados', 'Hosts: 12 responded · 50 no response · 14 not scanned'],
      ['Portas TCP: 1 abertas · 61 recusadas · 62 sem resposta · 0 erros', 'TCP ports: 1 open · 61 refused · 62 no answer · 0 errors'],
      ['DNS inverso: 1 com PTR · 10 sem PTR · 1 falhas', 'Reverse DNS: 1 with PTR · 10 without PTR · 1 failed'],
      ['SNMP: 10 lidos · 0 parciais · 1 autenticação falhou · 1 sem resposta · 0 erros · 0 não tentados (política)', 'SNMP: 10 read · 0 partial · 1 authentication failed · 1 no response · 0 errors · 0 not tried (policy)'],
    ];
    for (const [pt, en] of texts) expect(translateLegacyText('en-US', pt)).toBe(en);
  });
});
