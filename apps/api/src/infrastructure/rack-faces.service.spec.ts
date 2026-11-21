import 'reflect-metadata';
import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { BadRequestException, ConflictException, RequestMethod } from '@nestjs/common';
import { InfrastructureService } from './infrastructure.service';
import { InfrastructureController } from './infrastructure.controller';

const user = { id: 'user-1', username: 'admin', roles: ['ADMIN'] } as any;
const port = (n: number) => ({ portKey: `ethernet1/${n}`, label: `${n}`, interfaceType: 'RJ45', x: 0.1, y: 0.1, width: 0.02, height: 0.1 });

function harness(model: Record<string, unknown>, assets: string[] = ['asset-front', 'asset-rear']) {
  const updates: any[] = []; const creates: any[] = []; const audits: any[] = []; const locks: number[] = [];
  let stored = { id: 'model-1', model: 'C9300', frontAssetId: null, backAssetId: null, frontAsset: null, backAsset: null, portLayout: null, networkPortCount: 4, portCount: 4, supportsNetworkPorts: true, ...model } as any;
  const prisma = {
    deviceModel: {
      findUnique: async () => stored,
      update: async (args: any) => { updates.push(args); stored = { ...stored, ...args.data }; return stored; },
      create: async (args: any) => { creates.push(args); return { id: 'new', ...args.data }; },
    },
    assetFile: {
      count: async ({ where }: any) => (assets.includes(where.id) ? 1 : 0),
      findUnique: async ({ where }: any) => (assets.includes(where.id) ? { id: where.id, storageKey: `${where.id}.bin`, mimeType: where.id === 'asset-pdf' ? 'application/pdf' : 'image/png' } : null),
    },
    auditLog: { create: async (args: any) => { audits.push(args); return args.data; } },
    $queryRaw: async () => { locks.push(1); return []; },
  } as any;
  prisma.$transaction = async (fn: (tx: any) => unknown) => { const snapshot = stored; try { return await fn(prisma); } catch (error) { stored = snapshot; throw error; } };
  const audit = { record: async (args: any) => audits.push(args), scheduleInventoryQualityReconcile: async () => undefined } as any;
  const subject = new InfrastructureService(prisma, audit, {} as any, {} as any);
  (subject as any).log = async (...args: unknown[]) => { audits.push(args); };
  // Stored bytes: 'asset-fake-png' is declared image/png but is really a PDF; every other asset is a real PNG.
  (subject as any).readAssetBytes = async (storageKey: string) => (storageKey.startsWith('asset-fake-png') ? PDF_BYTES : PNG_BYTES);
  return { subject, updates, creates, locks, get stored() { return stored; } };
}

const PNG_BYTES = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13]);
const PDF_BYTES = Buffer.from('%PDF-1.7\n%fake\n');

const code = (expected: string) => (error: unknown) => (error instanceof BadRequestException || error instanceof ConflictException) && (error.getResponse() as any).code === expected;

