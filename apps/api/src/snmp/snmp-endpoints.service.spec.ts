import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ForbiddenException } from '@nestjs/common';
import { parseMac, SnmpEndpointsService } from './snmp-endpoints.service';

describe('D-P1e endpoint lookup', () => {
  it('normalises colon, dash, Cisco dot and bare forms, and refuses anything else', () => {
    for (const value of ['00:A3:D1:EE:00:50', '00-a3-d1-ee-00-50', '00a3.d1ee.0050', '00a3d1ee0050']) assert.equal(parseMac(value), '00:a3:d1:ee:00:50');
    for (const value of [undefined, '', 'nope', '00a3d1ee00', '00a3d1ee0050ff']) assert.equal(parseMac(value), null);
  });

  it('drops sightings on devices the caller cannot read, and raises errors that are not about scope', async () => {
    const row = (deviceId: string) => ({ id: deviceId, deviceId, ipAddress: '10.0.0.5', macAddress: '00:a3:d1:ee:00:50', ifIndex: 1, interfaceName: 'Gi1/0/1', entryType: 'DYNAMIC', vlanId: 70, bridgePort: 1, status: 'LEARNED', source: 'x', firstSeenAt: new Date(0), lastSeenAt: new Date(1), device: { name: deviceId } });
    const prisma = {
      snmpArpEntry: { findMany: async () => [row('a'), row('b')], groupBy: async () => [{ deviceId: 'a', _max: { lastSeenAt: new Date(1) } }] },
      snmpMacEntry: { findMany: async () => [row('a'), row('b')], groupBy: async () => [] },
    };
    let fail: Error | null = null;
    const access = { assertDevice: async (_user: unknown, action: string, id: string) => { assert.equal(action, 'READ'); if (fail) throw fail; if (id === 'b') throw new ForbiddenException(); } };
    const service = new SnmpEndpointsService(prisma as never, access as never);
    const result = await service.lookup({ id: 'u' } as never, { mac: '00a3d1ee0050' });
    assert.deepEqual(result.arp.map((item) => [item.deviceId, item.current]), [['a', true]]);
    assert.deepEqual(result.mac.map((item) => [item.deviceId, item.vlanId, item.current]), [['a', 70, false]]);
    fail = new Error('db down');
    await assert.rejects(service.lookup({ id: 'u' } as never, { mac: '00a3d1ee0050' }), /db down/);
  });
});
