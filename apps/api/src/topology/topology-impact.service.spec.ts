import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { TopologyImpactService } from './topology-impact.service';

const id = (n: number) => `00000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const FW = id(1), CORE = id(2), ACC = id(3), SRV = id(4), SRV2 = id(5), OTHER = id(6);
const device = (deviceId: string, name: string, type: string, extra: Record<string, unknown> = {}) => ({ id: deviceId, name, type, status: 'ACTIVE', hostname: null, managementIp: null, isCritical: false, criticalityTier: null, siteId: 'site', rackId: 'rack', rack: { roomId: 'room-a' }, ...extra });
const devices = [
  device(FW, 'FW', 'FIREWALL'), device(CORE, 'CORE', 'SWITCH', { criticalityTier: 'T1', isCritical: true }), device(ACC, 'ACC', 'SWITCH', { rack: { roomId: 'room-b' } }),
  device(SRV, 'SRV', 'SERVER', { hostname: 'srv.corp.local', managementIp: '10.0.0.4', criticalityTier: 'T2' }), device(SRV2, 'SRV2', 'SERVER'), device(OTHER, 'OTHER', 'SERVER'),
];
const connections = [
  { id: 'c1', sourceDeviceId: FW, targetDeviceId: CORE, type: 'PHYSICAL' }, { id: 'c2', sourceDeviceId: CORE, targetDeviceId: ACC, type: 'PHYSICAL' },
  { id: 'c3', sourceDeviceId: ACC, targetDeviceId: SRV, type: 'PHYSICAL' }, { id: 'c4', sourceDeviceId: FW, targetDeviceId: OTHER, type: 'PHYSICAL' },
  { id: 'c5', sourceDeviceId: OTHER, targetDeviceId: SRV2, type: 'LOGICAL' },
];
const outlets = [{ pduId: 'pdu-a', deviceId: SRV }, { pduId: 'pdu-b', deviceId: SRV }, { pduId: 'pdu-a', deviceId: SRV2 }];
const inList = (value: string, filter: any) => !filter || (filter.in ? filter.in.includes(value) : value === filter);

function prisma() {
  return {
    device: {
      findUnique: async ({ where }: any) => devices.find((item) => item.id === where.id) ?? null,
      findMany: async ({ where }: any) => devices.filter((item) => where.id ? inList(item.id, where.id) : where.OR.some((clause: any) => (clause.siteId && item.siteId === clause.siteId) || (clause.id && inList(item.id, clause.id)))),
    },
    deviceConnection: { findMany: async ({ where }: any) => connections.filter((item) => (!where.type || item.type === where.type) && (!where.id || inList(item.id, where.id))).map((item) => ({ ...item, label: null, sourceInterface: null, targetInterface: null })) },
    rackPdu: { findUnique: async ({ where }: any) => ['pdu-a', 'pdu-b'].includes(where.id) ? { id: where.id, name: null, source: where.id === 'pdu-a' ? 'SUPPLIER' : 'UPS', rackId: 'rack', rack: { name: 'R1', room: { building: { siteId: 'site' } } } } : null },
    rack: { findUnique: async () => ({ id: 'rack', name: 'R1', room: { building: { siteId: 'site' } }, devices: [{ id: SRV }, { id: SRV2 }], pdus: [{ id: 'pdu-a' }, { id: 'pdu-b' }] }) },
    pduOutletAssignment: { findMany: async ({ where }: any) => outlets.filter((item) => inList(item.pduId, where.pduId) && inList(item.deviceId, where.deviceId)) },
    host: { findMany: async ({ where }: any) => where.OR[0].deviceId.in.includes(SRV) ? [{ id: 'host-1', name: 'srv', hostname: 'srv.corp.local', observedHostname: null, status: 'ACTIVE', deviceId: SRV, ipAddresses: [{ address: '10.0.0.40', deviceId: SRV }], services: [{ id: 'svc', name: 'https', protocol: 'tcp', port: 443, status: 'UP' }] }] : [] },
    applicationLink: { findMany: async () => [{ id: 'app-1', name: 'ERP', url: 'https://srv.corp.local/erp', category: 'Apps' }, { id: 'app-2', name: 'Wiki', url: 'https://wiki.corp.local', category: 'Apps' }, { id: 'app-3', name: 'Direct', url: 'http://10.0.0.40:8080', category: 'Apps' }] },
  };
}
function access(rooms = ['room-a', 'room-b']) {
  return {
    assertDevice: async (_user: unknown, _action: string, deviceId: string) => { const item = devices.find((row) => row.id === deviceId); if (!item) throw new Error('missing'); return { id: item.id, type: item.type, siteId: item.siteId, rack: item.rack }; },
    assertRack: async () => ({ id: 'rack', roomId: 'room-a' }),
    visibleRoomIds: async () => rooms, visibleUnplacedSiteIds: async () => ['site'],
  };
}
const admin = { id: 'u', roles: ['ADMIN'] } as never;

test('device impact lists downstream devices, hosts, services, apps and tiers', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  const result: any = await service.impact(admin, { deviceId: CORE });
  assert.equal(result.anchorMode, 'gateway-devices');
  assert.deepEqual(result.anchorDeviceIds, [FW]);
  assert.deepEqual(result.down.map((item: any) => [item.id, item.reason]), [[CORE, 'ORIGIN']]);
  assert.deepEqual(result.affected.map((item: any) => [item.name, item.hops]), [['ACC', 1], ['SRV', 2]]);
  assert.deepEqual(result.hosts.map((item: any) => item.id), ['host-1']);
  assert.equal(result.counts.services, 1);
  assert.deepEqual(result.applications.map((item: any) => item.name), ['ERP', 'Direct']);
  assert.deepEqual(result.critical, { T1: [CORE], T2: [SRV], T3: [], untiered: [] });
  assert.equal(result.hiddenCount, 0);
  assert.equal(typeof result.elapsedMs, 'number');
});

test('logical links are ignored unless asked for', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  const physical: any = await service.impact(admin, { deviceId: OTHER });
  assert.deepEqual(physical.affected, []);
  const logical: any = await service.impact(admin, { deviceId: OTHER, includeLogical: 'true' });
  assert.deepEqual(logical.affected.map((item: any) => item.name), ['SRV2']);
});

test('a PDU takes down single-fed devices and flags dual-fed ones as degraded', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  const result: any = await service.impact(admin, { pduId: 'pdu-a' });
  assert.equal(result.origin.kind, 'PDU');
  assert.deepEqual(result.down.map((item: any) => [item.name, item.reason]), [['SRV2', 'POWER']]);
  assert.deepEqual(result.powerDegraded.map((item: any) => item.name), ['SRV']);
});

test('a rack takes down every device in it', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  const result: any = await service.impact(admin, { rackId: id(99) });
  assert.deepEqual(result.down.map((item: any) => [item.name, item.reason]).sort(), [['SRV', 'RACK'], ['SRV2', 'RACK']]);
  assert.deepEqual(result.powerDegraded, []);
});

test('devices outside the caller scope are counted, not named', async () => {
  const service = new TopologyImpactService(prisma() as never, access(['room-a']) as never);
  const result: any = await service.impact({ id: 'u', roles: ['READ_ONLY'] } as never, { deviceId: CORE });
  assert.deepEqual(result.affected.map((item: any) => item.name), ['SRV']);
  assert.equal(result.affected[0].viaDeviceId, null, 'the hidden access switch is not revealed as the via device');
  assert.equal(result.hiddenCount, 1);
});

test('exactly one origin is required', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  await assert.rejects(service.impact(admin, {}), (error: any) => error.getStatus() === 400);
  await assert.rejects(service.impact(admin, { deviceId: CORE, rackId: id(99) }), (error: any) => error.getStatus() === 400);
});

test('path view returns the shortest path and hides devices out of scope', async () => {
  const service = new TopologyImpactService(prisma() as never, access() as never);
  const result: any = await service.path(admin, { fromDeviceId: SRV, toDeviceId: OTHER });
  assert.equal(result.found, true);
  assert.deepEqual(result.steps.map((item: any) => item.name), ['SRV', 'ACC', 'CORE', 'FW', 'OTHER']);
  assert.deepEqual(result.connections.map((item: any) => item.id), ['c3', 'c2', 'c1', 'c4']);
  const scoped: any = await new TopologyImpactService(prisma() as never, access(['room-a']) as never).path({ id: 'u', roles: ['READ_ONLY'] } as never, { fromDeviceId: SRV, toDeviceId: OTHER });
  assert.deepEqual(scoped.steps.map((item: any) => item.hidden), [false, true, false, false, false]);
  assert.deepEqual(scoped.connections.map((item: any) => item.hidden), [true, true, false, false]);
  const none: any = await service.path(admin, { fromDeviceId: SRV, toDeviceId: SRV2 });
  assert.deepEqual([none.found, none.reason], [false, 'NO_PATH']);
});
