export type TopologyMapType = 'PHYSICAL' | 'NETWORK' | 'VLAN_SUBNET';
export type DeviceConnectionType = 'PHYSICAL' | 'LOGICAL';
export type TopologyDeviceType = 'SWITCH' | 'ROUTER' | 'FIREWALL' | 'SERVER' | 'STORAGE' | 'OTHER';
import type { AssetFile, DeviceInterface, PortLayout } from '@/features/infrastructure/types';

export interface TopologyNode { id: string; deviceId: string; x: number; y: number; label?: string | null; device?: { id: string; name: string; hostname?: string | null; type: TopologyDeviceType | string; managementIp?: string | null; frontAsset?: AssetFile | null; model?: { frontAsset?: AssetFile | null; portLayout?: PortLayout | number | null } | null; rack?: { name: string; room?: { name: string; building?: { name: string } } } | null }; networkContext?: { vlans: Array<{ id: string; vlanId: number; name: string }>; subnets: Array<{ id: string; cidr: string }> } }
export interface TopologyConnection { id: string; sourceNodeId: string; targetNodeId: string; sourceDeviceId: string; targetDeviceId: string; sourceInterfaceId?: string | null; targetInterfaceId?: string | null; sourceInterface?: DeviceInterface | null; targetInterface?: DeviceInterface | null; type?: DeviceConnectionType | null; label?: string | null; notes?: string | null }
export interface TopologyMap { id: string; siteId: string; name: string; type: TopologyMapType; revision: number; filters?: { vlanIds?: string[] } | null; nodes: TopologyNode[]; connections: TopologyConnection[]; _count?: { nodes: number; connections: number } }
