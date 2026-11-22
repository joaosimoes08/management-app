import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { calculateIpv4SubnetPlan } from './ipam-advanced.service';

test('subnet planning counts reserved and excluded addresses as unavailable', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/29', [
    { address: '192.0.2.2', state: 'RESERVED' },
    { address: '192.0.2.3', state: 'FREE' },
    { address: '192.0.2.4', state: 'OCCUPIED' },
    { address: '192.0.2.5', state: 'EXCLUDED' },
  ]);

  assert.equal(plan.unavailable, 3);
  assert.equal(plan.free, 3);
  assert.equal(plan.utilizationPercent, 50);
  assert.deepEqual(plan.usableGaps, [
    { start: '192.0.2.1', end: '192.0.2.1', count: 1 },
    { start: '192.0.2.3', end: '192.0.2.3', count: 1 },
    { start: '192.0.2.6', end: '192.0.2.6', count: 1 },
  ]);
});

// ---------------------------------------------------------------------------
// Item 6: carving aligned child blocks out of a parent (read-only preview).
// ---------------------------------------------------------------------------
import { MAX_PLANNED_BLOCKS, parsePlanningQuery, rangeToCidrs } from './subnet-planning';

const cidrs = (plan: { planned: Array<{ cidr: string }> }) => plan.planned.map((block) => block.cidr);
const overlaps = (a: { start: string; end: string }, b: { start: string; end: string }) => {
  const n = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
  return n(a.start) <= n(b.end) && n(b.start) <= n(a.end);
};

test('case 1: splits a /24 in production into /27s around an existing child, hosts and a reservation', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [
    { address: '10.0.0.1', state: 'OCCUPIED' }, // gateway host in the first /27
    { address: '10.0.0.70', state: 'RESERVED' }, // reservation in the third /27
    { address: '10.0.0.200', state: 'FREE', deviceId: 'dev-1' }, // FREE but still linked to a device: blocks .192/27
    { address: '10.0.0.230', state: 'FREE' }, // a free row does not block
  ], { subnets: [{ id: 'child-1', cidr: '10.0.0.32/27', purpose: 'Servidores' }], requests: [{ prefix: 27 }] });

  assert.deepEqual(cidrs(plan), ['10.0.0.96/27', '10.0.0.128/27', '10.0.0.160/27', '10.0.0.224/27']);
  for (const a of plan.planned) for (const b of plan.planned) if (a !== b) assert.equal(overlaps(a, b), false);
  assert.deepEqual(plan.shortfalls, []);
  assert.equal(plan.childSubnets, 1);
  // The free gaps no longer report addresses that belong to the child subnet.
  assert.ok(plan.usableGaps.every((gap) => !overlaps(gap, { start: '10.0.0.32', end: '10.0.0.63' })));
  assert.equal(plan.unavailable, 32 + 3);
});

test('case 1: asking for more /27s than fit plans what fits and reports the rest', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { subnets: [{ cidr: '10.0.0.0/25' }], requests: [{ prefix: 27, count: 6 }] });
  assert.deepEqual(cidrs(plan), ['10.0.0.128/27', '10.0.0.160/27', '10.0.0.192/27', '10.0.0.224/27']);
  assert.deepEqual(plan.shortfalls, [{ prefix: 27, requested: 6, planned: 4, missing: 2, reason: 'NOT_ENOUGH_FREE_SPACE' }]);
  assert.deepEqual(plan.addressSpace, { total: 256, taken: 128, reserved: 0, planned: 128, freeAfterPlan: 0 });
});

test('case 2: carves the lowest free aligned /30 for a point-to-point link', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/24', [
    { address: '192.0.2.1', state: 'OCCUPIED' },
    { address: '192.0.2.6', state: 'EXCLUDED' },
  ], { subnets: [{ cidr: '192.0.2.8/29' }], requests: [{ prefix: 30, count: 1 }] });
  // .0/30 has a host, .4/30 has an excluded address, .8-.15 is a child: the first clean /30 is .16.
  assert.deepEqual(plan.planned, [{ cidr: '192.0.2.16/30', prefix: 30, start: '192.0.2.16', end: '192.0.2.19', size: 4, usable: 2 }]);
});

test('case 2: supports /31 point-to-point links (RFC 3021) with two usable addresses', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/29', [{ address: '192.0.2.0', state: 'OCCUPIED' }, { address: '192.0.2.3', state: 'OCCUPIED' }], { requests: [{ prefix: 31, count: 2 }] });
  assert.deepEqual(plan.planned.map((block) => [block.cidr, block.usable]), [['192.0.2.4/31', 2], ['192.0.2.6/31', 2]]);
});

