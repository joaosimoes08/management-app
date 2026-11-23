import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { PrismaClient } from '@simoes/database';
import { probesPerAddress, recordDiscoveryFailure, runDiscoveryScan, ScanDependencies } from '../src/discovery/discovery-scan';

// Round 2 #10/#11: discovery saves progress per batch, cancels, resumes idempotently and stops at limits.
const databaseUrl = process.env.DATABASE_URL ?? '';
if (!/[_-]test(?:\?|$)/i.test(databaseUrl)) throw new Error('Integration tests require an isolated DATABASE_URL whose database name ends in _test.');

const prisma = new PrismaClient();
const siteId = 'd1000000-0000-4000-8000-000000000001';
const subnetId = 'd1000000-0000-4000-8000-000000000002';
// 10.251.0.0/26: 62 hosts. Every 5th host answers ping; .10 also has 22 open.
const reachable = (address: string) => Number(address.split('.')[3]) % 5 === 0;
let probed: string[] = [];
const probe: ScanDependencies['probe'] = async (address, methods) => {
  probed.push(address);
  return { address, icmp: { reachable: methods.includes('ICMP') && reachable(address), responseMs: reachable(address) ? 1 : undefined }, openPorts: methods.includes('TCP') && address.endsWith('.10') ? [22] : [] };
};

