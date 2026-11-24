import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { after, before, beforeEach, test } from 'node:test';
import { Prisma, PrismaClient } from '@simoes/database';
import { probesPerAddress, recordDiscoveryFailure, runDiscoveryScan, ScanDependencies } from '../src/discovery/discovery-scan';
import { discoveryProcessSockets } from '../src/discovery/discovery-limiter';
import { buildEnrichment, DiscoverySnmpEnricher, failedEnrichment, readEnrichment } from '../src/discovery/discovery-snmp';
import { encryptCredential, parseKeyring } from '@simoes/snmp-core';

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
const snmpDeviceId = 'd1000000-0000-4000-8000-000000000003';
const otherSnmpDeviceId = 'd1000000-0000-4000-8000-000000000004';
const snmpCredentialId = 'd1000000-0000-4000-8000-000000000005';
const otherSnmpCredentialId = 'd1000000-0000-4000-8000-000000000006';
before(async () => {
  await prisma.device.deleteMany({ where: { id: { in: [snmpDeviceId, otherSnmpDeviceId] } } });
  // A previous run that stopped early leaves the subnet behind (deleting the site does not delete it).
  await prisma.discoveryJob.deleteMany({ where: { subnetId } });
  await prisma.subnet.deleteMany({ where: { id: subnetId } });
  await prisma.site.deleteMany({ where: { id: siteId } });
  await prisma.site.create({ data: { id: siteId, name: 'R2-10 Discovery Site', code: 'R2-10-DISC' } });
  await prisma.subnet.create({ data: { id: subnetId, cidr: '10.251.0.0/26', version: 4, siteId } });
  const envelope = encryptCredential({ community: 'integration-only' }, parseKeyring(JSON.stringify({ activeKeyId: 'k', keys: { k: Buffer.alloc(32, 3).toString('base64') } })));
  for (const [deviceId, credentialId] of [[snmpDeviceId, snmpCredentialId], [otherSnmpDeviceId, otherSnmpCredentialId]]) {
    await prisma.device.create({ data: { id: deviceId, name: `D-P1a ${deviceId.slice(-1)}`, type: 'SWITCH', siteId } });
    await prisma.snmpCredential.create({ data: { id: credentialId, deviceId, purpose: 'READ', version: 'V2C', ...envelope, ciphertext: Buffer.from(envelope.ciphertext), iv: Buffer.from(envelope.iv), authTag: Buffer.from(envelope.authTag), wrappedDek: Buffer.from(envelope.wrappedDek), wrapIv: Buffer.from(envelope.wrapIv), wrapAuthTag: Buffer.from(envelope.wrapAuthTag) } });
  }
  const settings = await prisma.systemSettings.findFirst();
  if (!settings) { await prisma.systemSettings.create({ data: { organizationName: 'R2-10', organizationCode: 'R2-10', setupCompleted: true, discoveryAllowedCidrs: ['10.251.0.0/16'] } }); settingsCreated = true; }
  else if (Array.isArray(settings.discoveryAllowedCidrs) && !(settings.discoveryAllowedCidrs as string[]).includes('10.251.0.0/16')) await prisma.systemSettings.update({ where: { id: settings.id }, data: { discoveryAllowedCidrs: [...settings.discoveryAllowedCidrs as string[], '10.251.0.0/16'] } });
});
beforeEach(async () => { probed = []; await prisma.discoveryJob.deleteMany({ where: { subnetId } }); await prisma.subnet.update({ where: { id: subnetId }, data: { discoverySnmpCredentialId: null } }); });
after(async () => {
  await prisma.discoveryJob.deleteMany({ where: { subnetId } });
  await prisma.subnet.deleteMany({ where: { id: subnetId } });
  await prisma.device.deleteMany({ where: { id: { in: [snmpDeviceId, otherSnmpDeviceId] } } });
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

const quietOutcome = (address: string) => ({ address, icmp: { reachable: false }, openPorts: [] as number[] });

test('review #148: two concurrent scans share the process-wide socket ceiling, and scans of one subnet share its cap', async () => {
  const otherSubnetId = '00000000-0000-4000-8000-0000000251b1';
  await prisma.subnet.deleteMany({ where: { id: otherSubnetId } });
  await prisma.subnet.create({ data: { id: otherSubnetId, cidr: '10.251.1.0/26', version: 4, siteId } });
  const previousCeiling = discoveryProcessSockets.limit;
  try {
    // Different subnets, each allowed 64 sockets: together they stay under the process ceiling of 5.
    discoveryProcessSockets.setCapacity(5);
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryProbesPerSecond: 2000 } });
    await prisma.subnet.update({ where: { id: otherSubnetId }, data: { discoveryProbesPerSecond: 2000 } });
    const first = await createJob({ methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443] });
    const second = await prisma.discoveryJob.create({ data: { name: 'R2-10 other subnet', subnetId: otherSubnetId, methods: ['ICMP', 'TCP'], tcpPorts: [22, 80, 443], reverseDns: false } });
    let inFlight = 0; let peak = 0; const perSubnet = new Map<string, number>();
    const counted: ScanDependencies['probe'] = async (address, _methods, tcpPorts, limiter) => {
      const one = () => limiter.run(async () => { inFlight += 1; peak = Math.max(peak, inFlight); await new Promise((resolve) => setTimeout(resolve, 20)); inFlight -= 1; });
      await Promise.all([one(), ...tcpPorts.map(one)]);
      const subnet = address.split('.')[2];
      perSubnet.set(subnet, (perSubnet.get(subnet) ?? 0) + 1);
      return quietOutcome(address);
    };
    const outcomes = await Promise.all([runDiscoveryScan(prisma, first.id, { probe: counted }), runDiscoveryScan(prisma, second.id, { probe: counted })]);
    assert.deepEqual(outcomes, [{ status: 'COMPLETED', stopReason: null }, { status: 'COMPLETED', stopReason: null }]);
    assert.deepEqual([perSubnet.get('0'), perSubnet.get('1')], [62, 62]);
    assert.equal(peak, 5, 'never more than the process-wide ceiling across both scans');
    assert.equal(discoveryProcessSockets.inUse, 0);

    // Same subnet: two workers on one job use the same limiter, so the subnet cap of 3 holds across both.
    discoveryProcessSockets.setCapacity(previousCeiling);
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: 3, discoveryProbesPerSecond: 2000 } });
    const shared = await createJob({ methods: ['ICMP'] });
    inFlight = 0; peak = 0;
    await Promise.all([runDiscoveryScan(prisma, shared.id, { probe: counted, batchSize: 16 }), runDiscoveryScan(prisma, shared.id, { probe: counted, batchSize: 16 })]);
    assert.equal(peak, 3, 'the subnet cap is shared, not doubled');
    assert.equal((await prisma.discoveryJob.findUniqueOrThrow({ where: { id: shared.id } })).status, 'COMPLETED');
  } finally {
    discoveryProcessSockets.setCapacity(previousCeiling);
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: null, discoveryProbesPerSecond: null } });
    await prisma.discoveryJob.deleteMany({ where: { subnetId: otherSubnetId } });
    await prisma.subnet.deleteMany({ where: { id: otherSubnetId } });
  }
});