test('case 2: the parent gateway blocks the block that contains it', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/28', [], { gateway: '192.0.2.1', requests: [{ prefix: 30, count: 1 }] });
  assert.deepEqual(cidrs(plan), ['192.0.2.4/30']);
  // Without a plan the gateway has its own map row.
  const map = calculateIpv4SubnetPlan('192.0.2.0/28', [], { gateway: '192.0.2.1' });
  assert.deepEqual([map.segments[1].start, map.segments[1].kinds, map.segments[1].label], ['192.0.2.1', ['GATEWAY'], '192.0.2.1']);
});

test('case 3: every planned block starts on a multiple of its own size', () => {
  // Free space starts at .5 (unaligned) - a /27 must still start on .32, a /29 on a multiple of 8.
  const plan = calculateIpv4SubnetPlan('10.1.0.0/24', [], { subnets: [{ cidr: '10.1.0.0/30' }], requests: [{ prefix: 27, count: 1 }, { prefix: 29, count: 1 }] });
  const n = (ip: string) => ip.split('.').reduce((acc, part) => acc * 256 + Number(part), 0);
  for (const block of plan.planned) assert.equal(n(block.start) % block.size, 0, block.cidr);
  // Largest first, lowest first: /27 takes .32, then the /29 takes .8 (below it, still aligned).
  assert.deepEqual(cidrs(plan), ['10.1.0.8/29', '10.1.0.32/27']);
});

test('case 4: the map shows the whole parent as free, taken, reserved and planned rows in order', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.5', state: 'OCCUPIED' }, { address: '10.0.0.6', state: 'RESERVED' }], { subnets: [{ id: 's1', cidr: '10.0.0.64/26', purpose: 'Voz' }], requests: [{ prefix: 26, count: 2 }] });
  assert.deepEqual(plan.segments.map((segment) => [segment.status, segment.start, segment.end, segment.count]), [
    ['CONFLICT', '10.0.0.0', '10.0.0.63', 64],
    ['TAKEN', '10.0.0.64', '10.0.0.127', 64],
    ['PLANNED', '10.0.0.128', '10.0.0.191', 64],
    ['PLANNED', '10.0.0.192', '10.0.0.255', 64],
  ]);
  assert.equal(plan.segments[1].label, '10.0.0.64/26 · Voz');
  assert.deepEqual(plan.segments[1].cidrs, ['10.0.0.64/26']);
  const view = calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.5', state: 'OCCUPIED' }, { address: '10.0.0.6', state: 'RESERVED' }], { subnets: [{ id: 's1', cidr: '10.0.0.64/26', purpose: 'Voz' }] });
  assert.deepEqual(view.segments.map((segment) => [segment.status, segment.start, segment.end, segment.count]), [
    ['RESERVED', '10.0.0.0', '10.0.0.0', 1],
    ['FREE', '10.0.0.1', '10.0.0.4', 4],
    ['TAKEN', '10.0.0.5', '10.0.0.6', 2],
    ['FREE', '10.0.0.7', '10.0.0.63', 57],
    ['TAKEN', '10.0.0.64', '10.0.0.127', 64],
    ['FREE', '10.0.0.128', '10.0.0.254', 127],
    ['RESERVED', '10.0.0.255', '10.0.0.255', 1],
  ]);
  assert.deepEqual(view.segments[2].kinds, ['HOST', 'RESERVED']);
  assert.deepEqual(view.segments[3].cidrs, ['10.0.0.7/32', '10.0.0.8/29', '10.0.0.16/28', '10.0.0.32/27']);
  // Rows cover every address of the parent exactly once.
  for (const result of [plan, view]) assert.equal(result.segments.reduce((sum, segment) => sum + segment.count, 0), 256);
});

// Free totals shown by the map, Utilização and "Após o plano" must be the same number.
const mapFree = (plan: { segments: Array<{ status: string; count: number; breakdown?: { free: number } }> }) =>
  plan.segments.reduce((sum, segment) => sum + (segment.status === 'FREE' ? segment.count : segment.status === 'CONFLICT' ? segment.breakdown!.free : 0), 0);