let settingsCreated = false;
before(async () => {
  // A previous run that stopped early leaves the subnet behind (deleting the site does not delete it).
  await prisma.discoveryJob.deleteMany({ where: { subnetId } });
  await prisma.subnet.deleteMany({ where: { id: subnetId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.site.create({ data: { id: siteId, name: 'R2-10 Discovery Site', code: 'R2-10-DISC' } });
  await prisma.subnet.create({ data: { id: subnetId, cidr: '10.251.0.0/26', version: 4, siteId } });
  const settings = await prisma.systemSettings.findFirst();
  if (!settings) { await prisma.systemSettings.create({ data: { organizationName: 'R2-10', organizationCode: 'R2-10', setupCompleted: true, discoveryAllowedCidrs: ['10.251.0.0/16'] } }); settingsCreated = true; }
  else if (Array.isArray(settings.discoveryAllowedCidrs) && !(settings.discoveryAllowedCidrs as string[]).includes('10.251.0.0/16')) await prisma.systemSettings.update({ where: { id: settings.id }, data: { discoveryAllowedCidrs: [...settings.discoveryAllowedCidrs as string[], '10.251.0.0/16'] } });
});
beforeEach(async () => { probed = []; await prisma.discoveryJob.deleteMany({ where: { subnetId } }); });
after(async () => {
  await prisma.discoveryJob.deleteMany({ where: { subnetId } });
  await prisma.subnet.deleteMany({ where: { id: subnetId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  if (settingsCreated) await prisma.systemSettings.deleteMany({ where: { organizationCode: 'R2-10' } });
  await prisma.$disconnect();
});

const createJob = (data: Record<string, unknown> = {}) => prisma.discoveryJob.create({ data: { name: 'R2-10 scan', subnetId, methods: ['ICMP'], tcpPorts: [], reverseDns: false, ...data } });

test('a full scan saves every batch and ends COMPLETED with consistent counters', async () => {
  const job = await createJob({ methods: ['ICMP', 'TCP'], tcpPorts: [22] });
  const outcome = await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16 });
  assert.deepEqual(outcome, { status: 'COMPLETED', stopReason: null });
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual({ total: stored.totalCount, processed: stored.processedCount, scanned: stored.scannedCount, probes: stored.probeCount, results: stored.resultCount, unreachable: stored.unreachableCount, attempts: stored.attemptCount, stopReason: stored.stopReason },
    { total: 62, processed: 62, scanned: 62, probes: 62 * probesPerAddress(['ICMP', 'TCP'], [22]), results: 12, unreachable: 50, attempts: 1, stopReason: null });
  assert.equal(await prisma.discoveryResult.count({ where: { jobId: job.id } }), 12);
  assert.ok(stored.completedAt);
});

test('a crash mid-scan keeps the saved batches; the retry resumes after them without duplicates', async () => {
  const job = await createJob();
  let calls = 0;
  const crashing: ScanDependencies['probe'] = async (address, methods, ports, limiter) => { calls += 1; if (calls > 32) throw Object.assign(new Error('worker lost'), { code: 'ECONNRESET' }); return probe(address, methods, ports, limiter); };
  await assert.rejects(runDiscoveryScan(prisma, job.id, { probe: crashing, batchSize: 16 }), /worker lost/);
  assert.deepEqual(await recordDiscoveryFailure(prisma, job.id, Object.assign(new Error('x'), { code: 'ECONNRESET' }), false), { code: 'ECONNRESET', final: false });
  const halfway = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(halfway.status, 'PENDING', 'a retryable failure keeps the subnet reserved');
  assert.equal(halfway.processedCount, 32);
  const savedEarly = await prisma.discoveryResult.count({ where: { jobId: job.id } });
  assert.equal(savedEarly, halfway.resultCount);

  probed = [];
  const outcome = await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16 });
  assert.equal(outcome.status, 'COMPLETED');
  assert.equal(probed[0], '10.251.0.33', 'resumes after the 32 saved addresses');
  assert.equal(probed.length, 30);
  const done = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual({ scanned: done.scannedCount, results: done.resultCount, attempts: done.attemptCount, startedAt: done.startedAt?.getTime() }, { scanned: 62, results: 12, attempts: 2, startedAt: halfway.startedAt?.getTime() });
  assert.equal(await prisma.discoveryResult.count({ where: { jobId: job.id } }), 12);

  // A re-delivery of a finished job does nothing.
  probed = [];
  assert.equal((await runDiscoveryScan(prisma, job.id, { probe })).skipped, 'TERMINAL');
  assert.equal(probed.length, 0);
});

test('two workers on the same job never count a batch twice', async () => {
  const job = await createJob();
  const slow: ScanDependencies['probe'] = async (...args) => { await new Promise((resolve) => setTimeout(resolve, 5)); return probe(...args); };
  const outcomes = await Promise.all([runDiscoveryScan(prisma, job.id, { probe: slow, batchSize: 8 }), runDiscoveryScan(prisma, job.id, { probe: slow, batchSize: 8 })]);
  assert.ok(outcomes.some((item) => item.status === 'COMPLETED'));
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(stored.status, 'COMPLETED');
  assert.equal(stored.scannedCount, 62);
  assert.equal(stored.resultCount, 12);
  assert.equal(await prisma.discoveryResult.count({ where: { jobId: job.id } }), 12);
});

test('cancel: a running scan stops before its next batch and keeps what it saved; a cancelled scan frees the subnet', async () => {
  const job = await createJob();
  const cancelling: ScanDependencies['probe'] = async (address, methods, ports, limiter) => {
    if (address === '10.251.0.20') await prisma.discoveryJob.update({ where: { id: job.id }, data: { cancelRequestedAt: new Date() } });
    return probe(address, methods, ports, limiter);
  };
  const outcome = await runDiscoveryScan(prisma, job.id, { probe: cancelling, batchSize: 16 });
  assert.deepEqual(outcome, { status: 'CANCELLED', stopReason: 'CANCELLED' });
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(stored.processedCount, 32, 'the batch in flight is saved, the next one never starts');
  assert.equal(await prisma.discoveryResult.count({ where: { jobId: job.id } }), stored.resultCount);
  await createJob({ name: 'next scan after cancel' }); // the one-active-per-subnet index accepts it
});

test('limits: probe budget and maximum duration end the scan as "stopped at limit"', async () => {
  const byProbes = await createJob({ methods: ['ICMP', 'TCP'], tcpPorts: [22, 443], maxProbes: 50 });
  assert.deepEqual(await runDiscoveryScan(prisma, byProbes.id, { probe, batchSize: 8 }), { status: 'COMPLETED', stopReason: 'LIMIT_PROBES' });
  const probesStored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: byProbes.id } });
  assert.equal(probesStored.processedCount, 16, '3 probes per address: 50 probes allow 16 addresses');
  assert.equal(probesStored.probeCount, 48);
  assert.ok(probesStored.probeCount <= 50);
  await prisma.discoveryJob.delete({ where: { id: byProbes.id } });

  let clock = new Date('2026-11-22T10:00:00Z').getTime();
  const byTime = await createJob({ maxDurationSeconds: 60 });
  const ticking: ScanDependencies['probe'] = async (...args) => { clock += 1_000; return probe(...args); };
  assert.deepEqual(await runDiscoveryScan(prisma, byTime.id, { probe: ticking, batchSize: 10, now: () => new Date(clock) }), { status: 'COMPLETED', stopReason: 'LIMIT_DURATION' });
  const timeStored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: byTime.id } });
  assert.equal(timeStored.processedCount, 60, '1 s per address: the batch that crosses 60 s is the last');
  assert.ok(timeStored.processedCount < timeStored.totalCount);
});

