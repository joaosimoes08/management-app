import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertDiscoveryAllowed, DiscoveryPolicyError, normalizeDiscoveryPorts } from './discovery-policy';
import { discoveryProfiles, resolveDiscoveryProfile } from './discovery-profiles';

test('allows a subnet fully contained in an approved private range', () => {
  assert.equal(assertDiscoveryAllowed('10.20.30.0/24', ['10.0.0.0/8']).version, 4);
});

test('rejects targets outside the allowlist and special networks even when explicitly allowed', () => {
  assert.throws(() => assertDiscoveryAllowed('8.8.8.0/24', ['10.0.0.0/8']), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_TARGET_NOT_ALLOWED');
  assert.throws(() => assertDiscoveryAllowed('169.254.169.254/32', ['0.0.0.0/0']), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_TARGET_FORBIDDEN');
  assert.throws(() => assertDiscoveryAllowed('::1/128', ['::/0']), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_TARGET_FORBIDDEN');
});

test('normalizes ports and enforces the maximum', () => {
  assert.deepEqual(normalizeDiscoveryPorts([443, 22, 443]), [22, 443]);
  assert.throws(() => normalizeDiscoveryPorts(Array.from({ length: 65 }, (_, index) => index + 1)), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_PORT_LIMIT');
});

test('requires the complete subnet to fit inside one allowlist entry', () => {
  assert.throws(() => assertDiscoveryAllowed('10.0.0.0/23', ['10.0.0.0/24', '10.0.1.0/24']), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_TARGET_NOT_ALLOWED');
  assert.equal(assertDiscoveryAllowed('fd12:3456::/64', ['fc00::/7']).version, 6);
});

test('offers bounded probe profiles and resolves fixed profiles on the server', () => {
  const defaults = { methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443, 3389], reverseDns: true };
  assert.deepEqual(discoveryProfiles(defaults).map(({ id }) => id), ['defaults', 'icmp-only', 'web', 'network', 'custom']);
  assert.deepEqual(resolveDiscoveryProfile('web', { methods: ['ICMP'], tcpPorts: [1], reverseDns: false }, defaults), { methods: ['ICMP', 'TCP'], tcpPorts: [80, 443], reverseDns: true });
  assert.deepEqual(resolveDiscoveryProfile('icmp-only', { methods: ['TCP'], tcpPorts: [443], reverseDns: false }, defaults), { methods: ['ICMP'], tcpPorts: [], reverseDns: true });
});

test('custom profile accepts normalized settings but rejects invalid and over-limit profiles', () => {
  const defaults = { methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443, 3389], reverseDns: true };
  assert.deepEqual(resolveDiscoveryProfile('custom', { methods: ['TCP', 'TCP'], tcpPorts: [443, 80, 443], reverseDns: false }, defaults), { methods: ['TCP'], tcpPorts: [80, 443], reverseDns: false });
  assert.throws(() => resolveDiscoveryProfile('custom', { methods: ['TCP'], tcpPorts: [], reverseDns: true }, defaults), (error: unknown) => (error as DiscoveryPolicyError).code === 'TCP_PORT_REQUIRED');
  assert.throws(() => resolveDiscoveryProfile('custom', { methods: ['TCP'], tcpPorts: Array.from({ length: 65 }, (_, index) => index + 1), reverseDns: true }, defaults), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_PORT_LIMIT');
  assert.throws(() => resolveDiscoveryProfile('untrusted-profile', { methods: ['ICMP'], tcpPorts: [], reverseDns: true }, defaults), (error: unknown) => (error as DiscoveryPolicyError).code === 'DISCOVERY_PROFILE_INVALID');
});
