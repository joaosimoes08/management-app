'use client';

import { infrastructureHelpTopic } from '@/features/help/articles';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { usePowerDefaults } from './use-power-defaults';
import { useAssets, useDeviceInterfaces, useDeviceModels, useDevices, useEffectiveAccess, useSiteLocations, useSiteRacks, useSiteVlans } from './hooks/infrastructure-queries';
import { useWorkspaceNavigation } from './hooks/use-workspace-navigation';
import { usePortLayoutEditor } from './hooks/use-port-layout-editor';
import { useAssetUpload } from './hooks/use-asset-upload';
import { usePowerStep } from './hooks/use-power-step';
import { MapPinned, X } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import type { RackSearchItem } from '@/components/layout/global-search';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useUiText } from '@/components/ui/use-ui-text';
import { useSiteContext } from '@/lib/site-context';
import { rememberRecentItem } from '@/lib/recent-items';
import { entityHref } from '@/lib/routes';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import type { Device, DeviceInterface, DeviceModel, IpAddress, RoomWithBuilding } from './types';
import { emptyRackPower, pduSettings, rackPowerChanged, rackPowerDraft, rackPowerInput, type BuildingForm, type DeviceForm, type ModelForm, type RackForm } from './forms';
import type { PowerConflictDetails, PowerConflictDevice } from './types';
import { connectionOutlets } from './power';
import { DevicePowerStep } from './components/editors/device-power-step';
import type { RackEditDraft } from './types';
import type { InterfaceFormState } from './components/models/interface-editor';
import {
  createBuilding as apiCreateBuilding,
  updateBuilding as apiUpdateBuilding,
  createRoom as apiCreateRoom,
  createRack as apiCreateRack,
  updateRack as apiUpdateRack,
  setRackPower,
  disconnectPduDevice,
  updateRoom as apiUpdateRoom,
  getDevice,
  getSiteLocations,
} from './api';
import { readInfrastructureContext, writeInfrastructureContext } from './utils';
import { BuildingModal } from './components/sites/building-modal';
import { RoomModal } from './components/sites/room-modal';
import { useSnmpHealthMap } from '@/features/snmp/health/health-api';
import { RetirementReviewModal } from './components/devices/retirement-review-modal';
import { DeepLinkDeviceLoader } from './components/devices/deep-link-device-loader';
import { InterfaceEditor } from './components/models/interface-editor';
import { PortLayoutEditor } from './components/models/port-layout-editor';
import { AssetUploadModal } from './components/assets/asset-upload-modal';
import { EntityEditor } from './components/editors/entity-editor';
import { mapApiFieldErrors, settingsTabFromSearch, useRequiredConfigRegistry, type DeviceEditorTab, type MappedFieldError } from './device-requirements';
import { LinuxHosts } from './components/linux-hosts';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { hasDeviceUrlFilters } from './device-filters';
import { setDeviceTags } from '@/features/tags/api';
import { TagEditor, TagManager, useTagFilterLabel } from '@/features/tags/tag-components';
import { canManageTagCatalog } from '@/features/tags/types';
import { DiscoveryPromotionSnmpOffer, promotionDeviceForm, readDiscoveryPromotion, withoutDiscoveryPromotion, type DiscoveryPromotionRequest } from './discovery-promotion';
import { InfrastructureWorkspaceProvider, type InfrastructureWorkspaceContextValue } from './workspace-context';
import { InfrastructureTabNavigation } from './tabs/tab-navigation';
import { LocationControls } from './tabs/location-controls';
import { SitesTab } from './tabs/sites-tab';
import { RacksTab } from './tabs/racks-tab';
import { DevicesTab } from './tabs/devices-tab';
import { LifecycleTab } from './tabs/lifecycle-tab';
import { ModelsTab } from './tabs/models-tab';
import { AssetsTab } from './tabs/assets-tab';
import { InterfacesTab } from './tabs/interfaces-tab';
import { PermissionsTab } from './tabs/permissions-tab';

const EMPTY_IPS: IpAddress[] = [];

const emptyDeviceForm: DeviceForm = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', isCritical: false, criticalityTier: '', frontAssetId: '', backAssetId: '', snmpEnabled: false, snmpVersion: 'V3', snmpReadUsername: '', snmpReadCommunity: '', snmpReadAuthKey: '', snmpReadPrivKey: '', snmpTrapEnabled: false, snmpTrapUsername: '', snmpTrapCommunity: '', snmpTrapAuthKey: '', snmpTrapPrivKey: '', snmpAuthProtocol: 'SHA256', snmpPrivProtocol: 'AES128', snmpCompatibilitySha1: false, snmpPort: '161', snmpIntervalMinutes: '15', snmpTimeoutMs: '5000', snmpRetries: '2' };
const emptyModelForm: ModelForm = { manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '', backAssetId: '' };
const modelFormFrom = (model: DeviceModel): ModelForm => ({ manufacturer: model.manufacturer, model: model.model, type: model.type ?? 'OTHER', supportsNetworkPorts: !!model.supportsNetworkPorts, networkPortCount: String(model.networkPortCount ?? ''), frontAssetId: model.frontAssetId ?? model.frontAsset?.id ?? '', backAssetId: model.backAssetId ?? model.backAsset?.id ?? '' });
const emptyInterfaceForm: InterfaceFormState = { id: '', name: '', portKey: '', interfaceType: 'ETHERNET', description: '', adminUp: true, operUp: false, speedMbps: '', mode: 'ACCESS', accessVlanId: '', nativeVlanId: '', allowedVlanIds: [], macAddress: '' };

