import { strict as assert } from 'node:assert';
import { randomBytes } from 'node:crypto';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { encryptCredential, parseKeyring } from '@simoes/snmp-core';
import { TrapReceiver } from './traps';

let directory: string;
let originalKeyringFile: string | undefined;
let originalSelfTestEnabled: string | undefined;
let originalSelfTestProxySources: string | undefined;
let originalSelfTestAllowTranslatedSource: string | undefined;

describe('trap durability when Redis is unavailable', () => {
  before(async () => {
    originalKeyringFile = process.env.SNMP_KEYRING_FILE;
    originalSelfTestEnabled = process.env.SNMP_SELF_TEST_ENABLED;
    originalSelfTestProxySources = process.env.SNMP_SELF_TEST_PROXY_SOURCES;
    originalSelfTestAllowTranslatedSource = process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE;
    directory = await mkdtemp(join(tmpdir(), 'snmp-trap-test-'));
    const encoded = randomBytes(32).toString('base64');
    await writeFile(join(directory, 'keyring.json'), JSON.stringify({ activeKeyId: 'test', keys: { test: encoded } }), { mode: 0o600 });
    process.env.SNMP_KEYRING_FILE = join(directory, 'keyring.json');
  });

  after(async () => {
    if (originalKeyringFile === undefined) delete process.env.SNMP_KEYRING_FILE;
    else process.env.SNMP_KEYRING_FILE = originalKeyringFile;
    if (originalSelfTestEnabled === undefined) delete process.env.SNMP_SELF_TEST_ENABLED;
    else process.env.SNMP_SELF_TEST_ENABLED = originalSelfTestEnabled;
    if (originalSelfTestProxySources === undefined) delete process.env.SNMP_SELF_TEST_PROXY_SOURCES;
    else process.env.SNMP_SELF_TEST_PROXY_SOURCES = originalSelfTestProxySources;
    if (originalSelfTestAllowTranslatedSource === undefined) delete process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE;
    else process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE = originalSelfTestAllowTranslatedSource;
    await rm(directory, { recursive: true, force: true });
  });

  it('persists first and later re-enqueues only the event ID', async () => {
    const keyring = parseKeyring(await import('node:fs/promises').then(({ readFile }) => readFile(process.env.SNMP_KEYRING_FILE!, 'utf8')));
    const credential = {
      id: '30000000-0000-4000-8000-000000000001', deviceId: '20000000-0000-4000-8000-000000000001',
      purpose: 'TRAP', version: 'V2C', username: null, authProtocol: null, privProtocol: null, enabled: true,
      ...encryptCredential({ community: 'trap-community' }, keyring),
    };
    const unrelatedCredential = {
      ...credential,
      id: '30000000-0000-4000-8000-000000000002',
      deviceId: '20000000-0000-4000-8000-000000000002',
      ...encryptCredential({ community: 'another-site-community' }, keyring),
    };
    const eventId = '40000000-0000-4000-8000-000000000001';
    let persisted: any;
    const prisma = {
      device: { findMany: async () => [
        { id: unrelatedCredential.deviceId, snmpCredentials: [unrelatedCredential] },
        { id: credential.deviceId, snmpCredentials: [credential] },
      ] },
      snmpTrapEnrollment: { findMany: async () => [] },
      snmpTrapEvent: {
        create: async ({ data }: any) => { persisted = data; return { id: eventId, status: data.status }; },
        findMany: async () => [{ id: eventId }],
      },
      snmpCredential: { update: async () => undefined },
    } as any;
    const payloads: unknown[] = [];
    let redisAvailable = false;
    const queue = { add: async (_name: string, payload: unknown) => { if (!redisAvailable) throw new Error('Redis unavailable'); payloads.push(payload); } } as any;
    const receiver = new TrapReceiver(prisma, queue);
    await (receiver as any).persist({
      rinfo: { address: '10.20.30.40', port: 50162 },
      pdu: {
        type: (snmp.PduType as any).TrapV2,
        community: 'trap-community',
        id: 42,
        varbinds: [
          { oid: '1.3.6.1.2.1.1.3.0', type: snmp.ObjectType.TimeTicks, value: 1234 },
          { oid: '1.3.6.1.6.3.1.1.4.1.0', type: snmp.ObjectType.OID, value: '1.3.6.1.6.3.1.1.5.3' },
        ],
      },
    });
    assert.equal(persisted.status, 'PENDING');
    assert.equal(persisted.deviceId, credential.deviceId);
    assert.equal(payloads.length, 0);

    redisAvailable = true;
    await receiver.recoverPending();
    assert.deepEqual(payloads, [{ schemaVersion: 1, recordId: eventId }]);
    assert.equal(JSON.stringify(payloads).includes('trap-community'), false);
  });

  it('marks an authenticated exact-IP enrollment as discovered without queueing secrets', async () => {
    const keyring = parseKeyring(await import('node:fs/promises').then(({ readFile }) => readFile(process.env.SNMP_KEYRING_FILE!, 'utf8')));
    const enrollment = {
      id: '50000000-0000-4000-8000-000000000001', siteId: '10000000-0000-4000-8000-000000000001',
      sourceAddress: '10.20.30.50', status: 'WAITING', expiresAt: new Date(Date.now() + 60_000), firstSeenAt: null,
      version: 'V2C', username: null, authProtocol: null, privProtocol: null,
      ...encryptCredential({ community: 'unique-enrollment-community' }, keyring),
    };
    const persisted: any[] = []; const updates: any[] = []; const payloads: unknown[] = [];
    const prisma = {
      device: { findMany: async () => [] },
      snmpTrapEnrollment: {
        findMany: async ({ where }: any) => where.sourceAddress === enrollment.sourceAddress ? [enrollment] : [],
        update: async (value: any) => { updates.push(value); },
      },
      snmpTrapEvent: { create: async ({ data }: any) => { persisted.push(data); return { id: `event-${persisted.length}`, status: data.status }; } },
    } as any;
    const receiver = new TrapReceiver(prisma, { add: async (_name: string, payload: unknown) => { payloads.push(payload); } } as any);
    const pdu = { type: (snmp.PduType as any).TrapV2, community: 'unique-enrollment-community', id: 7, varbinds: [{ oid: '1.3.6.1.6.3.1.1.4.1.0', type: snmp.ObjectType.OID, value: '1.3.6.1.6.3.1.1.5.1' }] };

    await (receiver as any).persist({ rinfo: { address: enrollment.sourceAddress, port: 53001 }, pdu });
    await (receiver as any).persist({ rinfo: { address: '10.20.30.51', port: 53002 }, pdu });

    assert.equal(persisted[0].status, 'DISCOVERED');
    assert.equal(persisted[0].enrollmentId, enrollment.id);
    assert.equal(persisted[1].status, 'UNMATCHED');
    assert.equal(updates.length, 1);
    assert.equal(payloads.length, 0);
    assert.equal(JSON.stringify(persisted).includes('unique-enrollment-community'), false);
  });

  it('maps an authenticated SNMPv3 self-test only through an explicit proxy and fresh host interface', async () => {
    process.env.SNMP_SELF_TEST_ENABLED = 'true';
    process.env.SNMP_SELF_TEST_PROXY_SOURCES = '192.168.65.1';
    const keyring = parseKeyring(await import('node:fs/promises').then(({ readFile }) => readFile(process.env.SNMP_KEYRING_FILE!, 'utf8')));
    const enrollment = {
      id: '50000000-0000-4000-8000-000000000002', siteId: '10000000-0000-4000-8000-000000000001',
      sourceAddress: '192.168.151.203', status: 'WAITING', expiresAt: new Date(Date.now() + 60_000), firstSeenAt: null,
      version: 'V3', username: 'self-test-user', authProtocol: 'SHA256', privProtocol: 'AES128',
      ...encryptCredential({ username: 'self-test-user', authKey: 'authentication-key', privKey: 'privacy-key' }, keyring),
    };
    const persisted: any[] = []; const updates: any[] = [];
    const prisma = {
      device: { findMany: async () => [] },
      snmpListenerInterface: {
        findMany: async () => [{ instanceId: 'host:test', name: 'en0', address: enrollment.sourceAddress, internal: false }],
      },
      snmpListenerConfig: { findUnique: async () => ({ listenAll: true, selectedInterfaces: [] }) },
      snmpTrapEnrollment: {
        findMany: async ({ where }: any) => {
          if (typeof where.sourceAddress === 'string') return [];
          return where.version === 'V3' && where.username === enrollment.username && where.sourceAddress.in.includes(enrollment.sourceAddress) ? [enrollment] : [];
        },
        update: async (value: any) => { updates.push(value); },
      },
      snmpTrapEvent: { create: async ({ data }: any) => { persisted.push(data); return { id: `event-${persisted.length}`, status: data.status }; } },
    } as any;
    const receiver = new TrapReceiver(prisma, { add: async () => undefined } as any);
    const pdu = { type: (snmp.PduType as any).TrapV2, user: 'self-test-user', version: snmp.Version3, id: 8, varbinds: [] };

    await (receiver as any).persist({ rinfo: { address: '192.168.65.1', port: 54001 }, pdu });
    await (receiver as any).persist({ rinfo: { address: '192.168.65.2', port: 54002 }, pdu });

    assert.equal(persisted[0].status, 'DISCOVERED');
    assert.equal(persisted[0].enrollmentId, enrollment.id);
    assert.equal(persisted[0].sourceAddress, '192.168.65.1');
    assert.equal(persisted[0].category, 'SELF_TEST');
    assert.equal(persisted[1].status, 'UNMATCHED');
    assert.equal(updates.length, 1);
  });

  it('fails closed when a self-test identity matches more than one local enrollment', async () => {
    process.env.SNMP_SELF_TEST_ENABLED = 'true';
    process.env.SNMP_SELF_TEST_PROXY_SOURCES = '192.168.65.1';
    const keyring = parseKeyring(await import('node:fs/promises').then(({ readFile }) => readFile(process.env.SNMP_KEYRING_FILE!, 'utf8')));
    const encrypted = encryptCredential({ username: 'ambiguous-user', authKey: 'authentication-key', privKey: 'privacy-key' }, keyring);
    const enrollments = ['192.168.151.203', '192.168.151.204'].map((sourceAddress, index) => ({
      id: `50000000-0000-4000-8000-00000000001${index}`, siteId: '10000000-0000-4000-8000-000000000001', sourceAddress,
      status: 'WAITING', expiresAt: new Date(Date.now() + 60_000), firstSeenAt: null, version: 'V3', username: 'ambiguous-user',
      authProtocol: 'SHA256', privProtocol: 'AES128', ...encrypted,
    }));
    let persisted: any;
    const prisma = {
      device: { findMany: async () => [] },
      snmpListenerInterface: { findMany: async () => enrollments.map(({ sourceAddress }, index) => ({ instanceId: 'host:test', name: `en${index}`, address: sourceAddress, internal: false })) },
      snmpListenerConfig: { findUnique: async () => ({ listenAll: true, selectedInterfaces: [] }) },
      snmpTrapEnrollment: { findMany: async ({ where }: any) => typeof where.sourceAddress === 'string' ? [] : enrollments },
      snmpTrapEvent: { create: async ({ data }: any) => { persisted = data; return { id: 'event-ambiguous', status: data.status }; } },
    } as any;
    const receiver = new TrapReceiver(prisma, { add: async () => undefined } as any);

    await (receiver as any).persist({
      rinfo: { address: '192.168.65.1', port: 54003 },
      pdu: { type: (snmp.PduType as any).TrapV2, user: 'ambiguous-user', version: snmp.Version3, id: 9, varbinds: [] },
    });

    assert.equal(persisted.status, 'UNMATCHED');
    assert.equal(persisted.enrollmentId, undefined);
  });

  it('maps a translated authenticated source only with the dedicated opt-in', async () => {
    process.env.SNMP_SELF_TEST_ENABLED = 'true';
    process.env.SNMP_SELF_TEST_PROXY_SOURCES = '127.0.0.1';
    process.env.SNMP_SELF_TEST_ALLOW_TRANSLATED_SOURCE = 'true';
    const keyring = parseKeyring(await import('node:fs/promises').then(({ readFile }) => readFile(process.env.SNMP_KEYRING_FILE!, 'utf8')));
    const enrollment = {
      id: '50000000-0000-4000-8000-000000000020', siteId: '10000000-0000-4000-8000-000000000001',
      sourceAddress: '192.168.151.203', status: 'WAITING', expiresAt: new Date(Date.now() + 60_000), firstSeenAt: null,
      version: 'V3', username: 'translated-user', authProtocol: 'SHA1', privProtocol: 'AES128',
      ...encryptCredential({ username: 'translated-user', authKey: 'authentication-key', privKey: 'privacy-key' }, keyring),
    };
    let persisted: any; let updateCount = 0;
    const prisma = {
      device: { findMany: async () => [] },
      snmpListenerInterface: { findMany: async () => [{ instanceId: 'host:test', name: 'en0', address: enrollment.sourceAddress, internal: false }] },
      snmpListenerConfig: { findUnique: async () => ({ listenAll: false, selectedInterfaces: [{ instanceId: 'host:test', name: 'en0', address: enrollment.sourceAddress }] }) },
      snmpTrapEnrollment: {
        findMany: async ({ where }: any) => typeof where.sourceAddress === 'string' ? [] : [enrollment],
        update: async () => { updateCount++; },
      },
      snmpTrapEvent: { create: async ({ data }: any) => { persisted = data; return { id: 'event-translated', status: data.status }; } },
    } as any;
    const receiver = new TrapReceiver(prisma, { add: async () => undefined } as any);

    await (receiver as any).persist({
      rinfo: { address: '144.202.100.225', port: 55001 },
      pdu: { type: (snmp.PduType as any).TrapV2, user: 'translated-user', version: snmp.Version3, id: 10, varbinds: [] },
    });

    assert.equal(persisted.status, 'DISCOVERED');
    assert.equal(persisted.category, 'SELF_TEST');
    assert.equal(persisted.sourceAddress, '144.202.100.225');
    assert.equal(persisted.enrollmentId, enrollment.id);
    assert.equal(updateCount, 1);
  });
});
