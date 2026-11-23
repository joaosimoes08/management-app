import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { DISCOVERY_DEFAULT_MAX_SOCKETS, DISCOVERY_DEFAULT_PROBES_PER_SECOND, ProbeLimiter, resolveDiscoveryLimits, type LimiterClock } from './discovery-limiter';

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