/**
 * The Infrastructure workspace (Mapa físico). It owns the Site-wide server state, the Building/Room/Rack/device
 * selection and the editors (modals); each tab is its own component under ./tabs and reads what tabs share from
 * the workspace context. URL-backed navigation (tab, search, device filters) lives in useWorkspaceNavigation.
 */
export function InfrastructureWorkspace() {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  // Power defaults come from the API only; fetched once here so the rack form is prefilled when it opens.
  const powerDefaults = usePowerDefaults();
  const { t } = useI18n();
  const ui = useUiText();
  const { hasRole, user } = useAuth();
  const { siteId, activeSite, sites } = useSiteContext();
  const canReadHosts = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR') || hasRole('AUDITOR') || hasRole('READ_ONLY');
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');

  const navigation = useWorkspaceNavigation(siteId);
  const { tab, setTab, search, setSearch, debouncedSearch, deviceFilters, missingConfig, missingConfigAllSites } = navigation;
  const [tagEditorDevice, setTagEditorDevice] = useState<Device | null>(null);
  const [managingDeviceTags, setManagingDeviceTags] = useState(false);
  const [buildingId, setBuildingId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rackId, setRackId] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [retirementDeviceId, setRetirementDeviceId] = useState('');
  const [selectedInterface, setSelectedInterface] = useState<DeviceInterface | null>(null);
  const [modal, setModal] = useState('');
  const [editingId, setEditingId] = useState('');
  const [animateDeviceEdit, setAnimateDeviceEdit] = useState(false);
  const [error, setError] = useState('');
  const [formError, setFormError] = useState('');
  const [deviceFieldErrors, setDeviceFieldErrors] = useState<MappedFieldError[]>([]);
  const [deviceEditorTab, setDeviceEditorTab] = useState<DeviceEditorTab | undefined>(undefined);
  const requiredConfigRegistry = useRequiredConfigRegistry();
  const missingConfigLabel = requiredConfigRegistry?.configs?.find((config) => config.key === missingConfig)?.label ?? missingConfig;
  useEffect(() => { setFormError(''); setDeviceFieldErrors([]); }, [modal]);
  /** D-P1b: discovery result being promoted (create form open) and the device it became (SNMP offer). */
  const promotionRef = useRef<DiscoveryPromotionRequest | null>(null);
  const promotionRead = useRef(false);
  const [promotedDevice, setPromotedDevice] = useState<{ id: string; name: string } | null>(null);
  useEffect(() => { if (modal !== 'device') promotionRef.current = null; }, [modal]);
  const [buildingForm, setBuildingForm] = useState<BuildingForm>({ name: '', description: '' });
  const [roomForm, setRoomForm] = useState({ name: '', buildingId: '' });
  const [editingLocationId, setEditingLocationId] = useState('');
  const [rackForm, setRackForm] = useState<RackForm>({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  /** Devices that stopped the last rack power save (409 from the API). */
  const [rackPowerConflict, setRackPowerConflict] = useState<{ kind: 'ups' | 'outlets'; devices: PowerConflictDevice[] } | null>(null);
  const [disconnectingUps, setDisconnectingUps] = useState(false);
  useEffect(() => { setRackPowerConflict(null); }, [modal]);
  /** Rack of the device being edited when its form opened, to tell whether a save moved it. */
  const editingDeviceRackId = useRef('');
  const [deviceForm, setDeviceForm] = useState<DeviceForm>(emptyDeviceForm);
  const [interfaceForm, setInterfaceForm] = useState<InterfaceFormState>(emptyInterfaceForm);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModelForm);

  // ── Server state (React Query) ───────────────────────────────────────────

  const { data: accessData, error: accessError, isFetching: fetchingAccess } = useEffectiveAccess(siteId);
  const { data: locationsData, error: locationsError, isFetching: fetchingLocations } = useSiteLocations(siteId);
  const { data: racksData, error: racksError, isFetching: fetchingRacks } = useSiteRacks(siteId);
  const canUseCatalog = Boolean(accessData?.tabs?.models || accessData?.tabs?.assets);
  const canUseInterfaces = Boolean(accessData?.tabs?.interfaces);
  const { data: modelsData, error: modelsError } = useDeviceModels(siteId, canUseCatalog);
  const { data: assetsData, error: assetsError } = useAssets(siteId, canUseCatalog);
  const { data: vlansData, error: vlansError } = useSiteVlans(siteId, canUseInterfaces);
  // Drill-through filters (dashboard links) apply to the Equipamentos tab only.
  // SNMP Phase 2 step 10: one Site-wide health request shared by the device list and the rack view (no per-row fetch).
  const snmpHealth = useSnmpHealthMap(siteId, Boolean(siteId) && (tab === 'devices' || tab === 'racks'));
  const activeDeviceFilters = tab === 'devices' && hasDeviceUrlFilters(deviceFilters) ? deviceFilters : null;
  const { data: devicesData, error: devicesError } = useDevices({
    siteId,
    search: tab === 'devices' ? debouncedSearch : '',
    missingConfig: missingConfigAllSites ? '' : missingConfig,
    filters: activeDeviceFilters,
  });
  const deepLinkQuery = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  // ?focus=device&deviceId=… or the alert link ?tab=devices&deviceId=…&settingsTab=… opens the device's settings.
  const deepLinkedDeviceId = deepLinkQuery?.get('focus') === 'device' || deepLinkQuery?.get('settingsTab') ? deepLinkQuery.get('deviceId') : null;
  const deviceId = device?.id ?? '';
  const { data: interfacesData } = useDeviceInterfaces(deviceId);
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('interfaceId');
    if (!requested || !interfacesData) return;
    const target = interfacesData.find((item) => item.id === requested);
    if (target) setSelectedInterface(target);
  }, [interfacesData]);

  const busy = fetchingAccess || fetchingLocations || fetchingRacks;
  const queryError = [accessError, locationsError, racksError, modelsError, assetsError, vlansError, devicesError].find(Boolean);
  const errorMessage = queryError instanceof Error ? queryError.message : '';

  const locations = locationsData ?? [];
  const racks = useMemo(() => racksData ?? [], [racksData]);
  const models = modelsData ?? [];
  const assets = assetsData ?? [];
  const vlans = vlansData?.items ?? [];
  const devices = useMemo(() => (devicesData?.items ?? []).filter((item) => item.status !== 'RETIRED'), [devicesData]);
  const interfaces = interfacesData ?? [];

  useEffect(() => {
    setBuildingId('');
    setRoomId('');
    setRackId('');
    setDevice(null);
  }, [siteId]);

  // ── URL/context restoration after racks and locations arrive.

  useEffect(() => {
    if (!siteId || !locationsData || !racksData) return;
    const query = new URLSearchParams(location.search);
    const storedContext = readInfrastructureContext();
    const requestedDevice = (devicesData?.items ?? []).find((item) => item.id === query.get('deviceId'));
    if (requestedDevice) {
      setDevice(requestedDevice);
      setTab(query.get('tab') === 'devices' ? 'devices' : (canUseInterfaces ? 'interfaces' : 'devices'));
    }
    const rack = racksData.find((item) => item.id === query.get('rackId'));
    if (rack) {
      setBuildingId(rack.room?.building?.id ?? '');
      setRoomId(rack.room?.id ?? '');
      setRackId(rack.id);
    } else {
      setRackId('');
      const contextForSite = storedContext?.siteId === siteId ? storedContext : null;
      const requestedRoomId = query.get('roomId') || contextForSite?.roomId || '';
      const requestedBuildingId = query.get('buildingId') || contextForSite?.buildingId || '';
      const restoredRoom = locationsData
        .flatMap((building) => building.rooms ?? [])
        .find((room) => room.id === requestedRoomId);
      const restoredBuildingId = restoredRoom?.buildingId || requestedBuildingId;

      // A sala persistida é a fonte mais específica. Derivar o edifício a
      // partir dela mantém o filtro de bastidores alinhado com o contexto
      // restaurado, mesmo quando a URL só contém o site.
      setBuildingId(restoredBuildingId);
      setRoomId(restoredRoom?.id || requestedRoomId);
      if (restoredBuildingId || restoredRoom?.id) {
        writeInfrastructureContext({
          siteId,
          buildingId: restoredBuildingId,
          roomId: restoredRoom?.id || requestedRoomId,
        });
      }
    }
  }, [siteId, locationsData, racksData, devicesData, canUseInterfaces, setTab]);

  const invalidateInfrastructure = () => queryClient.invalidateQueries({ queryKey: ['infrastructure'] });
  const assetUpload = useAssetUpload({ openModal: setModal, onUploaded: invalidateInfrastructure, onError: setError });
  const portLayout = usePortLayoutEditor({ openModal: setModal, onSaved: invalidateInfrastructure });
  const { openUpload } = assetUpload;

  useEffect(() => {
    const openModel = () => { setEditingId(''); setModelForm({ manufacturer: '', model: '', type: 'OTHER', supportsNetworkPorts: false, networkPortCount: '', frontAssetId: '', backAssetId: '' }); setModal('model'); };
    window.addEventListener('asset-upload-request', openUpload);
    window.addEventListener('model-create-request', openModel);
    return () => {
      window.removeEventListener('asset-upload-request', openUpload);
      window.removeEventListener('model-create-request', openModel);
    };
  }, [openUpload]);

  // ── Derived view state ───────────────────────────────────────────────────

  const buildings = locations;
  const rooms = useMemo(() => buildingId ? locations.filter((item) => item.id === buildingId).flatMap((building) => (building.rooms ?? []).map((room): RoomWithBuilding => ({ ...room, building }))) : [], [locations, buildingId]);

  const effective = accessData;
  const scopeActions = roomId
    ? effective?.infrastructure?.rooms?.find((item) => item.id === roomId)?.actions ?? []
    : buildingId
      ? effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []
      : effective?.infrastructure?.site ?? [];
  const canEdit = (roomId ? roleCanEdit : hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && scopeActions.some((action) => action !== 'READ');
  const canUpdateDevice = roleCanEdit && scopeActions.includes('UPDATE');
  /** Step 36: NETWORK_OPERATOR alone edits tags of network equipment only (the API enforces the same rule). */
  /** Catalog changes need the whole-Site device scope (ADMIN / SYSTEMS_OPERATOR with UPDATE), like the API. */
  const canManageTags = canUpdateDevice && canManageTagCatalog(hasRole);
  const canTagDevice = (item: Device) => canUpdateDevice && (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR') || ['SWITCH', 'ROUTER', 'FIREWALL'].includes(item.type));
  const deviceTagFilterName = useTagFilterLabel(siteId, deviceFilters.tag);
  const canCreateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && (effective?.infrastructure?.site ?? []).includes('CREATE');
  const canCreateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []).includes('CREATE');
  const canUpdateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []).includes('UPDATE');
  const canUpdateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(roomId) && (effective?.infrastructure?.rooms?.find((item) => item.id === roomId)?.actions ?? []).includes('UPDATE');
  /** PDU writes (rack power, device outlets, Desligar) are ADMIN / SYSTEMS_OPERATOR, like rack edits. */
  const canEditPower = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && scopeActions.some((action) => action !== 'READ');
  const { powerStep, powerStepError, offerPowerStep, savePowerStep, skipPowerStep } = usePowerStep({ canEditPower, powerDefaults, onError: setError, onSaved: invalidateInfrastructure });

  // ── Actions ──────────────────────────────────────────────────────────────

  const chooseBuilding = (id: string) => {
    if (id === '__new__') { setEditingLocationId(''); setBuildingForm({ name: '', description: '' }); setModal('building'); return; }
    setBuildingId(id);
    setRoomId('');
    setRackId('');
    setDevice(null);
    writeInfrastructureContext({ siteId, buildingId: id, roomId: '' });
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${id}`);
  };
  const chooseRoom = (id: string) => {
    if (id === '__new__') { setEditingLocationId(''); setRoomForm({ name: '', buildingId: buildingId || buildings[0]?.id || '' }); setModal('room'); return; }
    const room = rooms.find((item) => item.id === id);
    const nextBuilding = room?.building?.id || buildingId;
    setBuildingId(nextBuilding);
    setRoomId(id);
    setRackId('');
    setDevice(null);
    writeInfrastructureContext({ siteId, buildingId: nextBuilding, roomId: id });
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${nextBuilding}&roomId=${id}`);
  };
  const createBuilding = async () => {
    if (!buildingForm.name.trim()) return;
    try {
      if (editingLocationId) await apiUpdateBuilding(editingLocationId, { name: buildingForm.name.trim(), description: buildingForm.description.trim() || undefined });
      else await apiCreateBuilding(siteId, { name: buildingForm.name.trim(), description: buildingForm.description.trim() || undefined });
      const fresh = await getSiteLocations(siteId);
      queryClient.setQueryData(['infrastructure', 'locations', siteId], fresh);
      const created = editingLocationId ? fresh.find((item) => item.id === editingLocationId) : fresh.find((item) => item.name === buildingForm.name.trim());
      setModal('');
      setEditingLocationId('');
      if (created) {
        setBuildingId(created.id);
        setRoomId('');
        writeInfrastructureContext({ siteId, buildingId: created.id, roomId: '' });
        history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar o edifício.');
    }
  };
  const createRoom = async () => {
    if (!roomForm.name.trim() || !roomForm.buildingId) return;
    try {
      if (editingLocationId) await apiUpdateRoom(editingLocationId, { name: roomForm.name.trim() });
      else await apiCreateRoom(roomForm.buildingId, { name: roomForm.name.trim() });
      const fresh = await getSiteLocations(siteId);
      queryClient.setQueryData(['infrastructure', 'locations', siteId], fresh);
      const created = editingLocationId ? fresh.flatMap((item) => item.rooms ?? []).find((room) => room.id === editingLocationId) : fresh.flatMap((item) => item.rooms ?? []).find((room) => room.name === roomForm.name.trim() && room.buildingId === roomForm.buildingId);
      setModal('');
      setEditingLocationId('');
      if (created) {
        setBuildingId(roomForm.buildingId);
        setRoomId(created.id);
        writeInfrastructureContext({ siteId, buildingId: roomForm.buildingId, roomId: created.id });
        history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${roomForm.buildingId}&roomId=${created.id}`);
      }
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível criar a sala.');
    }
  };
  const openDevice = useCallback((selected: Device) => {
    rememberRecentItem(user?.id, { id: `device:${selected.id}`, kind: 'Equipamento', label: selected.name, href: entityHref({ kind: 'device', id: selected.id, siteId }) });
    setDevice(selected);
    setTab(canUseInterfaces ? 'interfaces' : 'devices');
    setSelectedInterface(null);
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&tab=${canUseInterfaces ? 'interfaces' : 'devices'}&deviceId=${selected.id}`);
  }, [user?.id, siteId, canUseInterfaces, setTab]);
  const editDevice = useCallback(async (selected: Device, animateEntry = false, openTab?: DeviceEditorTab) => {
    const full = await getDevice(selected.id);
    setDeviceEditorTab(openTab);
    setEditingId(full.id);
    setAnimateDeviceEdit(animateEntry);
    setDeviceForm({
      name: full.name ?? '',
      type: full.type ?? 'SWITCH',
      hostname: full.hostname ?? '',
      managementIp: full.managementIp ?? '',
      managementIpAddressId: full.ipAddresses?.find((ip) => ip.address === full.managementIp)?.id ?? '',
      rackId: full.rackId ?? '',
      rackUnitStart: full.rackUnitStart ? String(full.rackUnitStart) : '',
      rackUnitSize: String(full.rackUnitSize ?? 1),
      modelId: full.modelId ?? full.model?.id ?? '',
      status: full.status ?? 'UNKNOWN',
      isCritical: !!full.isCritical,
      criticalityTier: full.criticalityTier ?? '',
      frontAssetId: full.frontAssetId ?? full.frontAsset?.id ?? '',
      backAssetId: full.backAssetId ?? full.backAsset?.id ?? '',
      savedAssetIds: { front: full.frontAssetId ?? full.frontAsset?.id ?? '', rear: full.backAssetId ?? full.backAsset?.id ?? '' },
      powerPlugCount: full.powerPlugCount == null ? '' : String(full.powerPlugCount),
      estimatedWatts: full.estimatedWatts == null ? '' : String(full.estimatedWatts),
      savedPower: { plugs: full.powerPlugCount == null ? '' : String(full.powerPlugCount), watts: full.estimatedWatts == null ? '' : String(full.estimatedWatts) },
      savedRackId: full.rackId ?? '',
      requiredMissing: full.requiredConfig?.missing ?? selected.requiredConfig?.missing ?? [],
    });
    editingDeviceRackId.current = full.rackId ?? '';
    setModal('device');
  }, []);
  const openDeepLinkedDevice = useCallback((selected: Device) => {
    setDevice(selected);
    setTab('devices');
    // ?settingsTab=imagens|energia|… opens the editor on that tab (missing-config alerts link here).
    const requestedTab = settingsTabFromSearch(window.location.search);
    if (siteId) history.replaceState({}, '', `/infraestrutura?siteId=${encodeURIComponent(siteId)}&tab=devices&deviceId=${encodeURIComponent(selected.id)}`);
    void editDevice(selected, false, requestedTab);
  }, [siteId, editDevice, setTab]);
  const reportDeepLinkError = useCallback((cause: unknown) => {
    setError(cause instanceof Error ? cause.message : 'Não foi possível abrir o equipamento.');
  }, []);
  const editInterface = (item: DeviceInterface) => {
    setSelectedInterface(item);
    setInterfaceForm({
      id: item.id,
      name: item.name ?? '',
      portKey: item.portKey ?? '',
      interfaceType: item.interfaceType ?? 'ETHERNET',
      description: item.description ?? '',
      adminUp: item.adminUp !== false,
      operUp: !!item.operUp,
      speedMbps: item.speedMbps ? String(item.speedMbps) : '',
      mode: item.mode ?? 'ACCESS',
      accessVlanId: item.accessVlanId ?? '',
      nativeVlanId: item.nativeVlanId ?? '',
      allowedVlanIds: (item.allowedVlans ?? []).map((entry) => entry.vlanId),
      macAddress: item.macAddress ?? '',
    });
    setModal('interface');
  };
  const save = async (path: string, body: Record<string, unknown>, method = editingId ? 'PATCH' : 'POST') => {
    setFormError('');
    try {
      const saved = await apiFetch<unknown>(path, { method, body: JSON.stringify(body) });
      // D-P1b: a promoted result saved as a plain device gets the SNMP offer (the SNMP onboarding save already set it up).
      const promotion = promotionRef.current;
      promotionRef.current = null;
      if (promotion && method === 'POST' && path === '/api/v1/devices' && saved && typeof saved === 'object' && 'id' in saved) setPromotedDevice({ id: String((saved as Device).id), name: (saved as Device).name ?? promotion.name });
      setModal('');
      setEditingId('');
      await invalidateInfrastructure();
      if (device) openDevice(device);
      // A device that lands in a rack (new, or moved from another rack) gets the power step, unless the save already
      // connected its plugs (`power` in the body; it can still adjust them in "Ligações elétricas").
      if (/^\/api\/v1\/devices(\/[^/]+)?$/.test(path) && !('power' in body) && saved && typeof saved === 'object' && 'id' in saved) {
        const previousRackId = method === 'POST' ? '' : editingDeviceRackId.current;
        void offerPowerStep(saved as Device, previousRackId);
      }
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : 'Operação falhou.');
      // Field-level 400s on a device save are shown on their fields (and the tab that holds them).
      if (cause instanceof ApiRequestError && cause.status === 400 && /^\/api\/v1\/(devices|snmp\/onboarding\/devices)/.test(path)) setDeviceFieldErrors(mapApiFieldErrors(cause.payload));
    }
  };

  // ── Rack form and rack power ──────────────────────────────────────────────

  /** UPS connections that stop "Só rede elétrica" on the rack being edited (checked before the API says 409). */
  const editedRack = modal === 'rack' && editingId ? racks.find((rack) => rack.id === editingId) : undefined;
  const upsDevices = (editedRack?.pdus ?? []).filter((pdu) => pdu.source === 'UPS').flatMap((pdu) => (pdu.connections ?? []).map((connection) => ({ deviceId: connection.deviceId, deviceName: connection.deviceName, outlets: connectionOutlets(connection).map((outlet) => outlet.outletIndex) })));
  const localUpsBlock = rackForm.power?.mode === 'SUPPLIER_ONLY' && upsDevices.length ? { kind: 'ups' as const, devices: upsDevices } : null;
  const rackPowerBlocked = rackPowerConflict ?? localUpsBlock;

  const editRack = (rack: RackEditDraft) => {
    const power = rackPowerDraft(rack.id ? rack : null, powerDefaults);
    setEditingId(rack.id ?? '');
    setRackForm({ name: rack.name ?? '', units: String(rack.units ?? 42), roomId: rack.room?.id ?? rack.roomId ?? roomId, modelId: rack.modelId ?? rack.model?.id ?? '', frontAssetId: rack.frontAssetId ?? rack.frontAsset?.id ?? '', power, savedPower: power });
    setModal('rack');
  };
  const saveRack = async (skipLocalCheck = false) => {
    setFormError('');
    const power = rackForm.power ?? emptyRackPower(powerDefaults);
    if (!skipLocalCheck && localUpsBlock) {
      setFormError(t('power.error.upsFirst'));
      return;
    }
    try {
      if (editingId) {
        await apiUpdateRack(editingId, { name: rackForm.name, roomId: rackForm.roomId });
        if (rackPowerChanged(power, rackForm.savedPower)) await setRackPower(editingId, rackPowerInput(power));
      } else {
        await apiCreateRack({ name: rackForm.name, roomId: rackForm.roomId, powerMode: power.mode, supplierPdu: pduSettings(power.supplier), ...(power.mode === 'SUPPLIER_AND_UPS' ? { upsPdu: pduSettings(power.ups) } : {}) });
      }
      setModal('');
      setEditingId('');
      await invalidateInfrastructure();
    } catch (cause) {
      // The name/room update may already be saved when the power change fails (e.g. 409): show what the API now holds.
      if (editingId) void queryClient.invalidateQueries({ queryKey: ['infrastructure', 'racks', siteId] });
      const details = cause instanceof ApiRequestError && cause.status === 409 ? cause.payload?.details as PowerConflictDetails | undefined : undefined;
      if (details?.devices?.length) setRackPowerConflict({ kind: cause instanceof ApiRequestError && cause.code === 'PDU_HAS_CONNECTIONS' ? 'ups' : 'outlets', devices: details.devices });
      setFormError(cause instanceof Error ? cause.message : 'Operação falhou.');
    }
  };
  /** "Desligar todos da UPS": frees every UPS outlet of the edited rack, then saves the form again. */
  const disconnectAllUps = async () => {
    const rack = editedRack;
    const ups = rack?.pdus?.find((pdu) => pdu.source === 'UPS');
    if (!rack || !ups || !rackPowerBlocked) return;
    setDisconnectingUps(true);
    setFormError('');
    try {
      for (const item of rackPowerBlocked.devices) await disconnectPduDevice(rack.id, ups.id, item.deviceId);
      setRackPowerConflict(null);
      await queryClient.refetchQueries({ queryKey: ['infrastructure', 'racks', siteId] });
      await saveRack(true);
    } catch (cause) {
      setFormError(cause instanceof Error ? cause.message : t('power.error.disconnectAll'));
    } finally {
      setDisconnectingUps(false);
    }
  };
  const reset = () => {
    setBuildingId('');
    setRoomId('');
    setRackId('');
    setDevice(null);
    setSelectedInterface(null);
    setModal('');
    writeInfrastructureContext({ siteId, buildingId: '', roomId: '' });
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}`);
  };
  // D-P1b: `?promote=discovery&ip=…` (from an approved discovery result) opens the create form prefilled, once the
  // Site access and the model catalogue (for the SNMP model) are known.
  const modelsReady = Boolean(modelsData || modelsError || (accessData && !canUseCatalog));
  useEffect(() => {
    if (promotionRead.current || !accessData || !modelsReady) return;
    // Wait for the Site context to reach the Site the link names (the access answer must be that Site's).
    const linkedSite = new URLSearchParams(window.location.search).get('siteId');
    if (linkedSite && linkedSite !== siteId) return;
    const promotion = readDiscoveryPromotion(window.location.search);
    promotionRead.current = true;
    if (!promotion) return;
    history.replaceState(history.state, '', `${window.location.pathname}${withoutDiscoveryPromotion(window.location.search)}`);
    if (!roleCanEdit || !(accessData.infrastructure?.site ?? []).some((action) => action !== 'READ')) { setError(t('discoveryPromote.forbidden')); return; }
    setTab('devices');
    setEditingId('');
    setAnimateDeviceEdit(false);
    setDeviceEditorTab(undefined);
    setDeviceForm(promotionDeviceForm(emptyDeviceForm, promotion, modelsData ?? []));
    editingDeviceRackId.current = '';
    promotionRef.current = promotion;
    setModal('device');
  }, [accessData, modelsReady, modelsData, roleCanEdit, siteId, t, setTab]);
  const newDevice = () => {
    setEditingId('');
    setAnimateDeviceEdit(false);
    setDeviceEditorTab(undefined);
    setDeviceForm(emptyDeviceForm);
    editingDeviceRackId.current = '';
    setModal('device');
  };
  const { openLayout } = portLayout;
  useEffect(() => {
    const query = new URLSearchParams(location.search);
    const modelId = query.get('modelId');
    const model = modelId ? modelsData?.find((item) => item.id === modelId) : undefined;
    if (!model) return;
    setTab('models');
    if (query.get('focus') === 'port-layout') {
      void openLayout(model);
      return;
    }
    setEditingId(model.id);
    setModelForm(modelFormFrom(model));
    setModal('model');
  }, [modelsData, openLayout, setTab]);

  const modalForEditor = modal === 'room' || modal === 'building' ? '' : modal;
  const tabName = ['sites', 'racks', 'devices', 'models', 'interfaces', 'assets', 'lifecycle', 'permissions'].includes(tab) ? ui(`infra.tab.${tab}`) : tab;
  const rackSearchContext = tab === 'racks' ? {
    racks,
    value: search,
    onChange: setSearch,
    hrefForRack: (rack: RackSearchItem) => {
      const params = new URLSearchParams({ siteId, rackId: rack.id });
      const targetBuildingId = rack.room?.building?.id ?? buildingId;
      const targetRoomId = rack.room?.id ?? rack.roomId ?? roomId;
      if (targetBuildingId) params.set('buildingId', targetBuildingId);
      if (targetRoomId) params.set('roomId', targetRoomId);
      return `/infraestrutura?${params.toString()}`;
    },
  } : undefined;
  // Equipamentos filtered to servers keeps the Servidores help article.
  const showServerHosts = tab === 'devices' && deviceFilters.type === 'SERVER' && canReadHosts;
  const helpTopic = infrastructureHelpTopic(tab === 'devices' && deviceFilters.type === 'SERVER' ? 'hosts' : tab);
  const serverHosts = showServerHosts ? <LinuxHosts embedded sites={sites} canManage={hasRole('ADMIN')} canAudit={hasRole('ADMIN') || hasRole('AUDITOR')} /> : null;
  const tabNavigation = <InfrastructureTabNavigation tab={tab} tabs={effective?.tabs} onSelect={(key) => navigation.selectTab(key, reset)} />;
  if (!siteId) return <AppShell section="Infraestrutura" helpTopic={helpTopic} moduleTabs={canReadHosts ? tabNavigation : undefined}><div className="module-page infrastructure-workspace"><header className="workspace-head"><div><h1>Infraestrutura</h1><p>Seleciona um Site no seletor superior para começar.</p></div></header>{deepLinkedDeviceId ? <><DeepLinkDeviceLoader deviceId={deepLinkedDeviceId} loadDevice={getDevice} onOpen={openDeepLinkedDevice} onError={reportDeepLinkError} /><section className="ipam-card empty-context"><MapPinned size={28} /><strong>{device ? `${device.name} · ${device.type}` : error || 'A carregar equipamento…'}</strong><p>O equipamento está sem Site. Seleciona um Site no seletor superior para associá-lo e guardar alterações.</p></section><EntityEditor modal={modal} close={() => setModal('')} editingId={editingId} animateDeviceEntry={animateDeviceEdit} form={{ rack: rackForm, device: deviceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, model: setModelForm }} rooms={[]} racks={[]} models={[]} assets={[]} ips={EMPTY_IPS} save={save} formError={formError} deviceFieldErrors={deviceFieldErrors} deviceTab={deviceEditorTab} /></> : <section className="ipam-card empty-context"><MapPinned size={28} /><strong>Seleciona um Site no seletor superior</strong></section>}{serverHosts}</div></AppShell>;
  const locationControls = <LocationControls buildings={buildings} rooms={rooms} buildingId={buildingId} roomId={roomId} chooseBuilding={chooseBuilding} chooseRoom={chooseRoom} canCreateBuilding={canCreateBuilding} canCreateRoom={canCreateRoom} canUpdateBuilding={canUpdateBuilding} canUpdateRoom={canUpdateRoom} onEditBuilding={(building) => { setEditingLocationId(building.id); setBuildingForm({ name: building.name, description: building.description ?? '' }); setModal('building-edit'); }} onEditRoom={(room) => { setEditingLocationId(room.id); setRoomForm({ name: room.name, buildingId: room.buildingId }); setModal('room-edit'); }} busy={busy} />;

  if (tab === 'permissions' && effective?.tabs?.permissions) return <AppShell section="Mapa físico" toolbarKey={tab} helpTopic={helpTopic} moduleTabs={tabNavigation}><PermissionsTab siteId={siteId} buildings={buildings} /></AppShell>;

  const workspace: InfrastructureWorkspaceContextValue = {
    siteId, navigation, devices, device, snmpHealth, racks,
    access: { roleCanEdit, canEdit, canUpdateDevice, canEditPower, scopeActions },
    openDevice, editDevice, setError, invalidateInfrastructure, askConfirm, offerPowerStep,
  };

  return <InfrastructureWorkspaceProvider value={workspace}>{confirmDialog}<AppShell section="Mapa físico" toolbarKey={tab} helpTopic={helpTopic} moduleTabs={tabNavigation} search={tab === 'racks' || tab === 'sites' ? undefined : { value: search, onChange: setSearch, placeholder: ui('infra.searchIn', undefined, { tab: tabName.toLocaleLowerCase() }), scopeLabel: tabName }} rackSearch={rackSearchContext} toolbar={tab === 'sites' ? undefined : locationControls}><DeepLinkDeviceLoader deviceId={deepLinkedDeviceId} loadDevice={getDevice} onOpen={openDeepLinkedDevice} onError={reportDeepLinkError} /><div className="module-page infrastructure-workspace"><h1 className="topology-sr-only">Mapa físico</h1>{(error || errorMessage) && <div className="ipam-alert error"><X size={15} />{error || errorMessage}</div>}
    {tab === 'sites' && <SitesTab siteId={siteId} siteName={activeSite?.name ?? 'Site'} />}
    {tab === 'racks' && <RacksTab rooms={rooms} buildingId={buildingId} roomId={roomId} rackId={rackId} setRoomId={setRoomId} setRackId={setRackId} onEditRack={editRack} />}
    {tab === 'devices' && <DevicesTab activeDeviceFilters={activeDeviceFilters} missingConfigLabel={missingConfigLabel} deviceTagFilterName={deviceTagFilterName} tierCounts={devicesData?.tierCounts} canManageTags={canManageTags} canTagDevice={canTagDevice} onManageTags={() => setManagingDeviceTags(true)} onEditTags={setTagEditorDevice} onNew={newDevice} onRetire={(item) => setRetirementDeviceId(item.id)} serverHosts={serverHosts} />}
    {tab === 'lifecycle' && <LifecycleTab />}
    {tab === 'models' && effective?.tabs?.models && <ModelsTab models={models} onEdit={(model) => { setEditingId(model.id); setModelForm(modelFormFrom(model)); setModal('model'); }} onLayout={openLayout} />}
    {tab === 'assets' && effective?.tabs?.assets && <AssetsTab assets={assets} />}
    {tab === 'interfaces' && effective?.tabs?.interfaces && <InterfacesTab interfaces={interfaces} selectedInterface={selectedInterface} onInterface={editInterface} />}
    <EntityEditor modal={modalForEditor} close={() => setModal('')} editingId={editingId} animateDeviceEntry={animateDeviceEdit} form={{ rack: rackForm, device: deviceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, model: setModelForm }} rooms={rooms} racks={racks} models={models} assets={assets} ips={EMPTY_IPS} save={save} formError={formError} deviceFieldErrors={deviceFieldErrors} deviceTab={deviceEditorTab} saveRack={() => saveRack()} rackPower={{ blocked: rackPowerBlocked, onDisconnectAllUps: canEditPower ? () => void disconnectAllUps() : undefined, disconnecting: disconnectingUps }} onDevicePower={canEditPower && editingId ? () => void offerPowerStep({ id: editingId, name: deviceForm.name, rackId: deviceForm.rackId, powerPlugCount: deviceForm.powerPlugCount ? Number(deviceForm.powerPlugCount) : null, model: models.find((item) => item.id === deviceForm.modelId) ?? null }, deviceForm.rackId, true) : undefined} />
    {powerStep && <DevicePowerStep key={`${powerStep.device.id}:${powerStep.rack.id}`} device={powerStep.device} plugs={powerStep.plugs} rack={powerStep.rack} moved={powerStep.moved} onSave={savePowerStep} onSkip={skipPowerStep} error={powerStepError} />}
    {promotedDevice && !powerStep && !modal && <DiscoveryPromotionSnmpOffer key={promotedDevice.id} device={promotedDevice} canConfigureSnmp={hasRole('ADMIN')} close={() => setPromotedDevice(null)} onConfigured={() => void invalidateInfrastructure()} />}
    {modal === 'interface' && <InterfaceEditor modal={modal} close={() => setModal('')} form={{ interface: interfaceForm }} setForm={{ interface: setInterfaceForm }} vlans={vlans} save={save} formError={formError} />}
    <BuildingModal modal={modal === 'building' || modal === 'building-edit'} editing={modal === 'building-edit'} close={() => { setModal(''); setEditingLocationId(''); }} buildingForm={buildingForm} setBuildingForm={setBuildingForm} createBuilding={createBuilding} />
    <RoomModal modal={modal === 'room' || modal === 'room-edit'} editing={modal === 'room-edit'} close={() => { setModal(''); setEditingLocationId(''); }} roomForm={roomForm} setRoomForm={setRoomForm} buildings={buildings} createRoom={createRoom} />
    <AssetUploadModal modal={modal === 'asset-upload'} close={() => setModal('')} file={assetUpload.pendingUpload} name={assetUpload.assetName} setName={assetUpload.setAssetName} modelId={assetUpload.uploadModelId} setModelId={assetUpload.setUploadModelId} face={assetUpload.uploadFace} setFace={assetUpload.setUploadFace} models={models} choose={assetUpload.chooseUpload} submit={assetUpload.submitUpload} busy={assetUpload.uploading} />
    <PortLayoutEditor modal={modal === 'layout'} close={() => setModal('')} layoutModel={portLayout.layoutModel} faces={portLayout.layoutFaces} setFaces={portLayout.setLayoutFaces} face={portLayout.layoutFace} setFace={portLayout.setLayoutFace} assets={assets} assetIds={portLayout.layoutAssetIds} setAssetId={portLayout.setLayoutAssetId} detect={(face) => void portLayout.detectLayout(face)} confirm={portLayout.confirmLayout} saving={portLayout.layoutSaving} error={portLayout.layoutError} />
    {tagEditorDevice && siteId && <TagEditor siteId={siteId} canCreate={canManageTags} itemLabel={tagEditorDevice.name} selected={tagEditorDevice.tags ?? []} save={async (tagIds) => { await setDeviceTags(tagEditorDevice.id, tagIds); void queryClient.invalidateQueries({ queryKey: ['infrastructure', 'devices', siteId] }); void queryClient.invalidateQueries({ queryKey: ['tags', siteId] }); void queryClient.invalidateQueries({ queryKey: ['device-360', tagEditorDevice.id] }); }} close={() => setTagEditorDevice(null)} />}
    {managingDeviceTags && siteId && <TagManager siteId={siteId} canManage={canManageTags} close={() => setManagingDeviceTags(false)} onChanged={() => void queryClient.invalidateQueries({ queryKey: ['infrastructure', 'devices', siteId] })} />}
    {retirementDeviceId && <RetirementReviewModal deviceId={retirementDeviceId} close={() => setRetirementDeviceId('')} retired={() => { setRetirementDeviceId(''); queryClient.invalidateQueries({ queryKey: ['infrastructure', 'devices', siteId] }); }} />}
  </div></AppShell></InfrastructureWorkspaceProvider>;
}
