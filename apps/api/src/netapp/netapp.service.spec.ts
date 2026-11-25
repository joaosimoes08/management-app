import * as assert from 'node:assert/strict';
import { test } from 'node:test';
import { encryptCredential } from '@simoes/snmp-core';
import { NetAppService } from './netapp.service';

test('refresh failure preserves cached last-known snapshot and records safe error state', async () => {
  const snapshot = { systems: [{ name: 'cluster-a' }] };
  const keyring = { activeKeyId: 'active', keys: { active: new Uint8Array(32).fill(7) } };
  const record: any = { id: 'integration', siteId: 'site', endpointUrl: 'https://ontap.example', username: 'reader', ...encryptCredential({ password: 'credential-value' }, keyring), snapshot, lastSuccessAt: new Date('2026-10-30T10:00:00.000Z') };
  let update: any;
  const audits: any[] = [];
  const service = Object.create(NetAppService.prototype) as any;
  service.prisma = { netAppIntegration: { findUnique: async () => record, update: async ({ data }: any) => { update = data; return { ...record, ...data }; } } };
  service.access = { assertSite: async () => ({ id: 'site' }) };
  service.audit = { record: async (entry: any) => audits.push(entry) };
  service.keyring = () => keyring;
  const originalFetch = globalThis.fetch;
  globalThis.fetch = (async () => { throw new TypeError('network unreachable'); }) as typeof fetch;
  try {
    await assert.rejects(() => service.refresh('site', { id: 'user', roles: ['ADMIN'] }), (error: any) => error.getStatus() === 503 && error.getResponse().code === 'ONTAP_UNAVAILABLE');
  } finally { globalThis.fetch = originalFetch; }
  assert.equal(update.snapshot, undefined);
  assert.equal(update.lastErrorCode, 'ONTAP_UNAVAILABLE');
  assert.equal(record.snapshot, snapshot);
  assert.equal(audits.at(-1).action, 'NETAPP_REFRESH_FAILED');
  assert.equal(JSON.stringify(audits).includes('secret'), false);
});

function serviceWith(record: any, calls: string[], audits: any[], denied?: Error) {
  const service = Object.create(NetAppService.prototype) as any;
  service.prisma = { netAppIntegration: { findUnique: async () => { calls.push('findUnique'); return record; } } };
  service.access = { assertSite: async (_user: unknown, action: string) => { calls.push(`assertSite:${action}`); if (denied) throw denied; return { id: 'site' }; } };
  service.audit = { record: async (entry: any) => audits.push(entry) };
  return service;
}

test('get on a site without an integration answers { configured: false } (no 404) and records no audit', async () => {
  const calls: string[] = []; const audits: any[] = [];
  const result = await serviceWith(null, calls, audits).get('site', { id: 'user', roles: ['READ_ONLY'] });
  assert.deepEqual(result, { siteId: 'site', configured: false });
  assert.deepEqual(calls, ['assertSite:READ', 'findUnique']);
  assert.equal(audits.length, 0);
});

test('get checks site access before looking for the integration', async () => {
  const calls: string[] = []; const audits: any[] = [];
  const forbidden = Object.assign(new Error('forbidden'), { status: 403 });
  await assert.rejects(() => serviceWith(null, calls, audits, forbidden).get('site', { id: 'user', roles: ['READ_ONLY'] }), forbidden);
  assert.deepEqual(calls, ['assertSite:READ']);
  assert.equal(audits.length, 0);
});

test('get on a configured site returns the public integration and audits the read', async () => {
  const calls: string[] = []; const audits: any[] = [];
  const record = { id: 'integration', siteId: 'site', endpointUrl: 'https://ontap.example', username: 'reader', snapshot: null, lastAttemptAt: null, lastSuccessAt: null, lastErrorCode: null, updatedAt: new Date('2026-11-25T00:00:00Z'), passwordCiphertext: 'never-returned' };
  const result = await serviceWith(record, calls, audits).get('site', { id: 'user', roles: ['READ_ONLY'] });
  assert.equal(result.configured, true);
  assert.equal(result.id, 'integration');
  assert.equal(JSON.stringify(result).includes('never-returned'), false);
  assert.deepEqual(audits.map((entry) => entry.action), ['NETAPP_SNAPSHOT_READ']);
});

test('refresh still answers 404 NETAPP_INTEGRATION_NOT_CONFIGURED for a site without an integration', async () => {
  const calls: string[] = []; const audits: any[] = [];
  await assert.rejects(() => serviceWith(null, calls, audits).refresh('site', { id: 'user', roles: ['ADMIN'] }), (error: any) => error.getStatus() === 404 && error.getResponse().code === 'NETAPP_INTEGRATION_NOT_CONFIGURED');
  assert.equal(audits.length, 0);
});
