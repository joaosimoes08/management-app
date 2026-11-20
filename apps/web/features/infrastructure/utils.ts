import type { AssetFile, Device, DeviceInterface, DeviceModel, PortLayout, PortLayoutFace, PortLayoutPort, PortLayoutV2, RackFace, RackView, Vlan } from './types';
import { getPublicRuntimeConfig } from '@/lib/runtime-config';

export const FIXED_RACK_IMAGE = '/assets/rack-empty-42u.png?v=2';
export const RACK_UNITS = 42;
/**
 * Geometry of FIXED_RACK_IMAGE in its own pixels, measured from the rail labels:
 * 42 labels at an 18.374 px pitch (largest deviation 0.52 px); the top edge of U42 is at y=18.34
 * and the bottom edge of U1 at y=790.05. Unit boundaries are evenly spaced between those two edges.
 */
export const RACK_IMAGE = { width: 304, height: 838, unitTop: 18.34, unitBottom: 790.05, railLeft: 49, railRight: 255 } as const;
export const RACK_UNIT_PITCH = (RACK_IMAGE.unitBottom - RACK_IMAGE.unitTop) / RACK_UNITS;
/** The area holding the 42 units, as fractions of the image. Device positions are percentages of this box. */
export const RACK_VIEWPORT = {
  left: RACK_IMAGE.railLeft / RACK_IMAGE.width,
  top: RACK_IMAGE.unitTop / RACK_IMAGE.height,
  width: (RACK_IMAGE.railRight - RACK_IMAGE.railLeft) / RACK_IMAGE.width,
  height: (RACK_IMAGE.unitBottom - RACK_IMAGE.unitTop) / RACK_IMAGE.height,
};

/** Top and height of a device as a percentage of RACK_VIEWPORT. U42 is at the top, U1 at the bottom. */
export function rackUnitBox(start: number, size: number): { top: number; height: number } {
  const units = Math.max(1, Math.floor(size) || 1);
  const end = start + units - 1;
  return { top: ((RACK_UNITS - end) / RACK_UNITS) * 100, height: (units / RACK_UNITS) * 100 };
}

/** The same box in image pixels (used to check alignment against the rail labels). */
export function rackUnitImageY(start: number, size: number): { top: number; bottom: number } {
  const box = rackUnitBox(start, size);
  const span = RACK_IMAGE.unitBottom - RACK_IMAGE.unitTop;
  return { top: RACK_IMAGE.unitTop + span * box.top / 100, bottom: RACK_IMAGE.unitTop + span * (box.top + box.height) / 100 };
}

/** The rack unit under a point, from its distance to the top of RACK_VIEWPORT. Same grid as rackUnitBox. */
export function rackUnitAt(relativeY: number, viewportHeight: number): number {
  if (!(viewportHeight > 0)) return RACK_UNITS;
  const fromTop = Math.floor((Math.max(0, Math.min(viewportHeight - 0.001, relativeY)) / viewportHeight) * RACK_UNITS);
  return RACK_UNITS - fromTop;
}
export const EQUIPMENT_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'] as const;
export const PORT_TYPES = ['FAST_ETHERNET', 'ETHERNET', 'GIGABIT_ETHERNET', 'SFP', 'SFP_PLUS', 'QSFP', 'MANAGEMENT', 'CONSOLE', 'FIBRE_CHANNEL', 'OTHER'] as const;

export function assetFileUrl(asset: Pick<AssetFile, 'id'>): string {
  return `${getPublicRuntimeConfig().apiUrl}/api/v1/assets/${asset.id}/file`;
}

export function assetDisplayName(asset?: AssetFile | null): string {
  return asset?.filename ?? 'Asset sem nome';
}

/** Persisted workspace context (site/building/room) across visits. */
export interface InfrastructureContext {
  siteId: string;
  buildingId: string;
  roomId: string;
}

const INFRASTRUCTURE_CONTEXT_KEY = 'cociber.infrastructureContext';

export function readInfrastructureContext(): InfrastructureContext | null {
  try {
    const value = localStorage.getItem(INFRASTRUCTURE_CONTEXT_KEY);
    return value ? (JSON.parse(value) as InfrastructureContext) : null;
  } catch {
    return null;
  }
}

export function writeInfrastructureContext(context: InfrastructureContext): void {
  try {
    localStorage.setItem(INFRASTRUCTURE_CONTEXT_KEY, JSON.stringify(context));
  } catch {
    // A indisponibilidade do armazenamento local não deve impedir a navegação.
  }
}

/** Natural sort for interface names like ethernet1/10. */
export function naturalInterfaceCompare(a: Pick<DeviceInterface, 'name' | 'portKey'>, b: Pick<DeviceInterface, 'name' | 'portKey'>): number {
  const tokenize = (value: string) => value.toLocaleLowerCase().split(/(\d+)/).map((part) => (/^\d+$/.test(part) ? Number(part) : part));
  const left = tokenize(a.name || a.portKey || '');
  const right = tokenize(b.name || b.portKey || '');
  for (let i = 0; i < Math.max(left.length, right.length); i += 1) {
    if (left[i] === undefined) return -1;
    if (right[i] === undefined) return 1;
    if (left[i] === right[i]) continue;
    return left[i] < right[i] ? -1 : 1;
  }
  return String(a.portKey || '').localeCompare(String(b.portKey || ''));
}

