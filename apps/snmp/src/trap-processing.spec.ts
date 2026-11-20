import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { TrapReceiver } from './traps';

function receiverFor(event: Record<string, unknown>) {
  const updates: any[] = []; const audits: any[] = [];
  const prisma = {
    snmpTrapEvent: { findUnique: async () => event, update: (args: any) => { updates.push(args); return args; } },
    auditLog: { create: (args: any) => { audits.push(args); return args; } },
    $transaction: async (operations: unknown[]) => operations,
  };
  return { receiver: new TrapReceiver(prisma as any, {} as any), updates, audits };
}

describe('trap processing with the catalog', () => {
  it('stores the decoded Cisco category and state-aware severity, leaving varbinds untouched', async () => {
    const varbinds = [
      { oid: '1.3.6.1.6.3.1.1.4.1.0', type: 6, value: '1.3.6.1.4.1.9.9.13.3.0.8' },
      { oid: '1.3.6.1.4.1.9.9.13.1.4.1.2.1012', type: 4, value: { encoding: 'hex', value: Buffer.from('Switch 1 - FAN 2').toString('hex') } },
      { oid: '1.3.6.1.4.1.9.9.13.1.4.1.3.1012', type: 2, value: 1 },
    ];
    const { receiver, updates, audits } = receiverFor({ id: 'e1', status: 'PENDING', trapOid: '1.3.6.1.4.1.9.9.13.3.0.8', varbinds, deviceId: 'd1', credentialId: 'c1', sourceAddress: '192.0.2.10' });
    await receiver.process('e1');
    assert.equal(updates.length, 1);
    assert.equal(updates[0].data.category, 'ENV_FAN');
    assert.equal(updates[0].data.severity, 'INFO');
    assert.equal(updates[0].data.status, 'PROCESSED');
    assert.equal('varbinds' in updates[0].data, false);
    assert.equal(audits[0].data.metadata.category, 'ENV_FAN');
  });

  it('keeps unknown notifications as VENDOR/INFO', async () => {
    const { receiver, updates } = receiverFor({ id: 'e2', status: 'PENDING', trapOid: '1.3.6.1.4.1.99999.0.1', varbinds: [{ oid: '1.3.6.1.4.1.99999.1.0', type: 4, value: { encoding: 'hex', value: '00ff' } }], deviceId: 'd1', credentialId: 'c1', sourceAddress: '192.0.2.10' });
    await receiver.process('e2');
    assert.equal(updates[0].data.category, 'VENDOR');
    assert.equal(updates[0].data.severity, 'INFO');
    assert.equal('varbinds' in updates[0].data, false);
  });
});
