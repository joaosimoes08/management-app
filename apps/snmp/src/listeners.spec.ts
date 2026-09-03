import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { configuredListenerAddresses, runtimeIpv4Interfaces, selfTestExpectedAddresses, snmpSelfTestProxySources, snmpSelfTestSourceAllowed, TrapReceiver } from './traps';

test('runtime listener inventory exposes only IPv4 addresses with interface names', () => {
  const result = runtimeIpv4Interfaces('snmp-a', {
    en0: [
      { address: '10.0.0.5', family: 'IPv4', internal: false },
      { address: 'fe80::1', family: 'IPv6', internal: false },
    ],
    lo0: [{ address: '127.0.0.1', family: 'IPv4', internal: true }],
  } as never);
  assert.deepEqual(result, [
    { instanceId: 'snmp-a', name: 'en0', address: '10.0.0.5', internal: false },
    { instanceId: 'snmp-a', name: 'lo0', address: '127.0.0.1', internal: true },
  ]);
});

test('selected listener addresses must match the current runtime identity exactly', () => {
  const current = [
    { instanceId: 'snmp-a', name: 'en0', address: '10.0.0.5', internal: false },
    { instanceId: 'snmp-a', name: 'en1', address: '10.0.1.5', internal: false },
  ];
  assert.deepEqual(configuredListenerAddresses(false, [
    { instanceId: 'snmp-a', name: 'en1', address: '10.0.1.5' },
    { instanceId: 'snmp-b', name: 'en0', address: '10.0.0.5' },
    { instanceId: 'snmp-a', name: 'en0', address: '203.0.113.8' },
  ], current), ['10.0.1.5']);
  assert.deepEqual(configuredListenerAddresses(false, [], current), []);
});

test('self-test proxy sources are disabled by default and accept only explicit IPv4 addresses', () => {
  assert.deepEqual(snmpSelfTestProxySources('', '192.168.65.1'), []);
  assert.deepEqual(snmpSelfTestProxySources('false', '192.168.65.1'), []);
  assert.deepEqual(snmpSelfTestProxySources('true', '192.168.65.1, invalid, 192.168.65.1, ::1'), ['192.168.65.1']);
});

test('translated self-test sources require a separate explicit opt-in', () => {
  assert.equal(snmpSelfTestSourceAllowed('144.202.100.225', 'true', '127.0.0.1', 'false'), false);
  assert.equal(snmpSelfTestSourceAllowed('144.202.100.225', 'true', '127.0.0.1', 'true'), true);
  assert.equal(snmpSelfTestSourceAllowed('144.202.100.225', 'false', '127.0.0.1', 'true'), false);
  assert.equal(snmpSelfTestSourceAllowed('invalid', 'true', '', 'true'), false);
});

test('self-test expects only fresh host interfaces selected for listening', () => {
  const current = [
    { instanceId: 'host:a', name: 'en0', address: '10.0.0.5', internal: false },
    { instanceId: 'host:a', name: 'en1', address: '10.0.1.5', internal: false },
  ];
  assert.deepEqual(selfTestExpectedAddresses(true, [], current), ['10.0.0.5', '10.0.1.5']);
  assert.deepEqual(selfTestExpectedAddresses(false, [
    { instanceId: 'host:a', name: 'en1', address: '10.0.1.5' },
    { instanceId: 'host:b', name: 'en0', address: '10.0.0.5' },
  ], current), ['10.0.1.5']);
});

test('expired enrollment cleanup is checked even when no listener socket is active', async () => {
  let cleanupChecked = false;
  const receiver = new TrapReceiver({
    snmpTrapEnrollment: { findMany: async () => { cleanupChecked = true; return []; } },
  } as never, {} as never);
  await receiver.reloadCredentials();
  assert.equal(cleanupChecked, true);
});
