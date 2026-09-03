import assert from 'node:assert/strict';
import { randomBytes } from 'node:crypto';
import dgram from 'node:dgram';
import { after, before, describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { encryptCredential, SNMP_OIDS, SnmpKeyring } from '@simoes/snmp-core';
import { createSnmpSession, get, pollStandard, setValues, setVarbinds } from './client';

const keyring: SnmpKeyring = { activeKeyId: 'test', keys: { test: Uint8Array.from(randomBytes(32)) } };
let agent: any;
let port: number;

function freeUdpPort() {
  return new Promise<number>((resolve, reject) => {
    const socket = dgram.createSocket('udp4');
    socket.once('error', reject);
    socket.bind(0, '127.0.0.1', () => {
      const address = socket.address();
      socket.close(() => resolve(typeof address === 'object' ? address.port : 0));
    });
  });
}

function stored(version: 'V2C' | 'V3', secret: Record<string, string>) {
  return {
    version,
    username: secret.username ?? null,
    authProtocol: version === 'V3' ? 'SHA256' : null,
    privProtocol: version === 'V3' ? 'AES128' : null,
    ...encryptCredential(secret, keyring),
  };
}

describe('SNMP client against a controlled agent', () => {
  before(async () => {
    port = await freeUdpPort();
    agent = snmp.createAgent({
      address: '127.0.0.1',
      port,
      disableAuthorization: false,
      accessControlModelType: snmp.AccessControlModelType.Simple,
      engineID: '8000b983800102030405060708090a0b',
    }, () => undefined);
    const authorizer = agent.getAuthorizer();
    authorizer.addCommunity('private-community');
    authorizer.addUser({
      name: 'snmp-test-user',
      level: snmp.SecurityLevel.authPriv,
      authProtocol: (snmp.AuthProtocols as any).sha256,
      authKey: 'authentication-key',
      privProtocol: snmp.PrivProtocols.aes,
      privKey: 'privacy-key',
    });
    const access = authorizer.getAccessControlModel();
    access.setCommunityAccess('private-community', snmp.AccessLevel.ReadWrite);
    access.setUserAccess('snmp-test-user', snmp.AccessLevel.ReadWrite);
    agent.registerProvider({ name: 'sysName', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.5', scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-write'] });
    agent.registerProvider({ name: 'sysLocation', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.6', scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-write'] });
    agent.registerProvider({ name: 'sysDescr', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.1', scalarType: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] });
    agent.registerProvider({ name: 'sysObjectId', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.2', scalarType: snmp.ObjectType.OID, maxAccess: snmp.MaxAccess['read-only'] });
    agent.registerProvider({ name: 'sysUpTime', type: snmp.MibProviderType.Scalar, oid: '1.3.6.1.2.1.1.3', scalarType: snmp.ObjectType.TimeTicks, maxAccess: snmp.MaxAccess['read-only'] });
    agent.registerProvider({
      name: 'ifTable', type: snmp.MibProviderType.Table, oid: '1.3.6.1.2.1.2.2.1', maxAccess: snmp.MaxAccess['not-accessible'],
      tableColumns: [
        { number: 1, name: 'ifIndex', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 2, name: 'ifDescr', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 3, name: 'ifType', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 5, name: 'ifSpeed', type: snmp.ObjectType.Gauge, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 6, name: 'ifPhysAddress', type: snmp.ObjectType.OctetString, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 7, name: 'ifAdminStatus', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 8, name: 'ifOperStatus', type: snmp.ObjectType.Integer, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 10, name: 'ifInOctets', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
        { number: 16, name: 'ifOutOctets', type: snmp.ObjectType.Counter, maxAccess: snmp.MaxAccess['read-only'] },
      ],
      tableIndex: [{ columnName: 'ifIndex' }],
    });
    agent.getMib().setScalarValue('sysName', 'lab-switch');
    agent.getMib().setScalarValue('sysLocation', 'laboratory');
    agent.getMib().setScalarValue('sysDescr', 'Controlled SNMP agent');
    agent.getMib().setScalarValue('sysObjectId', '1.3.6.1.4.1.8072.3.2.10');
    agent.getMib().setScalarValue('sysUpTime', 123456);
    agent.getMib().addTableRow('ifTable', [1, 'eth0', 6, 1_000_000_000, Buffer.from('001122334455', 'hex'), 1, 1, 1234, 5678]);
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  after(() => new Promise<void>((resolve) => agent.close(() => resolve())));

  it('performs GET and predefined SET over SNMPv2c', async () => {
    const session = createSnmpSession('127.0.0.1', port, 1000, 0, stored('V2C', { community: 'private-community' }), keyring);
    try {
      const before = await get(session, [SNMP_OIDS.sysName]);
      assert.equal(before[0].value.toString(), 'lab-switch');
      await setValues(session, setVarbinds({ operation: 'SYSTEM_IDENTITY', sysName: 'lab-switch-updated' }));
      const afterSet = await get(session, [SNMP_OIDS.sysName]);
      assert.equal(afterSet[0].value.toString(), 'lab-switch-updated');
    } finally { session.close(); }
  });

  it('performs authenticated and encrypted GET over SNMPv3', async () => {
    const credential = stored('V3', { username: 'snmp-test-user', authKey: 'authentication-key', privKey: 'privacy-key' });
    const session = createSnmpSession('127.0.0.1', port, 1500, 0, credential, keyring);
    try {
      const values = await get(session, [SNMP_OIDS.sysLocation]);
      assert.equal(values[0].value.toString(), 'laboratory');
    } finally { session.close(); }
  });

  it('walks system and IF-MIB data over v2c and v3 authPriv', async () => {
    const credentials = [
      stored('V2C', { community: 'private-community' }),
      stored('V3', { username: 'snmp-test-user', authKey: 'authentication-key', privKey: 'privacy-key' }),
    ];
    for (const credential of credentials) {
      const session = createSnmpSession('127.0.0.1', port, 1500, 0, credential, keyring);
      try {
        const result = await pollStandard(session);
        assert.equal(result.system.sysDescr, 'Controlled SNMP agent');
        assert.equal(result.interfaces[0].ifIndex, 1);
        assert.equal(result.interfaces[0].description, 'eth0');
        assert.equal(result.interfaces[0].adminUp, true);
        assert.equal(result.interfaces[0].operUp, true);
        assert.equal(result.interfaces[0].speedMbps, 1000);
      } finally { session.close(); }
    }
  });

  it('fails closed for an unknown community and an unavailable device', async () => {
    for (const target of [
      { host: '127.0.0.1', port, community: 'unknown-community' },
      { host: '127.0.0.1', port: port + 1, community: 'private-community' },
    ]) {
      const session = createSnmpSession(target.host, target.port, 100, 0, stored('V2C', { community: target.community }), keyring);
      try { await assert.rejects(() => get(session, [SNMP_OIDS.sysName]), /timed out/i); }
      finally { session.close(); }
    }
  });
});
