'use client';

import type { ReactNode } from 'react';
import { X } from 'lucide-react';
import { SavedViews } from '@/components/data-table';
import { FilterChipBar, FilterChips } from '@/components/ui/filter-chips';
import { useUiText } from '@/components/ui/use-ui-text';
import { chipOptions } from '@/lib/filter-chips';
import { useServerChipCounts } from '@/lib/use-server-chip-counts';
import { ManageTagsButton, TagFilter } from '@/features/tags/tag-components';
import { countDevices } from '../api';
import { CrossSiteMissingConfigList } from '../components/devices/cross-site-missing-config-list';
import { DeviceList } from '../components/devices/device-list';
import { deviceFilterLabels, deviceStatusLabel, deviceStatusOptions, deviceTypeOptions, deviceUrlConfig, type DeviceUrlFilters } from '../device-filters';
import type { Device } from '../types';
import { useInfrastructureWorkspace } from '../workspace-context';

// '' first: its count is the "Todos" chip (search and the other dimension's filters applied).
const deviceStatusValues = ['', ...deviceStatusOptions().map(([value]) => value)];
const deviceTypeValues = ['', ...deviceTypeOptions().map(([value]) => value)];

type DevicesTabProps = {
  /** Drill-through filters in force (dashboard links), or null. */
  activeDeviceFilters: DeviceUrlFilters | null;
  missingConfigLabel: string;
  /** Name of the tag filter, for the applied-filters note. */
  deviceTagFilterName: string;
  tierCounts: Parameters<typeof DeviceList>[0]['tierCounts'];
  canManageTags: boolean;
  canTagDevice: (device: Device) => boolean;
  onManageTags: () => void;
  onEditTags: (device: Device) => void;
  onNew: () => void;
  onRetire: (device: Device) => void;
  /** Linux hosts panel, shown below the list when Tipo = Servidores. */
  serverHosts: ReactNode;
};

/** Equipamentos: the Site's device list with its Estado/Tipo chips, tag filter, saved views and drill-through filters. */
export function DevicesTab({ activeDeviceFilters, missingConfigLabel, deviceTagFilterName, tierCounts, canManageTags, canTagDevice, onManageTags, onEditTags, onNew, onRetire, serverHosts }: DevicesTabProps) {
  const ui = useUiText();
  const { siteId, navigation, devices, device, access, snmpHealth, openDevice, editDevice } = useInfrastructureWorkspace();
  const { deviceFilters, applyDeviceFilters, clearDeviceFilters, chooseDeviceType, deviceSavedViewsTable, missingConfig, missingConfigAllSites, clearMissingConfig, search, debouncedSearch } = navigation;

  // Estado and Tipo chips: one total-only request per value, with the search and every other filter applied.
  const chipBaseFilters = { ...deviceFilters, missingConfig: missingConfigAllSites ? '' : missingConfig };
  const chipSearch = debouncedSearch;
  const chipCountsEnabled = Boolean(siteId);
  const statusChipCounts = useServerChipCounts(deviceStatusValues, ['infrastructure', 'devices', siteId, chipSearch, { ...chipBaseFilters, status: '' }],
    (status) => countDevices(siteId, chipSearch, { ...chipBaseFilters, status }), chipCountsEnabled);
  const typeChipCounts = useServerChipCounts(deviceTypeValues, ['infrastructure', 'devices', siteId, chipSearch, { ...chipBaseFilters, type: '' }],
    (type) => countDevices(siteId, chipSearch, { ...chipBaseFilters, type }), chipCountsEnabled);
  const deviceStatusChips = chipOptions(deviceStatusOptions(ui), statusChipCounts, { selected: deviceFilters.status, hideEmpty: true, extraLabel: (value) => deviceStatusLabel(value, ui) });
  const deviceTypeChips = chipOptions(deviceTypeOptions(ui), typeChipCounts, { selected: deviceFilters.type });

  return <>
    {activeDeviceFilters && <p className="ipam-scope-note" role="status">{ui('infrastructure.devicesTab.appliedFilters')} <strong>{deviceFilterLabels(activeDeviceFilters, deviceTagFilterName, ui).join(' · ')}</strong> <button type="button" className="text-button" onClick={clearDeviceFilters}><X size={12} /> {ui('infrastructure.devicesTab.clearFilters')}</button></p>}
    {missingConfig && <div className="device-filter-chips" role="group" aria-label={ui('infrastructure.devicesTab.listFilters')}><span className="device-filter-chip">{ui(missingConfigAllSites ? 'infra.missingConfigFilterAllSites' : 'infra.missingConfigFilter', undefined, { label: missingConfigLabel })}<button type="button" onClick={clearMissingConfig} aria-label={ui('infrastructure.devicesTab.removeMissingConfigurationFilter')}><X size={12} aria-hidden="true" /></button></span></div>}
    {missingConfig && missingConfigAllSites && <CrossSiteMissingConfigList config={missingConfig} label={missingConfigLabel} />}
    {!(missingConfig && missingConfigAllSites) && <DeviceList devices={devices} tierFilter={deviceFilters.tier} onTierFilterChange={(tier) => applyDeviceFilters({ ...deviceFilters, tier })} toolbarFilters={siteId ? <div className="interface-toolbar-controls"><label><span className="toolbar-filter-label">{ui('infrastructure.devicesTab.tag')}</span><TagFilter siteId={siteId} value={deviceFilters.tag} onChange={(tag) => applyDeviceFilters({ ...deviceFilters, tag })} /></label>{canManageTags && <ManageTagsButton onClick={onManageTags} />}<SavedViews pageId="infra-devices" config={deviceUrlConfig} table={deviceSavedViewsTable} /></div> : undefined} filterChips={<FilterChipBar><FilterChips label={ui('infrastructure.devicesTab.status')} value={deviceFilters.status} options={deviceStatusChips} total={statusChipCounts['']} onChange={(status) => applyDeviceFilters({ ...deviceFilters, status })} /><FilterChips label={ui('infrastructure.devicesTab.type')} value={deviceFilters.type} options={deviceTypeChips} total={typeChipCounts['']} onChange={chooseDeviceType} /></FilterChipBar>} onEditTags={access.canUpdateDevice ? onEditTags : undefined} canEditTagsFor={canTagDevice} tierCounts={tierCounts} search={search} onSelect={openDevice} onEdit={editDevice} onNew={onNew} onRetire={onRetire} canRetire={access.roleCanEdit && access.scopeActions.includes('DELETE')} canEdit={access.canEdit} selectedId={device?.id} health={snmpHealth} />}
    {serverHosts}
  </>;
}
