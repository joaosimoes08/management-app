import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DISCOVERY_DEFAULT_MAX_SOCKETS, DISCOVERY_DEFAULT_PROBES_PER_SECOND, ProbeAbortedError, ProbeLimiter, Semaphore, discoveryProcessSockets, resolveDiscoveryLimits, subnetProbeLimiter, type LimiterClock } from './discovery-limiter';

/** A clock that only moves when the limiter sleeps, so spacing can be checked without real waiting. */
function fakeClock() {
  let now = 0;
  const sleeps: number[] = [];
  const clock: LimiterClock = { now: () => now, sleep: async (ms) => { sleeps.push(ms); now += ms; } };
  return { clock, sleeps, at: () => now };
}

test('defaults are sane: 100 probes per second and 64 probes in flight', () => {
  assert.equal(DISCOVERY_DEFAULT_PROBES_PER_SECOND, 100);
  assert.equal(DISCOVERY_DEFAULT_MAX_SOCKETS, 64);
  assert.deepEqual(resolveDiscoveryLimits(null), { probesPerSecond: 100, maxSockets: 64 });
  assert.deepEqual(resolveDiscoveryLimits({ discoveryProbesPerSecond: null, discoveryMaxSockets: null }), { probesPerSecond: 100, maxSockets: 64 });
});

test('a subnet value wins when it is in range; out-of-range values fall back to the default', () => {
  assert.deepEqual(resolveDiscoveryLimits({ discoveryProbesPerSecond: 10, discoveryMaxSockets: 4 }), { probesPerSecond: 10, maxSockets: 4 });
  assert.deepEqual(resolveDiscoveryLimits({ discoveryProbesPerSecond: 0, discoveryMaxSockets: 5000 }), { probesPerSecond: 100, maxSockets: 64 });
  assert.deepEqual(resolveDiscoveryLimits({ discoveryProbesPerSecond: 2.5, discoveryMaxSockets: -1 }), { probesPerSecond: 100, maxSockets: 64 });
});

test('never more probes in flight than the socket cap, even when 64 hosts × 64 ports are queued at once', async () => {
  const limiter = new ProbeLimiter({ probesPerSecond: 2000, maxSockets: 8 }, { now: () => 0, sleep: async () => undefined });
  let inFlight = 0; let peak = 0; let done = 0;
  const probe = () => limiter.run(async () => {
    inFlight += 1; peak = Math.max(peak, inFlight);
    await new Promise((resolve) => setImmediate(resolve));
    inFlight -= 1; done += 1;
    return true;
  });
  await Promise.all(Array.from({ length: 64 * 64 }, probe));
  assert.equal(done, 4096);
  assert.equal(peak, 8);
  assert.equal(limiter.peakInFlight, 8);
});

test('4096-host load profile holds both the configured rate and socket cap with a fake prober', async () => {
  const { clock, at } = fakeClock();
  const limiter = new ProbeLimiter({ probesPerSecond: 20, maxSockets: 7 }, clock);
  let active = 0; let peak = 0; const starts: number[] = [];
  await Promise.all(Array.from({ length: 4096 }, (_, i) => limiter.run(async () => {
    starts.push(at()); active++; peak = Math.max(peak, active); active--; return i;
  })));
  assert.equal(starts.length, 4096);
  assert.ok(peak <= 7);
  starts.sort((a, b) => a - b);
  const elapsed = starts.at(-1)! - starts[0];
  assert.ok(elapsed >= (4096 - 7) * 50, `4096 starts took ${elapsed} ms; minimum after socket concurrency is ${(4096 - 7) * 50} ms`);
});

test('probes are spaced evenly at the configured rate (10/s = one every 100 ms)', async () => {
  const { clock, at } = fakeClock();
  const limiter = new ProbeLimiter({ probesPerSecond: 10, maxSockets: 1 }, clock);
  const started: number[] = [];
  await Promise.all(Array.from({ length: 5 }, () => limiter.run(async () => { started.push(at()); })));
  assert.deepEqual(started, [0, 100, 200, 300, 400]);
});

test('a probe that throws still frees its slot', async () => {
  const limiter = new ProbeLimiter({ probesPerSecond: 2000, maxSockets: 1 }, { now: () => 0, sleep: async () => undefined });
  await assert.rejects(limiter.run(async () => { throw new Error('socket error'); }), /socket error/);
  assert.equal(await limiter.run(async () => 'next'), 'next');
});

