import * as assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { hostsFor } from './discovery-network';

describe('hostsFor', () => {
  it('enumerates private IPv4 networks without signed integer overflow', () => {
    const hosts = hostsFor('192.168.0.0/24');

    assert.equal(hosts.length, 254);
    assert.equal(hosts[0], '192.168.0.1');
    assert.equal(hosts.at(-1), '192.168.0.254');
  });

  it('accepts a subnet immediately below the discovery host limit', () => {
    const hosts = hostsFor('192.168.0.0/20');

    assert.equal(hosts.length, 4094);
    assert.equal(hosts[0], '192.168.0.1');
    assert.equal(hosts.at(-1), '192.168.15.254');
  });

  it('rejects subnets above the discovery host limit', () => {
    assert.throws(
      () => hostsFor('192.168.0.0/19'),
      /Discovery limitado a 4096 hosts/,
    );
  });
});
