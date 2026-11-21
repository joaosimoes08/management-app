import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { countTokens, diffPrefixes, parseCidr, parsePrefixList, summarizeDiff } from './ripe-diff';

test('parses, normalises and de-duplicates pasted IPv4/IPv6 prefixes', () => {
  const parsed = parsePrefixList(['193.0.0.0/21\n193.0.10.1/23, 2001:DB8:0:0::/32;bad', '10.0.0.5', '193.0.0.0/21', '10.0.0.0/33']);
  assert.deepEqual(parsed.valid.map((item) => item.prefix), ['193.0.0.0/21', '193.0.10.0/23', '2001:db8::/32']);
  assert.deepEqual(parsed.normalized, [{ input: '193.0.10.1/23', prefix: '193.0.10.0/23' }, { input: '2001:DB8:0:0::/32', prefix: '2001:db8::/32' }]);
  assert.deepEqual(parsed.duplicates, ['193.0.0.0/21']);
  assert.deepEqual(parsed.invalid.map((item) => [item.input, item.reason]), [['bad', 'INVALID_CIDR'], ['10.0.0.5', 'MISSING_PREFIX_LENGTH'], ['10.0.0.0/33', 'INVALID_CIDR']]);
  assert.equal(countTokens(['a b', ' c ,d ']), 4);
  assert.equal(parseCidr('::/0')?.prefix, '::/0');
  assert.equal(parseCidr('2001:db8::1/128')?.prefix, '2001:db8::1/128');
  assert.equal(parseCidr('300.1.1.1/8'), null);
});

test('classifies each prefix as new / changed / exists / conflict against the Site', () => {
  const subnets = [
    { id: 's1', cidr: '10.1.0.0/24', siteId: 'site-a', vrfId: null, purpose: 'Users', environment: null, visible: true },
    { id: 's2', cidr: '10.2.0.0/24', siteId: 'site-a', vrfId: 'vrf-x', purpose: null, environment: null, visible: true },
    { id: 's3', cidr: '10.3.0.0/16', siteId: 'site-a', vrfId: null, purpose: null, environment: null, visible: true },
    { id: 's4', cidr: '10.4.0.0/24', siteId: 'site-b', vrfId: null, purpose: null, environment: null, visible: false },
    { id: 's5', cidr: '10.5.0.0/24', siteId: 'site-b', vrfId: null, purpose: null, environment: null, visible: true },
    { id: 's6', cidr: '2001:db8:1::/48', siteId: 'site-a', vrfId: null, purpose: null, environment: null, visible: true },
  ];
  const parsed = parsePrefixList(['10.1.0.0/24', '10.2.0.0/24', '10.3.4.0/24', '10.4.0.0/24', '10.5.0.0/25', '10.9.0.0/24', '2001:db8::/32', '2001:db8:2::/48']);
  const diff = diffPrefixes(parsed.valid, subnets, { siteId: 'site-a', vrfId: null });
  const byPrefix = Object.fromEntries(diff.map((item) => [item.prefix, item]));
  assert.deepEqual([byPrefix['10.1.0.0/24'].status, byPrefix['10.1.0.0/24'].reason, byPrefix['10.1.0.0/24'].importable], ['exists', 'EXISTS_SAME', false]);
  assert.deepEqual([byPrefix['10.2.0.0/24'].status, byPrefix['10.2.0.0/24'].changes], ['changed', [{ field: 'vrfId', current: 'vrf-x', proposed: null }]]);
  assert.deepEqual([byPrefix['10.3.4.0/24'].status, byPrefix['10.3.4.0/24'].reason, byPrefix['10.3.4.0/24'].overlaps?.[0]?.relation], ['conflict', 'OVERLAP', 'within']);
  assert.deepEqual([byPrefix['10.4.0.0/24'].status, byPrefix['10.4.0.0/24'].reason, byPrefix['10.4.0.0/24'].existing], ['conflict', 'EXISTS_OUTSIDE_SITE', { id: null, cidr: null, hidden: true }]);
  assert.deepEqual([byPrefix['10.5.0.0/25'].status, byPrefix['10.5.0.0/25'].reason, byPrefix['10.5.0.0/25'].importable], ['new', 'NEW_OVERLAPS_OTHER_SCOPE', true]);
  assert.deepEqual([byPrefix['10.9.0.0/24'].status, byPrefix['10.9.0.0/24'].reason], ['new', 'NEW']);
  assert.deepEqual([byPrefix['2001:db8::/32'].status, byPrefix['2001:db8::/32'].overlaps?.[0]?.relation], ['conflict', 'contains']);
  assert.equal(byPrefix['2001:db8:2::/48'].status, 'new');
  assert.deepEqual(summarizeDiff(diff, 1, 2), { total: 8, new: 3, changed: 1, exists: 1, conflict: 3, importable: 3, invalid: 1, duplicates: 2 });
});

