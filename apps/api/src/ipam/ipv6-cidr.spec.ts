import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ipv6Cidr } from './ipam-advanced.service';

test('IPv6 CIDR normalization does not add a third colon for a trailing zero run', () => {
  assert.equal(ipv6Cidr('2001:db8:1234::/48').cidr, '2001:db8:1234::/48');
});

test('IPv6 CIDR normalization keeps compression correct at the start, middle, and all-zero address', () => {
  assert.equal(ipv6Cidr('::1/64').cidr, '::/64');
  assert.equal(ipv6Cidr('2001:db8::1/64').cidr, '2001:db8::/64');
  assert.equal(ipv6Cidr('::/0').cidr, '::/0');
});
