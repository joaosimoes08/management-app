import { createHash } from 'node:crypto';
import { BadRequestException } from '@nestjs/common';

/**
 * Port layout v2: one layout per physical face of a device model.
 *
 * Stored shapes we still have to read:
 *  - v1   `{ imageWidth, imageHeight, viewport?, ports: PortEntry[], ... }`  → read as `faces.rear`
 *  - seed `{ family, ports: <number> }` (catalog seed)                         → read as an empty `faces.rear`
 *  - v2   `{ version: 2, faces: { front?, rear? } }`
 *
 * Today's images and port maps were drawn from the rear of the equipment, so legacy shapes become the rear face.
 */
export const PORT_LAYOUT_FACES = ['front', 'rear'] as const;
export type PortLayoutFace = (typeof PORT_LAYOUT_FACES)[number];
export const DEFAULT_PORT_LAYOUT_FACE: PortLayoutFace = 'rear';
export const DEFAULT_FACE_IMAGE_WIDTH = 1000;
export const DEFAULT_FACE_IMAGE_HEIGHT = 300;

export interface PortLayoutEntry {
  portKey: string;
  label?: string;
  interfaceType?: string;
  x: number;
  y: number;
  width: number;
  height: number;
  [key: string]: unknown;
}

export interface PortLayoutViewport { left: number; top: number; width: number; height: number }

export interface PortLayoutFaceData {
  imageWidth: number;
  imageHeight: number;
  viewport?: PortLayoutViewport | null;
  confidence?: number;
  confirmedAt?: string;
  confirmedBy?: string;
  ports: PortLayoutEntry[];
}

export interface PortLayoutV2 {
  version: 2;
  family?: string;
  faces: Partial<Record<PortLayoutFace, PortLayoutFaceData>>;
}

const isRecord = (value: unknown): value is Record<string, unknown> => !!value && typeof value === 'object' && !Array.isArray(value);
const positiveNumber = (value: unknown, fallback: number) => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : fallback);

function readFace(raw: unknown): PortLayoutFaceData | undefined {
  if (!isRecord(raw)) return undefined;
  const face: PortLayoutFaceData = {
    imageWidth: positiveNumber(raw.imageWidth, DEFAULT_FACE_IMAGE_WIDTH),
    imageHeight: positiveNumber(raw.imageHeight, DEFAULT_FACE_IMAGE_HEIGHT),
    ports: Array.isArray(raw.ports) ? (raw.ports.filter(isRecord) as PortLayoutEntry[]) : [],
  };
  if (raw.viewport !== undefined) face.viewport = isRecord(raw.viewport) ? (raw.viewport as unknown as PortLayoutViewport) : null;
  if (typeof raw.confidence === 'number') face.confidence = raw.confidence;
  if (typeof raw.confirmedAt === 'string') face.confirmedAt = raw.confirmedAt;
  if (typeof raw.confirmedBy === 'string') face.confirmedBy = raw.confirmedBy;
  return face;
}

/** Reads any stored port layout (v1, seed, v2) and returns v2, or null when the model has no layout. */
export function normalizePortLayout(raw: unknown): PortLayoutV2 | null {
  if (raw === null || raw === undefined) return null;
  if (!isRecord(raw)) return { version: 2, faces: {} };
  const family = typeof raw.family === 'string' ? raw.family : undefined;
  const result: PortLayoutV2 = { version: 2, ...(family ? { family } : {}), faces: {} };
  if (raw.version === 2 && isRecord(raw.faces)) {
    for (const name of PORT_LAYOUT_FACES) { const face = readFace(raw.faces[name]); if (face) result.faces[name] = face; }
    return result;
  }
  if (Array.isArray(raw.ports)) { result.faces.rear = readFace(raw); return result; }
  if (typeof raw.ports === 'number') { result.faces.rear = { imageWidth: DEFAULT_FACE_IMAGE_WIDTH, imageHeight: DEFAULT_FACE_IMAGE_HEIGHT, ports: [] }; return result; }
  return result;
}

/** True when the stored value is already exactly the normalised v2 form (used to keep the data migration idempotent). */
export function isNormalizedPortLayout(raw: unknown) {
  return canonicalJson(raw ?? null) === canonicalJson(normalizePortLayout(raw));
}

