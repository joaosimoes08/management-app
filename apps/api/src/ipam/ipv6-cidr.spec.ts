import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { addressInCidr, ipv6Cidr } from './ipam-advanced.service';

test('IPv6 CIDR normalization does not add a third colon for a trailing zero run', () => {
  assert.equal(ipv6Cidr('2001:db8:1234::/48').cidr, '2001:db8:1234::/48');
});

test('IPv6 CIDR normalization keeps compression correct at the start, middle, and all-zero address', () => {
  assert.equal(ipv6Cidr('::1/64').cidr, '::/64');
  assert.equal(ipv6Cidr('2001:db8::1/64').cidr, '2001:db8::/64');
  assert.equal(ipv6Cidr('::/0').cidr, '::/0');
});

test('IPv4-mapped IPv6 CIDRs normalize and compare their dotted tails as two hexadecimal groups', () => {
  assert.equal(ipv6Cidr('::ffff:192.0.2.1/128').cidr, '::ffff:c000:201/128');
  assert.equal(ipv6Cidr('::ffff:192.0.2.255/120').cidr, '::ffff:c000:200/120');
  assert.equal(addressInCidr('::ffff:192.0.2.1', '::ffff:192.0.2.0/120'), true);
  assert.equal(addressInCidr('::ffff:192.0.3.1', '::ffff:192.0.2.0/120'), false);
});
