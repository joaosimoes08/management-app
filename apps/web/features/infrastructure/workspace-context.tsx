'use client';

import { createContext, useContext } from 'react';
import type { ConfirmFn } from '@/components/ui/confirm-dialog';
import type { SnmpHealthSummaryItem } from '@/features/snmp/health/health-api';
import type { useWorkspaceNavigation } from './hooks/use-workspace-navigation';
import type { DeviceEditorTab } from './device-requirements';
import type { Device, Rack } from './types';

/**
 * What every Infrastructure tab shares: the Site, the URL-backed navigation (tab, search, device filters), the
 * device list and selection, the user's rights in the current Building/Room scope and the common actions. The
 * workspace provides it once, so tabs read it directly instead of receiving it through props.
 */
export type InfrastructureWorkspaceContextValue = {
  siteId: string;
  navigation: ReturnType<typeof useWorkspaceNavigation>;
  /** Devices of the Site (retired ones excluded). */
  devices: Device[];
  /** The open device (Interfaces / Equipamentos). */
  device: Device | null;
  snmpHealth: ReadonlyMap<string, SnmpHealthSummaryItem> | undefined;
  access: {
    roleCanEdit: boolean;
    canEdit: boolean;
    canUpdateDevice: boolean;
    canEditPower: boolean;
    /** Actions the user has on the selected Room, else Building, else Site. */
    scopeActions: string[];
  };
  openDevice: (device: Device) => void;
  editDevice: (device: Device, animateEntry?: boolean, openTab?: DeviceEditorTab) => Promise<void>;
  setError: (message: string) => void;
  invalidateInfrastructure: () => Promise<void>;
  askConfirm: ConfirmFn;
  /** Opens the power step for a device placed in (or moved to) a rack. */
  offerPowerStep: (saved: Pick<Device, 'id' | 'name' | 'rackId'> & Partial<Device>, previousRackId: string, force?: boolean) => Promise<void>;
  racks: Rack[];
};

const InfrastructureWorkspaceContext = createContext<InfrastructureWorkspaceContextValue | null>(null);

export const InfrastructureWorkspaceProvider = InfrastructureWorkspaceContext.Provider;

export function useInfrastructureWorkspace(): InfrastructureWorkspaceContextValue {
  const value = useContext(InfrastructureWorkspaceContext);
  if (!value) throw new Error('useInfrastructureWorkspace must be used inside InfrastructureWorkspace.');
  return value;
}
