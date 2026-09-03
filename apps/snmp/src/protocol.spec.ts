import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { setVarbinds, snmpAuthProtocol, snmpPrivProtocol } from './client';
import { setVerificationMatches } from './set';
import { classifyTrap, isSupportedNotificationPdu } from './traps';

describe('SNMP protocol policy', () => {
  it('maps persisted SHA1 compatibility to the Net-SNMP SHA protocol', () => {
    assert.equal(snmpAuthProtocol('SHA1'), (snmp.AuthProtocols as any).sha);
    assert.equal(snmpAuthProtocol('SHA256'), (snmp.AuthProtocols as any).sha256);
    assert.throws(() => snmpAuthProtocol('MD5'));
  });
  it('accepts only AES privacy protocols', () => {
    assert.equal(snmpPrivProtocol('AES128'), snmp.PrivProtocols.aes);
    assert.throws(() => snmpPrivProtocol('DES'));
    assert.throws(() => snmpPrivProtocol(''));
  });
  it('maps only the predefined interface SET operation', () => {
    assert.deepEqual(setVarbinds({ operation: 'INTERFACE_ADMIN_STATUS', interfaceId: '8d832270-fb4e-4d97-a95f-5f2f0c8da911', adminUp: false }, 17), [{ oid: '1.3.6.1.2.1.2.2.1.7.17', type: snmp.ObjectType.Integer, value: 2 }]);
  });

  it('normalizes standard and vendor traps', () => {
    assert.deepEqual(classifyTrap('1.3.6.1.6.3.1.1.5.3'), { category: 'LINK_DOWN', severity: 'WARNING' });
    assert.deepEqual(classifyTrap('1.3.6.1.4.1.9.9.1'), { category: 'VENDOR', severity: 'INFO' });
  });

  it('rejects the SNMPv1 trap PDU while accepting v2/v3 notifications', () => {
    assert.equal(isSupportedNotificationPdu((snmp.PduType as any).Trap), false);
    assert.equal(isSupportedNotificationPdu((snmp.PduType as any).TrapV2), true);
    assert.equal(isSupportedNotificationPdu((snmp.PduType as any).InformRequest), true);
  });

  it('detects a divergent SET verification result', () => {
    const expected = [{ oid: '1.3.6.1.2.1.1.5.0', value: 'expected-name' }];
    assert.equal(setVerificationMatches(expected, { '1.3.6.1.2.1.1.5.0': 'expected-name' }), true);
    assert.equal(setVerificationMatches(expected, { '1.3.6.1.2.1.1.5.0': 'different-name' }), false);
  });
});
