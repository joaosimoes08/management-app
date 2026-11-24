import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { SnmpService } from './snmp.service';

const service = Object.create(SnmpService.prototype) as any;

describe('SNMP credential policy and redaction', () => {
  it('returns metric history only after device access and scopes samples to the requested interface', async () => {
    let accessChecked = false;
    const observedAt = new Date('2026-10-31T12:00:00.000Z');
    const metricsService = Object.create(SnmpService.prototype) as any;
    metricsService.device = async (deviceId: string, user: unknown) => { accessChecked = deviceId === 'device-1' && user === 'reader'; };
    metricsService.prisma = {
      snmpSnapshot: {
        findMany: async () => [{ observedAt, interfaces: [
          { ifIndex: 3, name: 'uplink', description: null, adminUp: true, operUp: true, speedMbps: 1000, counters: { hcInOctets: '1000', hcOutOctets: '2000' } },
          { ifIndex: 4, name: 'other', description: null, adminUp: true, operUp: false, speedMbps: 100, counters: {} },
        ] }],
        findFirst: async () => ({ interfaces: [{ ifIndex: 3, name: 'uplink', description: null }, { ifIndex: 4, name: 'other', description: null }] }),
      },
      snmpDeviceConfig: { findUnique: async () => ({ intervalMinutes: 15 }) },
      snmpJob: { findMany: async () => [{ id: 'poll-1', status: 'FAILED', errorCode: 'SNMP_TIMEOUT', createdAt: observedAt, completedAt: observedAt }] },
    };
    const result = await metricsService.metrics('device-1', 'reader', 3, 7);
    assert.equal(accessChecked, true);
    assert.equal(result.selectedInterfaceIndex, 3);
    assert.equal(result.interfaces.length, 2);
    assert.equal(result.interfacesHistory.length, 1);
    assert.equal(result.interfacesHistory[0].operUp, true);
    assert.equal(result.availability[0].available, false);
    assert.equal(result.availability[0].errorCode, 'SNMP_TIMEOUT');
  });

  it('returns the latest device health only after device access, with BigInt columns as strings (Phase 2 step 8)', async () => {
    const calls: string[] = [];
    const healthService = Object.create(SnmpService.prototype) as any;
    healthService.device = async (deviceId: string, user: unknown) => { calls.push(`access:${deviceId}:${user}`); };
    let row: any = null;
    healthService.prisma = { snmpDeviceHealth: { findUnique: async ({ where }: any) => { calls.push(`read:${where.deviceId}`); return row; } } };
    assert.deepEqual(await healthService.health('device-1', 'reader'), { deviceId: 'device-1', health: null });
    assert.deepEqual(calls, ['access:device-1:reader', 'read:device-1']);
    const observedAt = new Date('2026-11-23T12:00:00.000Z');
    row = { vendor: 'cisco', status: 'DEGRADED', observedAt, jobId: 'job-1', uptimeTicks: 24000n, bootedAt: observedAt, rebootDetectedAt: observedAt, rebootCount: 1, cpu5sPercent: 97, cpu1mPercent: 94, cpu5mPercent: 91, memoryUsedPercent: 94.03, memoryUsedBytes: 1513000000n, memoryTotalBytes: 1609000000n, issueCount: 6, data: { issues: [] } };
    const result = await healthService.health('device-1', 'reader');
    assert.equal(result.health.uptimeTicks, '24000');
    assert.equal(result.health.memory.totalBytes, '1609000000');
    assert.deepEqual(result.health.cpu, { fiveSecondPercent: 97, oneMinutePercent: 94, fiveMinutePercent: 91 });
    assert.doesNotThrow(() => JSON.stringify(result));
    healthService.device = async () => { throw new Error('denied'); };
    await assert.rejects(healthService.health('device-1', 'outsider'), /denied/);
  });

  it('rejects unsupported periods and interface indices', async () => {
    const metricsService = Object.create(SnmpService.prototype) as any;
    await assert.rejects(metricsService.metrics('device-1', 'reader', undefined, 2));
    await assert.rejects(metricsService.metrics('device-1', 'reader', 0, 7));
  });

  it('requires authPriv material and gates SHA-1 compatibility', () => {
    assert.deepEqual(service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value' }), {
      username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value',
    });
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: false }));
    assert.doesNotThrow(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'auth-key-value', privKey: 'priv-key-value', authProtocol: 'SHA1' }, { compatibilitySha1: true }));
    assert.throws(() => service.credentialSecret({ version: 'V3', username: 'operator', authKey: 'short', privKey: 'short' }));
  });

  it('never exposes encrypted payload fields in API summaries', () => {
    const output = service.publicCredential({
      id: 'credential-id', deviceId: 'device-id', purpose: 'READ', version: 'V3', username: 'operator',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'),
      keyId: 'v1', enabled: true,
    });
    assert.equal(output.configured, true);
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
  });

  it('redacts enrollment envelopes and selects the most specific Site subnet', () => {
    const output = service.publicEnrollment({
      id: 'enrollment-id', siteId: 'site-id', sourceAddress: '10.20.30.42', status: 'DISCOVERED',
      ciphertext: Buffer.from('ciphertext'), iv: Buffer.from('iv'), authTag: Buffer.from('tag'),
      wrappedDek: Buffer.from('dek'), wrapIv: Buffer.from('iv'), wrapAuthTag: Buffer.from('tag'), keyId: 'v1',
    });
    for (const field of ['ciphertext', 'iv', 'authTag', 'wrappedDek', 'wrapIv', 'wrapAuthTag']) assert.equal(field in output, false);
    assert.equal(service.mostSpecificSubnet('10.20.30.42', [
      { id: 'broad', cidr: '10.0.0.0/8' },
      { id: 'site', cidr: '10.20.30.0/24' },
      { id: 'specific', cidr: '10.20.30.32/28' },
      { id: 'other', cidr: '10.20.31.0/24' },
    ]).id, 'specific');
    assert.equal(service.mostSpecificSubnet('192.0.2.1', [{ id: 'site', cidr: '10.20.30.0/24' }]), undefined);
  });
});

