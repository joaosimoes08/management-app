import assert from 'node:assert/strict';
import dgram from 'node:dgram';
import { after, before, describe, it } from 'node:test';
import * as snmp from 'net-snmp';

let receiver: any;
let port: number;
const notifications: any[] = [];
const rejections: Error[] = [];

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

function sent(action: (callback: (error?: Error | null) => void) => void) {
  return new Promise<void>((resolve, reject) => action((error) => error ? reject(error) : resolve()));
}

async function waitUntil(predicate: () => boolean) {
  const deadline = Date.now() + 1500;
  while (!predicate()) {
    if (Date.now() > deadline) throw new Error('SNMP_TEST_EVENT_TIMEOUT');
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
}

describe('SNMP trap/inform receiver authorization', () => {
  before(async () => {
    port = await freeUdpPort();
    receiver = snmp.createReceiver({
      address: '127.0.0.1', port, transport: 'udp4', disableAuthorization: false,
      includeAuthentication: true, engineID: '8000b983800102030405060708090a0c',
    }, (error: Error | null, notification: any) => error ? rejections.push(error) : notifications.push(notification));
    const authorizer = receiver.getAuthorizer();
    authorizer.addCommunity('trap-community');
    authorizer.addUser({
      name: 'trap-user', level: snmp.SecurityLevel.authPriv,
      authProtocol: (snmp.AuthProtocols as any).sha256, authKey: 'authentication-key',
      privProtocol: snmp.PrivProtocols.aes, privKey: 'privacy-key',
    });
    await new Promise((resolve) => setTimeout(resolve, 25));
  });

  after(() => new Promise<void>((resolve) => receiver.close(() => resolve())));

  it('accepts an authorized SNMPv2c trap and inform', async () => {
    const session = snmp.createSession('127.0.0.1', 'trap-community', { version: snmp.Version2c, port, trapPort: port, timeout: 500, retries: 0 });
    try {
      const initial = notifications.length;
      await sent((callback) => session.trap(snmp.TrapType.LinkDown, [], callback));
      await waitUntil(() => notifications.length === initial + 1);
      await sent((callback) => session.inform('1.3.6.1.6.3.1.1.5.4', [], callback as any));
      await waitUntil(() => notifications.length === initial + 2);
      assert.equal(notifications[initial].pdu.community, 'trap-community');
    } finally { session.close(); }
  });

  it('accepts an authenticated and encrypted SNMPv3 trap', async () => {
    const session = snmp.createV3Session('127.0.0.1', {
      name: 'trap-user', level: snmp.SecurityLevel.authPriv,
      authProtocol: (snmp.AuthProtocols as any).sha256, authKey: 'authentication-key',
      privProtocol: snmp.PrivProtocols.aes, privKey: 'privacy-key',
    }, { port, trapPort: port, timeout: 1000, retries: 0 });
    try {
      const initial = notifications.length;
      await sent((callback) => session.trap(snmp.TrapType.WarmStart, [], callback));
      await waitUntil(() => notifications.length === initial + 1);
      assert.equal(notifications[initial].pdu.user, 'trap-user');
    } finally { session.close(); }
  });

  it('rejects an unknown identity', async () => {
    const session = snmp.createSession('127.0.0.1', 'unknown-community', { version: snmp.Version2c, port, trapPort: port, timeout: 200, retries: 0 });
    try {
      const initial = rejections.length;
      await sent((callback) => session.trap(snmp.TrapType.AuthenticationFailure, [], callback));
      await waitUntil(() => rejections.length === initial + 1);
      assert.ok(rejections[initial]);
    } finally { session.close(); }
  });
});
