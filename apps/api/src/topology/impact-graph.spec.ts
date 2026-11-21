import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { MAX_DEPTH_LIMIT, clampDepth, computeImpact, hostMatches, shortestPath, urlHost, type ImpactEdge } from './impact-graph';

/**
 * Reference test topology:
 *   fw — core1 — dist1 — acc1 — srv1
 *          |       |
 *          |      acc2 — srv2
 *        dist2 — acc3 — srv3
 *   core2 — dist2 (redundant uplink), core2 — fw
 *   dist1 — acc1 — acc2 — dist1 forms a loop.
 */
const links: [string, string][] = [
  ['fw', 'core1'], ['core1', 'dist1'], ['dist1', 'acc1'], ['acc1', 'srv1'], ['dist1', 'acc2'], ['acc2', 'srv2'], ['acc1', 'acc2'],
  ['core1', 'dist2'], ['dist2', 'acc3'], ['acc3', 'srv3'], ['core2', 'dist2'], ['core2', 'fw'],
];
const edges: ImpactEdge[] = links.map(([a, b], index) => ({ id: `c${index}`, a, b }));

test('removing a core switch lists exactly the devices that lose every path to the gateway', () => {
  const result = computeImpact({ edges, failed: ['core1'], anchors: ['fw'], anchorMode: 'gateway-devices' });
  assert.deepEqual(result.affected.map((item) => item.deviceId).sort(), ['acc1', 'acc2', 'dist1', 'srv1', 'srv2']);
  assert.equal(result.anchorMode, 'gateway-devices');
  assert.equal(result.truncated, false);
  const dist1 = result.affected.find((item) => item.deviceId === 'dist1')!;
  assert.deepEqual([dist1.hops, dist1.viaDeviceId, dist1.viaConnectionId], [1, 'core1', 'c1']);
  assert.equal(result.affected.find((item) => item.deviceId === 'srv1')!.hops, 3);
});

test('redundant paths keep devices off the affected list', () => {
  const result = computeImpact({ edges, failed: ['core2'], anchors: ['fw'] });
  assert.deepEqual(result.affected, []);
});

test('a failed set (rack) is removed together', () => {
  const result = computeImpact({ edges, failed: ['core1', 'core2'], anchors: ['fw'] });
  assert.deepEqual(result.affected.map((item) => item.deviceId).sort(), ['acc1', 'acc2', 'acc3', 'dist1', 'dist2', 'srv1', 'srv2', 'srv3']);
});

test('loops and self-links terminate and each device is listed once', () => {
  const ring: ImpactEdge[] = Array.from({ length: 50 }, (_, index) => ({ id: `r${index}`, a: `n${index}`, b: `n${(index + 1) % 50}` }));
  ring.push({ id: 'self', a: 'n3', b: 'n3' }, { id: 'dup', a: 'n1', b: 'n2' }, { id: 'up', a: 'gw', b: 'n0' });
  const result = computeImpact({ edges: ring, failed: ['n0'], anchors: ['gw'], maxDepth: 32 });
  assert.equal(result.truncated, false);
  assert.equal(computeImpact({ edges: ring, failed: ['n0'], anchors: ['gw'] }).affected.length, 24, 'default depth 12 lists 12 hops each way');
  assert.equal(result.affected.length, 49);
  assert.equal(new Set(result.affected.map((item) => item.deviceId)).size, 49);
  assert.equal(Math.max(...result.affected.map((item) => item.hops)), 25);
});

test('depth is bounded and reported as truncated', () => {
  const chain: ImpactEdge[] = Array.from({ length: 40 }, (_, index) => ({ id: `e${index}`, a: `d${index}`, b: `d${index + 1}` }));
  chain.push({ id: 'gw', a: 'gw', b: 'd0' });
  const result = computeImpact({ edges: chain, failed: ['d0'], anchors: ['gw'], maxDepth: 5 });
  assert.equal(result.affected.length, 5);
  assert.equal(result.truncated, true);
  assert.equal(clampDepth('999'), MAX_DEPTH_LIMIT);
  assert.equal(clampDepth('0'), 1);
  assert.equal(clampDepth('abc'), 12);
});

test('a failed anchor falls back to the largest surviving segment', () => {
  // gw is the only gateway and it goes down: the bigger side (a1..a3) stands in for the network, b1 is cut off.
  const graph: ImpactEdge[] = [{ id: '1', a: 'gw', b: 'a1' }, { id: '2', a: 'a1', b: 'a2' }, { id: '3', a: 'a2', b: 'a3' }, { id: '4', a: 'gw', b: 'b1' }];
  const result = computeImpact({ edges: graph, failed: ['gw'], anchors: ['gw'], anchorMode: 'gateway-devices' });
  assert.equal(result.anchorMode, 'largest-segment');
  assert.deepEqual(result.affected.map((item) => item.deviceId), ['b1']);
});

test('shortest documented path, deterministic and bounded', () => {
  assert.deepEqual(shortestPath(edges, 'srv1', 'srv3'), { deviceIds: ['srv1', 'acc1', 'dist1', 'core1', 'dist2', 'acc3', 'srv3'], connectionIds: ['c3', 'c2', 'c1', 'c7', 'c8', 'c9'] });
  assert.deepEqual(shortestPath(edges, 'fw', 'fw'), { deviceIds: ['fw'], connectionIds: [] });
  assert.equal(shortestPath(edges, 'srv1', 'srv3', 3), null);
  assert.equal(shortestPath(edges, 'srv1', 'nowhere'), null);
});

test('large graphs stay fast', () => {
  // 5,000 devices: 1 gateway, 2 cores, 50 distribution, 500 access, rest servers, plus a ring among access switches.
  const big: ImpactEdge[] = []; let id = 0; const link = (a: string, b: string) => big.push({ id: `l${id++}`, a, b });
  link('gw', 'core0'); link('gw', 'core1');
  for (let d = 0; d < 50; d += 1) { link('core0', `dist${d}`); if (d % 2) link('core1', `dist${d}`); }
  for (let a = 0; a < 500; a += 1) { link(`dist${a % 50}`, `acc${a}`); link(`acc${a}`, `acc${(a + 1) % 500}`); }
  for (let s = 0; s < 4447; s += 1) link(`acc${s % 500}`, `srv${s}`);
  // One warm-up pass, then the best of three timed passes: a single timed run flaps on shared CI runners (GC, cold JIT).
  const run = () => {
    const started = performance.now();
    const result = computeImpact({ edges: big, failed: ['core0'], anchors: ['gw'] });
    const path = shortestPath(big, 'srv0', 'srv4446', 32);
    const elapsed = performance.now() - started;
    assert.equal(result.affected.length, 0, 'the access ring and core1 keep everything reachable');
    assert.ok(path);
    return elapsed;
  };
  run();
  const best = Math.min(run(), run(), run());
  assert.ok(best < 500, `best of 3 took ${best} ms`);
});

test('application URLs match host names, short names and IPs', () => {
  const names = new Set(['srv1.corp.local', 'erp', '10.0.0.5']);
  assert.equal(urlHost('https://SRV1.corp.local:8443/app'), 'srv1.corp.local');
  assert.equal(urlHost('not a url'), null);
  assert.equal(hostMatches('srv1.corp.local', names), true);
  assert.equal(hostMatches('srv1', names), true);
  assert.equal(hostMatches('erp.corp.local', names), true);
  assert.equal(hostMatches('10.0.0.5', names), true);
  assert.equal(hostMatches('10.0.0.50', names), false);
  assert.equal(hostMatches('srv2.corp.local', names), false);
  assert.equal(hostMatches('10', new Set(['10.0.0.5'])), false);
});