test('totals: network and broadcast are reserved in the map, so map, Utilização and the plan agree (10.251.130.0/24, gateway .1)', () => {
  const view = calculateIpv4SubnetPlan('10.251.130.0/24', [], { gateway: '10.251.130.1' });
  assert.deepEqual(view.segments.map((segment) => [segment.status, segment.start, segment.end, segment.count, segment.label ?? null]), [
    ['RESERVED', '10.251.130.0', '10.251.130.0', 1, 'Endereço de rede'],
    ['TAKEN', '10.251.130.1', '10.251.130.1', 1, '10.251.130.1'],
    ['FREE', '10.251.130.2', '10.251.130.254', 253, null],
    ['RESERVED', '10.251.130.255', '10.251.130.255', 1, 'Endereço de broadcast'],
  ]);
  assert.equal(view.free, 253);
  assert.equal(mapFree(view), 253);
  assert.deepEqual(view.addressSpace, { total: 256, taken: 1, reserved: 2, planned: 0, freeAfterPlan: 253 });

  for (const [prefix, planned, free] of [[27, 7 * 32, 30], [30, 63 * 4, 2], [32, 255, 0]] as const) {
    const plan = calculateIpv4SubnetPlan('10.251.130.0/24', [], { gateway: '10.251.130.1', requests: [{ prefix }] });
    assert.equal(plan.addressSpace.planned, planned, `/${prefix}`);
    assert.equal(plan.addressSpace.freeAfterPlan, free, `/${prefix}`);
    assert.equal(mapFree(plan), free, `/${prefix}`);
    assert.equal(plan.addressSpace.total, plan.addressSpace.taken + plan.addressSpace.reserved + plan.addressSpace.planned + plan.addressSpace.freeAfterPlan);
    assert.equal(plan.free, 253, 'Utilização does not change with the plan');
  }
});

test('totals: /31 and /32 parents have no reserved network or broadcast row', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/31', []);
  assert.deepEqual(plan.segments.map((segment) => segment.status), ['FREE']);
  assert.equal(plan.addressSpace.reserved, 0);
  assert.equal(mapFree(plan), plan.free);
});

test('skipped: a /24 split into /27s shows all 8 blocks, with .0/27 flagged as a conflict with the gateway', () => {
  const plan = calculateIpv4SubnetPlan('10.251.130.0/24', [], { gateway: '10.251.130.1', requests: [{ prefix: 27 }] });
  assert.equal(plan.planned[0].cidr, '10.251.130.32/27');
  assert.deepEqual(plan.skipped.map((item) => [item.cidr, item.blocks, item.insideExisting, item.conflicts.map((c) => c.label)]), [['10.251.130.0/27', 1, false, ['Gateway 10.251.130.1']]]);
  assert.equal(plan.planned.length + plan.skipped.length, 8);
  assert.deepEqual(plan.segments.map((segment) => [segment.status, segment.cidrs[0]]), [
    ['CONFLICT', '10.251.130.0/27'],
    ...[32, 64, 96, 128, 160, 192, 224].map((start) => ['PLANNED', `10.251.130.${start}/27`]),
  ]);
  assert.equal(plan.segments[0].label, 'Gateway 10.251.130.1');
  assert.deepEqual(plan.segments[0].breakdown, { taken: 1, reserved: 1, free: 30 });
});

test('skipped: the same for /30s: .0/30 is a gateway conflict and .4/30 is the first planned block', () => {
  const plan = calculateIpv4SubnetPlan('10.251.130.0/24', [], { gateway: '10.251.130.1', requests: [{ prefix: 30, count: 1 }] });
  assert.deepEqual(cidrs(plan), ['10.251.130.4/30']);
  assert.deepEqual(plan.skipped.map((item) => [item.cidr, item.conflicts.map((c) => c.label)]), [['10.251.130.0/30', ['Gateway 10.251.130.1']]]);
  assert.deepEqual(plan.segments.slice(0, 2).map((segment) => [segment.status, segment.start, segment.end]), [['CONFLICT', '10.251.130.0', '10.251.130.3'], ['PLANNED', '10.251.130.4', '10.251.130.7']]);
});