describe('port-layout endpoints per face', () => {
  test('GET returns normalised v2 with the requested face, its image and the mapping status', async () => {
    const { subject } = harness({ portLayout: { imageWidth: 1000, imageHeight: 300, ports: [port(1), port(2), port(3), port(4)] }, backAsset: { id: 'asset-rear' } });
    const rear = await subject.getPortLayout('model-1');
    assert.equal(rear.face, 'rear');
    assert.equal(rear.portLayout?.version, 2);
    assert.equal(rear.faceLayout?.ports.length, 4);
    assert.deepEqual(rear.asset, { id: 'asset-rear' });
    assert.equal(rear.mapping.complete, true);
    const front = await subject.getPortLayout('model-1', 'front');
    assert.equal(front.faceLayout, null);
    assert.equal(front.asset, null);
  });

  test('PUT on the rear face writes backAssetId only and never frontAssetId or old top-level keys', async () => {
    const h = harness({ frontAssetId: 'asset-front', portLayout: { imageWidth: 1000, imageHeight: 300, ports: [port(1)], warnings: ['old'], legacyJunk: true } });
    await h.subject.updatePortLayout('model-1', { imageWidth: 1200, imageHeight: 200, ports: [port(1), port(2)], assetId: 'asset-rear' }, user, 'rear');
    const data = h.updates[0].data;
    assert.equal(data.backAssetId, 'asset-rear');
    assert.equal('frontAssetId' in data, false);
    assert.deepEqual(data.portLayout, { version: 2, faces: { rear: { imageWidth: 1200, imageHeight: 200, ports: [port(1), port(2)] } } });
  });

  test('PUT on the front face leaves the rear face and rear image untouched', async () => {
    const h = harness({ backAssetId: 'asset-rear', portLayout: { version: 2, faces: { rear: { imageWidth: 900, imageHeight: 100, ports: [port(1), port(2)] } } } });
    await h.subject.updatePortLayout('model-1', { imageWidth: 500, imageHeight: 50, ports: [port(3)], assetId: 'asset-front' }, user, 'front');
    const data = h.updates[0].data;
    assert.equal(data.frontAssetId, 'asset-front');
    assert.equal('backAssetId' in data, false);
    assert.deepEqual(data.portLayout.faces.rear, { imageWidth: 900, imageHeight: 100, ports: [port(1), port(2)] });
    assert.equal(data.portLayout.faces.front.ports.length, 1);
  });

  test('PUT without assetId does not touch either image column', async () => {
    const h = harness({});
    await h.subject.updatePortLayout('model-1', { imageWidth: 1, imageHeight: 1, ports: [port(1)] }, user, 'rear');
    assert.equal('frontAssetId' in h.updates[0].data, false);
    assert.equal('backAssetId' in h.updates[0].data, false);
  });

  test('PUT rejects partly mapped ports with PORT_LAYOUT_INCOMPLETE and saves nothing', async () => {
    const h = harness({});
    await assert.rejects(h.subject.updatePortLayout('model-1', { ports: [{ portKey: 'ethernet1/1', x: 0.1 }] }, user, 'rear'), code('PORT_LAYOUT_INCOMPLETE'));
    assert.equal(h.updates.length, 0);
  });

  test('generate on the front face fills only the ports the rear face does not already map, without key collisions', async () => {
    const h = harness({ portLayout: { version: 2, faces: { rear: { imageWidth: 900, imageHeight: 100, ports: [port(1), port(2), port(3)] } } } });
    const result = await h.subject.generatePortLayout('model-1', user, 'front');
    assert.equal(result.face, 'front');
    assert.deepEqual(result.faceLayout?.ports.map((item) => item.portKey), ['ethernet1/4']);
    assert.equal(result.mapping.complete, true);
    assert.equal(h.stored.portLayout.faces.rear.ports.length, 3);
  });

  test('detect for a face proposes the remaining ports and skips keys mapped on the other face', async () => {
    const h = harness({ portLayout: { version: 2, faces: { front: { imageWidth: 900, imageHeight: 100, ports: [port(1)] } } } });
    const result = await h.subject.detectPortLayout('model-1', {}, 'rear');
    assert.equal(result.face, 'rear');
    assert.deepEqual(result.ports.map((item) => item.portKey), ['ethernet1/2', 'ethernet1/3', 'ethernet1/4']);
  });

  test('POST assets/rear sets backAssetId', async () => {
    const h = harness({});
    await h.subject.setModelFaceAsset('model-1', 'rear', 'asset-rear', user);
    assert.deepEqual(h.updates[0].data, { backAssetId: 'asset-rear' });
    await assert.rejects(h.subject.setModelFaceAsset('model-1', 'rear', '', user), code('ASSET_ID_REQUIRED'));
  });
});