describe('SNMP interface change impact preview', () => {
  it('does not report zero impact when no related connection is known', async () => {
    const impactService = Object.create(SnmpService.prototype) as any;
    impactService.prisma = {
      snmpSnapshot: { findFirst: async () => ({ observedAt: new Date() }) },
      deviceConnection: { findMany: async () => [] },
      lldpObservation: { findMany: async () => [] },
    };
    impactService.access = { assertDevice: async () => undefined };
    const result = await impactService.interfaceImpactPreview({ siteId: 'site' }, { id: 'interface', name: 'Gi0/1', deviceId: 'switch' }, { id: 'operator' });
    assert.deepEqual(result.knownImpacts, []);
    assert.equal(result.coverage.status, 'UNKNOWN');
    assert.match(result.coverage.reason, /não significa impacto zero/);
  });

  it('links documented neighbors and labels stale observation coverage', async () => {
    const impactService = Object.create(SnmpService.prototype) as any;
    impactService.prisma = {
      snmpSnapshot: { findFirst: async () => ({ observedAt: new Date(Date.now() - 48 * 60 * 60 * 1000) }) },
      deviceConnection: { findMany: async () => [{ sourceInterfaceId: 'interface', targetDevice: { id: 'peer', name: 'edge-1', type: 'SWITCH' }, targetInterface: { name: 'Gi0/2' } }] },
      lldpObservation: { findMany: async () => [] },
    };
    impactService.access = { assertDevice: async () => undefined };
    const result = await impactService.interfaceImpactPreview({ siteId: 'site one' }, { id: 'interface', name: 'Gi0/1', deviceId: 'switch' }, { id: 'operator' });
    assert.equal(result.knownImpacts[0].id, 'peer');
    assert.match(result.knownImpacts[0].href, /deviceId=peer/);
    assert.equal(result.coverage.status, 'STALE');
  });

  it('requires acknowledgement before a preview can be submitted', async () => {
    const previousFlag = process.env.SNMP_SET_ENABLED;
    process.env.SNMP_SET_ENABLED = 'true';
    const impactService = Object.create(SnmpService.prototype) as any;
    impactService.prisma = { snmpWriteRequest: { findUnique: async () => ({ id: 'request', deviceId: 'switch', status: 'PREVIEW', impactPreview: { coverage: { status: 'UNKNOWN' } }, requestedAt: new Date() }) } };
    impactService.device = async () => ({ id: 'switch' });
    try {
      await assert.rejects(impactService.executeWrite('request', { impactAcknowledged: false }, { id: 'operator' }), (error: any) => error.getResponse().code === 'SNMP_SET_IMPACT_ACK_REQUIRED');
    } finally {
      if (previousFlag === undefined) delete process.env.SNMP_SET_ENABLED;
      else process.env.SNMP_SET_ENABLED = previousFlag;
    }
  });
});

