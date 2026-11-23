import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { after, before, describe, it } from 'node:test';
import { encryptCredential, SnmpKeyring } from '@simoes/snmp-core';
import { withDeadline } from './client';
import { publicErrorCode } from './log';
import { CREDENTIAL_TEST_DEADLINE_MARGIN_MS, PollProcessor } from './poll';

// P0-3 follow-up: "Testar" against a host that never answers must end with SNMP_TIMEOUT within the configured timeout.
const key = randomBytes(32);
const keyring: SnmpKeyring = { activeKeyId: 'test', keys: { test: Uint8Array.from(key) } };
let sink: dgram.Socket;
let silentPort: number;
let received = 0;
let originalKeyring: string | undefined;

function fakePrisma(status: string, timeoutMs: number) {
  const credential = { id: 'cred', version: 'V3', username: 'u', authProtocol: 'SHA256', privProtocol: 'AES128', ...encryptCredential({ username: 'u', authKey: 'authentication-key', privKey: 'privacy-key' }, keyring) };
  const job: any = { id: 'job', deviceId: 'dev', type: 'CREDENTIAL_TEST', status, requestedBy: 'user', device: { managementIp: '127.0.0.1' }, credential };
  const prisma: any = {
    job,
    snmpJob: {
      findUnique: async () => job,
      updateMany: async ({ where, data }: any) => { if (where.status && where.status !== job.status) return { count: 0 }; Object.assign(job, data); return { count: 1 }; },
    },
    snmpDeviceConfig: { findUnique: async () => ({ port: silentPort, timeoutMs }) },
    snmpCredential: { update: async () => ({}) },
    auditLog: { create: async () => ({}) },
    $transaction: async (work: Array<Promise<unknown>>) => Promise.all(work),
  };
  return prisma;
}

describe('credential test against an unreachable host', () => {
  before(async () => {
    originalKeyring = process.env.SNMP_KEYRING_FILE;
    const dir = mkdtempSync(join(tmpdir(), 'snmp-keyring-'));
    writeFileSync(join(dir, 'keyring.json'), JSON.stringify({ activeKeyId: 'test', keys: { test: key.toString('base64') } }));
    process.env.SNMP_KEYRING_FILE = join(dir, 'keyring.json');
    // A UDP socket that swallows every request: the same as a host that never answers (192.0.2.10), without leaving localhost.
    sink = dgram.createSocket('udp4');
    sink.on('message', () => { received += 1; });
    await new Promise<void>((resolve) => sink.bind(0, '127.0.0.1', () => resolve()));
    silentPort = (sink.address() as { port: number }).port;
  });
  after(() => {
    sink.close();
    if (originalKeyring === undefined) delete process.env.SNMP_KEYRING_FILE; else process.env.SNMP_KEYRING_FILE = originalKeyring;
  });

  it('fails the job with SNMP_TIMEOUT within the configured timeout plus the margin', async () => {
    const timeoutMs = 400;
    const prisma = fakePrisma('PENDING', timeoutMs);
    const started = Date.now();
    await assert.rejects(new PollProcessor(prisma, {} as any).test('job'), (error) => publicErrorCode(error) === 'SNMP_TIMEOUT');
    const elapsed = Date.now() - started;
    assert.ok(received >= 1, 'the request reached the silent host');
    assert.ok(elapsed >= timeoutMs - 50, `waited the timeout (${elapsed} ms)`);
    assert.ok(elapsed < timeoutMs + CREDENTIAL_TEST_DEADLINE_MARGIN_MS, `ended within timeout + margin (${elapsed} ms)`);
    assert.equal(prisma.job.status, 'FAILED');
    assert.equal(prisma.job.errorCode, 'SNMP_TIMEOUT');
  });

  it('does not reopen a test the API already closed', async () => {
    const prisma = fakePrisma('FAILED', 400);
    const before = received;
    assert.deepEqual(await new PollProcessor(prisma, {} as any).test('job'), { skipped: true });
    assert.equal(prisma.job.status, 'FAILED');
    assert.equal(received, before, 'no SNMP request was sent');
  });

  it('withDeadline rejects a request whose callback never fires', async () => {
    const started = Date.now();
    await assert.rejects(withDeadline(new Promise(() => undefined), 100), (error) => publicErrorCode(error) === 'SNMP_TIMEOUT');
    assert.ok(Date.now() - started < 1_000);
    assert.equal(await withDeadline(Promise.resolve('ok'), 100), 'ok');
  });
});