describe('atomic save of both faces (PUT port-layout/faces)', () => {
  const face = (ports: unknown[], extra: Record<string, unknown> = {}) => ({ imageWidth: 1000, imageHeight: 300, ports, ...extra });

  test('GET returns a revision that changes after any write', async () => {
    const h = harness({});
    const first = await h.subject.getPortLayout('model-1');
    assert.match(first.revision, /^[0-9a-f]{16}$/);
    await h.subject.updatePortLayout('model-1', face([port(1)]), user, 'rear');
    assert.notEqual((await h.subject.getPortLayout('model-1')).revision, first.revision);
  });

  test('writes both faces and both images in one locked transaction and returns the new revision', async () => {
    const h = harness({});
    const { revision } = await h.subject.getPortLayout('model-1');
    const result: any = await h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: face([port(1)], { assetId: 'asset-front' }), rear: face([port(2), port(3), port(4)], { assetId: 'asset-rear' }) } }, user);
    assert.equal(h.updates.length, 1);
    assert.equal(h.locks.length, 1);
    assert.equal(h.updates[0].data.frontAssetId, 'asset-front');
    assert.equal(h.updates[0].data.backAssetId, 'asset-rear');
    assert.deepEqual(Object.keys(h.updates[0].data.portLayout.faces).sort(), ['front', 'rear']);
    assert.equal(result.mapping.complete, true);
    assert.equal(result.portLayout.version, 2);
    assert.notEqual(result.revision, revision);
    assert.equal(result.revision, (await h.subject.getPortLayout('model-1')).revision);
    assert.equal('faceLayout' in result, false);
  });

  test('a stale revision gets 409 PORT_LAYOUT_CONFLICT with the current revision and saves nothing', async () => {
    const h = harness({});
    const { revision } = await h.subject.getPortLayout('model-1');
    await h.subject.updatePortLayout('model-1', face([port(1)]), user, 'rear');
    const current = (await h.subject.getPortLayout('model-1')).revision;
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: face([port(2)]) } }, user), (error: any) => error instanceof ConflictException && (error.getResponse() as any).code === 'PORT_LAYOUT_CONFLICT' && (error.getResponse() as any).revision === current);
    assert.equal(h.updates.length, 1);
  });

  test('validates both faces together: duplicates across faces, total over the port count, half-mapped ports', async () => {
    const h = harness({});
    const { revision } = await h.subject.getPortLayout('model-1');
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: face([port(1)]), rear: face([port(1)]) } }, user), code('PORT_LAYOUT_DUPLICATE_PORT'));
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: face([port(1), port(2)]), rear: face([port(3), port(4), port(5)]) } }, user), code('PORT_LAYOUT_TOO_MANY_PORTS'));
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: face([port(1)]), rear: face([{ portKey: 'ethernet1/2', x: 0.1 }]) } }, user), code('PORT_LAYOUT_INCOMPLETE'));
    assert.equal(h.updates.length, 0);
  });

  test('null removes a face map, an absent face is left alone', async () => {
    const h = harness({ portLayout: { version: 2, faces: { front: face([port(1)]), rear: face([port(2)]) } } });
    const { revision } = await h.subject.getPortLayout('model-1');
    await h.subject.savePortLayoutFaces('model-1', { revision, faces: { front: null } }, user);
    assert.deepEqual(h.updates[0].data.portLayout.faces, { rear: face([port(2)]) });
    assert.equal('frontAssetId' in h.updates[0].data, false);
  });

  test('rejects a missing revision, missing faces, unknown faces and non-image assets', async () => {
    const h = harness({}, ['asset-front', 'asset-rear', 'asset-pdf']);
    const { revision } = await h.subject.getPortLayout('model-1');
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { faces: { rear: face([]) } }, user), code('PORT_LAYOUT_REVISION_REQUIRED'));
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: {} }, user), code('PORT_LAYOUT_FACES_REQUIRED'));
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { side: face([]) } }, user), code('PORT_LAYOUT_FACE_INVALID'));
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { rear: face([], { assetId: 'asset-pdf' }) } }, user), code('ASSET_NOT_IMAGE'));
    assert.equal(h.updates.length, 0);
  });

  test('rejects an asset declared image/png whose stored bytes are not an image (D2)', async () => {
    const h = harness({}, ['asset-front', 'asset-rear', 'asset-fake-png']);
    const { revision } = await h.subject.getPortLayout('model-1');
    await assert.rejects(h.subject.savePortLayoutFaces('model-1', { revision, faces: { rear: face([], { assetId: 'asset-fake-png' }) } }, user), code('ASSET_NOT_IMAGE'));
    await assert.rejects(h.subject.updatePortLayout('model-1', { ...face([port(1)]), assetId: 'asset-fake-png' }, user, 'front'), code('ASSET_NOT_IMAGE'));
    assert.equal(h.updates.length, 0);
  });

  test('per-face PUT also honours an optional revision', async () => {
    const h = harness({});
    await assert.rejects(h.subject.updatePortLayout('model-1', { ...face([port(1)]), revision: 'stale' }, user, 'rear'), code('PORT_LAYOUT_CONFLICT'));
  });
});

