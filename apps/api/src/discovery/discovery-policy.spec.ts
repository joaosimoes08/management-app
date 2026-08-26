import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { assertDiscoveryAllowed, DiscoveryPolicyError, normalizeDiscoveryPorts } from './discovery-policy';

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