// Round 2 #12: scheduler reconciliation repairs only missing schedulers and records failures instead of swallowing them.
describe('SNMP scheduler reconciliation', () => {
  const quietLogger = { errors: [] as string[], error(message: string) { this.errors.push(message); } };
  function harness(options: { schedulers?: string[]; queueDown?: boolean; upsertFails?: string[] }) {
    const svc = Object.create(SnmpService.prototype) as any;
    const updates: Array<{ id: string; data: any }> = [];
    const upserts: string[] = [];
    svc.logger = { ...quietLogger, errors: [] };
    svc.prisma = { snmpDeviceConfig: {
      findMany: async () => [
        { id: '00000000-0000-4000-8000-000000000001', deviceId: 'd1', enabled: true, intervalMinutes: 15, nextPollAt: new Date() },
        { id: '00000000-0000-4000-8000-000000000002', deviceId: 'd2', enabled: true, intervalMinutes: 15, nextPollAt: new Date() },
        { id: '00000000-0000-4000-8000-000000000003', deviceId: 'd3', enabled: true, intervalMinutes: 15, nextPollAt: null },
      ],
      update: async (args: { where: { id: string }; data: any }) => { updates.push({ id: args.where.id, data: args.data }); return {}; },
    } };
    svc.queue = {
      getJobSchedulers: async () => { if (options.queueDown) throw new Error('ECONNREFUSED'); return (options.schedulers ?? []).map((key) => ({ key, name: 'poll' })); },
      upsertJobScheduler: async (id: string) => { if (options.upsertFails?.includes(id)) throw new Error('boom'); upserts.push(id); },
    };
    return { svc, updates, upserts };
  }

  it('creates only the missing schedulers (and one whose next poll was cleared), leaving existing cadences alone', async () => {
    const { svc, upserts } = harness({ schedulers: ['snmp-device-d1', 'snmp-device-d3'] });
    const health = await svc.reconcileSchedulers(new Date('2026-11-22T10:00:00Z'));
    assert.deepEqual(upserts.sort(), ['snmp-device-d2', 'snmp-device-d3']);
    assert.deepEqual({ ok: health.ok, checked: health.checked, repaired: health.repaired, failed: health.failed }, { ok: true, checked: 3, repaired: 2, failed: 0 });
    assert.equal(svc.schedulerHealth, health);
  });

  it('records a per-device error and logs it when a scheduler cannot be created', async () => {
    const { svc, updates } = harness({ schedulers: ['snmp-device-d1', 'snmp-device-d3'], upsertFails: ['snmp-device-d2'] });
    const health = await svc.reconcileSchedulers();
    assert.equal(health.ok, false);
    assert.equal(health.failed, 1);
    assert.deepEqual(updates.find((item) => item.id === '00000000-0000-4000-8000-000000000002')?.data, { nextPollAt: null, lastErrorCode: 'SNMP_SCHEDULER_FAILED' });
    assert.equal(svc.logger.errors.length, 1);
  });

  it('marks every enabled device when the queue is unreachable', async () => {
    const { svc, updates, upserts } = harness({ queueDown: true });
    const health = await svc.reconcileSchedulers();
    assert.equal(health.errorCode, 'SNMP_QUEUE_UNAVAILABLE');
    assert.equal(health.failed, 3);
    assert.equal(upserts.length, 0);
    assert.ok(updates.every((item) => item.data.lastErrorCode === 'SNMP_QUEUE_UNAVAILABLE' && item.data.nextPollAt === null));
  });
});