test('purpose and environment only count as changes when the preview sets them', () => {
  const subnets = [{ id: 's1', cidr: '10.1.0.0/24', siteId: 'site-a', vrfId: 'vrf-a', purpose: 'Users', environment: 'prod', visible: true }];
  const parsed = parsePrefixList(['10.1.0.0/24']);
  assert.equal(diffPrefixes(parsed.valid, subnets, { siteId: 'site-a', vrfId: 'vrf-a' })[0].status, 'exists');
  const changed = diffPrefixes(parsed.valid, subnets, { siteId: 'site-a', vrfId: 'vrf-a', purpose: 'Servers', environment: 'prod' })[0];
  assert.deepEqual([changed.status, changed.changes], ['changed', [{ field: 'purpose', current: 'Users', proposed: 'Servers' }]]);
});

test('flags overlaps between prefixes of the same paste; the first importable one wins', () => {
  const subnets = [{ id: 's1', cidr: '10.8.0.0/24', siteId: 'site-a', vrfId: null, purpose: null, environment: null, visible: true }];
  const parsed = parsePrefixList(['10.9.0.0/16', '10.9.1.0/24', '10.20.1.0/24', '10.20.0.0/16', '10.8.0.0/23', '10.8.1.0/24', '2001:db8::/32', '2001:db8:1::/48', '10.10.0.0/24']);
  const diff = diffPrefixes(parsed.valid, subnets, { siteId: 'site-a' });
  const byPrefix = Object.fromEntries(diff.map((item) => [item.prefix, item]));
  assert.deepEqual([byPrefix['10.9.0.0/16'].status, byPrefix['10.9.0.0/16'].importable], ['new', true]);
  assert.deepEqual([byPrefix['10.9.1.0/24'].status, byPrefix['10.9.1.0/24'].reason, byPrefix['10.9.1.0/24'].overlaps], ['conflict', 'OVERLAP', [{ source: 'paste', relation: 'within', sameScope: true, prefix: '10.9.0.0/16' }]]);
  assert.deepEqual(byPrefix['10.20.0.0/16'].overlaps, [{ source: 'paste', relation: 'contains', sameScope: true, prefix: '10.20.1.0/24' }]);
  // 10.8.0.0/23 conflicts with an existing subnet, so it does not block 10.8.1.0/24 as a paste overlap.
  assert.equal(byPrefix['10.8.0.0/23'].status, 'conflict');
  assert.deepEqual([byPrefix['10.8.1.0/24'].status, byPrefix['10.8.1.0/24'].importable], ['new', true]);
  assert.deepEqual([byPrefix['2001:db8:1::/48'].status, (byPrefix['2001:db8:1::/48'].overlaps?.[0] as { prefix: string }).prefix], ['conflict', '2001:db8::/32']);
  assert.equal(byPrefix['10.10.0.0/24'].status, 'new');
  assert.deepEqual(summarizeDiff(diff, 0, 0), { total: 9, new: 5, changed: 0, exists: 0, conflict: 4, importable: 5, invalid: 0, duplicates: 0 });
});

test('hides attribute changes of a subnet the user cannot read', () => {
  const subnets = [{ id: 's1', cidr: '10.1.0.0/24', siteId: 'site-a', vrfId: 'vrf-secret', purpose: 'Secret', environment: null, visible: false }];
  const item = diffPrefixes(parsePrefixList(['10.1.0.0/24']).valid, subnets, { siteId: 'site-a', purpose: 'Public' })[0];
  assert.deepEqual([item.status, item.existing, item.changes], ['changed', { id: null, cidr: null, hidden: true }, undefined]);
});