test('skipped: a count that is met lists only the blocks placement stepped over, not conflicts above the last planned block', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.40', state: 'OCCUPIED' }, { address: '10.0.0.200', state: 'OCCUPIED' }], { gateway: '10.0.0.1', requests: [{ prefix: 27, count: 2 }] });
  assert.deepEqual(cidrs(plan), ['10.0.0.64/27', '10.0.0.96/27']);
  assert.deepEqual(plan.skipped.map((item) => [item.cidr, item.conflicts.map((c) => c.label)]), [['10.0.0.0/27', ['Gateway 10.0.0.1']], ['10.0.0.32/27', ['Host 10.0.0.40']]]);
  // The two conflict rows sit next to each other in the map and the free total still matches.
  assert.deepEqual(plan.segments.slice(0, 2).map((segment) => [segment.status, segment.start, segment.end, segment.breakdown]), [['CONFLICT', '10.0.0.0', '10.0.0.31', { taken: 1, reserved: 1, free: 30 }], ['CONFLICT', '10.0.0.32', '10.0.0.63', { taken: 1, reserved: 0, free: 31 }]]);
  assert.equal(mapFree(plan), plan.addressSpace.freeAfterPlan);
  assert.equal(plan.segments.reduce((sum, segment) => sum + segment.count, 0), 256);
});

test('skipped: candidates inside an existing subnet are grouped under that subnet and keep its map row', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { subnets: [{ id: 's1', cidr: '10.0.0.0/25', purpose: 'Servidores' }, { cidr: '10.0.0.0/26' }], requests: [{ prefix: 27 }] });
  assert.deepEqual(cidrs(plan), ['10.0.0.128/27', '10.0.0.160/27', '10.0.0.192/27', '10.0.0.224/27']);
  assert.deepEqual(plan.skipped.map((item) => [item.cidr, item.blocks, item.insideExisting, item.conflicts.map((c) => c.label)]), [['10.0.0.0/25', 4, true, ['Subnet 10.0.0.0/25 · Servidores', 'Subnet 10.0.0.0/26']]]);
  assert.deepEqual(plan.segments[0].status, 'TAKEN');
  assert.ok(plan.segments.every((segment) => segment.status !== 'CONFLICT'));
});

test('skipped: a large parent is not walked block by block and the list is capped', () => {
  // A /17 inside a /16 asked for /32s: the subnet is one grouped row, not 32 768 candidates.
  const grouped = calculateIpv4SubnetPlan('10.0.0.0/16', [], { subnets: [{ cidr: '10.0.0.0/17' }], requests: [{ prefix: 32, count: 1 }] });
  assert.deepEqual(grouped.skipped.map((item) => [item.cidr, item.blocks]), [['10.0.0.0/17', 32768]]);
  // 300 hosts in separate /30s of a /20: 300 conflicts, capped at 256 and flagged.
  const hosts = Array.from({ length: 300 }, (_, i) => ({ address: `10.0.${Math.floor(i / 64)}.${(i % 64) * 4 + 1}`, state: 'OCCUPIED' }));
  const wide = calculateIpv4SubnetPlan('10.0.0.0/20', hosts, { requests: [{ prefix: 30 }] });
  assert.equal(wide.planned.length, 1024 - 300);
  assert.equal(wide.skipped.length, 256);
  assert.equal(wide.skippedTruncated, true);
});

test('edge: a full parent plans nothing and says why', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { subnets: [{ cidr: '10.0.0.0/25' }, { cidr: '10.0.0.128/25' }], requests: [{ prefix: 30, count: 1 }] });
  assert.deepEqual(plan.planned, []);
  assert.deepEqual(plan.shortfalls, [{ prefix: 30, requested: 1, planned: 0, missing: 1, reason: 'NO_FREE_ALIGNED_BLOCK' }]);
  assert.equal(plan.free, 0);
  assert.deepEqual(plan.usableGaps, []);
});

test('edge: a host in the middle of a candidate block pushes the block to the next aligned slot', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.17', state: 'OCCUPIED' }], { requests: [{ prefix: 27, count: 1 }] });
  assert.deepEqual(cidrs(plan), ['10.0.0.32/27']);
});

test('edge: an existing child is never overlapped, even when it is not aligned to the requested size', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { subnets: [{ cidr: '10.0.0.28/30' }], requests: [{ prefix: 27 }] });
  assert.equal(cidrs(plan).includes('10.0.0.0/27'), false);
  assert.deepEqual(cidrs(plan), ['10.0.0.32/27', '10.0.0.64/27', '10.0.0.96/27', '10.0.0.128/27', '10.0.0.160/27', '10.0.0.192/27', '10.0.0.224/27']);
});

test('edge: /32 blocks fill single free addresses, including the parent network and broadcast', () => {
  const plan = calculateIpv4SubnetPlan('192.0.2.0/30', [{ address: '192.0.2.1', state: 'OCCUPIED' }], { requests: [{ prefix: 32 }] });
  assert.deepEqual(plan.planned.map((block) => [block.cidr, block.usable]), [['192.0.2.0/32', 1], ['192.0.2.2/32', 1], ['192.0.2.3/32', 1]]);
});

