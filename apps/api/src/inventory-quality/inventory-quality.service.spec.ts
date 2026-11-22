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

test('flags models without a front image and with incomplete per-face port mapping', async () => {
  const port = (n: number) => ({ portKey: `ethernet1/${n}`, x: 0.1, y: 0.1, width: 0.02, height: 0.1 });
  const model = (id: string, extra: Record<string, unknown>) => ({ id, manufacturer: 'Cisco', model: id, supportsNetworkPorts: true, networkPortCount: 2, portCount: 2, frontAssetId: 'front', ...extra });
  const device = (id: string, deviceModel: unknown) => ({ id, name: id, siteId: 'site-1', rackId: 'rack-1', modelId: 'x', type: 'SERVER', status: 'ACTIVE', managementIp: '10.0.0.1', model: deviceModel, interfaces: [], snmpSnapshots: [] });
  const devices = [
    device('d1', model('migrated', { frontAssetId: null, portLayout: { imageWidth: 1, imageHeight: 1, ports: [port(1), port(2)] } })),
    device('d2', model('partial', { portLayout: { version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: [port(1)] } } } })),
    device('d3', model('complete', { portLayout: { version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: [port(1)] }, rear: { imageWidth: 1, imageHeight: 1, ports: [port(2)] } } } })),
    device('d4', model('seeded', { portLayout: { family: 'ethernet', ports: 2 } })),
  ];
  const prisma = { device: { findMany: async () => devices }, snmpDrift: { findMany: async () => [] }, ipAddress: { findMany: async () => [] }, $queryRaw: async () => [] } as any;
  const service = new InventoryQualityService(prisma, {} as any, {} as any, {} as any, {} as any);

  const found = await (service as any).detect('site-1') as Array<{ rule: string; entityId: string; title: string; severity: string }>;
  const pick = (rule: string) => found.filter((item) => item.rule === rule).map((item) => item.entityId).sort();

  assert.deepEqual(pick('DEVICE_MODEL_MISSING_FRONT_IMAGE'), ['migrated']);
  assert.deepEqual(pick('NETWORK_MODEL_MISSING_PORT_MAP'), ['partial', 'seeded']);
  assert.ok(found.filter((item) => item.rule === 'DEVICE_MODEL_MISSING_FRONT_IMAGE').every((item) => item.title === 'Sem vista frontal' && item.severity === 'WARNING'));
  assert.ok(found.filter((item) => item.rule === 'NETWORK_MODEL_MISSING_PORT_MAP').every((item) => item.title === 'Mapeamento de portas em falta' && item.severity === 'WARNING'));
});