describe('model front image rule', () => {
  const dto = { manufacturer: 'Cisco', model: 'C9300', supportsNetworkPorts: true, networkPortCount: 4 };

  test('create without a front image is rejected with FRONT_IMAGE_REQUIRED', async () => {
    const h = harness({});
    await assert.rejects(h.subject.createModel({ ...dto }, user), code('FRONT_IMAGE_REQUIRED'));
    await assert.rejects(h.subject.createModel({ ...dto, frontAssetId: null as any }, user), code('FRONT_IMAGE_REQUIRED'));
    assert.equal(h.creates.length, 0);
  });

  test('create with a front image succeeds and stores a v1 portLayout as v2 rear', async () => {
    const h = harness({});
    const item: any = await h.subject.createModel({ ...dto, frontAssetId: 'asset-front', portLayout: { imageWidth: 10, imageHeight: 10, ports: [port(1)] } }, user);
    assert.equal(h.creates[0].data.frontAssetId, 'asset-front');
    assert.equal(h.creates[0].data.portLayout.version, 2);
    assert.equal(item.portLayout.faces.rear.ports.length, 1);
  });

  test('edit cannot remove an existing front image', async () => {
    const h = harness({ frontAssetId: 'asset-front' });
    await assert.rejects(h.subject.updateModel('model-1', { ...dto, frontAssetId: null as any }, user), code('FRONT_IMAGE_REQUIRED'));
    assert.equal(h.updates.length, 0);
  });

  test('existing models without a front image (migrated) can still be edited', async () => {
    const h = harness({ frontAssetId: null, backAssetId: 'asset-rear' });
    await h.subject.updateModel('model-1', { ...dto, frontAssetId: null as any }, user);
    assert.equal(h.updates.length, 1);
    assert.equal(h.updates[0].data.frontAssetId, null);
  });
});

describe('device creation enforces mapping per face', () => {
  test('validateDeviceModel accepts a model mapped across front and rear', async () => {
    const h = harness({ portLayout: { version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: [port(1)] }, rear: { imageWidth: 1, imageHeight: 1, ports: [port(2), port(3), port(4)] } } } });
    await (h.subject as any).validateDeviceModel('model-1');
  });

  test('validateDeviceModel rejects an incomplete mapping with 400 PORT_LAYOUT_INCOMPLETE', async () => {
    const h = harness({ portLayout: { version: 2, faces: { rear: { imageWidth: 1, imageHeight: 1, ports: [port(1)] } } } });
    await assert.rejects((h.subject as any).validateDeviceModel('model-1'), code('PORT_LAYOUT_INCOMPLETE'));
  });

  test('an explicit networkPortCount of 0 means no ports, even when portCount is set', async () => {
    const h = harness({ networkPortCount: 0, portCount: 48, portLayout: null });
    await (h.subject as any).validateDeviceModel('model-1');
  });

  test('validateDeviceModel does not block models without network ports', async () => {
    const h = harness({ supportsNetworkPorts: false, portLayout: null });
    await (h.subject as any).validateDeviceModel('model-1');
  });
});

