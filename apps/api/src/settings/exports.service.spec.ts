import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { ExportsService } from './exports.service';

const user = { id: 'user-1', username: 'operator', roles: ['SYSTEMS_OPERATOR'] } as any;

function makeService(rows: Record<string, unknown>[]) {
  const calls: Record<string, unknown> = {};
  const prisma = { device: { findMany: async (args: unknown) => { calls.query = args; return rows; } } } as any;
  const infrastructure = {
    visibleRoomIds: async (actor: unknown, siteId?: string) => { calls.roomScope = [actor, siteId]; return ['room-1']; },
    visibleUnplacedSiteIds: async (actor: unknown, siteId?: string) => { calls.siteScope = [actor, siteId]; return ['site-1']; },
  } as any;
  const audits: unknown[] = [];
  const audit = { record: async (event: unknown) => { audits.push(event); } } as any;
  return { subject: new ExportsService(prisma, {} as any, infrastructure, {} as any, audit), calls, audits };
}

test('builds deterministic Ansible groups from the scoped device query and allowlisted host variables', async () => {
  const { subject, calls, audits } = makeService([
    { id: 'd-2', name: 'Core Switch', type: 'Switch', hostname: 'core-01', managementIp: '192.0.2.2', assetTag: 'A-2', serialNumber: 'S-2', status: 'ACTIVE', siteId: 'site-1', snmpCommunity: 'must-not-leak' },
    { id: 'd-1', name: 'Édge Router', type: 'Router', hostname: 'edge-01', managementIp: '192.0.2.1', status: 'ACTIVE', siteId: 'site-1', snmpPassword: 'must-not-leak' },
    { id: 'd-3', name: 'Edge Router duplicate', type: 'Router', hostname: 'edge-01', managementIp: '192.0.2.3', status: 'ACTIVE', siteId: 'site-1' },
  ]);

  const result = await subject.ansibleInventory('site-1', user) as any;

  assert.deepEqual(result.all.children, ['device_type_router', 'device_type_switch']);
  assert.deepEqual(result.device_type_router.hosts, ['edge_01', 'edge_01_d_3']);
  assert.deepEqual(result.device_type_switch.hosts, ['core_01']);
  assert.deepEqual(result._meta.hostvars.edge_01, {
    ansible_host: '192.0.2.1', inventory_name: 'Édge Router', device_type: 'Router',
    device_status: 'ACTIVE', site_id: 'site-1',
  });
  assert.equal(JSON.stringify(result).includes('must-not-leak'), false);
  assert.deepEqual(calls.roomScope, [user, 'site-1']);
  assert.deepEqual(calls.siteScope, [user, 'site-1']);
  const query = calls.query as any;
  assert.deepEqual(query.where.AND[1], { siteId: 'site-1' });
  assert.equal(Object.hasOwn(query.select, 'snmpCommunity'), false);
  assert.deepEqual(audits, [{ userId: user.id, action: 'ANSIBLE_INVENTORY_EXPORT', entityType: 'InventoryExport', metadata: { kind: 'ansible', format: 'json', siteId: 'site-1', rowCount: 3 } }]);
});

test('emits a valid empty Ansible inventory and audits the requested scope', async () => {
  const { subject, audits } = makeService([]);
  const result = await subject.ansibleInventory(undefined, user);

  assert.deepEqual(result, { all: { children: [] }, _meta: { hostvars: {} } });
  assert.equal((audits[0] as any).metadata.rowCount, 0);
  assert.equal((audits[0] as any).metadata.siteId, null);
});
