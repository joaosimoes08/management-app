import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { InventoryQualityService } from './inventory-quality.service';

test('summary counts distinct affected devices and reports finding/entity counts separately', async () => {
  const findings = [
    { id: 'f1', siteId: 'site', status: 'OPEN', severity: 'HIGH', rule: 'MISSING_MODEL', entityType: 'Device', entityId: 'device-a' },
    { id: 'f2', siteId: 'site', status: 'OPEN', severity: 'WARNING', rule: 'MISSING_LOCATION', entityType: 'Device', entityId: 'device-a' },
    { id: 'f3', siteId: 'site', status: 'OPEN', severity: 'WARNING', rule: 'STALE_SNMP_OBSERVATION', entityType: 'DeviceInterface', entityId: 'interface-a' },
  ];
  const prisma = {
    site: { findMany: async () => [{ id: 'site' }] },
    inventoryFinding: { findMany: async () => findings },
    device: { findMany: async ({ select }: any) => select?.id ? [{ id: 'device-a' }, { id: 'device-b' }] : [] },
    deviceInterface: { findMany: async () => [{ id: 'interface-a', deviceId: 'device-a' }] },
    snmpDrift: { findMany: async () => [] }, ipAddress: { findMany: async () => [] },
  };
  const service = new InventoryQualityService(prisma as never, {} as never, {} as never, {} as never, {} as never);
  const summary = await service.summary({ id: 'user', roles: ['ADMIN'] } as never);
  assert.equal(summary.deviceCount, 2);
  assert.equal(summary.affectedDeviceCount, 1);
  assert.equal(summary.validDeviceCount, 1);
  assert.equal(summary.affectedEntityCount, 2);
  assert.equal(summary.findingCount, 3);
  assert.equal(summary.total, 2);
  assert.equal(summary.invalid, 1);
  assert.equal(summary.valid, 1);
  assert.equal(summary.staleFindingCount, 1);
  assert.equal(summary.score, 50);
});
