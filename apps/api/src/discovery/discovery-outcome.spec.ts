import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import {
  addOutcomeCounts, classifyPingFailure, classifyReverseDns, classifyReverseDnsError, classifyTcpFailure, countHost, emptyOutcomeCounts,
  icmpOutcomeFor, readOutcomeCounts, snmpOutcomeFor, tcpOutcomeFor, type DiscoveryHostOutcome,
} from './discovery-outcome';

test('D-P2a: ping and TCP failures are classified', () => {
  assert.equal(classifyPingFailure(Object.assign(new Error('exit 1'), { code: 1 }), 'linux'), 'NO_REPLY');
  assert.equal(classifyPingFailure(Object.assign(new Error('timeout'), { killed: true, signal: 'SIGTERM' }), 'linux'), 'NO_REPLY');
  assert.equal(classifyPingFailure(Object.assign(new Error('exit 2'), { code: 2 }), 'linux'), 'ERROR');
  assert.equal(classifyPingFailure(Object.assign(new Error('spawn ping ENOENT'), { code: 'ENOENT' }), 'linux'), 'ERROR');
  // macOS / BSD ping exits 2 when nothing answered and 68 for an unknown host.
  assert.equal(classifyPingFailure(Object.assign(new Error('exit 2'), { code: 2 }), 'darwin'), 'NO_REPLY');
  assert.equal(classifyPingFailure(Object.assign(new Error('exit 68'), { code: 68 }), 'darwin'), 'ERROR');
  assert.equal(classifyPingFailure(Object.assign(new Error('exit 1'), { code: 1 }), 'darwin'), 'ERROR');
  assert.equal(classifyTcpFailure('ECONNREFUSED'), 'REFUSED');
  assert.equal(classifyTcpFailure('EHOSTUNREACH'), 'ERROR');
  assert.equal(classifyTcpFailure(undefined), 'ERROR');
});

test('D-P2a: reverse DNS tells a missing PTR from a failed lookup', () => {
  assert.deepEqual(classifyReverseDns('sw1.example'), { dns: 'PTR', hostname: 'sw1.example' });
  assert.deepEqual(classifyReverseDns(undefined), { dns: 'NO_PTR' });
  assert.deepEqual(classifyReverseDnsError(Object.assign(new Error('x'), { code: 'ENOTFOUND' })), { dns: 'NO_PTR' });
  assert.deepEqual(classifyReverseDnsError(Object.assign(new Error('x'), { code: 'ENODATA' })), { dns: 'NO_PTR' });
  assert.deepEqual(classifyReverseDnsError(Object.assign(new Error('x'), { code: 'ETIMEOUT' })), { dns: 'LOOKUP_FAILED', dnsError: 'ETIMEOUT' });
  assert.deepEqual(classifyReverseDnsError(new Error('boom')), { dns: 'LOOKUP_FAILED', dnsError: 'DNS_LOOKUP_FAILED' });
  assert.deepEqual(classifyReverseDnsError(Object.assign(new Error('x'), { code: 'weird code <script>' })), { dns: 'LOOKUP_FAILED', dnsError: 'DNS_LOOKUP_FAILED' }, 'only plain codes are stored');
});

test('D-P2a: per-method outcomes, with and without probe detail', () => {
  const detailed = { icmp: { reachable: false, status: 'ERROR' as const }, openPorts: [22], tcp: [{ port: 22, state: 'OPEN' as const }, { port: 443, state: 'REFUSED' as const }] };
  assert.equal(icmpOutcomeFor(detailed, ['ICMP', 'TCP']), 'ERROR');
  assert.equal(icmpOutcomeFor({ icmp: { reachable: false }, openPorts: [] }, ['ICMP']), 'NO_REPLY');
  assert.equal(icmpOutcomeFor({ icmp: { reachable: true }, openPorts: [] }, ['ICMP']), 'REPLY');
  assert.equal(icmpOutcomeFor(detailed, ['TCP']), 'NOT_PROBED');
  assert.deepEqual(tcpOutcomeFor(detailed, ['ICMP', 'TCP'], [22, 443]), [{ port: 22, state: 'OPEN' }, { port: 443, state: 'REFUSED' }]);
  assert.deepEqual(tcpOutcomeFor({ icmp: { reachable: false }, openPorts: [22] }, ['TCP'], [22, 80]), [{ port: 22, state: 'OPEN' }, { port: 80, state: 'TIMEOUT' }], 'older probes: open or no answer');
  assert.equal(tcpOutcomeFor(detailed, ['ICMP'], [22]), null);
});

test('D-P2a: SNMP outcome from the enrichment, the run skip reason, or not enabled', () => {
  assert.deepEqual(snmpOutcomeFor({ status: 'AUTH_FAILED' } as never, null), { snmp: 'AUTH_FAILED' });
  assert.deepEqual(snmpOutcomeFor(undefined, 'SNMP_CREDENTIAL_OUT_OF_SCOPE'), { snmp: 'SKIPPED_POLICY', snmpSkipReason: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' });
  assert.deepEqual(snmpOutcomeFor(undefined, null), { snmp: 'NOT_ENABLED' });
});

test('D-P2a: counts add up per host and per port, and survive a round trip', () => {
  const counts = emptyOutcomeCounts();
  const responded: DiscoveryHostOutcome = { v: 1, result: 'RESPONDED', icmp: 'REPLY', tcp: [{ port: 22, state: 'OPEN' }, { port: 443, state: 'TIMEOUT' }], dns: 'LOOKUP_FAILED', dnsError: 'ETIMEOUT', snmp: 'TIMEOUT' };
  countHost(counts, responded.icmp, responded.tcp, responded);
  countHost(counts, 'NO_REPLY', [{ port: 22, state: 'REFUSED' }, { port: 443, state: 'ERROR' }], null);
  assert.deepEqual(
    [counts.responded, counts.noResponse, counts.icmpReply, counts.icmpNoReply, counts.tcpOpen, counts.tcpRefused, counts.tcpTimeout, counts.tcpError, counts.dnsLookupFailed, counts.snmpTimeout, counts.snmpOk],
    [1, 1, 1, 1, 1, 1, 1, 1, 1, 1, 0],
  );
  const twice = addOutcomeCounts(readOutcomeCounts(JSON.parse(JSON.stringify(counts))), counts);
  assert.equal(twice.responded, 2);
  assert.equal(twice.v, 1);
  assert.deepEqual(readOutcomeCounts(null), emptyOutcomeCounts());
  assert.equal(readOutcomeCounts({ responded: -3, noResponse: 'x', tcpOpen: 2.5, icmpReply: 4 }).icmpReply, 4, 'bad values read as zero');
  assert.equal(readOutcomeCounts({ responded: -3 }).responded, 0);
});
