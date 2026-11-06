import { strict as assert } from 'node:assert';
import { test } from 'node:test';
import { InventoryQualityService } from './inventory-quality.service';

test('DEVICE_MISSING_SITE links directly to its unassigned device record', async () => {
  const finding = {
    id: 'finding-1',
    siteId: null,
    entityType: 'Device',
    entityId: 'device-1',
    rule: 'DEVICE_MISSING_SITE',
    severity: 'HIGH',
    status: 'OPEN',
    title: 'Equipamento sem Site',
    detail: 'switch-1 não está associado a um Site.',
    lastDetectedAt: new Date('2026-11-06T10:00:00Z'),
  };
  const prisma = { inventoryFinding: { findMany: async () => [finding] } } as any;
  const service = new InventoryQualityService(prisma, {} as any, {} as any, {} as any, {} as any);
  (service as any).visibleSiteIds = async () => [];
  (service as any).filterVisibleFindings = async (_user: unknown, items: unknown[]) => items;

  const result = await service.list({ id: 'admin', roles: ['ADMIN'] } as any);

  assert.equal(result.items[0].actionHref, '/infraestrutura?tab=devices&deviceId=device-1&focus=device');
});
