import { apiFetch } from '@/lib/api/client';
import type {
  AssetFile,
  BuildingWithRooms,
  Device,
  DeviceInput,
  DeviceInterface,
  DeviceListResponse,
  DeviceModel,
  EffectiveAccess,
  InterfaceInput,
  IpAddress,
  PortLayout,
  Rack,
  RackPlacementPlan,
  Room,
  Site,
  SiteListResponse,
  Vlan,
  VlanListResponse,
} from './types';

// ── Access ─────────────────────────────────────────────────────────────────

export function getEffectiveAccess(siteId: string): Promise<EffectiveAccess> {
  return apiFetch<EffectiveAccess>(`/api/v1/access/effective?siteId=${siteId}`);
}

// ── Sites and physical hierarchy ───────────────────────────────────────────

export function listSites(): Promise<SiteListResponse> {
  return apiFetch<SiteListResponse>('/api/v1/sites?pageSize=100');
}

export function getSiteLocations(siteId: string): Promise<BuildingWithRooms[]> {
  return apiFetch<BuildingWithRooms[]>(`/api/v1/sites/${siteId}/locations`);
}

export function getSiteRacks(siteId: string): Promise<Rack[]> {
  return apiFetch<Rack[]>(`/api/v1/sites/${siteId}/racks`);
}

export function createBuilding(siteId: string, body: { name: string; description?: string }): Promise<unknown> {
  return apiFetch(`/api/v1/sites/${siteId}/buildings`, { method: 'POST', body: JSON.stringify(body) });
}

export function createRoom(buildingId: string, body: { name: string }): Promise<Room> {
  return apiFetch<Room>(`/api/v1/buildings/${buildingId}/rooms`, { method: 'POST', body: JSON.stringify(body) });
}

// ── Racks ──────────────────────────────────────────────────────────────────

export function createRack(body: { name: string; roomId: string }): Promise<Rack> {
  return apiFetch<Rack>('/api/v1/racks', { method: 'POST', body: JSON.stringify(body) });
}

export function updateRack(id: string, body: { name?: string; roomId?: string }): Promise<Rack> {
  return apiFetch<Rack>(`/api/v1/racks/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function deleteRack(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/racks/${id}`, { method: 'DELETE' });
}

// ── Device models (catalog) ────────────────────────────────────────────────

export function listDeviceModels(): Promise<DeviceModel[]> {
  return apiFetch<DeviceModel[]>('/api/v1/device-models');
}

export function createDeviceModel(body: Record<string, unknown>): Promise<DeviceModel> {
  return apiFetch<DeviceModel>('/api/v1/device-models', { method: 'POST', body: JSON.stringify(body) });
}

export function updateDeviceModel(id: string, body: Record<string, unknown>): Promise<DeviceModel> {
  return apiFetch<DeviceModel>(`/api/v1/device-models/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function getDeviceModelPortLayout(id: string): Promise<{ id: string; model: DeviceModel; frontAsset: AssetFile | null; portLayout: PortLayout | null; networkPortCount: number | null }> {
  return apiFetch(`/api/v1/device-models/${id}/port-layout`);
}

export function detectDeviceModelPortLayout(id: string, body: { assetId?: string; portCount?: number | null; imageWidth?: number; imageHeight?: number }): Promise<PortLayout> {
  return apiFetch<PortLayout>(`/api/v1/device-models/${id}/port-layout/detect`, { method: 'POST', body: JSON.stringify(body) });
}

export function saveDeviceModelPortLayout(id: string, body: Record<string, unknown>): Promise<PortLayout> {
  return apiFetch<PortLayout>(`/api/v1/device-models/${id}/port-layout`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function setDeviceModelFrontAsset(id: string, assetId: string): Promise<unknown> {
  return apiFetch(`/api/v1/device-models/${id}/assets/front`, { method: 'POST', body: JSON.stringify({ assetId }) });
}

// ── Assets ─────────────────────────────────────────────────────────────────

export function listAssets(): Promise<AssetFile[]> {
  return apiFetch<AssetFile[]>('/api/v1/assets');
}

export interface AssetUploadInput {
  filename: string;
  mimeType: string;
  kind: string;
  contentBase64: string;
}

export function createAsset(body: AssetUploadInput): Promise<AssetFile> {
  return apiFetch<AssetFile>('/api/v1/assets', { method: 'POST', body: JSON.stringify(body) });
}

export function deleteAsset(id: string): Promise<unknown> {
  return apiFetch(`/api/v1/assets/${id}`, { method: 'DELETE' });
}

// ── Devices ────────────────────────────────────────────────────────────────

export function listDevices(siteId: string, search: string): Promise<DeviceListResponse> {
  return apiFetch<DeviceListResponse>(`/api/v1/devices?siteId=${siteId}&search=${encodeURIComponent(search)}&pageSize=100`);
}

export function getDevice(id: string): Promise<Device> {
  return apiFetch<Device>(`/api/v1/devices/${id}`);
}

export function createDevice(body: DeviceInput): Promise<Device> {
  return apiFetch<Device>('/api/v1/devices', { method: 'POST', body: JSON.stringify(body) });
}

export function updateDevice(id: string, body: Partial<DeviceInput>): Promise<Device> {
  return apiFetch<Device>(`/api/v1/devices/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function previewDevicePlacement(deviceId: string, body: { rackId: string; rackUnitStart: number }): Promise<RackPlacementPlan> {
  return apiFetch<RackPlacementPlan>(`/api/v1/devices/${deviceId}/placement/preview`, { method: 'POST', body: JSON.stringify(body) });
}

export function placeDevice(deviceId: string, body: { rackId: string; rackUnitStart: number }): Promise<RackPlacementPlan> {
  return apiFetch<RackPlacementPlan>(`/api/v1/devices/${deviceId}/placement`, { method: 'PATCH', body: JSON.stringify(body) });
}

// ── Interfaces ─────────────────────────────────────────────────────────────

export function listInterfaces(deviceId: string): Promise<DeviceInterface[]> {
  return apiFetch<DeviceInterface[]>(`/api/v1/interfaces?deviceId=${deviceId}`);
}

export function updateInterface(id: string, body: Partial<InterfaceInput>): Promise<DeviceInterface> {
  return apiFetch<DeviceInterface>(`/api/v1/interfaces/${id}`, { method: 'PATCH', body: JSON.stringify(body) });
}

export function createInterface(deviceId: string, body: InterfaceInput): Promise<DeviceInterface> {
  return apiFetch<DeviceInterface>(`/api/v1/devices/${deviceId}/interfaces`, { method: 'POST', body: JSON.stringify(body) });
}

export function generateInterfaces(deviceId: string): Promise<unknown> {
  return apiFetch(`/api/v1/devices/${deviceId}/interfaces/generate`, { method: 'POST' });
}

// ── IPAM reads used by infrastructure views ────────────────────────────────

export function listVlansForSite(siteId: string): Promise<VlanListResponse> {
  return apiFetch<VlanListResponse>(`/api/v1/vlans?siteId=${siteId}&pageSize=500`);
}

export function listDeviceIpAddresses(siteId: string, deviceId: string): Promise<{ items: IpAddress[] }> {
  return apiFetch<{ items: IpAddress[] }>(`/api/v1/ip-addresses?siteId=${siteId}&deviceId=${deviceId}&pageSize=100`);
}
