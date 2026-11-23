import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { summarizeUnmatchedTrapSources } from './snmp.service';
import { summarizeSnmpFleet } from './snmp-fleet.service';
import { snmpV2cAllowed } from '@simoes/snmp-core';
import { snmpContainerReceiverView, snmpReceiverModeView, snmpReceiverView } from '../settings/settings.service';

test('unknown trap sources are listed newest first with count, first/last seen, latest trap and pre-registration', () => {
  const items = summarizeUnmatchedTrapSources(
    [
      { sourceAddress: '10.0.0.5', count: 3, firstSeenAt: new Date('2026-11-20T10:00:00Z'), lastSeenAt: new Date('2026-11-21T10:00:00Z') },
      { sourceAddress: '10.0.0.9', count: 1, firstSeenAt: new Date('2026-11-22T10:00:00Z'), lastSeenAt: new Date('2026-11-22T10:00:00Z') },
    ],
    [{ sourceAddress: '10.0.0.5', trapOid: '1.3.6.1.6.3.1.1.5.3', label: 'Porta em baixo', version: 'V3' }],
    new Set(['10.0.0.9']),
  );
  assert.deepEqual(items.map((item) => item.sourceAddress), ['10.0.0.9', '10.0.0.5']);
  assert.deepEqual(items[1], { sourceAddress: '10.0.0.5', count: 3, firstSeenAt: new Date('2026-11-20T10:00:00Z'), lastSeenAt: new Date('2026-11-21T10:00:00Z'), lastTrapLabel: 'Porta em baixo', lastTrapOid: '1.3.6.1.6.3.1.1.5.3', version: 'V3', preRegistered: false });
  assert.equal(items[0].preRegistered, true);
  assert.equal(items[0].lastTrapLabel, null);
});

test('network devices without SNMP are listed last in the attention list as NOT_CONFIGURED', () => {
  const now = new Date('2026-11-23T12:00:00Z');
  const summary = summarizeSnmpFleet([
    { id: 'a', name: 'access-1', type: 'SWITCH', siteId: 's', snmpConfig: null, pendingDrifts: 0 },
    { id: 'b', name: 'core-1', type: 'SWITCH', siteId: 's', snmpConfig: { enabled: true, intervalMinutes: 15, lastPollAt: null, nextPollAt: null, lastStatus: 'FAILED', lastErrorCode: 'SNMP_TIMEOUT' }, pendingDrifts: 0 },
  ], now);
  assert.deepEqual(summary.attention.map((item) => [item.name, item.reason]), [['core-1', 'FAILED'], ['access-1', 'NOT_CONFIGURED']]);
  assert.equal(summary.devices.notConfigured, 1);
});

test('the setup panel gets the published trap port (default 162) and whether v2c is accepted', () => {
  assert.equal(snmpReceiverView(undefined, snmpV2cAllowed(undefined)).v2cAllowed, true, 'v2c accepted by default');
  assert.equal(snmpReceiverView(undefined, snmpV2cAllowed('false')).v2cAllowed, false, 'opt-out');
  assert.deepEqual(snmpReceiverView(undefined, false), { trapPort: 162, v2cAllowed: false });
  assert.deepEqual(snmpReceiverView('10162', true), { trapPort: 10162, v2cAllowed: true });
  assert.deepEqual(snmpReceiverView('99999', false), { trapPort: 162, v2cAllowed: false });
  assert.deepEqual(snmpReceiverView('abc', false), { trapPort: 162, v2cAllowed: false });
});

test('container mode: the receiver address comes from SNMP_TRAP_PUBLIC_ADDRESS, then a real SNMP_TRAP_HOST_IP, else null with a reason', () => {
  assert.deepEqual(snmpContainerReceiverView({ publicAddress: ' 192.0.2.21 ', hostIp: '10.1.1.5', hostPort: '10162' }), { address: '192.0.2.21', addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS', reason: null, port: 10162 });
  assert.deepEqual(snmpContainerReceiverView({ publicAddress: '2001:db8::20' }), { address: '2001:db8::20', addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS', reason: null, port: 162 }, 'IPv6 literal');
  assert.deepEqual(snmpContainerReceiverView({ publicAddress: '192.0.2.20', hostIp: '0.0.0.0' }), { address: '192.0.2.20', addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS', reason: null, port: 162 });
  assert.deepEqual(snmpContainerReceiverView({ publicAddress: '', hostIp: '10.1.1.5' }), { address: '10.1.1.5', addressSource: 'SNMP_TRAP_HOST_IP', reason: null, port: 162 }, 'falls back to the host IP');
  for (const hostIp of ['0.0.0.0', undefined, '', '::', '::1', '127.0.0.1', '999.999.1.1', 'traps.example.internal']) {
    assert.deepEqual(snmpContainerReceiverView({ hostIp }), { address: null, addressSource: null, reason: 'SNMP_TRAP_PUBLIC_ADDRESS_REQUIRED', port: 162 }, `hostIp ${hostIp}`);
  }
  for (const publicAddress of ['not a host!', '0.0.0.0', '127.0.0.1', '127.1.2.3', '::', '::1', '::ffff:127.0.0.1', '999.999.1.1', 'traps.example.internal', 'snmp-receiver']) {
    assert.deepEqual(snmpContainerReceiverView({ publicAddress, hostIp: '10.1.1.5' }), { address: null, addressSource: null, reason: 'SNMP_TRAP_PUBLIC_ADDRESS_INVALID', port: 162 }, `publicAddress ${publicAddress}: reported, not silently replaced`);
  }
});

test('host-agent mode is unchanged: no container receiver while the agent reports interfaces', () => {
  const env = { publicAddress: '192.0.2.20', hostIp: '10.1.1.5', hostPort: '162' };
  assert.deepEqual(snmpReceiverModeView(2, env), { receiverMode: 'HOST_AGENT', containerReceiver: null });
  assert.deepEqual(snmpReceiverModeView(0, env), { receiverMode: 'CONTAINER_INGRESS', containerReceiver: { address: '192.0.2.20', addressSource: 'SNMP_TRAP_PUBLIC_ADDRESS', reason: null, port: 162 } });
});
