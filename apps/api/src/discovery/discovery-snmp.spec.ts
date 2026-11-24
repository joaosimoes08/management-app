import { strict as assert } from 'node:assert';
import { createSocket } from 'node:dgram';
import { test } from 'node:test';
import { encryptCredential, parseKeyring } from '@simoes/snmp-core';
import { compareDiscoveryResults } from './discovery-comparison';
import { ProbeRunner } from './discovery-limiter';
import { buildEnrichment, classifySnmpError, createDiscoverySnmpEnricher, DiscoveryStoredCredential, failedEnrichment, loadDiscoverySnmpEnricher, pickChassisIndex, readEnrichment } from './discovery-snmp';

const at = new Date('2026-11-24T10:00:00.000Z');
const keyring = parseKeyring(JSON.stringify({ activeKeyId: 'k1', keys: { k1: Buffer.alloc(32, 7).toString('base64') } }));

test('classifies timeouts, v3 auth failures and other errors per target', () => {
  const timeout = new Error('Request timed out'); timeout.name = 'RequestTimedOutError';
  assert.deepEqual(classifySnmpError(timeout), { status: 'TIMEOUT', errorCode: 'SNMP_TIMEOUT' });
  assert.deepEqual(classifySnmpError(Object.assign(new Error('x'), { code: 'SNMP_TIMEOUT' })), { status: 'TIMEOUT', errorCode: 'SNMP_TIMEOUT' });
  assert.deepEqual(classifySnmpError(new Error('Authentication digest mismatch: wrong digest')), { status: 'AUTH_FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED' });
  assert.deepEqual(classifySnmpError(new Error('Unknown user name')), { status: 'AUTH_FAILED', errorCode: 'SNMP_AUTHENTICATION_FAILED' });
  assert.deepEqual(classifySnmpError(Object.assign(new Error('bad'), { code: 'SNMP_NO_DATA' })), { status: 'ERROR', errorCode: 'SNMP_NO_DATA' });
  assert.deepEqual(classifySnmpError('boom'), { status: 'ERROR', errorCode: 'SNMP_EXECUTION_FAILED' });
});

test('picks the lowest chassis, else the lowest stack row', () => {
  assert.equal(pickChassisIndex([{ index: 1, physicalClass: 11 }, { index: 2000, physicalClass: 3 }, { index: 1000, physicalClass: 3 }]), 1000);
  assert.equal(pickChassisIndex([{ index: 5, physicalClass: 11 }, { index: 9, physicalClass: 10 }]), 5);
  assert.equal(pickChassisIndex([{ index: 9, physicalClass: 10 }]), null);
});

test('stores every value with SNMP provenance and grades OK, PARTIAL and empty readings', () => {
  const full = buildEnrichment({ sysObjectId: '1.3.6.1.4.1.9.1.2494', sysDescr: ' Cisco IOS XE \u0000', sysName: 'sw1', entity: { index: 1000, model: 'C9300-48P', serial: 'FOC1' } }, 'cred-1', at, 42);
  assert.equal(full.status, 'OK');
  assert.equal(full.fields.sysDescr?.value, 'Cisco IOS XE');
  assert.deepEqual(full.fields.entitySerial, { value: 'FOC1', oid: '1.3.6.1.2.1.47.1.1.1.1.11.1000', source: 'SNMP', credentialId: 'cred-1', observedAt: at.toISOString() });
  assert.equal(full.fields.entityModel?.oid, '1.3.6.1.2.1.47.1.1.1.1.13.1000');
  const partial = buildEnrichment({ sysName: 'sw1', entity: null }, 'cred-1', at, 1);
  assert.equal(partial.status, 'PARTIAL');
  assert.deepEqual(Object.keys(partial.fields), ['sysName']);
  const empty = buildEnrichment({ sysName: '  ' }, 'cred-1', at, 1);
  assert.deepEqual([empty.status, empty.errorCode], ['ERROR', 'SNMP_NO_DATA']);
  assert.equal(buildEnrichment({ sysDescr: 'x'.repeat(5000) }, 'c', at, 1).fields.sysDescr?.value.length, 1024);
  assert.deepEqual(failedEnrichment(new Error('timeout'), 'c', at, 3), { status: 'TIMEOUT', errorCode: 'SNMP_TIMEOUT', credentialId: 'c', observedAt: at.toISOString(), durationMs: 3, fields: {} });
  assert.equal(readEnrichment({ status: 'OK' }), null);
  assert.equal(readEnrichment(full), full);
});

