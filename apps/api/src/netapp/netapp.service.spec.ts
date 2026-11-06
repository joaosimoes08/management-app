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
