import { strict as assert } from 'node:assert';
import { describe, test } from 'node:test';
import { BadRequestException } from '@nestjs/common';
import { assertPortMappingComplete, assertWritableLayout, canonicalJson, isNormalizedPortLayout, normalizeModelLayouts, normalizePortLayout, parsePortLayoutFace, portMappingStatus, seedPortLayout, writeFace } from './port-layout';

const port = (n: number, extra: Record<string, unknown> = {}) => ({ portKey: `ethernet1/${n}`, label: `${n}`, interfaceType: 'RJ45', x: 0.1, y: 0.2, width: 0.02, height: 0.1, ...extra });
const ports = (from: number, count: number) => Array.from({ length: count }, (_, index) => port(from + index));

function rejectsWithCode(fn: () => unknown, code: string) {
  assert.throws(fn, (error: unknown) => error instanceof BadRequestException && (error.getResponse() as any).code === code);
}

describe('normalizePortLayout', () => {
  test('returns null when the model has no layout', () => {
    assert.equal(normalizePortLayout(null), null);
    assert.equal(normalizePortLayout(undefined), null);
  });

  test('reads a v1 layout as the rear face and drops leftover top-level keys', () => {
    const v1 = { imageWidth: 1200, imageHeight: 140, viewport: { left: 0, top: 0, width: 1, height: 1 }, confidence: 0.9, confirmedAt: '2026-11-01T10:00:00Z', ports: ports(1, 2), warnings: ['x'], family: 'ethernet' };
    assert.deepEqual(normalizePortLayout(v1), {
      version: 2,
      family: 'ethernet',
      faces: { rear: { imageWidth: 1200, imageHeight: 140, ports: ports(1, 2), viewport: { left: 0, top: 0, width: 1, height: 1 }, confidence: 0.9, confirmedAt: '2026-11-01T10:00:00Z' } },
    });
  });

  test('reads the catalog seed shape (numeric ports) as an empty rear face', () => {
    assert.deepEqual(normalizePortLayout({ family: 'sfp', ports: 24 }), { version: 2, family: 'sfp', faces: { rear: { imageWidth: 1000, imageHeight: 300, ports: [] } } });
    assert.deepEqual(normalizePortLayout({ family: 'sfp', ports: 24 }), seedPortLayout('sfp'));
  });

  test('keeps both faces of a v2 layout and ignores unknown faces', () => {
    const v2 = { version: 2, faces: { front: { imageWidth: 800, imageHeight: 100, ports: ports(1, 1) }, rear: { imageWidth: 900, imageHeight: 120, ports: ports(2, 3) }, side: { ports: [] } } };
    const result = normalizePortLayout(v2)!;
    assert.deepEqual(Object.keys(result.faces).sort(), ['front', 'rear']);
    assert.equal(result.faces.front!.ports.length, 1);
    assert.equal(result.faces.rear!.ports.length, 3);
  });

  test('turns an unreadable value into an empty v2 layout', () => {
    assert.deepEqual(normalizePortLayout({ foo: 1 }), { version: 2, faces: {} });
    assert.deepEqual(normalizePortLayout('garbage'), { version: 2, faces: {} });
  });

  test('is idempotent and detects already-normalised rows regardless of jsonb key order', () => {
    const once = normalizePortLayout({ imageWidth: 1000, imageHeight: 300, ports: ports(1, 4) });
    assert.deepEqual(normalizePortLayout(once), once);
    assert.equal(isNormalizedPortLayout(once), true);
    const reordered = JSON.parse(canonicalJson(once));
    assert.equal(isNormalizedPortLayout(reordered), true);
    assert.equal(isNormalizedPortLayout({ imageWidth: 1000, ports: [] }), false);
    assert.equal(isNormalizedPortLayout({ family: 'ethernet', ports: 48 }), false);
    assert.equal(isNormalizedPortLayout(null), true);
  });

  test('normalises portLayout on every model nested in a payload', () => {
    const payload = { id: 'rack', devices: [{ model: { id: 'm1', portLayout: { family: 'ethernet', ports: 8 } }, createdAt: new Date(0) }], model: { portLayout: null } };
    normalizeModelLayouts(payload);
    assert.equal((payload.devices[0].model.portLayout as any).version, 2);
    assert.equal(payload.model.portLayout, null);
    assert.ok(payload.devices[0].createdAt instanceof Date);
  });
});

