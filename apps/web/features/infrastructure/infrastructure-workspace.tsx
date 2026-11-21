'use client';

import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { usePowerDefaults } from './use-power-defaults';
import { Boxes, CalendarDays, Edit3, HardDrive, KeyRound, Layers, MapPinned, Server, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { filterRackSearchItems, type RackSearchItem } from '@/components/layout/global-search';
import { useAuth } from '@/lib/auth';
import { useI18n } from '@/lib/i18n';
import { useSiteContext } from '@/lib/site-context';
import { rememberRecentItem } from '@/lib/recent-items';
import { apiFetch } from '@/lib/api/client';
import { ApiRequestError } from '@/lib/api/errors';
import type { Device, DeviceInterface, DeviceModel, IpAddress, Rack, RackFace, RackPlacementPlan, RoomWithBuilding } from './types';
import { emptyRackPower, pduSettings, rackPowerChanged, rackPowerDraft, rackPowerInput, type BuildingForm, type DeviceForm, type ModelForm, type RackForm } from './forms';
import type { DevicePowerInput, PowerConflictDetails, PowerConflictDevice } from './types';
import { connectionOutlets, devicePlugCount, withoutPduConnection } from './power';
import { DevicePowerStep } from './components/editors/device-power-step';
import type { RackEditDraft } from './types';
import type { InterfaceFormState } from './components/models/interface-editor';
import {
  createBuilding as apiCreateBuilding,
  updateBuilding as apiUpdateBuilding,
  createAsset,
  createRoom as apiCreateRoom,
  createRack as apiCreateRack,
  updateRack as apiUpdateRack,
  getRack,
  setRackPower,
  setDevicePower,
  disconnectPduDevice,
  updateRoom as apiUpdateRoom,
  deleteAsset as apiDeleteAsset,
  deleteRack as apiDeleteRack,
  detectDeviceModelPortLayout,
  generateInterfaces as apiGenerateInterfaces,
  getDevice,
  getDeviceModelPortLayoutFaces,
  getEffectiveAccess,
  getSiteLocations,
  getSiteRacks,
  listAssets,
  listDeviceModels,
  listDevices,
  listInterfaces,
  listVlansForSite,
  placeDevice as apiPlaceDevice,
  previewDevicePlacement,
  reorderRacks as apiReorderRacks,
  saveDeviceModelPortLayoutFaces,
  setDeviceModelFaceAsset,
} from './api';
import { expectedPortCount, naturalInterfaceCompare, primaryPortFace, readInfrastructureContext, writeInfrastructureContext } from './utils';
import { BuildingModal } from './components/sites/building-modal';
import { RoomModal } from './components/sites/room-modal';
import { RackWorkspace } from './components/rack/rack-workspace';
import { DeviceList } from './components/devices/device-list';
import { CrossSiteMissingConfigList } from './components/devices/cross-site-missing-config-list';
import { RetirementReviewModal } from './components/devices/retirement-review-modal';
import { DeepLinkDeviceLoader } from './components/devices/deep-link-device-loader';
import { ModelList } from './components/models/model-list';
import { InterfaceWorkspace } from './components/models/interface-workspace';
import { InterfaceEditor } from './components/models/interface-editor';
import { buildFacesSave, EMPTY_FACE_LAYOUT, PortLayoutEditor, type PortLayoutAssetsDraft, type PortLayoutFacesDraft } from './components/models/port-layout-editor';
import { AssetList } from './components/assets/asset-list';
import { AssetUploadModal } from './components/assets/asset-upload-modal';
import { EntityEditor } from './components/editors/entity-editor';
import { mapApiFieldErrors, missingConfigAllSitesFromSearch, missingConfigFromSearch, settingsTabFromSearch, useRequiredConfigRegistry, type DeviceEditorTab, type MappedFieldError } from './device-requirements';
import { InfrastructurePermissions } from './components/infrastructure-permissions';
import { SiteCapacityOutlook } from './components/sites/capacity-outlook';
import { LinuxHosts } from './components/linux-hosts';
import hostStyles from './components/linux-hosts.module.css';
import { LifecycleDates } from './components/lifecycle-dates';
import { useConfirm } from '@/components/ui/confirm-dialog';
import { clearDeviceUrlFilters, deviceFilterLabels, emptyDeviceUrlFilters, hasDeviceUrlFilters, readDeviceUrlFilters, type DeviceUrlFilters } from './device-filters';

const EMPTY_IPS: IpAddress[] = [];

const emptyDeviceForm: DeviceForm = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', isCritical: false, frontAssetId: '', backAssetId: '', snmpEnabled: false, snmpVersion: 'V3', snmpReadUsername: '', snmpReadCommunity: '', snmpReadAuthKey: '', snmpReadPrivKey: '', snmpTrapEnabled: false, snmpTrapUsername: '', snmpTrapCommunity: '', snmpTrapAuthKey: '', snmpTrapPrivKey: '', snmpAuthProtocol: 'SHA256', snmpPrivProtocol: 'AES128', snmpCompatibilitySha1: false, snmpPort: '161', snmpIntervalMinutes: '15', snmpTimeoutMs: '5000', snmpRetries: '2' };
const emptyModelForm: ModelForm = { manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '', backAssetId: '' };
const modelFormFrom = (model: DeviceModel): ModelForm => ({ manufacturer: model.manufacturer, model: model.model, type: model.type ?? 'OTHER', supportsNetworkPorts: !!model.supportsNetworkPorts, networkPortCount: String(model.networkPortCount ?? ''), frontAssetId: model.frontAssetId ?? model.frontAsset?.id ?? '', backAssetId: model.backAssetId ?? model.backAsset?.id ?? '' });
const emptyInterfaceForm: InterfaceFormState = { id: '', name: '', portKey: '', interfaceType: 'ETHERNET', description: '', adminUp: true, operUp: false, speedMbps: '', mode: 'ACCESS', accessVlanId: '', nativeVlanId: '', allowedVlanIds: [], macAddress: '' };

export function InfrastructureWorkspace() {
  const { confirm: askConfirm, confirmDialog } = useConfirm();
  const queryClient = useQueryClient();
  // Power defaults come from the API only; fetched once here so the rack form is prefilled when it opens.
  const powerDefaults = usePowerDefaults();
  const { t } = useI18n();
  const { hasRole, user } = useAuth();
  const { siteId, activeSite, sites } = useSiteContext();
  const canReadHosts = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR') || hasRole('AUDITOR') || hasRole('READ_ONLY');
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');

  const [tab, setTab] = useState('racks');
  const [deviceFilters, setDeviceFilters] = useState<DeviceUrlFilters>(emptyDeviceUrlFilters);
  // `?tab=devices` (and drill-through filters) open the Equipamentos list directly.
  useEffect(() => {
    const filters = readDeviceUrlFilters(window.location.search);
    setDeviceFilters(filters);
    const requestedTab = new URLSearchParams(window.location.search).get('tab');
    if (requestedTab === 'hosts') setTab('hosts');
    else if (requestedTab === 'devices' || hasDeviceUrlFilters(filters)) setTab('devices');
    else if (requestedTab === 'sites') setTab('sites');
    const restoreHostsTab = () => {
      const next = new URLSearchParams(window.location.search).get('tab');
      setTab((current) => next === 'hosts' ? 'hosts' : current === 'hosts' ? (next === 'devices' ? 'devices' : next === 'sites' ? 'sites' : 'racks') : current);
    };
    window.addEventListener('popstate', restoreHostsTab);
    return () => window.removeEventListener('popstate', restoreHostsTab);
  }, []);
  const clearDeviceFilters = () => {
    setDeviceFilters(emptyDeviceUrlFilters);
    history.replaceState(history.state, '', `${location.pathname}${clearDeviceUrlFilters(location.search)}${location.hash}`);
  };
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
  /** ?missingConfig=rearImage|power (bell alert link): the device list shows only devices missing that config. */
  const [missingConfig, setMissingConfig] = useState('');
  /** `allSites=1` (or a missingConfig link without siteId): cross-site list, not narrowed to the active Site. */
  const [missingConfigAllSites, setMissingConfigAllSites] = useState(false);
  useEffect(() => {
    if (new URLSearchParams(window.location.search).get('tab') === 'lifecycle') setTab('lifecycle');
  }, []);
  const requiredConfigRegistry = useRequiredConfigRegistry();
  const missingConfigLabel = requiredConfigRegistry?.configs?.find((config) => config.key === missingConfig)?.label ?? missingConfig;
  useEffect(() => {
    const requested = missingConfigFromSearch(window.location.search);
    if (!requested || new URLSearchParams(window.location.search).get('tab') === 'hosts') return;
    setMissingConfig(requested);
    setMissingConfigAllSites(missingConfigAllSitesFromSearch(window.location.search));
    setTab('devices');
  }, []);
  const clearMissingConfig = () => {
    setMissingConfig('');
    setMissingConfigAllSites(false);
    const query = new URLSearchParams(window.location.search);
    query.delete('missingConfig');
    query.delete('allSites');
    if (!query.get('siteId') && siteId) query.set('siteId', siteId);
    history.replaceState({}, '', `/infraestrutura?${query.toString()}`);
  };
  useEffect(() => { setFormError(''); setDeviceFieldErrors([]); }, [modal]);
  const [deletingRackId, setDeletingRackId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [assetName, setAssetName] = useState('');
  const [uploadModelId, setUploadModelId] = useState('');
  const [uploadFace, setUploadFace] = useState<RackFace>('front');
  const [buildingForm, setBuildingForm] = useState<BuildingForm>({ name: '', description: '' });
  const [roomForm, setRoomForm] = useState({ name: '', buildingId: '' });
  const [editingLocationId, setEditingLocationId] = useState('');
  const [rackForm, setRackForm] = useState<RackForm>({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  /** Power step after placing a device in a rack (or from "Ligações elétricas"). */
  const [powerStep, setPowerStep] = useState<{ device: { id: string; name: string }; rack: Rack; plugs: number; moved: boolean } | null>(null);
  const [powerStepError, setPowerStepError] = useState('');
  /** Devices that stopped the last rack power save (409 from the API). */
  const [rackPowerConflict, setRackPowerConflict] = useState<{ kind: 'ups' | 'outlets'; devices: PowerConflictDevice[] } | null>(null);
  const [disconnectingUps, setDisconnectingUps] = useState(false);
  useEffect(() => { setRackPowerConflict(null); }, [modal]);
  /** Rack of the device being edited when its form opened, to tell whether a save moved it. */
  const editingDeviceRackId = useRef('');
  const [deviceForm, setDeviceForm] = useState<DeviceForm>(emptyDeviceForm);
  const [interfaceForm, setInterfaceForm] = useState<InterfaceFormState>(emptyInterfaceForm);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModelForm);
  const [layoutModel, setLayoutModel] = useState<DeviceModel | null>(null);
  const [layoutFaces, setLayoutFaces] = useState<PortLayoutFacesDraft | null>(null);
  const [layoutFace, setLayoutFace] = useState<RackFace>('rear');
  const [layoutAssetIds, setLayoutAssetIds] = useState<PortLayoutAssetsDraft>({ front: '', rear: '' });
  const savedLayoutFaces = useRef('');
  const layoutRevision = useRef('');
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const clickRef = useRef({ key: '', at: 0 });

  // ── Server state (React Query) ───────────────────────────────────────────

  const { data: accessData, error: accessError, isFetching: fetchingAccess } = useQuery({
    queryKey: ['access', 'effective', siteId],
    queryFn: () => getEffectiveAccess(siteId),
    enabled: Boolean(siteId),
  });
  const { data: locationsData, error: locationsError, isFetching: fetchingLocations } = useQuery({
    queryKey: ['infrastructure', 'locations', siteId],
    queryFn: () => getSiteLocations(siteId),
    enabled: Boolean(siteId),
  });
  const { data: racksData, error: racksError, isFetching: fetchingRacks } = useQuery({
    queryKey: ['infrastructure', 'racks', siteId],
    queryFn: () => getSiteRacks(siteId),
    enabled: Boolean(siteId),
  });
  const canUseCatalog = Boolean(accessData?.tabs?.models || accessData?.tabs?.assets);
  const canUseInterfaces = Boolean(accessData?.tabs?.interfaces);
  const { data: modelsData, error: modelsError } = useQuery({
    queryKey: ['infrastructure', 'device-models'],
    queryFn: listDeviceModels,
    enabled: Boolean(siteId) && canUseCatalog,
  });
  const { data: assetsData, error: assetsError } = useQuery({
    queryKey: ['infrastructure', 'assets'],
    queryFn: listAssets,
    enabled: Boolean(siteId) && canUseCatalog,
  });
  const { data: vlansData, error: vlansError } = useQuery({
    queryKey: ['infrastructure', 'vlans', siteId],
    queryFn: () => listVlansForSite(siteId),
    enabled: Boolean(siteId) && canUseInterfaces,
  });
  // Drill-through filters (dashboard links) apply to the Equipamentos tab only.
  const activeDeviceFilters = tab === 'devices' && hasDeviceUrlFilters(deviceFilters) ? deviceFilters : null;
  const { data: devicesData, error: devicesError } = useQuery({
    queryKey: ['infrastructure', 'devices', siteId, tab === 'devices' ? debouncedSearch : '', missingConfigAllSites ? '' : missingConfig, activeDeviceFilters],
    queryFn: () => listDevices(siteId, tab === 'devices' ? debouncedSearch : '', 1, { ...(activeDeviceFilters ?? {}), missingConfig: missingConfigAllSites ? '' : missingConfig }),
    enabled: Boolean(siteId),
  });
  const deepLinkQuery = typeof window === 'undefined' ? null : new URLSearchParams(window.location.search);
  // ?focus=device&deviceId=… or the alert link ?tab=devices&deviceId=…&settingsTab=… opens the device's settings.
  const deepLinkedDeviceId = deepLinkQuery?.get('focus') === 'device' || deepLinkQuery?.get('settingsTab') ? deepLinkQuery.get('deviceId') : null;
  const deviceId = device?.id ?? '';
  const { data: interfacesData } = useQuery({
    queryKey: ['infrastructure', 'interfaces', deviceId],
    queryFn: () => listInterfaces(deviceId),
    enabled: Boolean(deviceId),
    select: (data) => [...data].sort(naturalInterfaceCompare),
  });
  useEffect(() => {
    const requested = new URLSearchParams(location.search).get('interfaceId');
    if (!requested || !interfacesData) return;
    const target = interfacesData.find((item) => item.id === requested);
    if (target) setSelectedInterface(target);
  }, [interfacesData]);

  // Debounced device search (matches the original 250ms delay).
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const busy = fetchingAccess || fetchingLocations || fetchingRacks;
  const queryError = [accessError, locationsError, racksError, modelsError, assetsError, vlansError, devicesError].find(Boolean);
  const errorMessage = queryError instanceof Error ? queryError.message : '';

  const locations = locationsData ?? [];
  const racks = racksData ?? [];
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
    if (query.get('tab') === 'hosts') return;
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
  }, [siteId, locationsData, racksData, devicesData, canUseInterfaces]);

  useEffect(() => {
    const openUpload = () => { setPendingUpload(null); setAssetName(''); setUploadModelId(''); setUploadFace('front'); setModal('asset-upload'); };
    const openModel = () => { setEditingId(''); setModelForm({ manufacturer: '', model: '', type: 'OTHER', supportsNetworkPorts: false, networkPortCount: '', frontAssetId: '', backAssetId: '' }); setModal('model'); };
    window.addEventListener('asset-upload-request', openUpload);
    window.addEventListener('model-create-request', openModel);
    return () => {
      window.removeEventListener('asset-upload-request', openUpload);
      window.removeEventListener('model-create-request', openModel);
    };
  }, []);

  // ── Derived view state ───────────────────────────────────────────────────

  const buildings = locations;
  const rooms = useMemo(() => buildingId ? locations.filter((item) => item.id === buildingId).flatMap((building) => (building.rooms ?? []).map((room): RoomWithBuilding => ({ ...room, building }))) : [], [locations, buildingId]);
  const selectedRack = racks.find((item) => item.id === rackId);
  const normalizedSearch = search.trim().toLowerCase();
  const matches = (...values: unknown[]) => !normalizedSearch || values.join(' ').toLowerCase().includes(normalizedSearch);
  const allRoomRacks = racks.filter((item) => (item.room?.id ?? item.roomId) === roomId);
  const roomRacks = filterRackSearchItems(allRoomRacks, search);
  const visibleModels = models.filter((model) => matches(model.manufacturer, model.model, model.type));
  const visibleAssets = assets.filter((asset) => matches(asset.filename, asset.kind, asset.mimeType));
  const visibleInterfaces = interfaces.filter((item) => matches(item.name, item.portKey, item.description, item.macAddress));

  const effective = accessData;
  const scopeActions = roomId
    ? effective?.infrastructure?.rooms?.find((item) => item.id === roomId)?.actions ?? []
    : buildingId
      ? effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []
      : effective?.infrastructure?.site ?? [];
  const canEdit = (roomId ? roleCanEdit : hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && scopeActions.some((action) => action !== 'READ');
  const canUpdateDevice = roleCanEdit && scopeActions.includes('UPDATE');
  const canReorderRacks = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(roomId) && scopeActions.includes('UPDATE');
  const canCreateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && (effective?.infrastructure?.site ?? []).includes('CREATE');
  const canCreateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []).includes('CREATE');
  const canUpdateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []).includes('UPDATE');
  const canUpdateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(roomId) && (effective?.infrastructure?.rooms?.find((item) => item.id === roomId)?.actions ?? []).includes('UPDATE');

  const invalidateInfrastructure = () => queryClient.invalidateQueries({ queryKey: ['infrastructure'] });

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
    rememberRecentItem(user?.id, { id: `device:${selected.id}`, kind: 'Equipamento', label: selected.name, href: `/infraestrutura?siteId=${encodeURIComponent(siteId)}&deviceId=${encodeURIComponent(selected.id)}` });
    setDevice(selected);
    setTab(canUseInterfaces ? 'interfaces' : 'devices');
    setSelectedInterface(null);
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&tab=${canUseInterfaces ? 'interfaces' : 'devices'}&deviceId=${selected.id}`);
  }, [user?.id, siteId, canUseInterfaces]);
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
  }, [siteId, editDevice]);
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

  // ── Rack power ────────────────────────────────────────────────────────────

  /** PDU writes (rack power, device outlets, Desligar) are ADMIN / SYSTEMS_OPERATOR, like rack edits. */
  const canEditPower = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && scopeActions.some((action) => action !== 'READ');

  /**
   * Opens the power step for a device that was just placed in a rack: new in the rack, or moved from another rack (the
   * API removed its old outlets). Skipped for devices with 0 plugs and for users who cannot change power. `force` opens it
   * for a device already in its rack ("Ligações elétricas").
   */
  const offerPowerStep = async (saved: Pick<Device, 'id' | 'name' | 'rackId'> & Partial<Device>, previousRackId: string, force = false) => {
    if (!canEditPower || !saved.rackId) return;
    const moved = Boolean(previousRackId) && previousRackId !== saved.rackId;
    if (!force && previousRackId === saved.rackId) return;
    try {
      const rack = await getRack(saved.rackId);
      if (!rack.pdus?.length) return;
      const inRack = rack.devices?.find((item) => item.id === saved.id);
      const plugs = devicePlugCount({ ...saved, ...inRack } as Device, powerDefaults) ?? 0;
      if (plugs === 0 && !force) return;
      setPowerStepError('');
      setPowerStep({ device: { id: saved.id, name: inRack?.name ?? saved.name }, rack, plugs, moved });
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : t('power.error.open'));
    }
  };
  const savePowerStep = async (input: DevicePowerInput) => {
    if (!powerStep) return;
    setPowerStepError('');
    try {
      await setDevicePower(powerStep.device.id, input);
      setPowerStep(null);
      await invalidateInfrastructure();
    } catch (cause) {
      setPowerStepError(cause instanceof Error ? cause.message : t('power.error.save'));
    }
  };

  /** "Desligar" from a PDU card: the badge drops at once, then the API answer (or a refetch on error) settles it. */
  const disconnectPdu = async (targetRackId: string, pduId: string, deviceId: string) => {
    const racksKey = ['infrastructure', 'racks', siteId];
    await queryClient.cancelQueries({ queryKey: racksKey });
    queryClient.setQueryData<Rack[]>(racksKey, (current) => current?.map((rack) => (rack.id === targetRackId ? withoutPduConnection(rack, pduId, deviceId) : rack)));
    try {
      await disconnectPduDevice(targetRackId, pduId, deviceId);
    } finally {
      await invalidateInfrastructure();
    }
  };

  /** UPS connections that stop "Só rede elétrica" on the rack being edited (checked before the API says 409). */
  const editedRack = modal === 'rack' && editingId ? racks.find((rack) => rack.id === editingId) : undefined;
  const upsDevices = (editedRack?.pdus ?? []).filter((pdu) => pdu.source === 'UPS').flatMap((pdu) => (pdu.connections ?? []).map((connection) => ({ deviceId: connection.deviceId, deviceName: connection.deviceName, outlets: connectionOutlets(connection).map((outlet) => outlet.outletIndex) })));
  const localUpsBlock = rackForm.power?.mode === 'SUPPLIER_ONLY' && upsDevices.length ? { kind: 'ups' as const, devices: upsDevices } : null;
  const rackPowerBlocked = rackPowerConflict ?? localUpsBlock;

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
  const previewPlacement = async (deviceId: string, targetRackId: string, rackUnitStart: number): Promise<RackPlacementPlan> => {
    try {
      setError('');
      return await previewDevicePlacement(deviceId, { rackId: targetRackId, rackUnitStart });
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível pré-visualizar a posição do equipamento.';
      setError(message);
      throw cause;
    }
  };
  const placeDevice = async (deviceId: string, targetRackId: string, rackUnitStart: number) => {
    try {
      setError('');
      const placed = racks.flatMap((rack) => rack.devices ?? []).find((item) => item.id === deviceId);
      const result = await apiPlaceDevice(deviceId, { rackId: targetRackId, rackUnitStart });
      await invalidateInfrastructure();
      // Moved to another rack: its outlets were released, so offer the power step for the new rack.
      if (placed && placed.rackId !== targetRackId) void offerPowerStep({ ...placed, rackId: targetRackId }, placed.rackId ?? '');
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível atualizar a localização do equipamento.';
      setError(message);
      throw cause;
    }
  };
  const reorderRacks = async (targetRoomId: string, rackIds: string[]) => {
    try {
      setError('');
      await apiReorderRacks(targetRoomId, rackIds);
      await invalidateInfrastructure();
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível guardar a ordem dos bastidores.';
      setError(message);
      throw cause;
    }
  };
  const deleteRack = async (rack: Rack) => {
    if (!(await askConfirm({ message: `Eliminar o bastidor “${rack.name}”? Os bastidores seguintes serão deslocados uma posição para a esquerda.`, destructive: true }))) return;
    setDeletingRackId(rack.id);
    setError('');
    try {
      await apiDeleteRack(rack.id);
      setRackId('');
      const url = new URL(location.href);
      url.searchParams.delete('rackId');
      history.replaceState({}, '', `${url.pathname}${url.search}`);
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar o bastidor.');
    } finally {
      setDeletingRackId('');
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
  const selectTab = (key: string) => {
    if (key === 'hosts' || tab === 'hosts') {
      const url = new URL(window.location.href);
      if (key === 'hosts') {
        ['deviceId', 'focus', 'settingsTab', 'buildingId', 'roomId', 'rackId', 'interfaceId', 'missingConfig', 'allSites'].forEach((param) => url.searchParams.delete(param));
        url.searchParams.set('tab', 'hosts');
      } else {
        if (key === 'devices') url.searchParams.set('tab', 'devices');
        else url.searchParams.delete('tab');
        ['hosts-site', 'hosts-state'].forEach((param) => url.searchParams.delete(param));
      }
      window.history.replaceState(null, '', url);
    }
    const now = Date.now();
    const double = tab === key && clickRef.current.key === key && now - clickRef.current.at < 500;
    clickRef.current = { key, at: now };
    setSearch('');
    if (double) {
      reset();
      setTab(key);
      clickRef.current = { key: '', at: 0 };
    } else setTab(key);
    if (key === 'sites' || tab === 'sites') {
      const url = new URL(window.location.href);
      if (key === 'sites') url.searchParams.set('tab', 'sites');
      else url.searchParams.delete('tab');
      history.replaceState(history.state, '', `${url.pathname}${url.search}`);
    }
  };
  const newDevice = () => {
    setEditingId('');
    setAnimateDeviceEdit(false);
    setDeviceEditorTab(undefined);
    setDeviceForm(emptyDeviceForm);
    editingDeviceRackId.current = '';
    setModal('device');
  };
  const openLayout = useCallback(async (model: DeviceModel | null) => {
    if (!model) return;
    setLayoutError('');
    const { response, faces } = await getDeviceModelPortLayoutFaces(model.id);
    layoutRevision.current = response.revision ?? '';
    const draft: PortLayoutFacesDraft = { front: faces.front ?? { ...EMPTY_FACE_LAYOUT }, rear: faces.rear ?? { ...EMPTY_FACE_LAYOUT } };
    savedLayoutFaces.current = JSON.stringify(draft);
    setLayoutModel(model);
    setLayoutFaces(draft);
    setLayoutAssetIds({ front: model.frontAssetId ?? model.frontAsset?.id ?? '', rear: model.backAssetId ?? model.backAsset?.id ?? '' });
    // Open on the face that already has ports; the rear when neither has.
    setLayoutFace(primaryPortFace({ portLayout: { version: 2, faces } }));
    setModal('layout');
  }, []);
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
  }, [modelsData, openLayout]);
  const detectLayout = async (face: RackFace) => {
    if (!layoutModel || !layoutFaces) return;
    const current = layoutFaces[face];
    const other = layoutFaces[face === 'front' ? 'rear' : 'front'];
    const expected = expectedPortCount(layoutModel);
    try {
      const proposal = await detectDeviceModelPortLayout(layoutModel.id, {
        assetId: layoutAssetIds[face],
        // Ports already mapped on the other face are not proposed again.
        portCount: Math.max(0, expected - other.ports.length) || expected || null,
        imageWidth: current.imageWidth,
        imageHeight: current.imageHeight,
      }, face);
      setLayoutFaces({ ...layoutFaces, [face]: { ...current, ...proposal, ports: Array.isArray(proposal?.ports) ? proposal.ports : [] } });
    } catch (cause) {
      setLayoutError(cause instanceof Error ? cause.message : 'A deteção falhou.');
    }
  };
  const confirmLayout = async () => {
    if (!layoutModel || !layoutFaces) return;
    setLayoutSaving(true);
    setLayoutError('');
    try {
      const saved = JSON.parse(savedLayoutFaces.current || '{}') as Partial<PortLayoutFacesDraft>;
      const initialAssets = { front: layoutModel.frontAssetId ?? layoutModel.frontAsset?.id ?? '', rear: layoutModel.backAssetId ?? layoutModel.backAsset?.id ?? '' };
      // One transactional PUT for both faces, guarded by the revision read when the editor opened.
      const faces = buildFacesSave(saved, layoutFaces, initialAssets, layoutAssetIds, new Date().toISOString());
      if (faces) {
        const result = await saveDeviceModelPortLayoutFaces(layoutModel.id, { revision: layoutRevision.current, faces });
        layoutRevision.current = result.revision ?? '';
        savedLayoutFaces.current = JSON.stringify(layoutFaces);
      }
      setModal('');
      setLayoutFaces(null);
      await invalidateInfrastructure();
    } catch (cause) {
      setLayoutError(cause instanceof ApiRequestError && cause.code === 'PORT_LAYOUT_CONFLICT' ? 'Alterado por outra pessoa — recarrega' : cause instanceof Error ? cause.message : 'Não foi possível guardar o template.');
    } finally {
      setLayoutSaving(false);
    }
  };
  const generateInterfaces = async () => {
    if (device) {
      await apiGenerateInterfaces(device.id);
      openDevice(device);
    }
  };
  const submitUpload = async () => {
    if (!pendingUpload || !assetName.trim() || !uploadModelId) return;
    setUploading(true);
    try {
      const reader = new FileReader();
      const contentBase64 = await new Promise<string>((resolve, reject) => {
        reader.onload = () => resolve(String(reader.result));
        reader.onerror = reject;
        reader.readAsDataURL(pendingUpload);
      });
      const asset = await createAsset({ filename: assetName.trim(), mimeType: pendingUpload.type, kind: 'INFRASTRUCTURE', contentBase64 });
      await setDeviceModelFaceAsset(uploadModelId, uploadFace, asset.id);
      setModal('');
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Upload falhou.');
    } finally {
      setUploading(false);
    }
  };
  const chooseUpload = (event: React.ChangeEvent<HTMLInputElement> | React.DragEvent) => {
    const transfer = 'dataTransfer' in event ? event.dataTransfer : null;
    const file = transfer?.files?.[0] ?? (event as React.ChangeEvent<HTMLInputElement>).target.files?.[0];
    if ('target' in event && (event.target as HTMLInputElement)?.type === 'file') (event.target as HTMLInputElement).value = '';
    if (!file) return;
    setPendingUpload(file);
    setAssetName((current) => current.trim() || file.name);
  };
  const deleteAsset = async (asset: { id: string; filename: string }) => {
    if (!(await askConfirm({ message: `Eliminar o asset “${asset.filename}”? As associações visuais serão removidas.`, destructive: true }))) return;
    try {
      await apiDeleteAsset(asset.id);
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar o asset.');
    }
  };


  const canDeleteRack = hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR');
  const modalForEditor = modal === 'room' || modal === 'building' ? '' : modal;
  const tabName = ({ racks: 'Bastidores', devices: 'Equipamentos', models: 'Modelos', interfaces: 'Interfaces', assets: 'Assets', lifecycle: 'Ciclo de vida', permissions: 'Permissões' } as Record<string, string>)[tab] ?? tab;
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
  const visibleTabs: [string, string, LucideIcon][] = [['sites', 'Sites', MapPinned], ['racks', 'Bastidores', MapPinned], ['devices', 'Equipamentos', Server], ...(canReadHosts ? [['hosts', t('linuxHosts.title'), Server] as [string, string, LucideIcon]] : []), ['lifecycle', 'Ciclo de vida', CalendarDays], ...(effective?.tabs?.models ? [['models', 'Modelos', Boxes] as [string, string, LucideIcon]] : []), ...(effective?.tabs?.interfaces ? [['interfaces', 'Interfaces', Layers] as [string, string, LucideIcon]] : []), ...(effective?.tabs?.assets ? [['assets', 'Assets', HardDrive] as [string, string, LucideIcon]] : []), ...(effective?.tabs?.permissions ? [['permissions', 'Permissões', KeyRound] as [string, string, LucideIcon]] : [])];
  const tabNavigation = <nav className={`infra-menu infrastructure-tabs ${hostStyles.tabNavigation}`} aria-label="Infraestrutura">{visibleTabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} aria-current={tab === key ? 'page' : undefined} onClick={() => selectTab(key)}><Icon size={15} /><span>{label}</span></button>)}</nav>;
  if (!siteId && !(tab === 'hosts' && canReadHosts)) return <AppShell section="Infraestrutura" moduleTabs={canReadHosts ? tabNavigation : undefined}><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Seleciona um Site no seletor superior para começar.</p></div></header>{deepLinkedDeviceId ? <><DeepLinkDeviceLoader deviceId={deepLinkedDeviceId} loadDevice={getDevice} onOpen={openDeepLinkedDevice} onError={reportDeepLinkError} /><section className="ipam-card empty-context"><MapPinned size={28} /><strong>{device ? `${device.name} · ${device.type}` : error || 'A carregar equipamento…'}</strong><p>O equipamento está sem Site. Seleciona um Site no seletor superior para associá-lo e guardar alterações.</p></section><EntityEditor modal={modal} close={() => setModal('')} editingId={editingId} animateDeviceEntry={animateDeviceEdit} form={{ rack: rackForm, device: deviceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, model: setModelForm }} rooms={[]} racks={[]} models={[]} assets={[]} ips={EMPTY_IPS} save={save} formError={formError} deviceFieldErrors={deviceFieldErrors} deviceTab={deviceEditorTab} /></> : <section className="ipam-card empty-context"><MapPinned size={28} /><strong>Seleciona um Site no seletor superior</strong></section>}</main></AppShell>;
  const locationControls = <section className="infra-context-bar" aria-label="Localização">
    <div className="location-control-group">
      <label><MapPinned size={15} /><span>Edifício</span><select aria-label="Edifício" value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}><option value="">Seleciona um edifício</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateBuilding && <option value="__new__">Criar novo Edifício</option>}</select></label>
      {canUpdateBuilding && <button type="button" className="secondary-button compact-button" aria-label="Editar edifício" onClick={() => { const building = buildings.find((item) => item.id === buildingId); if (!building) return; setEditingLocationId(building.id); setBuildingForm({ name: building.name, description: building.description ?? '' }); setModal('building-edit'); }}><Edit3 size={14} /></button>}
    </div>
    <div className="location-control-group">
      <label><MapPinned size={15} /><span>Sala</span><select aria-label="Sala" value={roomId} onChange={(event) => chooseRoom(event.target.value)}><option value="">Seleciona uma sala</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateRoom && <option value="__new__">Criar nova Sala</option>}</select></label>
      {canUpdateRoom && <button type="button" className="secondary-button compact-button" aria-label="Editar sala" onClick={() => { const room = rooms.find((item) => item.id === roomId); if (!room) return; setEditingLocationId(room.id); setRoomForm({ name: room.name, buildingId: room.buildingId }); setModal('room-edit'); }}><Edit3 size={14} /></button>}
    </div>
    {busy && <span className="infra-loading-status" role="status">A carregar…</span>}
  </section>;

  if (tab === 'hosts' && canReadHosts) return <AppShell section="Mapa físico" toolbarKey={tab} moduleTabs={tabNavigation}>
    <LinuxHosts sites={sites} canManage={hasRole('ADMIN')} canAudit={hasRole('ADMIN') || hasRole('AUDITOR')} />
  </AppShell>;
  if (tab === 'permissions' && effective?.tabs?.permissions) return <AppShell section="Mapa físico" toolbarKey={tab} moduleTabs={tabNavigation}><main className="module-page infrastructure-workspace"><h1 className="topology-sr-only">Mapa físico</h1><InfrastructurePermissions siteId={siteId} buildings={buildings} /></main></AppShell>;

  return <>{confirmDialog}<AppShell section="Mapa físico" toolbarKey={tab} moduleTabs={tabNavigation} search={tab === 'racks' || tab === 'sites' ? undefined : { value: search, onChange: setSearch, placeholder: `Pesquisar em ${tabName.toLowerCase()}…`, scopeLabel: tabName }} rackSearch={rackSearchContext} toolbar={tab === 'sites' ? undefined : locationControls}><DeepLinkDeviceLoader deviceId={deepLinkedDeviceId} loadDevice={getDevice} onOpen={openDeepLinkedDevice} onError={reportDeepLinkError} /><main className="module-page infrastructure-workspace"><h1 className="topology-sr-only">Mapa físico</h1>{(error || errorMessage) && <div className="ipam-alert error"><X size={15} />{error || errorMessage}</div>}{tab === 'sites' && <SiteCapacityOutlook key={siteId} siteId={siteId} siteName={activeSite?.name ?? 'Site'} />}{tab === 'racks' && <RackWorkspace rooms={rooms} roomId={roomId} buildingId={buildingId} racks={roomRacks} allRoomRacks={allRoomRacks} selected={selectedRack} setRack={(rack: Rack) => { if (rack.room) setRoomId(rack.room.id); setRackId(rack.id); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${rack.room?.building?.id ?? buildingId}&roomId=${rack.room?.id ?? roomId}&rackId=${rack.id}`); }} onOut={() => setRackId('')} onDevice={openDevice} onEdit={(rack: RackEditDraft) => { const power = rackPowerDraft(rack.id ? rack : null, powerDefaults); setEditingId(rack.id ?? ''); setRackForm({ name: rack.name ?? '', units: String(rack.units ?? 42), roomId: rack.room?.id ?? rack.roomId ?? roomId, modelId: rack.modelId ?? rack.model?.id ?? '', frontAssetId: rack.frontAssetId ?? rack.frontAsset?.id ?? '', power, savedPower: power }); setModal('rack'); }} onDelete={canDeleteRack && scopeActions.includes('DELETE') ? deleteRack : undefined} deletingRackId={deletingRackId} canEdit={canEdit} onPreviewPlacement={previewPlacement} onPlaceDevice={placeDevice} onReorderRacks={reorderRacks} canReorderRacks={canReorderRacks} onEditDevice={editDevice} canEditPower={canEditPower} onDisconnectPdu={disconnectPdu} />} {tab === 'devices' && activeDeviceFilters && <p className="ipam-scope-note" role="status">Filtros aplicados: <strong>{deviceFilterLabels(activeDeviceFilters).join(' · ')}</strong> <button type="button" className="text-button" onClick={clearDeviceFilters}><X size={12} /> Limpar filtros</button></p>}{tab === 'devices' && missingConfig && <div className="device-filter-chips" role="group" aria-label="Filtros da lista"><span className="device-filter-chip">Configuração em falta: {missingConfigLabel}{missingConfigAllSites ? ' · todos os Sites' : ''}<button type="button" onClick={clearMissingConfig} aria-label="Remover filtro de configuração em falta"><X size={12} aria-hidden="true" /></button></span></div>}{tab === 'devices' && missingConfig && missingConfigAllSites && <CrossSiteMissingConfigList config={missingConfig} label={missingConfigLabel} />}{tab === 'devices' && !(missingConfig && missingConfigAllSites) && <DeviceList devices={devices} search={search} onSelect={openDevice} onEdit={editDevice} onNew={newDevice} onRetire={(item) => setRetirementDeviceId(item.id)} canRetire={roleCanEdit && scopeActions.includes('DELETE')} canEdit={canEdit} selectedId={device?.id} />} {tab === 'lifecycle' && <LifecycleDates siteId={siteId} devices={devices} canEdit={canUpdateDevice} />} {tab === 'models' && effective?.tabs?.models && <ModelList models={visibleModels} onEdit={(model) => { setEditingId(model.id); setModelForm(modelFormFrom(model)); setModal('model'); }} onLayout={openLayout} canEdit={roleCanEdit} />} {tab === 'assets' && effective?.tabs?.assets && <AssetList assets={visibleAssets} onDelete={deleteAsset} canEdit={roleCanEdit} canDelete={roleCanEdit} />} {tab === 'interfaces' && effective?.tabs?.interfaces && <InterfaceWorkspace devices={devices} selected={device} interfaces={visibleInterfaces} selectedInterface={selectedInterface} onDevice={openDevice} onInterface={editInterface} onGenerate={generateInterfaces} onEditDevice={() => device && editDevice(device)} />}<EntityEditor modal={modalForEditor} close={() => setModal('')} editingId={editingId} animateDeviceEntry={animateDeviceEdit} form={{ rack: rackForm, device: deviceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, model: setModelForm }} rooms={rooms} racks={racks} models={models} assets={assets} ips={EMPTY_IPS} save={save} formError={formError} deviceFieldErrors={deviceFieldErrors} deviceTab={deviceEditorTab} saveRack={() => saveRack()} rackPower={{ blocked: rackPowerBlocked, onDisconnectAllUps: canEditPower ? () => void disconnectAllUps() : undefined, disconnecting: disconnectingUps }} onDevicePower={canEditPower && editingId ? () => void offerPowerStep({ id: editingId, name: deviceForm.name, rackId: deviceForm.rackId, powerPlugCount: deviceForm.powerPlugCount ? Number(deviceForm.powerPlugCount) : null, model: models.find((item) => item.id === deviceForm.modelId) ?? null }, deviceForm.rackId, true) : undefined} />{powerStep && <DevicePowerStep key={`${powerStep.device.id}:${powerStep.rack.id}`} device={powerStep.device} plugs={powerStep.plugs} rack={powerStep.rack} moved={powerStep.moved} onSave={savePowerStep} onSkip={() => setPowerStep(null)} error={powerStepError} />}{modal === 'interface' && <InterfaceEditor modal={modal} close={() => setModal('')} form={{ interface: interfaceForm }} setForm={{ interface: setInterfaceForm }} vlans={vlans} save={save} formError={formError} />}<BuildingModal modal={modal === 'building' || modal === 'building-edit'} editing={modal === 'building-edit'} close={() => { setModal(''); setEditingLocationId(''); }} buildingForm={buildingForm} setBuildingForm={setBuildingForm} createBuilding={createBuilding} /><RoomModal modal={modal === 'room' || modal === 'room-edit'} editing={modal === 'room-edit'} close={() => { setModal(''); setEditingLocationId(''); }} roomForm={roomForm} setRoomForm={setRoomForm} buildings={buildings} createRoom={createRoom} /><AssetUploadModal modal={modal === 'asset-upload'} close={() => setModal('')} file={pendingUpload} name={assetName} setName={setAssetName} modelId={uploadModelId} setModelId={setUploadModelId} face={uploadFace} setFace={setUploadFace} models={models} choose={chooseUpload} submit={submitUpload} busy={uploading} /><PortLayoutEditor modal={modal === 'layout'} close={() => setModal('')} layoutModel={layoutModel} faces={layoutFaces} setFaces={setLayoutFaces} face={layoutFace} setFace={setLayoutFace} assets={assets} assetIds={layoutAssetIds} setAssetId={(face, id) => setLayoutAssetIds((current) => ({ ...current, [face]: id }))} detect={(face) => void detectLayout(face)} confirm={confirmLayout} saving={layoutSaving} error={layoutError} />{retirementDeviceId && <RetirementReviewModal deviceId={retirementDeviceId} close={() => setRetirementDeviceId('')} retired={() => { setRetirementDeviceId(''); queryClient.invalidateQueries({ queryKey: ['infrastructure', 'devices', siteId] }); }} />}  </main></AppShell></>;
}