test('comparison flags SNMP fields only when both runs read them', () => {
  const run = (sysName?: string, serial?: string) => buildEnrichment({ sysName, entity: serial ? { index: 1, serial } : null }, 'c', at, 1);
  const host = (snmp: unknown) => ({ address: '10.0.0.2', hostname: null, icmpReachable: true, openPorts: [22], snmp });
  assert.deepEqual(compareDiscoveryResults([host(run('a', 'S1'))], [host(run('b', 'S1'))]).changed[0]?.changes, ['snmp.sysName']);
  assert.deepEqual(compareDiscoveryResults([host(run('a', 'S1'))], [host(run('a', 'S2'))]).changed[0]?.changes, ['snmp.entitySerial']);
  assert.deepEqual(compareDiscoveryResults([host(run('a'))], [host(failedEnrichment(new Error('timeout'), 'c', at, 1))]).changed, []);
  assert.deepEqual(compareDiscoveryResults([host(null)], [host(run('a'))]).changed, []);
});

test('an enrichment uses exactly one limiter slot and a silent target becomes TIMEOUT without throwing', async () => {
  const sink = createSocket('udp4');
  await new Promise<void>((resolve) => sink.bind(0, '127.0.0.1', resolve));
  const port = (sink.address() as { port: number }).port;
  let slots = 0; let active = 0; let peak = 0;
  const runner: ProbeRunner = { run: async (probe) => { slots += 1; active += 1; peak = Math.max(peak, active); try { return await probe(); } finally { active -= 1; } } };
  const credential = { id: 'cred-v2', version: 'V2C', username: null, authProtocol: null, privProtocol: null, ...encryptCredential({ community: 'wrong' }, keyring) } as DiscoveryStoredCredential;
  try {
    const enrich = createDiscoverySnmpEnricher(credential, keyring, { port, timeoutMs: 150, retries: 0 });
    const result = await enrich('127.0.0.1', runner);
    assert.equal(slots, 1); assert.equal(peak, 1);
    assert.equal(result.status, 'TIMEOUT');
    assert.equal(result.credentialId, 'cred-v2');
    assert.deepEqual(result.fields, {});
  } finally { sink.close(); }
});

test('loading the scan credential refuses anything but an enabled READ credential on the subnet Site', async () => {
  const base = { id: 'c1', purpose: 'READ', enabled: true, version: 'V3', username: 'u', authProtocol: 'SHA', privProtocol: 'AES', ...encryptCredential({ authKey: 'a'.repeat(8), privKey: 'p'.repeat(8) }, keyring), device: { siteId: 'site-1' } };
  const prisma = (row: unknown) => ({ snmpCredential: { findUnique: async () => row } }) as never;
  const load = (row: unknown, site: string | null = 'site-1') => loadDiscoverySnmpEnricher(prisma(row), 'c1', site, { keyring: () => keyring });
  assert.deepEqual(await load(null), { skipped: 'SNMP_CREDENTIAL_UNAVAILABLE' });
  assert.deepEqual(await load({ ...base, purpose: 'WRITE' }), { skipped: 'SNMP_CREDENTIAL_UNAVAILABLE' });
  assert.deepEqual(await load({ ...base, enabled: false }), { skipped: 'SNMP_CREDENTIAL_UNAVAILABLE' });
  assert.deepEqual(await load(base, 'site-2'), { skipped: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' });
  assert.deepEqual(await load(base, null), { skipped: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' });
  assert.deepEqual(await loadDiscoverySnmpEnricher(prisma(base), 'c1', 'site-1', { keyring: () => { throw new Error('SNMP_KEYRING_FILE_MISSING'); } }), { skipped: 'SNMP_KEYRING_UNAVAILABLE' });
  assert.equal(typeof ('enricher' in (await load(base)) ? (await load(base) as { enricher: unknown }).enricher : null), 'function');
});