describe('mandatory port mapping per face', () => {
  const model = (portLayout: unknown, extra: Record<string, unknown> = {}) => ({ supportsNetworkPorts: true, networkPortCount: 6, portCount: 6, portLayout, ...extra });

  test('is complete when the faces together map every network port', () => {
    const status = portMappingStatus(model({ version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: ports(1, 2) }, rear: { imageWidth: 1, imageHeight: 1, ports: ports(3, 4) } } }));
    assert.equal(status.complete, true);
    assert.equal(status.mapped, 6);
    assert.deepEqual(status.byFace, { front: { ports: 2, mapped: 2 }, rear: { ports: 4, mapped: 4 } });
  });

  test('a front face with zero ports needs no map', () => {
    assert.equal(portMappingStatus(model({ imageWidth: 1, imageHeight: 1, ports: ports(1, 6) })).complete, true);
  });

  test('is incomplete when fewer ports are mapped than the model has', () => {
    const status = portMappingStatus(model({ imageWidth: 1, imageHeight: 1, ports: ports(1, 5) }));
    assert.equal(status.complete, false);
    rejectsWithCode(() => assertPortMappingComplete(model({ imageWidth: 1, imageHeight: 1, ports: ports(1, 5) })), 'PORT_LAYOUT_INCOMPLETE');
  });

  test('is incomplete when a face holds a partly mapped port, even if the total matches', () => {
    const layout = { version: 2, faces: { front: { imageWidth: 1, imageHeight: 1, ports: [port(1, { width: 0 })] }, rear: { imageWidth: 1, imageHeight: 1, ports: ports(2, 5) } } };
    const status = portMappingStatus(model(layout));
    assert.deepEqual(status.partialFaces, ['front']);
    assert.equal(status.complete, false);
    assert.throws(() => assertPortMappingComplete(model(layout)), (error: any) => error.getStatus() === 400 && error.getResponse().code === 'PORT_LAYOUT_INCOMPLETE' && /frontal/.test(error.getResponse().message));
  });

  test('the seed shape alone is not a mapping', () => {
    assert.equal(portMappingStatus(model({ family: 'ethernet', ports: 6 })).complete, false);
    assert.equal(portMappingStatus(model(null)).complete, false);
  });

  test('models without network ports are never blocked', () => {
    assert.equal(portMappingStatus(model(null, { supportsNetworkPorts: false })).complete, true);
    assert.equal(portMappingStatus(model(null, { networkPortCount: null, portCount: 0 })).complete, true);
  });
});

describe('writing one face', () => {
  const stored = { version: 2, faces: { front: { imageWidth: 800, imageHeight: 100, ports: ports(1, 2) }, rear: { imageWidth: 900, imageHeight: 120, viewport: { left: 0, top: 0, width: 1, height: 1 }, ports: ports(3, 2) } } };

  test('PUT replaces only the requested face', () => {
    const next = writeFace(stored, 'rear', { imageWidth: 1000, imageHeight: 200, ports: ports(3, 1) });
    assert.deepEqual(next.faces.front, stored.faces.front);
    assert.deepEqual(next.faces.rear, { imageWidth: 1000, imageHeight: 200, ports: ports(3, 1) });
  });

  test('PUT requires a ports array', () => {
    rejectsWithCode(() => writeFace(stored, 'rear', { imageWidth: 1 }), 'PORT_LAYOUT_PORTS_REQUIRED');
  });

  test('legacy PATCH merges into the face and still leaves the other face alone', () => {
    const next = writeFace(stored, 'rear', { confidence: 1 }, true);
    assert.deepEqual(next.faces.rear, { ...stored.faces.rear, confidence: 1 });
    assert.deepEqual(next.faces.front, stored.faces.front);
  });

  test('writing a face on a v1 layout keeps the old map as the rear face', () => {
    const next = writeFace({ imageWidth: 1000, imageHeight: 300, ports: ports(1, 4) }, 'front', { imageWidth: 500, imageHeight: 50, ports: [] });
    assert.equal(next.version, 2);
    assert.equal(next.faces.rear!.ports.length, 4);
    assert.deepEqual(next.faces.front, { imageWidth: 500, imageHeight: 50, ports: [] });
  });

  test('rejects partly mapped ports, duplicate keys across faces and more ports than the model has', () => {
    const model = { supportsNetworkPorts: true, networkPortCount: 4 };
    rejectsWithCode(() => assertWritableLayout(writeFace(stored, 'front', { ports: [port(1, { x: undefined })] }), 'front', model), 'PORT_LAYOUT_INCOMPLETE');
    rejectsWithCode(() => assertWritableLayout(writeFace(stored, 'front', { ports: [port(3)] }), 'front', model), 'PORT_LAYOUT_DUPLICATE_PORT');
    rejectsWithCode(() => assertWritableLayout(writeFace(stored, 'front', { ports: ports(10, 3) }), 'front', model), 'PORT_LAYOUT_TOO_MANY_PORTS');
    assert.doesNotThrow(() => assertWritableLayout(writeFace(stored, 'front', { ports: ports(10, 1) }), 'front', model));
  });
});

test('face query: defaults to rear, accepts front|rear, rejects anything else with 400', () => {
  assert.equal(parsePortLayoutFace(undefined), 'rear');
  assert.equal(parsePortLayoutFace(''), 'rear');
  assert.equal(parsePortLayoutFace('front'), 'front');
  assert.equal(parsePortLayoutFace('rear'), 'rear');
  rejectsWithCode(() => parsePortLayoutFace('back'), 'PORT_LAYOUT_FACE_INVALID');
});