test('review #148: at 1 probe/s, a cancel stops the batch within seconds and a passed deadline does too', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryProbesPerSecond: 1, discoveryMaxSockets: 64 } });
  try {
    let ran = 0;
    const slow: ScanDependencies['probe'] = async (address, _methods, _ports, limiter) => { await limiter.run(async () => { ran += 1; }); return quietOutcome(address); };

    // Without the abort, this 32-address batch would take 32 s.
    const cancelled = await createJob({ methods: ['ICMP'] });
    const started = Date.now();
    // Prisma queries only run when awaited or then-ed.
    setTimeout(() => { prisma.discoveryJob.update({ where: { id: cancelled.id }, data: { cancelRequestedAt: new Date() } }).then(() => undefined, () => undefined); }, 1_200);
    assert.deepEqual(await runDiscoveryScan(prisma, cancelled.id, { probe: slow, batchSize: 32 }), { status: 'CANCELLED', stopReason: 'CANCELLED' });
    const cancelMs = Date.now() - started;
    assert.ok(cancelMs < 4_000, `cancel took ${cancelMs} ms`);
    assert.ok(ran <= 4, `only the probes whose slot came before the cancel ran (${ran})`);
    const storedCancel = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: cancelled.id } });
    assert.equal(storedCancel.processedCount, 0, 'the unfinished batch is not saved; a retry probes it again');
    await prisma.discoveryJob.delete({ where: { id: cancelled.id } });

    const timed = await createJob({ methods: ['ICMP'], maxDurationSeconds: 2 });
    const timedStart = Date.now();
    assert.deepEqual(await runDiscoveryScan(prisma, timed.id, { probe: slow, batchSize: 32, controlPollMs: 250 }), { status: 'COMPLETED', stopReason: 'LIMIT_DURATION' });
    const deadlineMs = Date.now() - timedStart;
    assert.ok(deadlineMs < 4_000, `deadline took ${deadlineMs} ms`);
  } finally {
    await prisma.subnet.update({ where: { id: subnetId }, data: { discoveryMaxSockets: null, discoveryProbesPerSecond: null } });
  }
});