/** JSON with sorted object keys: Postgres jsonb does not keep key order, so compare layouts through this. */
export function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (isRecord(value)) return `{${Object.keys(value).filter((key) => value[key] !== undefined).sort().map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`).join(',')}}`;
  return JSON.stringify(value ?? null);
}

/** Seed-catalog layout written for new catalog models: the family, no mapped ports yet. */
export function seedPortLayout(family: string): PortLayoutV2 {
  return { version: 2, family, faces: { rear: { imageWidth: DEFAULT_FACE_IMAGE_WIDTH, imageHeight: DEFAULT_FACE_IMAGE_HEIGHT, ports: [] } } };
}

export function parsePortLayoutFace(value: unknown): PortLayoutFace {
  if (value === undefined || value === null || value === '') return DEFAULT_PORT_LAYOUT_FACE;
  if (typeof value === 'string' && (PORT_LAYOUT_FACES as readonly string[]).includes(value)) return value as PortLayoutFace;
  throw new BadRequestException({ code: 'PORT_LAYOUT_FACE_INVALID', message: 'A face tem de ser "front" ou "rear".' });
}

/** The DeviceModel column that holds the image of a face. */
export const faceAssetField = (face: PortLayoutFace) => (face === 'front' ? 'frontAssetId' : 'backAssetId');

const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);

/** A port is mapped when it has a key and a complete hotspot (x, y, width > 0, height > 0). */
export function isPortMapped(port: unknown): boolean {
  if (!isRecord(port)) return false;
  return typeof port.portKey === 'string' && port.portKey.trim().length > 0
    && finite(port.x) && finite(port.y) && finite(port.width) && finite(port.height)
    && (port.width as number) > 0 && (port.height as number) > 0;
}

export function allLayoutPorts(layout: PortLayoutV2 | null) {
  if (!layout) return [] as Array<PortLayoutEntry & { face: PortLayoutFace }>;
  return PORT_LAYOUT_FACES.flatMap((face) => (layout.faces[face]?.ports ?? []).map((port) => ({ ...port, face })));
}

export interface PortMappingModel {
  supportsNetworkPorts?: boolean | null;
  networkPortCount?: number | null;
  portCount?: number | null;
  portLayout?: unknown;
}

/**
 * The one port-count rule: a model without network ports expects 0; otherwise networkPortCount, then portCount.
 * An explicit 0 means "no ports" and is not skipped (?? not ||). Only fully mapped ports count towards it.
 */
export const expectedNetworkPorts = (model: PortMappingModel) => (model.supportsNetworkPorts ? (model.networkPortCount ?? model.portCount ?? 0) : 0);

export interface PortMappingStatus {
  required: boolean;
  expected: number;
  mapped: number;
  partialFaces: PortLayoutFace[];
  complete: boolean;
  byFace: Record<PortLayoutFace, { ports: number; mapped: number }>;
}

/**
 * Mandatory mapping rule: a model with network ports (supportsNetworkPorts and a port count > 0) needs every port
 * mapped across its faces (total mapped == expected), and no face may hold ports that are only partly mapped.
 * A face with zero ports needs no map.
 */
export function portMappingStatus(model: PortMappingModel): PortMappingStatus {
  const layout = normalizePortLayout(model.portLayout);
  const expected = expectedNetworkPorts(model);
  const required = !!model.supportsNetworkPorts && expected > 0;
  const byFace = { front: { ports: 0, mapped: 0 }, rear: { ports: 0, mapped: 0 } };
  for (const face of PORT_LAYOUT_FACES) {
    const ports = layout?.faces[face]?.ports ?? [];
    byFace[face] = { ports: ports.length, mapped: ports.filter(isPortMapped).length };
  }
  const partialFaces = PORT_LAYOUT_FACES.filter((face) => byFace[face].mapped !== byFace[face].ports);
  const mapped = byFace.front.mapped + byFace.rear.mapped;
  const complete = !partialFaces.length && (!required || mapped === expected);
  return { required, expected, mapped, partialFaces, complete, byFace };
}

const faceLabel = (face: PortLayoutFace) => (face === 'front' ? 'frontal' : 'traseira');

export function portLayoutIncompleteMessage(status: PortMappingStatus) {
  if (status.partialFaces.length) return `O mapa de portas tem portas incompletas na face ${status.partialFaces.map(faceLabel).join(' e ')}.`;
  return `O modelo tem ${status.expected} portas de rede mas só ${status.mapped} estão mapeadas (frente + traseira).`;
}

/** Throws 400 PORT_LAYOUT_INCOMPLETE when the model's port mapping does not satisfy the mandatory rule. */
export function assertPortMappingComplete(model: PortMappingModel) {
  const status = portMappingStatus(model);
  if (status.complete) return status;
  throw new BadRequestException({
    code: 'PORT_LAYOUT_INCOMPLETE',
    message: portLayoutIncompleteMessage(status),
    expected: status.expected,
    mapped: status.mapped,
    partialFaces: status.partialFaces,
    byFace: status.byFace,
  });
}

export interface FaceInput {
  imageWidth?: number;
  imageHeight?: number;
  viewport?: unknown;
  confidence?: number;
  confirmedAt?: string;
  confirmedBy?: string;
  ports?: unknown[];
}

/**
 * Builds the layout that results from writing one face. `merge` keeps fields of the stored face that the body omits
 * (legacy PATCH); without it the face is replaced (PUT). The other face is never touched.
 */
export function writeFace(stored: unknown, face: PortLayoutFace, input: FaceInput, merge = false): PortLayoutV2 {
  const layout = normalizePortLayout(stored) ?? { version: 2, faces: {} };
  const previous = layout.faces[face];
  if (!merge && !Array.isArray(input.ports)) throw new BadRequestException({ code: 'PORT_LAYOUT_PORTS_REQUIRED', message: 'Indica a lista de portas (ports) da face.' });
  const source = merge ? { ...(previous ?? {}), ...stripUndefined(input) } : { ...input };
  const next = readFace({ ...source, imageWidth: source.imageWidth ?? previous?.imageWidth, imageHeight: source.imageHeight ?? previous?.imageHeight })!;
  if (Array.isArray(source.ports) && source.ports.some((port) => !isRecord(port))) throw new BadRequestException({ code: 'PORT_LAYOUT_INCOMPLETE', message: 'Cada porta tem de ser um objeto com portKey, x, y, width e height.' });
  return { ...layout, faces: { ...layout.faces, [face]: next } };
}

const stripUndefined = <T extends object>(value: T) => Object.fromEntries(Object.entries(value).filter(([, item]) => item !== undefined)) as Partial<T>;

/**
 * Validation for a saved face: every port fully mapped, port keys unique across both faces,
 * and never more mapped ports than the model has. Fewer is allowed while the other face is still being mapped;
 * the mandatory total is enforced where devices are created (see assertPortMappingComplete).
 */
export function assertWritableLayout(layout: PortLayoutV2, face: PortLayoutFace, model: PortMappingModel) {
  assertWritableFaces(layout, [face], model);
}

/**
 * Same checks for several faces at once (atomic save): every port of the listed faces fully mapped, port keys unique
 * across both faces, and for a model with network ports no more mapped ports in total than it expects.
 */
export function assertWritableFaces(layout: PortLayoutV2, faces: readonly PortLayoutFace[], model: PortMappingModel) {
  for (const face of faces) {
    const partial = (layout.faces[face]?.ports ?? []).filter((port) => !isPortMapped(port));
    if (partial.length) throw new BadRequestException({ code: 'PORT_LAYOUT_INCOMPLETE', message: `${partial.length} porta(s) da face ${faceLabel(face)} não estão completamente mapeadas (portKey, x, y, width e height).`, face, partialPorts: partial.length });
  }
  const seen = new Set<string>();
  for (const port of allLayoutPorts(layout)) {
    if (!isPortMapped(port)) continue;
    const key = port.portKey.trim().toLowerCase();
    if (seen.has(key)) throw new BadRequestException({ code: 'PORT_LAYOUT_DUPLICATE_PORT', message: `A porta "${port.portKey}" está mapeada mais de uma vez.`, portKey: port.portKey });
    seen.add(key);
  }
  const expected = expectedNetworkPorts(model);
  if (model.supportsNetworkPorts && seen.size > expected) throw new BadRequestException({ code: 'PORT_LAYOUT_TOO_MANY_PORTS', message: `O mapa tem ${seen.size} portas mas o modelo só tem ${expected}.`, expected, mapped: seen.size });
}

/** Body of the atomic save: a face object replaces that face, null removes its map, an absent key leaves it alone. */
export type FacesInput = Partial<Record<PortLayoutFace, (FaceInput & { assetId?: string }) | null>>;

export function applyFaces(stored: unknown, faces: FacesInput): PortLayoutV2 {
  let layout = normalizePortLayout(stored) ?? { version: 2, faces: {} };
  for (const face of PORT_LAYOUT_FACES) {
    if (!(face in faces) || faces[face] === undefined) continue;
    const input = faces[face];
    if (input === null) { const rest = { ...layout.faces }; delete rest[face]; layout = { ...layout, faces: rest }; continue; }
    if (!isRecord(input)) throw new BadRequestException({ code: 'PORT_LAYOUT_FACE_INVALID', message: `A face ${faceLabel(face)} tem de ser um objeto ou null.` });
    const { assetId: _assetId, ...faceInput } = input;
    layout = writeFace(layout, face, faceInput);
  }
  return layout;
}

/**
 * Optimistic-concurrency token for a model's port mapping: a hash of the normalised layout and both face images.
 * Any write through any endpoint changes it, so a stale editor gets 409 PORT_LAYOUT_CONFLICT instead of overwriting.
 */
export function portLayoutRevision(model: { portLayout?: unknown; frontAssetId?: string | null; backAssetId?: string | null }) {
  return createHash('sha256').update(canonicalJson({ portLayout: normalizePortLayout(model.portLayout), frontAssetId: model.frontAssetId ?? null, backAssetId: model.backAssetId ?? null })).digest('hex').slice(0, 16);
}

/** Normalises `portLayout` in place on any DeviceModel found inside an API payload. */
export function normalizeModelLayouts<T>(payload: T): T {
  const visit = (value: unknown) => {
    if (Array.isArray(value)) { value.forEach(visit); return; }
    if (!isRecord(value) || value instanceof Date) return;
    for (const [key, item] of Object.entries(value)) {
      if (key === 'portLayout') (value as Record<string, unknown>).portLayout = normalizePortLayout(item);
      else if (item && typeof item === 'object') visit(item);
    }
  };
  visit(payload);
  return payload;
}
