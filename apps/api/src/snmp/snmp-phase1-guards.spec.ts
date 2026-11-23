import { strict as assert } from 'node:assert';
import { after, before, describe, it } from 'node:test';
import { SnmpService } from './snmp.service';

let originalAllowV2c: string | undefined;

function service(device: Record<string, unknown>, traps: Array<{ id: string; receivedAt: Date }> = []) {
  const instance = Object.create(SnmpService.prototype) as any;
  instance.device = async () => ({ id: 'device-1', name: 'SW-01', type: 'SWITCH', managementIp: '10.0.0.5', siteId: 'site-1', ...device });
  let transactions = 0;
  instance.prisma = {
    snmpDeviceConfig: { findUnique: async () => null },
    snmpCredential: { findMany: async () => [] },
    snmpSnapshot: { findFirst: async () => null },
    snmpJob: { findMany: async () => [] },
    snmpDrift: { findMany: async () => [] },
    snmpTrapEvent: { findMany: async () => traps },
    $transaction: async () => { transactions += 1; throw new Error('STOP_AFTER_GUARDS'); },
  };
  instance.publicCredential = (item: unknown) => item;
  return { instance, transactions: () => transactions };
}

const v3 = { purpose: 'TRAP', version: 'V3', username: 'trap-user', authKey: 'auth-key-123', privKey: 'priv-key-123' };
const code = (expected: string) => (error: any) => error?.response?.code === expected;

describe('SNMP Phase 1 API guards', () => {
  before(() => { originalAllowV2c = process.env.SNMP_ALLOW_V2C; delete process.env.SNMP_ALLOW_V2C; });
  after(() => { if (originalAllowV2c === undefined) delete process.env.SNMP_ALLOW_V2C; else process.env.SNMP_ALLOW_V2C = originalAllowV2c; });

  it('1.3 (rev. 4): accepts a v2c credential by default and refuses it only when SNMP_ALLOW_V2C=false', async () => {
    const { instance, transactions } = service({});
    assert.deepEqual(instance.credentialSecret({ version: 'V2C', community: 'community-123' }), { community: 'community-123' }, 'v2c accepted with the flag unset');
    assert.throws(() => instance.credentialSecret({ version: 'V2C', community: 'short' }), code('SNMP_COMMUNITY_INVALID'), 'a v2c community still needs 8 characters');
    assert.throws(() => instance.credentialSecret({ version: 'V1' as any, community: 'community-123' }), code('SNMP_V3_SECRET_INCOMPLETE'), 'anything that is not V2C is held to the v3 rules');
    process.env.SNMP_ALLOW_V2C = 'false';
    try {
      await assert.rejects(instance.createCredential('device-1', { purpose: 'READ', version: 'V2C', community: 'community-123' }, 'user'), code('SNMP_V2C_DISABLED'));
      assert.equal(transactions(), 0, 'nothing stored');
      assert.throws(() => instance.credentialSecret({ version: 'V2C', community: 'community-123' }), code('SNMP_V2C_DISABLED'), 'enrollment and onboarding share this check');
    } finally { delete process.env.SNMP_ALLOW_V2C; }
    assert.deepEqual(instance.credentialSecret({ version: 'V3', username: 'u', authKey: 'auth-key-123', privKey: 'priv-key-123' }), { username: 'u', authKey: 'auth-key-123', privKey: 'priv-key-123' });
  });

  it('2.2: a TRAP credential needs a site and a valid management IP', async () => {
    await assert.rejects(service({ siteId: null }).instance.createCredential('device-1', v3, 'user'), code('SNMP_TRAP_SITE_REQUIRED'));
    await assert.rejects(service({ managementIp: null }).instance.createCredential('device-1', v3, 'user'), code('SNMP_MANAGEMENT_IP_REQUIRED'));
    await assert.rejects(service({ managementIp: 'not-an-ip' }).instance.createCredential('device-1', v3, 'user'), code('SNMP_MANAGEMENT_IP_REQUIRED'));
    // READ credentials keep the previous rules; a complete TRAP device passes the guards and reaches storage
    const read = service({ siteId: null });
    await assert.rejects(read.instance.createCredential('device-1', { ...v3, purpose: 'READ' }, 'user'), /STOP_AFTER_GUARDS/);
    const ok = service({});
    await assert.rejects(ok.instance.createCredential('device-1', v3, 'user'), /STOP_AFTER_GUARDS/);
    assert.equal(ok.transactions(), 1);
  });

  it('2.2: the overview exposes when the device last sent a trap', async () => {
    const latest = new Date('2026-11-23T10:00:00Z');
    const withTraps = await service({}, [{ id: 't2', receivedAt: latest, trapOid: null, varbinds: [] } as never, { id: 't1', receivedAt: new Date('2026-11-22T10:00:00Z'), trapOid: null, varbinds: [] } as never]).instance.overview('device-1', 'user');
    assert.equal(withTraps.lastTrapReceivedAt, latest);
    assert.equal((await service({}).instance.overview('device-1', 'user')).lastTrapReceivedAt, null);
  });
});
