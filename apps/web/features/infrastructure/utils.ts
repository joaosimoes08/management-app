import type { AssetFile, Device, DeviceInterface, DeviceModel, PortLayout, PortLayoutPort, Vlan } from './types';

export const FIXED_RACK_IMAGE = '/assets/rack-empty-42u.png';
export const RACK_UNITS = 42;
export const RACK_VIEWPORT = { left: 49 / 304, top: 45 / 820, width: 206 / 304, height: 737 / 820 };
export const EQUIPMENT_TYPES = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'] as const;
export const PORT_TYPES = ['FAST_ETHERNET', 'ETHERNET', 'GIGABIT_ETHERNET', 'SFP', 'SFP_PLUS', 'QSFP', 'MANAGEMENT', 'CONSOLE', 'FIBRE_CHANNEL', 'OTHER'] as const;

const API = process.env.NEXT_PUBLIC_API_URL ?? 'http://localhost:3001';

export function assetFileUrl(asset: Pick<AssetFile, 'id'>): string {
  return `${API}/api/v1/assets/${asset.id}/file`;
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
  const relativeY = Math.max(0, Math.min(bounds.height - 1, event.clientY - bounds.top));
  const pointerUnit = units - Math.floor((relativeY / bounds.height) * units);
  const offsetFromTop = Number(event.dataTransfer.getData('application/x-rack-offset')) || 0;
  const end = pointerUnit + offsetFromTop;
  return Math.max(1, Math.min(units - size + 1, end - size + 1));
}

/** Number of mapped ports on a model layout (0 when unmapped or numeric legacy layout). */
export function modelPortLayoutCount(model: Pick<DeviceModel, 'portLayout'> | null | undefined): number {
  const layout = model?.portLayout;
  return layout && typeof layout === 'object' ? layout.ports.length : 0;
}

/** Port hotspots from the model layout, or a generated grid fallback. */
export function normalizedPortLayoutPorts(device: Pick<Device, 'model'> | null | undefined): PortLayoutPort[] {  const configured = device?.model?.portLayout;
  const ports = configured && typeof configured === 'object' ? configured.ports : undefined;
  if (Array.isArray(ports)) return ports;
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
  return device?.frontAsset ?? device?.model?.frontAsset ?? null;
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
