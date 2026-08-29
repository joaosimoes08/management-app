'use client';

import { useEffect, useMemo, useRef, useState } from 'react';
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { Boxes, HardDrive, Layers, MapPinned, Server, Upload, X } from 'lucide-react';
import type { LucideIcon } from 'lucide-react';
import { AppShell } from '@/components/layout/app-shell';
import { useAuth } from '@/lib/auth';
import { apiFetch } from '@/lib/api/client';
import type { Device, DeviceInterface, DeviceModel, IpAddress, PortLayout, Rack, RackPlacementPlan, RoomWithBuilding, Vlan } from './types';
import type { BuildingForm, DeviceForm, ModelForm, RackForm } from './forms';
import type { RackEditDraft } from './types';
import type { InterfaceFormState } from './components/models/interface-editor';
import {
  createBuilding as apiCreateBuilding,
  createAsset,
  createRoom as apiCreateRoom,
  deleteAsset as apiDeleteAsset,
  deleteRack as apiDeleteRack,
  detectDeviceModelPortLayout,
  generateInterfaces as apiGenerateInterfaces,
  getDevice,
  getDeviceModelPortLayout,
  getEffectiveAccess,
  getSiteLocations,
  getSiteRacks,
  listAssets,
  listDeviceModels,
  listDevices,
  listInterfaces,
  listSites,
  listVlansForSite,
  placeDevice as apiPlaceDevice,
  previewDevicePlacement,
  saveDeviceModelPortLayout,
  setDeviceModelFrontAsset,
  updateDevice,
  updateInterface,
  updateRack,
  createRack,
} from './api';
import { naturalInterfaceCompare, readInfrastructureContext, writeInfrastructureContext } from './utils';
import { BuildingModal } from './components/sites/building-modal';
import { RoomModal } from './components/sites/room-modal';
import { RackWorkspace } from './components/rack/rack-workspace';
import { DeviceList } from './components/devices/device-list';
import { ModelList } from './components/models/model-list';
import { InterfaceWorkspace } from './components/models/interface-workspace';
import { InterfaceEditor } from './components/models/interface-editor';
import { PortLayoutEditor } from './components/models/port-layout-editor';
import { AssetList } from './components/assets/asset-list';
import { AssetUploadModal } from './components/assets/asset-upload-modal';
import { EntityEditor } from './components/editors/entity-editor';

const EMPTY_IPS: IpAddress[] = [];

const emptyDeviceForm: DeviceForm = { name: '', type: 'SWITCH', hostname: '', managementIp: '', managementIpAddressId: '', rackId: '', rackUnitStart: '', rackUnitSize: '1', modelId: '', status: 'UNKNOWN', frontAssetId: '' };
const emptyModelForm: ModelForm = { manufacturer: '', model: '', type: 'SWITCH', supportsNetworkPorts: true, networkPortCount: '', frontAssetId: '' };
const emptyInterfaceForm: InterfaceFormState = { id: '', name: '', portKey: '', interfaceType: 'ETHERNET', description: '', adminUp: true, operUp: false, speedMbps: '', mode: 'ACCESS', accessVlanId: '', nativeVlanId: '', allowedVlanIds: [], macAddress: '' };

