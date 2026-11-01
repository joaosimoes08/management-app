import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SnmpService } from './snmp.service';

const service = Object.create(SnmpService.prototype) as any;

describe('SNMP credential policy and redaction', () => {
  it('returns metric history only after device access and scopes samples to the requested interface', async () => {
    let accessChecked = false;
    const observedAt = new Date('2026-10-31T12:00:00.000Z');
    const metricsService = Object.create(SnmpService.prototype) as any;
    metricsService.device = async (deviceId: string, user: unknown) => { accessChecked = deviceId === 'device-1' && user === 'reader'; };
    metricsService.prisma = {
      snmpSnapshot: {
        findMany: async () => [{ observedAt, interfaces: [
          { ifIndex: 3, name: 'uplink', description: null, adminUp: true, operUp: true, speedMbps: 1000, counters: { hcInOctets: '1000', hcOutOctets: '2000' } },
          { ifIndex: 4, name: 'other', description: null, adminUp: true, operUp: false, speedMbps: 100, counters: {} },
        ] }],
        findFirst: async () => ({ interfaces: [{ ifIndex: 3, name: 'uplink', description: null }, { ifIndex: 4, name: 'other', description: null }] }),
      },
      snmpDeviceConfig: { findUnique: async () => ({ intervalMinutes: 15 }) },
      snmpJob: { findMany: async () => [{ id: 'poll-1', status: 'FAILED', errorCode: 'SNMP_TIMEOUT', createdAt: observedAt, completedAt: observedAt }] },
    };
    const result = await metricsService.metrics('device-1', 'reader', 3, 7);
    assert.equal(accessChecked, true);
    assert.equal(result.selectedInterfaceIndex, 3);
    assert.equal(result.interfaces.length, 2);
    assert.equal(result.interfacesHistory.length, 1);
    assert.equal(result.interfacesHistory[0].operUp, true);
    assert.equal(result.availability[0].available, false);
    assert.equal(result.availability[0].errorCode, 'SNMP_TIMEOUT');
  });

  it('rejects unsupported periods and interface indices', async () => {
    const metricsService = Object.create(SnmpService.prototype) as any;
    await assert.rejects(metricsService.metrics('device-1', 'reader', undefined, 2));
    await assert.rejects(metricsService.metrics('device-1', 'reader', 0, 7));
  });

  it('requires authPriv material and gates SHA-1 compatibility', () => {
    assert.deepEqual(service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value' }), {
      username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value',
    });
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: false }));
    assert.doesNotThrow(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: true }));
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'short', privKey: 'short' }));
  });

  it('never exposes encrypted payload fields in API summaries', () => {
    const output = service.publicCredential({
      id: 'credential-id', deviceId: 'device-id', purpose: 'READ', version: 'V3', username: 'operator',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'),
      keyId: 'v1', enabled: true,
    });
    assert.equal(output.configured, true);
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
  });

  it('redacts enrollment envelopes and selects the most specific Site subnet', () => {
    const output = service.publicEnrollment({
      id: 'enrollment-id', siteId: 'site-id', sourceAddress: '10.20.30.42', status: 'DISCOVERED',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'), keyId: 'v1',
    });
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
    assert.equal(service.mostSpecificSubnet('10.20.30.42', [
      { id: 'broad', cidr: '10.0.0.0/8' },
      { id: 'site', cidr: '10.20.30.0/24' },
      { id: 'specific', cidr: '10.20.30.32/28' },
      { id: 'other', cidr: '10.20.31.0/24' },
    ]).id, 'specific');
    assert.equal(service.mostSpecificSubnet('192.0.2.1', [{ id: 'site', cidr: '10.20.30.0/24' }]), undefined);
  });
});