/** Converts a drop event on a rack into a target rack unit (1-based). */
export function rackUnitFromDrop(event: { currentTarget: HTMLElement; clientY: number; dataTransfer: DataTransfer }, units: number, size: number): number {
  const bounds = event.currentTarget.getBoundingClientRect();
  // The drop zone is RACK_VIEWPORT, which always shows 42 units; the rack's own size only limits the result.
  const pointerUnit = rackUnitAt(event.clientY - bounds.top, bounds.height);
  const offsetFromTop = Number(event.dataTransfer.getData('application/x-rack-offset')) || 0;
  const end = pointerUnit + offsetFromTop;
  return Math.max(1, Math.min(units - size + 1, end - size + 1));
}

export const RACK_FACES: readonly RackFace[] = ['front', 'rear'];

/** Faces of a stored port layout, already in v2 form. */
export type PortLayoutFaces = Partial<Record<RackFace, PortLayoutFace>>;

/**
 * Reads any stored port layout shape into faces.
 * v2 keeps its faces; a v1 layout (one image, one port list) is the rear face,
 * because the images and maps captured before v2 were photographed from the rear;
 * numeric seeds and empty values have no mapped face.
 */
export function normalizePortLayout(raw: unknown): PortLayoutFaces {
  if (!raw || typeof raw !== 'object') return {};
  const value = raw as Partial<PortLayoutV2> & Partial<PortLayout>;
  if (value.version === 2 && value.faces && typeof value.faces === 'object') {
    const faces: PortLayoutFaces = {};
    for (const face of RACK_FACES) {
      const entry = value.faces[face];
      if (entry && typeof entry === 'object') faces[face] = { ...entry, ports: Array.isArray(entry.ports) ? entry.ports : [] };
    }
    return faces;
  }
  if (Array.isArray(value.ports)) return { rear: { ...(value as PortLayout), ports: value.ports } };
  return {};
}

/** Mapped port hotspots of one face (empty when that face has no map). */
export function facePortLayoutPorts(model: Pick<DeviceModel, 'portLayout'> | null | undefined, face: RackFace): PortLayoutPort[] {
  return normalizePortLayout(model?.portLayout)[face]?.ports ?? [];
}

/** Number of mapped ports on a model layout across both faces (0 when unmapped or numeric legacy layout). */
export function modelPortLayoutCount(model: Pick<DeviceModel, 'portLayout'> | null | undefined): number {
  const faces = normalizePortLayout(model?.portLayout);
  return RACK_FACES.reduce((total, face) => total + (faces[face]?.ports.length ?? 0), 0);
}

/** Every mapped port of a layout, front first, for label lookups that do not care about the face. */
export function allPortLayoutPorts(raw: unknown): PortLayoutPort[] {
  const faces = normalizePortLayout(raw);
  return RACK_FACES.flatMap((face) => faces[face]?.ports ?? []);
}

/** The face that carries the model's mapped ports: rear when both or neither have them, as most equipment is cabled at the rear. */
export function primaryPortFace(model: Pick<DeviceModel, 'portLayout'> | null | undefined, preferred?: RackFace): RackFace {
  const faces = normalizePortLayout(model?.portLayout);
  const mapped = RACK_FACES.filter((face) => (faces[face]?.ports.length ?? 0) > 0);
  if (preferred && (mapped.includes(preferred) || !mapped.length)) return preferred;
  if (mapped.length === 1) return mapped[0];
  return preferred ?? 'rear';
}

/** Mapping status of a model against its declared network ports. */
export interface PortMappingStatus {
  expected: number;
  mapped: number;
  complete: boolean;
}

/** Same rule as the API: no network ports when the model says so; an explicit 0 means none. */
export function expectedPortCount(model: Pick<DeviceModel, 'networkPortCount' | 'portCount' | 'supportsNetworkPorts'> | null | undefined): number {
  if (!model || model.supportsNetworkPorts === false) return 0;
  return Math.max(0, Number(model.networkPortCount ?? model.portCount ?? 0) || 0);
}

/** A port counts only when it has a key, a position and a non-empty box (API rule). */
export function isPortFullyMapped(port: Partial<PortLayoutPort> | null | undefined): boolean {
  if (!port) return false;
  const finite = (value: unknown) => typeof value === 'number' && Number.isFinite(value);
  return String(port.portKey ?? '').trim() !== '' && finite(port.x) && finite(port.y) && finite(port.width) && finite(port.height) && Number(port.width) > 0 && Number(port.height) > 0;
}

export function portMappingStatus(model: Pick<DeviceModel, 'portLayout' | 'networkPortCount' | 'portCount' | 'supportsNetworkPorts'> | null | undefined, faces?: PortLayoutFaces): PortMappingStatus {
  const expected = expectedPortCount(model);
  const source = faces ?? normalizePortLayout(model?.portLayout);
  const mapped = RACK_FACES.reduce((total, face) => total + (source[face]?.ports.filter(isPortFullyMapped).length ?? 0), 0);
  return { expected, mapped, complete: mapped === expected };
}