// D-P1a: optional SNMP enrichment per subnet.
type EnricherCall = { credentialId: string; address: string };
function fakeSnmp(outcome: (address: string) => 'OK' | 'AUTH' | 'TIMEOUT' = () => 'OK') {
  const calls: EnricherCall[] = []; const loads: string[] = [];
  const snmpEnricher: NonNullable<ScanDependencies['snmpEnricher']> = async (credentialId, subnetSiteId) => {
    loads.push(`${credentialId}@${subnetSiteId}`);
    const enricher: DiscoverySnmpEnricher = (address, limiter) => limiter.run(async () => {
      calls.push({ credentialId, address });
      const at = new Date('2026-11-24T12:00:00.000Z');
      const kind = outcome(address);
      if (kind === 'AUTH') return failedEnrichment(new Error('Authentication failure: wrong digest'), credentialId, at, 4);
      if (kind === 'TIMEOUT') return failedEnrichment(new Error('Request timed out'), credentialId, at, 9);
      return buildEnrichment({ sysObjectId: '1.3.6.1.4.1.9.1.2494', sysDescr: 'IOS XE', sysName: `sw-${address}`, entity: { index: 1000, model: 'C9300-48P', serial: `FOC-${address}` } }, credentialId, at, 3);
    });
    return { enricher };
  };
  return { snmpEnricher, calls, loads };
}

test('SNMP enrichment off: no credential is loaded and no result carries SNMP data', async () => {
  const fake = fakeSnmp();
  const job = await createJob();
  assert.equal((await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16, snmpEnricher: fake.snmpEnricher })).status, 'COMPLETED');
  assert.deepEqual(fake.loads, []);
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual([stored.snmpCredentialId, stored.snmpEnrichedCount, stored.snmpFailedCount, stored.snmpSkippedReason], [null, 0, 0, null]);
  assert.equal(await prisma.discoveryResult.count({ where: { jobId: job.id, NOT: { snmp: { equals: Prisma.DbNull } } } }), 0);
});

