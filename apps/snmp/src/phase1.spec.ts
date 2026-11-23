import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { LEGACY_SHARED_ENGINE_ID } from '@simoes/snmp-core';
import { PollProcessor } from './poll';
import { classifyTrapRejection, REJECTED_TRAP_WINDOW_MS, TrapReceiver } from './traps';

let originalAllowV2c: string | undefined;
let originalEngineId: string | undefined;

function rejectedReceiver() {
  const created: any[] = [];
  const prisma = { snmpTrapEvent: { create: async ({ data }: any) => { created.push(data); return { id: `event-${created.length}`, status: data.status }; } } } as any;
  return { receiver: new TrapReceiver(prisma, { add: async () => undefined } as any), created };
}

describe('SNMP Phase 1 receiver and poll policy', () => {
  before(() => {
    originalAllowV2c = process.env.SNMP_ALLOW_V2C;
    originalEngineId = process.env.SNMP_ENGINE_ID;
    delete process.env.SNMP_ALLOW_V2C;
  });

  after(() => {
    if (originalAllowV2c === undefined) delete process.env.SNMP_ALLOW_V2C; else process.env.SNMP_ALLOW_V2C = originalAllowV2c;
    if (originalEngineId === undefined) delete process.env.SNMP_ENGINE_ID; else process.env.SNMP_ENGINE_ID = originalEngineId;
  });

  it('classifies receiver authentication failures without keeping the error text', () => {
    assert.deepEqual(classifyTrapRejection(new Error('Notification ignored: unknown community "secret-c"'), false), { errorCode: 'SNMP_V2C_DISABLED', version: 'V2C' });
    assert.deepEqual(classifyTrapRejection(new Error('Notification ignored: unknown community "secret-c"'), true), { errorCode: 'SNMP_TRAP_UNKNOWN_COMMUNITY', version: 'V2C' });
    assert.deepEqual(classifyTrapRejection(new Error('Local user not found for message with user bob'), false), { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' });
    assert.deepEqual(classifyTrapRejection(new Error('Authentication digest mismatch'), false), { errorCode: 'SNMP_TRAP_AUTH_FAILED', version: 'V3' });
  });

  it('refuses a v2c trap without the lab flag and records it as REJECTED, never the community', async () => {
    const { receiver, created } = rejectedReceiver();
    await (receiver as any).persist({
      rinfo: { address: '10.9.9.9', port: 50000 },
      pdu: { type: (snmp.PduType as any).TrapV2, community: 'leaked-community', id: 1, varbinds: [{ oid: '1.3.6.1.6.3.1.1.4.1.0', type: snmp.ObjectType.OID, value: '1.3.6.1.6.3.1.1.5.3' }] },
    });
    assert.equal(created.length, 1);
    assert.equal(created[0].status, 'REJECTED');
    assert.equal(created[0].errorCode, 'SNMP_V2C_DISABLED');
    assert.equal(created[0].sourceAddress, '10.9.9.9');
    assert.deepEqual(created[0].varbinds, []);
    assert.equal(JSON.stringify(created).includes('leaked-community'), false);
  });

  it('stores at most one rejected trap per source per window', async () => {
    const { receiver, created } = rejectedReceiver();
    const start = 1_000_000;
    assert.equal(await receiver.recordRejected('10.1.1.1', 1, { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' }, start), true);
    assert.equal(await receiver.recordRejected('10.1.1.1', 1, { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' }, start + 1000), false);
    assert.equal(await receiver.recordRejected('10.1.1.2', 1, { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' }, start + 1000), true);
    assert.equal(await receiver.recordRejected('10.1.1.1', 1, { errorCode: 'SNMP_TRAP_UNKNOWN_USER', version: 'V3' }, start + REJECTED_TRAP_WINDOW_MS), true);
    assert.deepEqual(created.map((row) => row.sourceAddress), ['10.1.1.1', '10.1.1.2', '10.1.1.1']);
  });

  it('generates and stores one engine ID per install and ignores the old shared default', async () => {
    process.env.SNMP_ENGINE_ID = LEGACY_SHARED_ENGINE_ID;
    let row: any = null;
    const prisma = { snmpListenerConfig: {
      findUnique: async () => row && { engineId: row.engineId },
      create: async ({ data }: any) => { row = { ...data }; return row; },
      updateMany: async ({ where, data }: any) => { if (row && row.engineId === where.engineId) row.engineId = data.engineId; return { count: 1 }; },
    } } as any;
    const first = await new TrapReceiver(prisma, {} as any).resolveEngineId();
    assert.match(first, /^8000b98305[0-9a-f]{24}$/);
    assert.notEqual(first, LEGACY_SHARED_ENGINE_ID);
    assert.equal(row.engineId, first);
    assert.equal(await new TrapReceiver(prisma, {} as any).resolveEngineId(), first, 'restarts reuse the stored ID');
    process.env.SNMP_ENGINE_ID = '8000b98305112233445566778899';
    assert.equal(await new TrapReceiver(prisma, {} as any).resolveEngineId(), '8000b98305112233445566778899');
    assert.equal(row.engineId, first, 'an explicit operator ID does not overwrite the stored one');
  });

  it('counts a failed poll toward the unreachable threshold', async () => {
    const writes: any[] = [];
    const prisma = {
      snmpJob: { findUnique: async () => ({ id: 'job', deviceId: 'device', requestedBy: null, device: { managementIp: '10.0.0.1' }, credential: { id: 'cred', version: 'V2C' } }), update: (value: any) => ({ job: value }) },
      snmpDeviceConfig: { findUnique: async () => ({ id: 'config', enabled: true, timeoutMs: 1000, retries: 0, port: 161 }), update: (value: any) => ({ config: value }) },
      auditLog: { create: (value: any) => ({ audit: value }) },
      $transaction: async (items: any[]) => { writes.push(...items); return items; },
    } as any;
    const locks = { withLock: (_id: string, _ttl: number, work: () => Promise<unknown>) => work() } as any;
    await assert.rejects(new PollProcessor(prisma, locks).run('job'));
    const config = writes.find((item) => item.config)?.config;
    assert.deepEqual(config.data.consecutiveFailures, { increment: 1 });
    assert.equal(config.data.lastErrorCode, 'SNMP_V2C_DISABLED');
  });
});