export function InfrastructureWorkspace() {
  const queryClient = useQueryClient();
  const { hasRole } = useAuth();
  const roleCanEdit = hasRole('ADMIN') || hasRole('NETWORK_OPERATOR') || hasRole('SYSTEMS_OPERATOR');

  const [tab, setTab] = useState('racks');
  const [siteId, setSiteId] = useState('');
  const [buildingId, setBuildingId] = useState('');
  const [roomId, setRoomId] = useState('');
  const [rackId, setRackId] = useState('');
  const [device, setDevice] = useState<Device | null>(null);
  const [selectedInterface, setSelectedInterface] = useState<DeviceInterface | null>(null);
  const [modal, setModal] = useState('');
  const [editingId, setEditingId] = useState('');
  const [error, setError] = useState('');
  const [deletingRackId, setDeletingRackId] = useState('');
  const [uploading, setUploading] = useState(false);
  const [search, setSearch] = useState('');
  const [debouncedSearch, setDebouncedSearch] = useState('');
  const [pendingUpload, setPendingUpload] = useState<File | null>(null);
  const [assetName, setAssetName] = useState('');
  const [uploadModelId, setUploadModelId] = useState('');
  const [buildingForm, setBuildingForm] = useState<BuildingForm>({ name: '', description: '' });
  const [roomForm, setRoomForm] = useState({ name: '', buildingId: '' });
  const [rackForm, setRackForm] = useState<RackForm>({ name: '', units: '42', roomId: '', modelId: '', frontAssetId: '' });
  const [deviceForm, setDeviceForm] = useState<DeviceForm>(emptyDeviceForm);
  const [interfaceForm, setInterfaceForm] = useState<InterfaceFormState>(emptyInterfaceForm);
  const [modelForm, setModelForm] = useState<ModelForm>(emptyModelForm);
  const [layoutModel, setLayoutModel] = useState<DeviceModel | null>(null);
  const [layout, setLayout] = useState<PortLayout | null>(null);
  const [layoutAssetId, setLayoutAssetId] = useState('');
  const [layoutSaving, setLayoutSaving] = useState(false);
  const [layoutError, setLayoutError] = useState('');
  const clickRef = useRef({ key: '', at: 0 });

  // ── Server state (React Query) ───────────────────────────────────────────

  const { data: sitesData } = useQuery({ queryKey: ['infrastructure', 'sites'], queryFn: listSites });
  const { data: accessData, error: accessError, isFetching: fetchingAccess } = useQuery({
    queryKey: ['infrastructure', 'access', siteId],
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
  const { data: devicesData, error: devicesError } = useQuery({
    queryKey: ['infrastructure', 'devices', siteId, tab === 'devices' ? debouncedSearch : ''],
    queryFn: () => listDevices(siteId, tab === 'devices' ? debouncedSearch : ''),
    enabled: Boolean(siteId),
  });
  const deviceId = device?.id ?? '';
  const { data: interfacesData } = useQuery({
    queryKey: ['infrastructure', 'interfaces', deviceId],
    queryFn: () => listInterfaces(deviceId),
    enabled: Boolean(deviceId),
    select: (data) => [...data].sort(naturalInterfaceCompare),
  });

  // Debounced device search (matches the original 250ms delay).
  useEffect(() => {
    const timer = window.setTimeout(() => setDebouncedSearch(search), 250);
    return () => window.clearTimeout(timer);
  }, [search]);

  const busy = fetchingAccess || fetchingLocations || fetchingRacks;
  const queryError = [accessError, locationsError, racksError, modelsError, assetsError, vlansError, devicesError].find(Boolean);
  const errorMessage = queryError instanceof Error ? queryError.message : '';

  const sites = sitesData?.items ?? [];
  const locations = locationsData ?? [];
  const racks = racksData ?? [];
  const models = modelsData ?? [];
  const assets = assetsData ?? [];
  const vlans = vlansData?.items ?? [];
  const devices = useMemo(() => (devicesData?.items ?? []).filter((item) => item.status !== 'RETIRED'), [devicesData]);
  const interfaces = interfacesData ?? [];

  // ── Bootstrap: pick the initial site from URL, workspace context or storage.

  useEffect(() => {
    const list = sitesData?.items ?? [];
    if (!list.length) return;
    const query = new URLSearchParams(location.search);
    const storedContext = readInfrastructureContext();
    const wanted = query.get('siteId') || storedContext?.siteId || localStorage.getItem('cociber.siteId');
    const id = wanted && list.some((site) => site.id === wanted) ? wanted : list.length === 1 ? list[0].id : '';
    setSiteId(id);
    if (id) writeInfrastructureContext(storedContext?.siteId === id ? { ...storedContext, siteId: id } : { siteId: id, buildingId: '', roomId: '' });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [sitesData]);

  // Cross-feature site switching (SiteSwitcher dispatches this event).
  useEffect(() => {
    const change = (event: Event) => {
      const id = (event as CustomEvent<{ siteId: string }>).detail.siteId;
      setSiteId(id);
      setBuildingId('');
      setRoomId('');
      setRackId('');
      setDevice(null);
    };
    window.addEventListener('cociber:site-change', change);
    return () => window.removeEventListener('cociber:site-change', change);
  }, []);

  // ── URL/context restoration after racks and locations arrive.

  useEffect(() => {
    if (!siteId || !locationsData || !racksData) return;
    const query = new URLSearchParams(location.search);
    const storedContext = readInfrastructureContext();
    const requestedDevice = (devicesData?.items ?? []).find((item) => item.id === query.get('deviceId'));
    if (requestedDevice && canUseInterfaces) {
      setDevice(requestedDevice);
      setTab('interfaces');
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteId, locationsData, racksData, devicesData, canUseInterfaces]);

  useEffect(() => {
    const openUpload = () => { setPendingUpload(null); setAssetName(''); setUploadModelId(''); setModal('asset-upload'); };
    const openModel = () => { setEditingId(''); setModelForm({ manufacturer: '', model: '', type: 'OTHER', supportsNetworkPorts: false, networkPortCount: '', frontAssetId: '' }); setModal('model'); };
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
  const roomRacks = racks.filter((item) => (item.room?.id ?? item.roomId) === roomId && matches(item.name, ...(item.devices ?? []).map((entry) => entry.name)));
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
  const canCreateBuilding = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && (effective?.infrastructure?.site ?? []).includes('CREATE');
  const canCreateRoom = (hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR')) && Boolean(buildingId) && (effective?.infrastructure?.buildings?.find((item) => item.id === buildingId)?.actions ?? []).includes('CREATE');

  const invalidateInfrastructure = () => queryClient.invalidateQueries({ queryKey: ['infrastructure'] });

  // ── Actions ──────────────────────────────────────────────────────────────

  const chooseBuilding = (id: string) => {
    if (id === '__new__') { setBuildingForm({ name: '', description: '' }); setModal('building'); return; }
    setBuildingId(id);
    setRoomId('');
    setRackId('');
    setDevice(null);
    writeInfrastructureContext({ siteId, buildingId: id, roomId: '' });
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${id}`);
  };
  const chooseRoom = (id: string) => {
    if (id === '__new__') { setRoomForm({ name: '', buildingId: buildingId || buildings[0]?.id || '' }); setModal('room'); return; }
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
      await apiCreateBuilding(siteId, { name: buildingForm.name.trim() });
      const fresh = await getSiteLocations(siteId);
      queryClient.setQueryData(['infrastructure', 'locations', siteId], fresh);
      const created = fresh.find((item) => item.name === buildingForm.name.trim());
      setModal('');
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
      await apiCreateRoom(roomForm.buildingId, { name: roomForm.name.trim() });
      const fresh = await getSiteLocations(siteId);
      queryClient.setQueryData(['infrastructure', 'locations', siteId], fresh);
      const created = fresh.flatMap((item) => item.rooms ?? []).find((room) => room.name === roomForm.name.trim() && room.buildingId === roomForm.buildingId);
      setModal('');
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
  const openDevice = (selected: Device) => {
    setDevice(selected);
    setTab('interfaces');
    setSelectedInterface(null);
    history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&tab=interfaces&deviceId=${selected.id}`);
  };
  const editDevice = async (selected: Device) => {
    const full = await getDevice(selected.id);
    setEditingId(full.id);
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
      frontAssetId: full.frontAssetId ?? full.frontAsset?.id ?? '',
    });
    setModal('device');
  };
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
    try {
      await apiFetch(path, { method, body: JSON.stringify(body) });
      setModal('');
      setEditingId('');
      await invalidateInfrastructure();
      if (device) openDevice(device);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Operação falhou.');
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
      const result = await apiPlaceDevice(deviceId, { rackId: targetRackId, rackUnitStart });
      await invalidateInfrastructure();
      return result;
    } catch (cause) {
      const message = cause instanceof Error ? cause.message : 'Não foi possível atualizar a localização do equipamento.';
      setError(message);
      throw cause;
    }
  };
  const deleteRack = async (rack: Rack) => {
    if (!window.confirm(`Eliminar o bastidor “${rack.name}”? Os bastidores seguintes serão deslocados uma posição para a esquerda.`)) return;
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
    const now = Date.now();
    const double = tab === key && clickRef.current.key === key && now - clickRef.current.at < 500;
    clickRef.current = { key, at: now };
    setSearch('');
    if (double) {
      reset();
      setTab(key);
      clickRef.current = { key: '', at: 0 };
    } else setTab(key);
  };
  const newDevice = () => {
    setEditingId('');
    setDeviceForm(emptyDeviceForm);
    setModal('device');
  };
  const openLayout = async (model: DeviceModel | null) => {
    if (!model) return;
    const data = await getDeviceModelPortLayout(model.id);
    setLayoutModel(model);
    setLayout(Array.isArray(data.portLayout?.ports) ? data.portLayout : { imageWidth: 1000, imageHeight: 300, ports: [] });
    setLayoutAssetId(model.frontAssetId ?? model.frontAsset?.id ?? '');
    setModal('layout');
  };
  const detectLayout = async () => {
    if (!layoutModel) return;
    try {
      const proposal = await detectDeviceModelPortLayout(layoutModel.id, {
        assetId: layoutAssetId,
        portCount: layoutModel.networkPortCount ?? layoutModel.portCount,
        imageWidth: layout?.imageWidth,
        imageHeight: layout?.imageHeight,
      });
      setLayout(proposal);
    } catch (cause) {
      setLayoutError(cause instanceof Error ? cause.message : 'A deteção falhou.');
    }
  };
  const confirmLayout = async () => {
    if (!layoutModel || !layout) return;
    setLayoutSaving(true);
    setLayoutError('');
    try {
      const ports = (layout.ports ?? []).map((port, index) => ({
        ...port,
        portKey: String(port.portKey || `ethernet1/${index + 1}`),
        label: String(port.label || port.portKey || `Porta ${index + 1}`),
        x: Math.max(0, Math.min(1, Number(port.x) || 0)),
        y: Math.max(0, Math.min(1, Number(port.y) || 0)),
        width: Math.max(.005, Math.min(1, Number(port.width) || .03)),
        height: Math.max(.005, Math.min(1, Number(port.height) || .3)),
      }));
      await saveDeviceModelPortLayout(layoutModel.id, { ...layout, ports, assetId: layoutAssetId || null, confirmedAt: new Date().toISOString() });
      setModal('');
      setLayout(null);
      await invalidateInfrastructure();
    } catch (cause) {
      setLayoutError(cause instanceof Error ? cause.message : 'Não foi possível guardar o template.');
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
      await setDeviceModelFrontAsset(uploadModelId, asset.id);
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
    if (!window.confirm(`Eliminar o asset “${asset.filename}”? As associações visuais serão removidas.`)) return;
    try {
      await apiDeleteAsset(asset.id);
      await invalidateInfrastructure();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'Não foi possível eliminar o asset.');
    }
  };

  if (!siteId) return <AppShell section="Infraestrutura"><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Seleciona um Site na barra lateral para começar.</p></div></header><section className="ipam-card empty-context"><MapPinned size={28} /><strong>Seleciona um Site na barra lateral</strong></section></main></AppShell>;

  const canDeleteRack = hasRole('ADMIN') || hasRole('SYSTEMS_OPERATOR');
  const modalForEditor = modal === 'room' || modal === 'building' ? '' : modal;
  const siteName = sites.find((item) => item.id === siteId)?.name ?? 'Site';
  const buildingName = buildings.find((item) => item.id === buildingId)?.name;
  const roomName = rooms.find((item) => item.id === roomId)?.name;
  const tabName = ({ racks: 'Bastidores', devices: 'Equipamentos', models: 'Modelos', interfaces: 'Interfaces', assets: 'Assets', permissions: 'Permissões' } as Record<string, string>)[tab] ?? tab;
  const visibleTabs: [string, string, LucideIcon][] = [['racks', 'Bastidores', MapPinned], ['devices', 'Equipamentos', Server], ...(effective?.tabs?.models ? [['models', 'Modelos', Boxes] as [string, string, LucideIcon]] : []), ...(effective?.tabs?.interfaces ? [['interfaces', 'Interfaces', Layers] as [string, string, LucideIcon]] : []), ...(effective?.tabs?.assets ? [['assets', 'Assets', HardDrive] as [string, string, LucideIcon]] : [])];

  return <AppShell section="Infraestrutura" context={[siteName, ...(buildingName ? [buildingName] : []), ...(roomName ? [roomName] : []), tabName]} search={{ value: search, onChange: setSearch, placeholder: `Pesquisar em ${tabName.toLowerCase()}…` }}><main className="module-page infrastructure-workspace"><header className="workspace-head"><div><span className="section-kicker">MAPA FÍSICO</span><h1>Infraestrutura</h1><p>Site → edifício → sala → bastidor → equipamento → interfaces.</p></div></header>{(error || errorMessage) && <div className="ipam-alert error"><X size={15} />{error || errorMessage}</div>}<section className="infra-context-bar"><label><MapPinned size={15} /> Edifício<select value={buildingId} onChange={(event) => chooseBuilding(event.target.value)}><option value="">Seleciona um edifício</option>{buildings.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateBuilding && <option value="__new__">Criar novo Edifício</option>}</select></label><label><MapPinned size={15} /> Sala<select value={roomId} onChange={(event) => chooseRoom(event.target.value)}><option value="">Seleciona uma sala</option>{rooms.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}{canCreateRoom && <option value="__new__">Criar nova Sala</option>}</select></label><span>{busy ? 'A carregar…' : `${racks.length} bastidores · ${devices.length} equipamentos ativos`}</span></section><nav className="infra-menu">{visibleTabs.map(([key, label, Icon]) => <button key={key} className={tab === key ? 'active' : ''} onClick={() => selectTab(key)}><Icon size={15} /><span>{label}</span></button>)}</nav>{tab === 'racks' && <RackWorkspace rooms={rooms} roomId={roomId} buildingId={buildingId} racks={roomRacks} selected={selectedRack} setRack={(rack: Rack) => { if (rack.room) setRoomId(rack.room.id); setRackId(rack.id); history.replaceState({}, '', `/infraestrutura?siteId=${siteId}&buildingId=${rack.room?.building?.id ?? buildingId}&roomId=${rack.room?.id ?? roomId}&rackId=${rack.id}`); }} onOut={() => setRackId('')} onDevice={openDevice} onEdit={(rack: RackEditDraft) => { setEditingId(rack.id ?? ''); setRackForm({ name: rack.name ?? '', units: String(rack.units ?? 42), roomId: rack.room?.id ?? rack.roomId ?? roomId, modelId: rack.modelId ?? rack.model?.id ?? '', frontAssetId: rack.frontAssetId ?? rack.frontAsset?.id ?? '' }); setModal('rack'); }} onDelete={canDeleteRack && scopeActions.includes('DELETE') ? deleteRack : undefined} deletingRackId={deletingRackId} canEdit={canEdit} onPreviewPlacement={previewPlacement} onPlaceDevice={placeDevice} onEditDevice={editDevice} />} {tab === 'devices' && <DeviceList devices={devices} search={search} onSelect={openDevice} onEdit={editDevice} onNew={newDevice} canEdit={canEdit} />} {tab === 'models' && effective?.tabs?.models && <ModelList models={visibleModels} onEdit={(model) => { setEditingId(model.id); setModelForm({ manufacturer: model.manufacturer, model: model.model, type: model.type ?? 'OTHER', supportsNetworkPorts: !!model.supportsNetworkPorts, networkPortCount: String(model.networkPortCount ?? ''), frontAssetId: model.frontAssetId ?? model.frontAsset?.id ?? '' }); setModal('model'); }} onLayout={openLayout} canEdit={roleCanEdit} />} {tab === 'assets' && effective?.tabs?.assets && <AssetList assets={visibleAssets} onDelete={deleteAsset} canEdit={roleCanEdit} canDelete={roleCanEdit} />} {tab === 'interfaces' && effective?.tabs?.interfaces && <InterfaceWorkspace devices={devices} selected={device} interfaces={visibleInterfaces} selectedInterface={selectedInterface} onDevice={openDevice} onInterface={editInterface} onGenerate={generateInterfaces} onEditDevice={() => device && editDevice(device)} />}<EntityEditor modal={modalForEditor} close={() => setModal('')} editingId={editingId} form={{ rack: rackForm, device: deviceForm, model: modelForm }} setForm={{ rack: setRackForm, device: setDeviceForm, model: setModelForm }} rooms={rooms} racks={racks} models={models} assets={assets} ips={EMPTY_IPS} save={save} />{modal === 'interface' && <InterfaceEditor modal={modal} close={() => setModal('')} form={{ interface: interfaceForm }} setForm={{ interface: setInterfaceForm }} vlans={vlans} save={save} />}<BuildingModal modal={modal === 'building'} close={() => setModal('')} buildingForm={buildingForm} setBuildingForm={setBuildingForm} createBuilding={createBuilding} /><RoomModal modal={modal === 'room'} close={() => setModal('')} roomForm={roomForm} setRoomForm={setRoomForm} buildings={buildings} createRoom={createRoom} /><AssetUploadModal modal={modal === 'asset-upload'} close={() => setModal('')} file={pendingUpload} name={assetName} setName={setAssetName} modelId={uploadModelId} setModelId={setUploadModelId} models={models} choose={chooseUpload} submit={submitUpload} busy={uploading} /><PortLayoutEditor modal={modal === 'layout'} close={() => setModal('')} layoutModel={layoutModel} layout={layout} setLayout={setLayout} assets={assets} assetId={layoutAssetId} setAssetId={setLayoutAssetId} detect={detectLayout} confirm={confirmLayout} saving={layoutSaving} error={layoutError} />  </main></AppShell>;
}