describe('device update', () => {
  function deviceHarness(current: Record<string, unknown>, model: Record<string, unknown>) {
    const updates: any[] = [];
    const prisma: any = {
      device: { findUnique: async () => ({ status: 'ACTIVE', siteId: 'site-1', rackId: null, modelId: 'model-old', frontAssetId: 'asset-front', backAssetId: 'asset-rear', type: 'SWITCH', rack: null, ...current }), update: async (args: any) => { updates.push(args); return { id: 'device-1' }; } },
      deviceModel: { findUnique: async () => ({ model: 'M', supportsNetworkPorts: true, networkPortCount: 2, portCount: 2, portLayout: null, ...model }) },
      assetFile: { findUnique: async ({ where }: any) => ({ id: where.id, storageKey: `${where.id}.png`, mimeType: 'image/png' }) },
      pduOutletAssignment: { count: async () => 0, deleteMany: async () => ({ count: 0 }), findMany: async () => [] },
    };
    prisma.$transaction = async (fn: any) => fn(prisma);
    const access = { assertDevice: async () => undefined, assertRack: async () => undefined, assertSite: async () => undefined } as any;
    const subject = new InfrastructureService(prisma, {} as any, access, {} as any);
    (subject as any).log = async () => undefined;
    (subject as any).getDevice = async () => ({ id: 'device-1' });
    (subject as any).readAssetBytes = async () => PNG_BYTES;
    return { subject, updates };
  }
  const base = { name: 'sw-01', type: 'SWITCH' } as any;

  test('changing the model to one that is not fully mapped is rejected with PORT_LAYOUT_INCOMPLETE', async () => {
    const h = deviceHarness({}, {});
    await assert.rejects(h.subject.updateDevice('device-1', { ...base, modelId: 'model-new' }, user), code('PORT_LAYOUT_INCOMPLETE'));
    assert.equal(h.updates.length, 0);
  });

  test('keeping the same model does not re-check its mapping', async () => {
    const h = deviceHarness({}, {});
    await h.subject.updateDevice('device-1', { ...base, modelId: 'model-old' }, user);
    assert.equal(h.updates.length, 1);
  });

  test('an update without frontAssetId/backAssetId never touches those columns', async () => {
    const h = deviceHarness({}, {});
    await h.subject.updateDevice('device-1', { ...base, notes: 'x' }, user);
    assert.equal('frontAssetId' in h.updates[0].data, false);
    assert.equal('backAssetId' in h.updates[0].data, false);
    await h.subject.updateDevice('device-1', { ...base, backAssetId: undefined } as any, user);
    assert.equal('backAssetId' in h.updates[1].data, false);
  });

  test('null (or an empty string) clears the image on purpose', async () => {
    const h = deviceHarness({}, {});
    await h.subject.updateDevice('device-1', { ...base, backAssetId: null, frontAssetId: '' } as any, user);
    assert.equal(h.updates[0].data.backAssetId, null);
    assert.equal(h.updates[0].data.frontAssetId, null);
  });
});

describe('controller routes', () => {
  const route = (name: string) => ({
    path: Reflect.getMetadata('path', (InfrastructureController.prototype as any)[name]),
    method: Reflect.getMetadata('method', (InfrastructureController.prototype as any)[name]),
  });

  test('exposes GET/PUT/PATCH port-layout and POST assets/rear', () => {
    assert.deepEqual(route('portLayout'), { path: 'device-models/:id/port-layout', method: RequestMethod.GET });
    assert.deepEqual(route('replacePortLayout'), { path: 'device-models/:id/port-layout', method: RequestMethod.PUT });
    assert.deepEqual(route('updatePortLayout'), { path: 'device-models/:id/port-layout', method: RequestMethod.PATCH });
    assert.deepEqual(route('setModelRearAsset'), { path: 'device-models/:id/assets/rear', method: RequestMethod.POST });
    assert.deepEqual(route('savePortLayoutFaces'), { path: 'device-models/:id/port-layout/faces', method: RequestMethod.PUT });
  });

  test('passes ?face through, defaults to rear and rejects unknown faces', async () => {
    const calls: unknown[][] = [];
    const service = new Proxy({}, { get: (_target, name) => (...args: unknown[]) => { calls.push([name, ...args]); return {}; } }) as any;
    const controller = new InfrastructureController(service, {} as any);
    controller.portLayout('m');
    controller.portLayout('m', 'front');
    controller.replacePortLayout('m', { ports: [] }, { user }, 'front');
    controller.updatePortLayout('m', { ports: [] }, { user });
    controller.generatePortLayout('m', { user }, 'front');
    controller.detectPortLayout('m', {}, 'rear');
    assert.deepEqual(calls.map((call) => [call[0], call.slice(-1)[0]]), [['getPortLayout', 'rear'], ['getPortLayout', 'front'], ['updatePortLayout', 'front'], ['updatePortLayout', true], ['generatePortLayout', 'front'], ['detectPortLayout', 'rear']]);
    assert.equal(calls[3][4], 'rear');
    assert.throws(() => controller.portLayout('m', 'side'), code('PORT_LAYOUT_FACE_INVALID'));
  });
});