const instant: LimiterClock = { now: () => 0, sleep: async () => undefined };
const tick = () => new Promise((resolve) => setImmediate(resolve));

test('review #148: scans of the same subnet share one limiter, so two concurrent scans stay under the subnet cap', async () => {
  const a = subnetProbeLimiter('subnet-shared', { probesPerSecond: 2000, maxSockets: 3 }, instant);
  const b = subnetProbeLimiter('subnet-shared', { probesPerSecond: 2000, maxSockets: 3 }, instant);
  assert.equal(a, b);
  let inFlight = 0; let peak = 0;
  const probe = (limiter: ProbeLimiter) => limiter.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await tick(); inFlight -= 1; });
  await Promise.all([...Array.from({ length: 40 }, () => probe(a)), ...Array.from({ length: 40 }, () => probe(b))]);
  assert.equal(peak, 3);
  assert.notEqual(subnetProbeLimiter('subnet-other', { probesPerSecond: 2000, maxSockets: 3 }, instant), a);
});

test('review #148: a changed subnet cap applies to the shared limiter', async () => {
  const limiter = subnetProbeLimiter('subnet-resize', { probesPerSecond: 2000, maxSockets: 2 }, instant);
  subnetProbeLimiter('subnet-resize', { probesPerSecond: 2000, maxSockets: 5 }, instant);
  assert.equal(limiter.limits.maxSockets, 5);
  let inFlight = 0; let peak = 0;
  await Promise.all(Array.from({ length: 20 }, () => limiter.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await tick(); inFlight -= 1; })));
  assert.equal(peak, 5);
});

test('review #148: the process-wide ceiling bounds probes across subnets', async () => {
  const ceiling = new Semaphore(4);
  const one = new ProbeLimiter({ probesPerSecond: 2000, maxSockets: 64 }, instant, ceiling);
  const two = new ProbeLimiter({ probesPerSecond: 2000, maxSockets: 64 }, instant, ceiling);
  let inFlight = 0; let peak = 0;
  const probe = (limiter: ProbeLimiter) => limiter.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await tick(); inFlight -= 1; });
  await Promise.all([...Array.from({ length: 50 }, () => probe(one)), ...Array.from({ length: 50 }, () => probe(two))]);
  assert.equal(peak, 4);
  assert.equal(ceiling.inUse, 0);
  assert.ok(discoveryProcessSockets.limit >= 1, 'the shared process ceiling exists');
});

test('review #148: queued probes stop at once on abort, whether they wait for a socket or for their rate slot', async () => {
  const limiter = new ProbeLimiter({ probesPerSecond: 1, maxSockets: 2 }); // real clock: one probe per second
  const controller = new AbortController();
  let ran = 0;
  const started = Date.now();
  const probes = Array.from({ length: 10 }, () => limiter.run(async () => { ran += 1; }, controller.signal));
  setTimeout(() => controller.abort(), 50);
  const results = await Promise.allSettled(probes);
  assert.ok(Date.now() - started < 1000, 'no probe waited out its rate slot');
  assert.equal(ran, 1, 'only the first probe had its slot before the abort');
  assert.equal(results.filter((r) => r.status === 'rejected' && r.reason instanceof ProbeAbortedError).length, 9);
  assert.equal(await limiter.run(async () => 'free', undefined).then((v) => v), 'free', 'aborted probes gave their slots back');
});

test('review #148: an aborted scan does not leave its rate slots to the next scan', async () => {
  const sleeps: number[] = [];
  // Sleeps bound to a scan wait until it aborts; unbound sleeps return at once. Time stays at 0.
  const clock: LimiterClock = { now: () => 0, sleep: (ms, signal) => { sleeps.push(ms); return new Promise<void>((resolve, reject) => { if (!signal) { resolve(); return; } signal.addEventListener('abort', () => reject(new ProbeAbortedError()), { once: true }); }); } };
  const limiter = new ProbeLimiter({ probesPerSecond: 10, maxSockets: 50 }, clock);
  const controller = new AbortController();
  let ran = 0;
  const queued = Array.from({ length: 20 }, () => limiter.run(async () => { ran += 1; }, controller.signal));
  await tick();
  assert.equal(sleeps.at(-1), 1900, '19 probes queued behind the first, 100 ms apart');
  controller.abort();
  await Promise.allSettled(queued);
  assert.equal(ran, 1);
  await limiter.run(async () => undefined);
  assert.equal(sleeps.at(-1), 100, 'the next probe waits one spacing after the last probe that ran, not 2 s');
});