test('edge: /31 and /32 parents treat every address as usable', () => {
  assert.deepEqual(calculateIpv4SubnetPlan('192.0.2.0/31', []).usableRange, { start: '192.0.2.0', end: '192.0.2.1' });
  const single = calculateIpv4SubnetPlan('192.0.2.9/32', [], { requests: [{ prefix: 32, count: 1 }] });
  assert.equal(single.usableTotal, 1);
  assert.deepEqual(cidrs(single), ['192.0.2.9/32']);
});

test('edge: a requested prefix shorter than the parent is reported, not planned', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { requests: [{ prefix: 23, count: 1 }] });
  assert.deepEqual(plan.planned, []);
  assert.deepEqual(plan.shortfalls, [{ prefix: 23, requested: 1, planned: 0, missing: 1, reason: 'PREFIX_SHORTER_THAN_PARENT' }]);
});

test('edge: a prefix equal to the parent plans the whole parent only when it is completely free', () => {
  assert.deepEqual(cidrs(calculateIpv4SubnetPlan('10.0.0.0/24', [], { requests: [{ prefix: 24, count: 1 }] })), ['10.0.0.0/24']);
  assert.deepEqual(cidrs(calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.200', state: 'OCCUPIED' }], { requests: [{ prefix: 24, count: 1 }] })), []);
});

test('edge: in-scope subnets outside the parent, the parent itself and a supernet are ignored; partial overlaps are clipped', () => {
  const plan = calculateIpv4SubnetPlan('10.0.1.0/24', [{ address: '10.0.2.5', state: 'OCCUPIED' }], { subnets: [{ cidr: '10.0.1.0/24' }, { cidr: '10.0.0.0/16' }, { cidr: '10.0.2.0/24' }, { cidr: '10.0.1.128/25' }], requests: [{ prefix: 25 }] });
  assert.deepEqual(cidrs(plan), ['10.0.1.0/25']);
});

test('edge: hidden subnets still block space but expose no purpose or id', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [], { subnets: [{ id: 'secret', cidr: '10.0.0.0/25', purpose: 'Privado', hidden: true }], requests: [{ prefix: 25, count: 1 }] });
  assert.deepEqual(cidrs(plan), ['10.0.0.128/25']);
  assert.equal(plan.segments[0].label, 'Subnet sem acesso');
  assert.equal(plan.segments[0].subnetId, undefined);
});

test('edge: "as many as fit" is capped and reported as truncated', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/16', [], { requests: [{ prefix: 32 }] });
  assert.equal(plan.planned.length, MAX_PLANNED_BLOCKS);
  assert.equal(plan.shortfalls[0].reason, 'TRUNCATED');
});

test('edge: mixed sizes never overlap each other', () => {
  const plan = calculateIpv4SubnetPlan('10.0.0.0/24', [{ address: '10.0.0.1', state: 'OCCUPIED' }], { requests: [{ prefix: 30, count: 2 }, { prefix: 26, count: 2 }] });
  for (const a of plan.planned) for (const b of plan.planned) if (a !== b) assert.equal(overlaps(a, b), false);
  assert.deepEqual(cidrs(plan), ['10.0.0.4/30', '10.0.0.8/30', '10.0.0.64/26', '10.0.0.128/26']);
});

test('rangeToCidrs splits ranges into the fewest aligned blocks', () => {
  assert.deepEqual(rangeToCidrs(0, 255), ['0.0.0.0/24']);
  assert.deepEqual(rangeToCidrs(1, 6), ['0.0.0.1/32', '0.0.0.2/31', '0.0.0.4/31', '0.0.0.6/32']);
});

test('parsePlanningQuery validates prefix and count', () => {
  assert.deepEqual(parsePlanningQuery(), { requests: [] });
  assert.deepEqual(parsePlanningQuery('/27'), { requests: [{ prefix: 27, count: null }] });
  assert.deepEqual(parsePlanningQuery('30', '1'), { requests: [{ prefix: 30, count: 1 }] });
  assert.ok('error' in parsePlanningQuery('33'));
  assert.ok('error' in parsePlanningQuery('27', '0'));
  assert.ok('error' in parsePlanningQuery('27', 'x'));
  assert.ok('error' in parsePlanningQuery(undefined, '2'));
});