/** Port hotspots from the model layout, or a generated grid fallback. When a face is given, only that face's map is used. */
export function normalizedPortLayoutPorts(device: Pick<Device, 'model'> | null | undefined, face?: RackFace): PortLayoutPort[] {
  const configured = device?.model?.portLayout;
  const faces = normalizePortLayout(configured);
  if (face) {
    const ports = faces[face]?.ports;
    if (ports?.length) return ports;
    // Without any mapped face, keep the generated grid on the face that would carry the ports.
    if (RACK_FACES.some((candidate) => faces[candidate]?.ports.length) || face !== primaryPortFace(device?.model)) return [];
  } else {
    const ports = faces[primaryPortFace(device?.model)]?.ports;
    if (ports?.length) return ports;
  }
  const count = Math.max(
    0,
    Number(device?.model?.networkPortCount ?? device?.model?.portCount ?? (typeof configured === 'number' ? configured : 0)) || 0,
  );
  if (!count) return [];
  const columns = Math.min(24, Math.max(1, count));
  const rows = Math.ceil(count / columns);
  return Array.from({ length: count }, (_, index) => ({
    portKey: `ethernet1/${index + 1}`,
    label: `${index + 1}`,
    x: ((index % columns) + 0.5) / columns,
    y: (Math.floor(index / columns) + 0.5) / rows,
    width: 0.8 / columns,
    height: 0.6 / rows,
  }));
}

/** Image of one device face: device override, then the model image; null shows the type icon. */
export function deviceFaceImage(device: Pick<Device, 'frontAsset' | 'backAsset' | 'model'> | null | undefined, face: RackFace): AssetFile | null {
  if (face === 'rear') return device?.backAsset ?? device?.model?.backAsset ?? null;
  return device?.frontAsset ?? device?.model?.frontAsset ?? null;
}

export const RACK_VIEW_STORAGE_KEY = 'cociber.rackView';
/** Width from which the rack opens with both faces side by side. */
export const RACK_BOTH_MIN_WIDTH = 1280;

/** Rack view remembered for this browser session; otherwise both faces on wide screens and the front below that. */
export function readRackView(viewportWidth: number): RackView {
  try {
    const stored = sessionStorage.getItem(RACK_VIEW_STORAGE_KEY);
    if (stored === 'front' || stored === 'rear' || stored === 'both') return stored === 'both' && viewportWidth < RACK_BOTH_MIN_WIDTH ? 'front' : stored;
  } catch {
    // Sem armazenamento de sessão, usa a vista por omissão.
  }
  return viewportWidth >= RACK_BOTH_MIN_WIDTH ? 'both' : 'front';
}

export function writeRackView(view: RackView): void {
  try {
    sessionStorage.setItem(RACK_VIEW_STORAGE_KEY, view);
  } catch {
    // A vista é apenas uma preferência da sessão.
  }
}

export function formatPortTooltipTitle(item: DeviceInterface | null | undefined, port: Pick<PortLayoutPort, 'portKey' | 'label'> | null | undefined): string {
  const value = String(item?.portKey || port?.portKey || item?.name || port?.label || 'Porta');
  return value.replace(/^ethernet/i, 'Eth').replace(/^eth/i, 'Eth');
}

export function getInterfaceVlans(item: DeviceInterface | null | undefined): Vlan[] {
  if (!item) return [];
  const vlans = [item.accessVlan, item.nativeVlan, ...(item.allowedVlans ?? []).map((entry) => entry?.vlan ?? null)];
  return vlans.filter((vlan): vlan is NonNullable<DeviceInterface['accessVlan']> => Boolean(vlan));
}

export function getInterfaceSubnets(item: DeviceInterface | null | undefined): string[] {
  return [...new Set(getInterfaceVlans(item).flatMap((vlan) => (vlan.subnets ?? []).map((subnet) => subnet.cidr).filter(Boolean)))];
}

export function deviceFrontImage(device: Pick<Device, 'frontAsset' | 'model'> | null | undefined): AssetFile | null {
  return deviceFaceImage(device, 'front');
}

export function deviceFrontImageId(device: Pick<Device, 'frontAsset' | 'frontAssetId' | 'model'>): string {
  return device.frontAssetId ?? device.frontAsset?.id ?? device.model?.frontAssetId ?? '';
}

/** Compact, evenly spaced grid positions for port hotspots. */
export function compactPortGrid(ports: PortLayoutPort[]): PortLayoutPort[] {
  const count = ports.length;
  if (!count) return ports;
  const columns = Math.min(24, count);
  const rows = Math.ceil(count / columns);
  return ports.map((p, index) => ({
    ...p,
    x: 0.11 + ((index % columns) + 0.5) * (0.78 / columns),
    y: 0.33 + ((Math.floor(index / columns) + 0.5) * 0.34) / rows,
    width: 0.62 / columns,
    height: 0.24 / rows,
  }));
}