test('SNMP enrichment on: only hosts that answered are tried, with the one subnet credential, and provenance is stored', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoverySnmpCredentialId: snmpCredentialId } });
  const fake = fakeSnmp((address) => address.endsWith('.10') ? 'AUTH' : address.endsWith('.15') ? 'TIMEOUT' : 'OK');
  const job = await createJob();
  const outcome = await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16, snmpEnricher: fake.snmpEnricher });
  assert.equal(outcome.status, 'COMPLETED', 'per-target SNMP failures never fail the scan');
  assert.deepEqual(fake.loads, [`${snmpCredentialId}@${siteId}`]);
  assert.equal(fake.calls.length, 12, 'one attempt per answered host, none for silent addresses');
  assert.ok(fake.calls.every((call) => call.credentialId === snmpCredentialId && reachable(call.address)));
  assert.equal(new Set(fake.calls.map((call) => call.address)).size, 12);
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual({ credential: stored.snmpCredentialId, ok: stored.snmpEnrichedCount, failed: stored.snmpFailedCount, skipped: stored.snmpSkippedReason, probes: stored.probeCount },
    { credential: snmpCredentialId, ok: 10, failed: 2, skipped: null, probes: 62 * probesPerAddress(['ICMP'], []) + 12 });
  const rows = await prisma.discoveryResult.findMany({ where: { jobId: job.id } });
  const byAddress = new Map(rows.map((row) => [row.address, readEnrichment(row.snmp)]));
  assert.deepEqual(byAddress.get('10.251.0.5')?.fields.entitySerial, { value: 'FOC-10.251.0.5', oid: '1.3.6.1.2.1.47.1.1.1.1.11.1000', source: 'SNMP', credentialId: snmpCredentialId, observedAt: '2026-11-24T12:00:00.000Z' });
  assert.deepEqual([byAddress.get('10.251.0.10')?.status, byAddress.get('10.251.0.10')?.errorCode], ['AUTH_FAILED', 'SNMP_AUTHENTICATION_FAILED']);
  assert.equal(byAddress.get('10.251.0.15')?.status, 'TIMEOUT');
});

test('the credential is fixed when the job first starts; a retry keeps it even if the subnet setting changed', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoverySnmpCredentialId: snmpCredentialId } });
  const fake = fakeSnmp();
  const job = await createJob();
  let calls = 0;
  const crashing: ScanDependencies['probe'] = async (...args) => { calls += 1; if (calls > 16) throw Object.assign(new Error('worker lost'), { code: 'ECONNRESET' }); return probe(...args); };
  await assert.rejects(runDiscoveryScan(prisma, job.id, { probe: crashing, batchSize: 16, snmpEnricher: fake.snmpEnricher }), /worker lost/);
  await recordDiscoveryFailure(prisma, job.id, Object.assign(new Error('x'), { code: 'ECONNRESET' }), false);
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoverySnmpCredentialId: otherSnmpCredentialId } });
  assert.equal((await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16, snmpEnricher: fake.snmpEnricher })).status, 'COMPLETED');
  assert.ok(fake.calls.length > 0);
  assert.ok(fake.calls.every((call) => call.credentialId === snmpCredentialId), 'never switches to the newly selected credential mid-job');
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.equal(stored.snmpCredentialId, snmpCredentialId);
  assert.equal(stored.snmpEnrichedCount, 12);
});

test('an unusable credential skips enrichment for the scan, records why, and the scan still completes', async () => {
  await prisma.subnet.update({ where: { id: subnetId }, data: { discoverySnmpCredentialId: snmpCredentialId } });
  const job = await createJob();
  const outcome = await runDiscoveryScan(prisma, job.id, { probe, batchSize: 16, snmpEnricher: async () => ({ skipped: 'SNMP_CREDENTIAL_OUT_OF_SCOPE' }) });
  assert.equal(outcome.status, 'COMPLETED');
  const stored = await prisma.discoveryJob.findUniqueOrThrow({ where: { id: job.id } });
  assert.deepEqual([stored.snmpSkippedReason, stored.snmpEnrichedCount, stored.snmpFailedCount, stored.resultCount], ['SNMP_CREDENTIAL_OUT_OF_SCOPE', 0, 0, 12]);
});