test('a configuration problem fails at once without retry', async () => {
  const job = await createJob({ methods: ['TCP'], tcpPorts: [] });
  const error = await runDiscoveryScan(prisma, job.id, { probe }).catch((caught) => caught);
  assert.equal(error.code, 'DISCOVERY_CONFIGURATION_INVALID');
  assert.deepEqual(await recordDiscoveryFailure(prisma, job.id, error, false), { code: 'DISCOVERY_CONFIGURATION_INVALID', final: true });
  assert.equal((await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } })).status, 'FAILED');
});

test('Discovery P0: the subnet socket cap bounds probes in flight across a whole batch', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: 4, discoveryProbesPerSecond: 2000 } });
  try {
    const job = await createJob({ methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443, 3389, 8080, 8443] });
    let inFlight = 0; let peak = 0; let calls = 0;
    const limited: ScanDependencies['probe'] = async (address, methods, tcpPorts, limiter) => {
      const one = () => limiter.run(async () => { calls += 1; inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((resolve) => setTimeout(resolve, 1)); inFlight -= 1; return false; });
      await one();
      await Promise.all(tcpPorts.map(one));
      return { address, icmp: { reachable: false }, openPorts: [] };
    };
    const outcome = await runDiscoveryScan(prisma, job.id, { probe: limited, batchSize: 32 });
    assert.deepEqual(outcome, { status: 'COMPLETED', stopReason: null });
    assert.equal(calls, 62 * 7);
    assert.equal(peak, 4);
  } finally {
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: null, discoveryProbesPerSecond: null } });
  }
});

test('Discovery P0: the subnet rate limit spaces probes (5/s → one every 200 ms)', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryProbesPerSecond: 5, discoveryMaxSockets: 1 } });
  try {
    const job = await createJob({ methods: ['ICMP'], maxProbes: 4 });
    let clock = 0; const started: number[] = [];
    const limiterClock = { now: () => clock, sleep: async (ms: number) => { clock += ms; } };
    const timed: ScanDependencies['probe'] = async (address, _methods, _ports, limiter) => { await limiter.run(async () => { started.push(clock); }); return { address, icmp: { reachable: false }, openPorts: [] }; };
    assert.deepEqual(await runDiscoveryScan(prisma, job.id, { probe: timed, batchSize: 4, limiterClock }), { status: 'COMPLETED', stopReason: 'LIMIT_PROBES' });
    assert.deepEqual(started.sort((a, b) => a - b), [0, 200, 400, 600]);
  } finally {
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: null, discoveryProbesPerSecond: null } });
  }
});
