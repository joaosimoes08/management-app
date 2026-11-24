/**
 * D-P1a simulator check: discovery SNMP enrichment against the simulated Cisco C9300 (e2e/snmp-sim-c9300) over
 * SNMPv2c and SNMPv3 authPriv, through the real per-subnet ProbeLimiter. Needs the simulator running, so it is skipped
 * unless SNMP_SIM_C9300=1 (e2e/snmp-sim-c9300/discovery-enrichment-check.sh does compose up -> this test -> compose down).
 * Credentials are the simulator's LAB-ONLY test values.
 */
import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { describe, it } from 'node:test';
import { encryptCredential, SnmpKeyring } from '@simoes/snmp-core';
import { subnetProbeLimiter } from './discovery-limiter';
import { createDiscoverySnmpEnricher, DiscoveryStoredCredential } from './discovery-snmp';

const enabled = process.env.SNMP_SIM_C9300 === '1';
const host = process.env.SNMP_SIM_HOST ?? '127.0.0.1';
const port = Number(process.env.SNMP_SIM_HEALTHY_PORT ?? 16161);
const keyring: SnmpKeyring = { activeKeyId: 'sim', keys: { sim: Uint8Array.from(randomBytes(32)) } };
const credential = (id: string, version: 'V2C' | 'V3', secret: Record<string, string>, username: string | null = null) =>
  ({ id, version, username, authProtocol: version === 'V3' ? 'SHA1' : null, privProtocol: version === 'V3' ? 'AES128' : null, ...encryptCredential(secret, keyring) }) as DiscoveryStoredCredential;
const CREDENTIALS = {
  v2c: credential('sim-v2c', 'V2C', { community: 'lab-public' }),
  v3: credential('sim-v3', 'V3', { username: 'labpoll', authKey: 'lab-poll-auth-pass', privKey: 'lab-poll-priv-pass' }, 'labpoll'),
};

describe('D-P1a: discovery SNMP enrichment against the simulated C9300', { skip: enabled ? false : 'set SNMP_SIM_C9300=1 with e2e/snmp-sim-c9300 running' }, () => {
  const limiter = subnetProbeLimiter('d-p1a-sim', { probesPerSecond: 50, maxSockets: 2 });

  for (const auth of ['v2c', 'v3'] as const) {
    it(`reads sysObjectID, sysDescr, sysName and the chassis model and serial over ${auth}, with provenance`, async () => {
      const enrich = createDiscoverySnmpEnricher(CREDENTIALS[auth], keyring, { port, timeoutMs: 2000, retries: 1 });
      const result = await enrich(host, limiter.bind());
      assert.equal(result.status, 'OK', JSON.stringify(result));
      assert.equal(result.fields.sysName?.value, 'sim-c9300-01');
      assert.equal(result.fields.sysObjectId?.value, '1.3.6.1.4.1.9.1.2494');
      assert.match(result.fields.sysDescr?.value ?? '', /Cisco/i);
      assert.deepEqual([result.fields.entityModel?.value, result.fields.entityModel?.oid], ['C9300-48P', '1.3.6.1.2.1.47.1.1.1.1.13.1000']);
      assert.deepEqual([result.fields.entitySerial?.value, result.fields.entitySerial?.oid], ['FOC2601LAB1', '1.3.6.1.2.1.47.1.1.1.1.11.1000']);
      for (const field of Object.values(result.fields)) assert.deepEqual([field.source, field.credentialId, field.observedAt], ['SNMP', CREDENTIALS[auth].id, result.observedAt]);
    });
  }

  it('a wrong v2c community is a per-target TIMEOUT, not a thrown error', async () => {
    const enrich = createDiscoverySnmpEnricher(credential('sim-bad-v2c', 'V2C', { community: 'not-the-community' }), keyring, { port, timeoutMs: 500, retries: 0 });
    const result = await enrich(host, limiter.bind());
    assert.deepEqual([result.status, result.errorCode, result.fields], ['TIMEOUT', 'SNMP_TIMEOUT', {}]);
  });

  it('a wrong v3 auth key is a per-target AUTH_FAILED, not a thrown error', async () => {
    const enrich = createDiscoverySnmpEnricher(credential('sim-bad-v3', 'V3', { username: 'labpoll', authKey: 'wrong-auth-pass-1', privKey: 'lab-poll-priv-pass' }, 'labpoll'), keyring, { port, timeoutMs: 1000, retries: 0 });
    const result = await enrich(host, limiter.bind());
    assert.deepEqual([result.status, result.errorCode, result.fields], ['AUTH_FAILED', 'SNMP_AUTHENTICATION_FAILED', {}], JSON.stringify(result));
  });

  it('every enrichment holds at most one limiter slot: parallel targets never exceed the subnet socket cap', async () => {
    const capped = subnetProbeLimiter('d-p1a-sim-cap', { probesPerSecond: 200, maxSockets: 1 });
    const enrich = createDiscoverySnmpEnricher(CREDENTIALS.v2c, keyring, { port, timeoutMs: 2000, retries: 1 });
    const results = await Promise.all([1, 2, 3].map(() => enrich(host, capped.bind())));
    assert.deepEqual(results.map((item) => item.status), ['OK', 'OK', 'OK']);
    assert.equal(capped.peakInFlight, 1);
  });
});
