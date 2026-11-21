import { BadRequestException, ConflictException, ForbiddenException, HttpException, Injectable, NotFoundException, OnModuleInit } from '@nestjs/common';
import { DeviceListFilterInput, deviceListFilterWhere } from './device-list-filters';
import { assetEtag } from './asset-cache';
import { sniffImageMime } from './asset-sniff';
import { Prisma, PrismaClient } from '@simoes/database';
import { AuditService } from '../audit/audit.service';
import { AuthenticatedUser } from '../auth/auth.service';
import { CreateAssetDto, CreateBuildingDto, CreateDeviceDto, CreateDeviceModelDto, CreateInterfaceDto, CreateRackDto, CreateRackModelDto, CreateRoomDto, DetectPortLayoutDto, PlaceDeviceDto, ReorderRacksDto, UpdateBuildingDto, UpdateDeviceDto, UpdateDeviceModelDto, UpdateInterfaceDto, UpdateRackDto, UpdateRackModelDto, UpdateRoomDto } from './dto';
import { findRackImportOverlaps, planRackPlacement, type RackPlacementPlan } from './rack-placement';
import { PersistedDeviceAuditError, updateDevicesIndividually } from './bulk-update';
import { allLayoutPorts, applyFaces, assertPortMappingComplete, assertWritableFaces, assertWritableLayout, expectedNetworkPorts, faceAssetField, isPortMapped, normalizeModelLayouts, normalizePortLayout, PORT_LAYOUT_FACES, portLayoutRevision, portMappingStatus, seedPortLayout, writeFace, type FaceInput, type FacesInput, type PortLayoutFace } from './port-layout';
import { mkdir, readFile, unlink, writeFile } from 'node:fs/promises';
import { extname, join, resolve } from 'node:path';
import { randomUUID } from 'node:crypto';
import { InfrastructureAccessService } from './infrastructure-access.service';
import { initialPdus, resolvePlugCount } from './power/rack-power';
import { applyDevicePowerInTransaction, attachRackPower, RACK_POWER_PDU_INCLUDE } from './power/rack-power.service';
import { createViolations, isFeatureConfigKey, missingConfigWhere, requiredConfigError, requiredConfigSummary, toDeviceConfigState, updateViolations } from './required-config/device-required-config';
import { RequiredConfigException } from './required-config/device-required-config.service';
import { IpamAccessService } from '../ipam/ipam-access.service';

/** Adds `requiredConfig: { missing, missingTabs, complete }` to a device loaded with model and _count.pduOutlets. */
function withRequiredConfig<T>(device: T): T & { requiredConfig: ReturnType<typeof requiredConfigSummary> } {
  return { ...device, requiredConfig: requiredConfigSummary(toDeviceConfigState(device as any)) };
}

function naturalInterfaceCompare(a: any, b: any) {
  const tokenize = (value: string) => value.toLocaleLowerCase().split(/(\d+)/).map((part) => /^\d+$/.test(part) ? Number(part) : part);
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

type CatalogEntry = readonly [string, string, string, number, boolean, number | null, string | null];

const DEFAULT_DEVICE_MODELS: readonly CatalogEntry[] = [
  ['Cisco', 'Catalyst 2960-X', 'SWITCH', 24, true, 24, 'ethernet'], ['Cisco', 'Catalyst 9200', 'SWITCH', 24, true, 24, 'ethernet'], ['Cisco', 'Catalyst 9300', 'SWITCH', 48, true, 48, 'ethernet'], ['Cisco', 'Catalyst 9500', 'SWITCH', 24, true, 24, 'sfp'], ['Cisco', 'Nexus 9300', 'SWITCH', 48, true, 48, 'qsfp/sfp'],
  ['Cisco', 'ISR 4321', 'ROUTER', 3, true, 3, 'ethernet'], ['Cisco', 'ISR 4331', 'ROUTER', 3, true, 3, 'ethernet'], ['Cisco', 'ISR 4351', 'ROUTER', 3, true, 3, 'ethernet'], ['Cisco', 'ISR 4431', 'ROUTER', 4, true, 4, 'ethernet'], ['Cisco', 'ISR 4451-X', 'ROUTER', 4, true, 4, 'ethernet'], ['Cisco', 'Catalyst 8300', 'ROUTER', 8, true, 8, 'ethernet'], ['Cisco', 'ASR 1001-X', 'ROUTER', 6, true, 6, 'ethernet'],
  ['Cisco', 'UCS C220 M4', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C220 M5', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C220 M6', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C220 M7', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C240 M5', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C240 M6', 'SERVER', 0, false, null, null], ['Cisco', 'UCS C240 M7', 'SERVER', 0, false, null, null],
  ['NetApp', 'FAS2720', 'STORAGE', 0, false, null, null], ['NetApp', 'FAS2750', 'STORAGE', 0, false, null, null], ['NetApp', 'FAS2820', 'STORAGE', 0, false, null, null], ['NetApp', 'AFF A250', 'STORAGE', 0, false, null, null], ['NetApp', 'AFF A400', 'STORAGE', 0, false, null, null], ['NetApp', 'AFF A700', 'STORAGE', 0, false, null, null], ['NetApp', 'AFF A900', 'STORAGE', 0, false, null, null], ['NetApp', 'AFF C250', 'STORAGE', 0, false, null, null],
  ['Dell', 'PowerEdge R640', 'SERVER', 0, false, null, null], ['Dell', 'PowerEdge R740', 'SERVER', 0, false, null, null], ['Dell', 'PowerEdge R740xd', 'SERVER', 0, false, null, null], ['Dell', 'PowerEdge R750', 'SERVER', 0, false, null, null], ['Dell', 'PowerEdge R650', 'SERVER', 0, false, null, null],
  ['Lenovo', 'ThinkSystem SR550', 'SERVER', 0, false, null, null], ['Lenovo', 'ThinkSystem SR570', 'SERVER', 0, false, null, null], ['Lenovo', 'ThinkSystem SR630', 'SERVER', 0, false, null, null], ['Lenovo', 'ThinkSystem SR650', 'SERVER', 0, false, null, null], ['Lenovo', 'ThinkSystem SR650 V4', 'SERVER', 0, false, null, null],
];

const DEFAULT_RACK_MODELS = [['APC/Schneider Electric', 'NetShelter SX AR3350', 42], ['APC/Schneider Electric', 'NetShelter SX AR3300X', 42], ['Generic', '42U Standard Rack', 42], ['Generic', '24U Standard Rack', 24]] as const;

@Injectable()
export class InfrastructureService implements OnModuleInit {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService, private readonly ipamAccess: IpamAccessService) {}
  async onModuleInit() {
    // Mantém o catálogo base disponível em instalações novas e é seguro em
    // reinícios porque o seed usa chaves únicas e upsert.
    await this.seedDefaultCatalog();
  }
  private async log(user: AuthenticatedUser, action: string, entityType: string, entityId: string, metadata?: unknown) { await this.audit.record({ userId: user.id, action, entityType, entityId, metadata }); }
  private assertDeviceCapability(user: AuthenticatedUser, type: string) { if (user.roles.includes('ADMIN') || user.roles.includes('SYSTEMS_OPERATOR') || (user.roles.includes('NETWORK_OPERATOR') && ['SWITCH', 'ROUTER', 'FIREWALL'].includes(type))) return; throw new ForbiddenException('A role não permite gerir este tipo de equipamento.'); }
  private async assertDeviceIdCapability(user: AuthenticatedUser, id: string) { const device = await this.prisma.device.findUnique({ where: { id }, select: { type: true } }); if (!device) throw new NotFoundException('Equipamento não encontrado'); this.assertDeviceCapability(user, device.type); }
  private readonly assetDirectory = resolve(process.env.ASSET_STORAGE_PATH ?? 'data/assets');
  async listAssets(kind?: string) { return this.prisma.assetFile.findMany({ where: kind ? { kind } : {}, orderBy: { createdAt: 'desc' } }); }
  async createAsset(dto: CreateAssetDto, user: AuthenticatedUser) {
    if (!['image/svg+xml', 'image/png', 'image/jpeg', 'image/webp'].includes(dto.mimeType)) throw new ConflictException('Apenas SVG, PNG, JPEG e WebP são suportados');
    const content = Buffer.from(dto.contentBase64.replace(/^data:[^;]+;base64,/, ''), 'base64');
    if (!content.length || content.length > 10 * 1024 * 1024) throw new ConflictException('O asset deve ter entre 1 byte e 10 MB');
    // The declared type comes from the browser (file extension); the stored type comes from the bytes.
    const mimeType = sniffImageMime(content);
    if (!mimeType) throw new BadRequestException({ code: 'ASSET_NOT_IMAGE', message: 'O ficheiro não é uma imagem SVG, PNG, JPEG ou WebP válida.' });
    await mkdir(this.assetDirectory, { recursive: true });
    const storageKey = `${randomUUID()}${extname(dto.filename).toLowerCase() || '.asset'}`;
    await writeFile(join(this.assetDirectory, storageKey), content, { flag: 'wx' });
    try {
      const duplicate = await this.prisma.assetFile.findFirst({ where: { filename: { equals: dto.filename, mode: 'insensitive' } }, select: { id: true } });
      if (duplicate) throw new ConflictException('Já existe um asset com esse nome');
      const asset = await this.prisma.assetFile.create({ data: { filename: dto.filename, storageKey, mimeType, sizeBytes: content.length, kind: dto.kind, license: dto.license } });
      await this.log(user, 'ASSET_CREATED', 'AssetFile', asset.id, { filename: asset.filename, kind: asset.kind });
      return asset;
    } catch (error) { await unlink(join(this.assetDirectory, storageKey)).catch(() => undefined); throw error; }
  }
  /**
   * Asset bytes never change: there is no update route and every upload gets a new random storage key.
   * So the id plus the size is a strong ETag, and a matching If-None-Match skips reading the file.
   */
  async assetFile(id: string, ifNoneMatch?: string) {
    const asset = await this.prisma.assetFile.findUnique({ where: { id } });
    if (!asset) throw new NotFoundException('Asset não encontrado');
    const etag = assetEtag(asset);
    if (ifNoneMatch && ifNoneMatch.split(',').some((tag) => tag.trim().replace(/^W\//, '') === etag || tag.trim() === '*')) return { asset, etag, notModified: true as const, buffer: null };
    const buffer = await this.readAssetBytes(asset.storageKey).catch(() => { throw new NotFoundException('Ficheiro do asset não encontrado'); });
    return { asset, etag, notModified: false as const, buffer };
  }
  /** Reads a stored asset; a method so specs can stub the disk. */
  protected readAssetBytes(storageKey: string): Promise<Buffer> { return readFile(join(this.assetDirectory, storageKey)); }
  async deleteAsset(id: string, user: AuthenticatedUser) { const asset = await this.prisma.assetFile.findUnique({ where: { id } }); if (!asset) throw new NotFoundException('Asset não encontrado'); await this.prisma.$transaction(async (tx) => { for (const field of ['frontAssetId', 'backAssetId', 'iconAssetId'] as const) await tx.deviceModel.updateMany({ where: { [field]: id }, data: { [field]: null } }); for (const field of ['frontAssetId', 'iconAssetId'] as const) await tx.rackModel.updateMany({ where: { [field]: id }, data: { [field]: null } }); for (const field of ['frontAssetId', 'backAssetId', 'iconAssetId'] as const) await tx.device.updateMany({ where: { [field]: id }, data: { [field]: null } }); await tx.rack.updateMany({ where: { frontAssetId: id }, data: { frontAssetId: null } }); await tx.assetFile.delete({ where: { id } }); }); await unlink(join(this.assetDirectory, asset.storageKey)).catch(() => undefined); await this.log(user, 'ASSET_DELETED', 'AssetFile', id, { filename: asset.filename, detached: true }); return { success: true, detached: true }; }
  async cleanupLegacyAssets(user: AuthenticatedUser) { const assets = await this.prisma.assetFile.findMany({ where: { filename: { in: ['fluxograma.png', 'c9300.png', 'cisco-c9300.png'], mode: 'insensitive' } } }); const removed: string[] = []; for (const asset of assets) { await this.prisma.$transaction(async (tx) => { await tx.deviceModel.updateMany({ where: { OR: [{ frontAssetId: asset.id }, { backAssetId: asset.id }, { iconAssetId: asset.id }] }, data: { frontAssetId: null, backAssetId: null, iconAssetId: null, portLayout: { set: null } } as never }); await tx.device.updateMany({ where: { OR: [{ frontAssetId: asset.id }, { backAssetId: asset.id }, { iconAssetId: asset.id }] }, data: { frontAssetId: null, backAssetId: null, iconAssetId: null } }); await tx.rack.updateMany({ where: { frontAssetId: asset.id }, data: { frontAssetId: null } }); await tx.assetFile.delete({ where: { id: asset.id } }); }); await unlink(join(this.assetDirectory, asset.storageKey)).catch(() => undefined); removed.push(asset.filename); await this.log(user, 'ASSET_DELETED', 'AssetFile', asset.id, { reason: 'legacy-cleanup', filename: asset.filename }); } await this.log(user, 'LEGACY_ASSETS_CLEANED', 'AssetFile', 'legacy', { removed }); return { removed, notFound: ['fluxograma.png', 'c9300.png'].filter((name) => !removed.some((item) => item.toLowerCase() === name)), preserved: ['rack-empty-42u.png'] }; }
  async listRackModels() { return this.prisma.rackModel.findMany({ where: { active: true }, include: { iconAsset: true, frontAsset: true, _count: { select: { racks: true } } }, orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }] }); }
  async createRackModel(dto: CreateRackModelDto, user: AuthenticatedUser) { try { const item = await this.prisma.rackModel.create({ data: dto as never }); await this.log(user, 'RACK_MODEL_CREATED', 'RackModel', item.id); return item; } catch { throw new ConflictException('Já existe esse modelo de bastidor'); } }
  async updateRackModel(id: string, dto: UpdateRackModelDto, user: AuthenticatedUser) { const item = await this.prisma.rackModel.update({ where: { id }, data: dto as never }).catch(() => { throw new NotFoundException('Modelo de bastidor não encontrado'); }); await this.log(user, 'RACK_MODEL_UPDATED', 'RackModel', id); return item; }
  async deleteRackModel(id: string, user: AuthenticatedUser) { const count = await this.prisma.rack.count({ where: { modelId: id } }); if (count) throw new ConflictException('O modelo está associado a bastidores'); await this.prisma.rackModel.update({ where: { id }, data: { active: false } }).catch(() => { throw new NotFoundException('Modelo de bastidor não encontrado'); }); await this.log(user, 'RACK_MODEL_ARCHIVED', 'RackModel', id); return { success: true }; }
  async listRacks(user: AuthenticatedUser, siteId?: string) { const roomIds = await this.access.visibleRoomIds(user, siteId); return (normalizeModelLayouts(await this.prisma.rack.findMany({ where: { roomId: { in: roomIds }, ...(siteId ? { room: { building: { siteId } } } : {}) }, include: { model: { include: { frontAsset: true, iconAsset: true } }, frontAsset: true, room: { include: { building: { include: { site: true } } } }, devices: { include: { model: { include: { frontAsset: true, backAsset: true, iconAsset: true } }, frontAsset: true, backAsset: true, iconAsset: true }, orderBy: { rackUnitStart: 'asc' } }, pdus: { include: RACK_POWER_PDU_INCLUDE } }, orderBy: [{ roomId: 'asc' }, { displayOrder: 'asc' }, { name: 'asc' }] })) as any[]).map((rack) => attachRackPower(rack)); }
  async listLocations(user: AuthenticatedUser, siteId: string) { const [buildingIds, roomIds] = await Promise.all([this.access.visibleBuildingIds(user, siteId), this.access.visibleRoomIds(user, siteId)]); return this.prisma.building.findMany({ where: { siteId, id: { in: buildingIds } }, include: { rooms: { where: { id: { in: roomIds } }, include: { racks: true, building: true }, orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } }); }
  async listBuildings(user: AuthenticatedUser, siteId: string) { const [buildingIds, roomIds] = await Promise.all([this.access.visibleBuildingIds(user, siteId), this.access.visibleRoomIds(user, siteId)]); return this.prisma.building.findMany({ where: { siteId, id: { in: buildingIds } }, include: { rooms: { where: { id: { in: roomIds } }, include: { racks: true }, orderBy: { name: 'asc' } } }, orderBy: { name: 'asc' } }); }
  async createBuilding(siteId: string, dto: CreateBuildingDto, user: AuthenticatedUser) { await this.access.assertSite(user, 'CREATE', siteId); const site = await this.prisma.site.findUnique({ where: { id: siteId } }); if (!site) throw new NotFoundException('Site não encontrado'); try { const item = await this.prisma.building.create({ data: { ...dto, siteId } }); await this.log(user, 'BUILDING_CREATED', 'Building', item.id, { siteId }); return item; } catch { throw new ConflictException('Já existe um edifício com esse nome neste Site'); } }
  async updateBuilding(id: string, dto: UpdateBuildingDto, user: AuthenticatedUser) { await this.access.assertBuilding(user, 'UPDATE', id); try { const item = await this.prisma.building.update({ where: { id }, data: dto }); await this.log(user, 'BUILDING_UPDATED', 'Building', id); return item; } catch { throw new NotFoundException('Edifício não encontrado'); } }
  async deleteBuilding(id: string, user: AuthenticatedUser) { await this.access.assertBuilding(user, 'DELETE', id); const item = await this.prisma.building.findUnique({ where: { id }, include: { rooms: true } }); if (!item) throw new NotFoundException('Edifício não encontrado'); if (item.rooms.length) throw new ConflictException('O edifício ainda contém salas'); await this.prisma.building.delete({ where: { id } }); await this.log(user, 'BUILDING_DELETED', 'Building', id); return { success: true }; }
  async listRooms(user: AuthenticatedUser, buildingId: string) { await this.access.assertBuilding(user, 'READ', buildingId); const roomIds = await this.access.visibleRoomIds(user); return this.prisma.room.findMany({ where: { buildingId, id: { in: roomIds } }, include: { racks: true, building: true }, orderBy: { name: 'asc' } }); }
  async createRoom(buildingId: string, dto: CreateRoomDto, user: AuthenticatedUser) { await this.access.assertBuilding(user, 'CREATE', buildingId); const building = await this.prisma.building.findUnique({ where: { id: buildingId } }); if (!building) throw new NotFoundException('Edifício não encontrado'); try { const item = await this.prisma.room.create({ data: { ...dto, buildingId } }); await this.log(user, 'ROOM_CREATED', 'Room', item.id, { buildingId }); return item; } catch { throw new ConflictException('Já existe uma sala com esse nome neste edifício'); } }
  async updateRoom(id: string, dto: UpdateRoomDto, user: AuthenticatedUser) { await this.access.assertRoom(user, 'UPDATE', id); try { const item = await this.prisma.room.update({ where: { id }, data: dto }); await this.log(user, 'ROOM_UPDATED', 'Room', id); return item; } catch { throw new NotFoundException('Sala não encontrada'); } }
  async deleteRoom(id: string, user: AuthenticatedUser) { await this.access.assertRoom(user, 'DELETE', id); const item = await this.prisma.room.findUnique({ where: { id }, include: { racks: true } }); if (!item) throw new NotFoundException('Sala não encontrada'); if (item.racks.length) throw new ConflictException('A sala ainda contém bastidores'); await this.prisma.room.delete({ where: { id } }); await this.log(user, 'ROOM_DELETED', 'Room', id); return { success: true }; }
  async getRack(id: string, user: AuthenticatedUser) { await this.access.assertRack(user, 'READ', id); const item = await this.prisma.rack.findUnique({ where: { id }, include: { model: { include: { frontAsset: true, iconAsset: true } }, frontAsset: true, room: { include: { building: { include: { site: true } } } }, devices: { include: { model: { include: { frontAsset: true, backAsset: true, iconAsset: true } }, frontAsset: true, backAsset: true, iconAsset: true }, orderBy: { rackUnitStart: 'asc' } }, pdus: { include: RACK_POWER_PDU_INCLUDE } } }); if (!item) throw new NotFoundException('Bastidor não encontrado'); return attachRackPower(normalizeModelLayouts(item) as any); }
  async createRack(dto: CreateRackDto, user: AuthenticatedUser) { await this.access.assertRoom(user, 'CREATE', dto.roomId); const room = await this.prisma.room.findUnique({ where: { id: dto.roomId } }); if (!room) throw new NotFoundException('Sala não encontrada'); const lastRack = await this.prisma.rack.findFirst({ where: { roomId: dto.roomId }, orderBy: { displayOrder: 'desc' }, select: { displayOrder: true } }); const { powerMode, supplierPdu, upsPdu, ...rackData } = dto; const pdus = initialPdus({ mode: powerMode, supplier: supplierPdu, ups: upsPdu }); const item = await this.prisma.rack.create({ data: { ...rackData, displayOrder: (lastRack?.displayOrder ?? -1) + 1, units: 42, modelId: null, frontAssetId: null, pdus: { create: pdus } } }); await this.log(user, 'RACK_CREATED', 'Rack', item.id, { powerMode: powerMode ?? 'SUPPLIER_ONLY', pdus }); return this.getRack(item.id, user); }
  async reorderRacks(roomId: string, dto: ReorderRacksDto, user: AuthenticatedUser) { await this.access.assertRoom(user, 'UPDATE', roomId); const racks = await this.prisma.rack.findMany({ where: { roomId }, select: { id: true } }); if (!racks.length) throw new NotFoundException('Sala ou bastidores não encontrados'); const expectedIds = new Set(racks.map((rack) => rack.id)); const receivedIds = new Set(dto.rackIds); if (receivedIds.size !== dto.rackIds.length || receivedIds.size !== expectedIds.size || dto.rackIds.some((id) => !expectedIds.has(id))) throw new ConflictException('A ordem tem de incluir todos os bastidores da sala uma única vez'); await this.prisma.$transaction(dto.rackIds.map((id, displayOrder) => this.prisma.rack.update({ where: { id }, data: { displayOrder } }))); await this.log(user, 'RACKS_REORDERED', 'Room', roomId, { rackIds: dto.rackIds }); return this.prisma.rack.findMany({ where: { roomId }, orderBy: [{ displayOrder: 'asc' }, { name: 'asc' }] }); }
  async updateRack(id: string, dto: UpdateRackDto, user: AuthenticatedUser) { const [room, current] = await Promise.all([this.prisma.room.findUnique({ where: { id: dto.roomId } }), this.prisma.rack.findUnique({ where: { id }, select: { roomId: true } })]); if (!room) throw new NotFoundException('Sala não encontrada'); if (!current) throw new NotFoundException('Bastidor não encontrado'); await this.access.assertRoom(user, 'UPDATE', current.roomId); if (current.roomId !== dto.roomId) await this.access.assertRoom(user, 'UPDATE', dto.roomId); const movingRoom = current.roomId !== dto.roomId; const lastRack = movingRoom ? await this.prisma.rack.findFirst({ where: { roomId: dto.roomId }, orderBy: { displayOrder: 'desc' }, select: { displayOrder: true } }) : null; const item = await this.prisma.rack.update({ where: { id }, data: { ...dto, ...(movingRoom ? { displayOrder: (lastRack?.displayOrder ?? -1) + 1 } : {}), units: 42, modelId: null, frontAssetId: null } }); await this.log(user, 'RACK_UPDATED', 'Rack', id); return this.getRack(item.id, user); }
  async deleteRack(id: string, user: AuthenticatedUser) {
    await this.access.assertRack(user, 'DELETE', id);
    const rack = await this.prisma.$transaction(async (tx) => {
      const item = await tx.rack.findUnique({ where: { id }, include: { devices: true } });
      if (!item) throw new NotFoundException('Bastidor não encontrado');
      if (item.devices.length) throw new ConflictException('O bastidor ainda contém equipamentos');

      await tx.rack.delete({ where: { id } });
      await tx.rack.updateMany({
        where: { roomId: item.roomId, displayOrder: { gt: item.displayOrder } },
        data: { displayOrder: { decrement: 1 } },
      });
      return item;
    });
    await this.log(user, 'RACK_DELETED', 'Rack', id, { roomId: rack.roomId, displayOrder: rack.displayOrder });
    return { success: true };
  }
  private async visibleDeviceWhere(user: AuthenticatedUser) { const roomIds = await this.access.visibleRoomIds(user); return { OR: [{ rackId: null }, { rack: { roomId: { in: roomIds } } }] }; }
  async listModels(user: AuthenticatedUser, search?: string, type?: string, networkPorts?: string) { const deviceWhere = await this.visibleDeviceWhere(user); return normalizeModelLayouts(await this.prisma.deviceModel.findMany({ where: { ...(type ? { type } : {}), ...(networkPorts === 'true' ? { supportsNetworkPorts: true } : {}), ...(search ? { OR: [{ manufacturer: { contains: search, mode: 'insensitive' } }, { model: { contains: search, mode: 'insensitive' } }] } : {}) }, include: { frontAsset: true, backAsset: true, iconAsset: true, _count: { select: { devices: { where: deviceWhere } } } }, orderBy: [{ manufacturer: 'asc' }, { model: 'asc' }] })); }
  async getModel(id: string, user: AuthenticatedUser) { const deviceWhere = await this.visibleDeviceWhere(user); const item = await this.prisma.deviceModel.findUnique({ where: { id }, include: { frontAsset: true, backAsset: true, iconAsset: true, devices: { where: deviceWhere } } }); if (!item) throw new NotFoundException('Modelo não encontrado'); return normalizeModelLayouts(item); }
  async seedCatalog(user: AuthenticatedUser) {
    const catalog = DEFAULT_DEVICE_MODELS;
    let created = 0; let existing = 0;
    for (const [manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, family] of catalog) {
      const found = await this.prisma.deviceModel.findUnique({ where: { manufacturer_model: { manufacturer, model } }, select: { id: true } });
      await this.prisma.deviceModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, portLayout: family ? seedPortLayout(family) : null } as never, update: { type, portCount, supportsNetworkPorts, networkPortCount } as never });
      if (found) existing++; else created++;
    }
    const racks = DEFAULT_RACK_MODELS;
    let rackCreated = 0; let rackExisting = 0;
    for (const [manufacturer, model, units] of racks) { const found = await this.prisma.rackModel.findUnique({ where: { manufacturer_model: { manufacturer, model } }, select: { id: true } }); await this.prisma.rackModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, units }, update: { units } }); if (found) rackExisting++; else rackCreated++; }
    await this.log(user, 'DEVICE_CATALOG_SEEDED', 'DeviceModel', 'catalog', { created, existing, rackCreated, rackExisting });
    return { created, existing, rackCreated, rackExisting, total: catalog.length, rackTotal: racks.length };
  }
  private async seedDefaultCatalog() {
    for (const [manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, family] of DEFAULT_DEVICE_MODELS) {
      await this.prisma.deviceModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, type, portCount, supportsNetworkPorts, networkPortCount, portLayout: family ? seedPortLayout(family) : null } as never, update: { type, portCount, supportsNetworkPorts, networkPortCount } as never });
    }
    for (const [manufacturer, model, units] of DEFAULT_RACK_MODELS) {
      await this.prisma.rackModel.upsert({ where: { manufacturer_model: { manufacturer, model } }, create: { manufacturer, model, units }, update: { units } });
    }
  }
  async createModel(dto: CreateDeviceModelDto, user: AuthenticatedUser) { const data = await this.prepareModelWrite(dto, null); try { const item = normalizeModelLayouts(await this.prisma.deviceModel.create({ data: data as never })); await this.log(user, 'DEVICE_MODEL_CREATED', 'DeviceModel', item.id); return item; } catch { throw new ConflictException('Já existe esse modelo'); } }
  async updateModel(id: string, dto: UpdateDeviceModelDto, user: AuthenticatedUser) { const current = await this.prisma.deviceModel.findUnique({ where: { id }, select: { frontAssetId: true, backAssetId: true, portLayout: true } }); if (!current) throw new NotFoundException('Modelo não encontrado'); const data = await this.prepareModelWrite(dto, current); const item = normalizeModelLayouts(await this.prisma.deviceModel.update({ where: { id }, data: data as never }).catch(() => { throw new NotFoundException('Modelo não encontrado'); })); await this.log(user, 'DEVICE_MODEL_UPDATED', 'DeviceModel', id); return item; }
  async deleteModel(id: string, user: AuthenticatedUser) { await this.prisma.deviceModel.delete({ where: { id } }).catch(() => { throw new NotFoundException('Modelo não encontrado'); }); await this.log(user, 'DEVICE_MODEL_DELETED', 'DeviceModel', id); return { success: true }; }
  async listDevices(user: AuthenticatedUser, search?: string, type?: string, siteId?: string, pageText?: string, pageSizeText?: string, filters: DeviceListFilterInput & { missingConfig?: string } = {}) { const { missingConfig, ...drill } = filters; const drillFilters = deviceListFilterWhere(drill); if (missingConfig !== undefined && !isFeatureConfigKey(missingConfig)) throw new BadRequestException({ code: 'UNKNOWN_REQUIRED_CONFIG', message: 'Configuração desconhecida. Usa rearImage ou power.' }); const page = Math.max(Number(pageText) || 1, 1); const pageSize = Math.min(Math.max(Number(pageSizeText) || 25, 1), 100); const [roomIds, unplacedSiteIds] = await Promise.all([this.access.visibleRoomIds(user, siteId), this.access.visibleUnplacedSiteIds(user, siteId)]); const where: Prisma.DeviceWhereInput = { AND: [{ OR: [{ rackId: null, siteId: { in: unplacedSiteIds } }, { rack: { roomId: { in: roomIds } } }] }, ...(type ? [{ type }] : []), ...(siteId ? [{ siteId }] : []), ...(missingConfig && isFeatureConfigKey(missingConfig) ? [missingConfigWhere(missingConfig)] : []), ...(search ? [{ OR: [{ name: { contains: search, mode: 'insensitive' as const } }, { hostname: { contains: search, mode: 'insensitive' as const } }, { serialNumber: { contains: search, mode: 'insensitive' as const } }, { assetTag: { contains: search, mode: 'insensitive' as const } }, { managementIp: { contains: search } }] }] : []), ...drillFilters] }; const [items, total] = await Promise.all([this.prisma.device.findMany({ where, include: { model: { include: { frontAsset: true, backAsset: true, iconAsset: true } }, frontAsset: true, backAsset: true, iconAsset: true, site: true, rack: { include: { room: { include: { building: true } } } }, _count: { select: { interfaces: true, ipAddresses: true, pduOutlets: true } } }, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }), this.prisma.device.count({ where })]); return { items: normalizeModelLayouts(items).map((item: any) => withRequiredConfig(item)), page, pageSize, total, totalPages: Math.ceil(total / pageSize) }; }
  async getDevice(id: string, user: AuthenticatedUser) { await this.access.assertDevice(user, 'READ', id); const item = await this.prisma.device.findUnique({ where: { id }, include: { model: { include: { frontAsset: true, backAsset: true, iconAsset: true } }, frontAsset: true, backAsset: true, iconAsset: true, site: true, rack: { include: { room: { include: { building: true } } } }, interfaces: { include: { nativeVlan: this.vlanInclude, accessVlan: this.vlanInclude, allowedVlans: { include: { vlan: this.vlanInclude } }, ipAddresses: { include: { subnet: true, host: true } } } }, ipAddresses: { include: { subnet: true, host: true } }, _count: { select: { pduOutlets: true } } } }); if (!item) throw new NotFoundException('Equipamento não encontrado'); item.interfaces.sort(naturalInterfaceCompare); return withRequiredConfig(normalizeModelLayouts(item)); }
  async previewDeviceImport(siteId: string, rows: Record<string, unknown>[], user: AuthenticatedUser) {
    if (typeof siteId !== 'string' || !siteId || !Array.isArray(rows) || !rows.length || rows.length > 500) throw new ConflictException('A importação deve conter entre 1 e 500 linhas e um Site.');
    await this.access.assertSite(user, 'CREATE', siteId, 'DEVICE');
    const seen = new Set<string>();
    const preview = [];
    for (let index = 0; index < rows.length; index++) {
      const source = rows[index] ?? {};
      const accepted = ['name', 'type', 'hostname', 'managementIp', 'serialNumber', 'assetTag', 'status', 'modelId', 'rackId', 'rackUnitStart', 'rackUnitSize', 'notes'];
      const row: any = Object.fromEntries(Object.entries(source).filter(([key]) => accepted.includes(key)).map(([key, value]) => [key, typeof value === 'string' ? value.trim() : value]));
      for (const key of ['rackUnitStart', 'rackUnitSize']) if (row[key] !== undefined && row[key] !== '') row[key] = Number(row[key]);
      const errors: string[] = [];
      const types = ['SWITCH', 'ROUTER', 'FIREWALL', 'SERVER', 'STORAGE', 'OTHER'];
      const statuses = ['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN'];
      if (!row.name) errors.push('Nome obrigatório');
      if (!types.includes(row.type)) errors.push('Tipo inválido');
      if (row.status && !statuses.includes(row.status)) errors.push('Estado inválido');
      for (const key of ['rackUnitStart', 'rackUnitSize']) if (row[key] !== undefined && (!Number.isInteger(row[key]) || row[key] < 1)) errors.push(`${key} deve ser um inteiro positivo`);
      try { if (row.type) this.assertDeviceCapability(user, String(row.type)); } catch { errors.push('A sua função não pode importar este tipo de equipamento'); }
      const duplicateKeys = [['serialNumber', row.serialNumber], ['assetTag', row.assetTag], ['managementIp', row.managementIp]].filter((entry) => entry[1]).map(([key, value]) => `${key}:${String(value).toLowerCase()}`);
      if (duplicateKeys.some((key) => seen.has(key))) errors.push('Duplicado noutra linha do ficheiro');
      duplicateKeys.forEach((key) => seen.add(key));
      const ors: Record<string, string>[] = []; if (row.serialNumber) ors.push({ serialNumber: String(row.serialNumber) }); if (row.assetTag) ors.push({ assetTag: String(row.assetTag) }); if (row.managementIp) ors.push({ managementIp: String(row.managementIp) });
      if (ors.length && await this.prisma.device.findFirst({ where: { siteId, OR: ors as any }, select: { id: true, name: true } })) errors.push('Conflito: número de série, etiqueta ou IP de gestão já existe neste Site');
      if (row.modelId) { try { await this.validateDeviceModel(String(row.modelId)); } catch (cause) { errors.push(cause instanceof Error ? cause.message : 'Modelo inválido'); } }
      if (row.rackId) {
        try { await this.access.assertRack(user, 'CREATE', String(row.rackId), 'DEVICE', row.type); if (await this.rackSiteId(String(row.rackId)) !== siteId) errors.push('O bastidor não pertence ao Site selecionado'); await this.validateRackPlacement({ ...row, siteId }); }
        catch (cause) { errors.push(cause instanceof Error ? cause.message : 'Localização inválida'); }
      }
      preview.push({ rowNumber: index + 2, data: row, errors, valid: errors.length === 0 });
    }
    const batchOverlaps = findRackImportOverlaps(preview.map((item) => ({ rowNumber: item.rowNumber, rackId: String(item.data.rackId ?? ''), rackUnitStart: Number(item.data.rackUnitStart), rackUnitSize: Number(item.data.rackUnitSize) })));
    for (const row of preview) if (batchOverlaps.includes(row.rowNumber)) { row.errors.push('Sobreposição com outra linha do ficheiro neste bastidor'); row.valid = false; }
    return { total: preview.length, valid: preview.filter((item) => item.valid).length, invalid: preview.length - preview.filter((item) => item.valid).length, rows: preview };
  }
  async importDevices(siteId: string, rows: Record<string, unknown>[], user: AuthenticatedUser) {
    const preview = await this.previewDeviceImport(siteId, rows, user);
    if (preview.invalid) throw new ConflictException({ code: 'IMPORT_VALIDATION_FAILED', message: 'Corrige os erros antes de confirmar a importação.', rows: preview.rows.filter((item) => !item.valid) });
    const rawCreated = await this.prisma.$transaction(async (tx) => {
      const created = [];
      for (const { data: row } of preview.rows) {
        const status = row.rackId && row.status !== 'RETIRED' ? 'ACTIVE' : row.status ?? 'UNKNOWN';
        created.push(await tx.device.create({ data: { name: row.name, type: row.type, hostname: row.hostname, managementIp: row.managementIp, serialNumber: row.serialNumber, assetTag: row.assetTag, status, modelId: row.modelId, siteId, rackId: row.rackId, rackUnitStart: row.rackUnitStart, rackUnitSize: row.rackUnitSize, notes: row.notes } as never }));
      }
      for (const item of created) await this.audit.recordInTransaction(tx, { userId: user.id, action: 'DEVICE_CREATED', entityType: 'Device', entityId: item.id, metadata: { imported: true, siteId } });
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'DEVICES_IMPORTED', entityType: 'Site', entityId: siteId, metadata: { count: created.length, deviceIds: created.map((item) => item.id) } });
      return created;
    }).catch(() => { throw new ConflictException('A importação foi cancelada porque os dados mudaram ou existe um conflito. Valida novamente o CSV.'); });
    await this.audit.scheduleInventoryQualityReconcile('Device');
    const created = [];
    for (const item of rawCreated) created.push(await this.getDevice(item.id, user));
    return { imported: created.length, devices: created };
  }
  async bulkUpdateDevices(ids: string[], changes: { status?: string; modelId?: string | null; rackId?: string | null }, user: AuthenticatedUser) {
    if (!Array.isArray(ids) || !ids.length || ids.length > 100 || ids.some((id) => typeof id !== 'string') || new Set(ids).size !== ids.length) throw new ConflictException('Seleciona entre 1 e 100 equipamentos distintos.');
    const allowed = ['status', 'modelId', 'rackId'];
    if (!Object.keys(changes ?? {}).length || Object.keys(changes).some((key) => !allowed.includes(key))) throw new ConflictException('Indica pelo menos um campo permitido para atualizar.');
    if (changes.status !== undefined && typeof changes.status !== 'string' || changes.modelId !== undefined && changes.modelId !== null && typeof changes.modelId !== 'string' || changes.rackId !== undefined && changes.rackId !== null && typeof changes.rackId !== 'string') throw new ConflictException('Os valores de atualização não são válidos.');
    const currentDevices = await this.prisma.device.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, type: true, status: true, modelId: true, rackId: true, siteId: true, hostname: true, managementIp: true, serialNumber: true, assetTag: true, rackUnitStart: true, rackUnitSize: true, frontAssetId: true, backAssetId: true, notes: true, rack: { select: { room: { select: { building: { select: { siteId: true } } } } } } } });
    if (currentDevices.length !== ids.length) throw new NotFoundException('Um ou mais equipamentos não foram encontrados.');
    for (const device of currentDevices) { await this.access.assertDevice(user, 'UPDATE', device.id); this.assertDeviceCapability(user, device.type); }
    if (changes.status && !['ACTIVE', 'INACTIVE', 'MAINTENANCE', 'RETIRED', 'UNKNOWN'].includes(changes.status)) throw new ConflictException('Estado inválido.');
    if (changes.modelId) await this.validateDeviceModel(changes.modelId);
    if (changes.rackId) for (const device of currentDevices) await this.access.assertRack(user, 'UPDATE', changes.rackId, 'DEVICE', device.type);
    const targetUnits = new Map<string, number>();
    if (changes.rackId) {
      const target = await this.prisma.rack.findUnique({ where: { id: changes.rackId }, include: { devices: true } });
      if (!target) throw new NotFoundException('Bastidor não encontrado.');
      const selectedIds = new Set(ids);
      const occupied = new Set<number>();
      for (const device of target.devices) if (!selectedIds.has(device.id) && device.rackUnitStart && device.rackUnitSize) for (let unit = device.rackUnitStart; unit < device.rackUnitStart + device.rackUnitSize; unit++) occupied.add(unit);
      for (const device of currentDevices) {
        const size = device.rackUnitSize ?? 1;
        let start = 1;
        for (; start + size - 1 <= target.units; start++) if (Array.from({ length: size }, (_, offset) => start + offset).every((unit) => !occupied.has(unit))) break;
        if (start + size - 1 > target.units) throw new ConflictException('O bastidor selecionado não tem espaço para todos os equipamentos.');
        targetUnits.set(device.id, start);
        for (let unit = start; unit < start + size; unit++) occupied.add(unit);
      }
    }
    const outcome = await updateDevicesIndividually(currentDevices, async (device) => {
      const targetSiteId = device.rack?.room.building.siteId ?? device.siteId;
      const dto: UpdateDeviceDto = { name: device.name, type: device.type, hostname: device.hostname ?? undefined, managementIp: device.managementIp ?? undefined, serialNumber: device.serialNumber ?? undefined, assetTag: device.assetTag ?? undefined, status: changes.status ?? device.status, modelId: changes.modelId === undefined ? device.modelId ?? undefined : changes.modelId as any, siteId: targetSiteId ?? undefined, rackId: changes.rackId === undefined ? device.rackId ?? undefined : changes.rackId as any, rackUnitStart: changes.rackId === undefined ? device.rackUnitStart ?? undefined : changes.rackId === null ? null as any : targetUnits.get(device.id), rackUnitSize: device.rackUnitSize ?? undefined, frontAssetId: device.frontAssetId ?? undefined, backAssetId: device.backAssetId ?? undefined, notes: device.notes ?? undefined };
      return this.updateDevice(device.id, dto, user, true);
    });
    let batchAuditFailed = false;
    try { await this.log(user, 'DEVICES_BULK_UPDATED', 'Device', 'bulk', { deviceIds: outcome.updatedIds, failed: outcome.failed, auditFailed: outcome.auditFailed, changes }); }
    catch { batchAuditFailed = true; }
    return { updated: outcome.updatedIds.length, updatedIds: outcome.updatedIds, failed: outcome.failed, auditFailed: outcome.auditFailed, batchAuditFailed };
  }
  private async validateDeviceModel(modelId?: string) { if (!modelId) return; const model = await this.prisma.deviceModel.findUnique({ where: { id: modelId }, select: { model: true, supportsNetworkPorts: true, networkPortCount: true, portCount: true, portLayout: true } }); if (!model) throw new NotFoundException('Modelo não encontrado'); assertPortMappingComplete(model); }
  private async validateDeviceAsset(assetId: string | null | undefined, face: PortLayoutFace, attachedId?: string | null) { if (assetId) await this.assertFaceImage(assetId, face, this.prisma, attachedId); }
  /** Image fields of a device update: an absent field never touches the column, null (or '') clears it on purpose. */
  private normalizeDeviceAssetFields<T extends { frontAssetId?: string | null; backAssetId?: string | null }>(dto: T): T { const next = { ...dto }; for (const field of ['frontAssetId', 'backAssetId'] as const) { if (!(field in next) || next[field] === undefined) delete next[field]; else if (next[field] === '') next[field] = null; } return next; }
  /**
   * A face image must be an existing image asset: its MIME type must be image/* and its stored bytes must really be
   * SVG, PNG, JPEG or WebP (asset `kind` is free text, so it cannot be used as the purpose check).
   * The bytes are only read when the image is being newly attached (assetId !== attachedId), so an unrelated edit of a
   * record whose old image predates this check (or whose file is missing) is not blocked by it.
   */
  private async assertFaceImage(assetId: string, face: PortLayoutFace, client: { assetFile: { findUnique: (args: any) => Promise<any> } } = this.prisma, attachedId?: string | null) {
    const asset = await client.assetFile.findUnique({ where: { id: assetId }, select: { id: true, mimeType: true, storageKey: true } });
    if (!asset) throw new NotFoundException(face === 'front' ? 'A imagem frontal selecionada não foi encontrada' : 'A imagem traseira selecionada não foi encontrada');
    const notImage = () => new BadRequestException({ code: 'ASSET_NOT_IMAGE', message: 'O asset selecionado não é uma imagem.', face });
    if (asset.mimeType && !String(asset.mimeType).startsWith('image/')) throw notImage();
    if (assetId === attachedId) return;
    // Older uploads were stored on the declared type alone, so check the real bytes too.
    const bytes = await this.readAssetBytes(asset.storageKey).catch(() => { throw new NotFoundException('Ficheiro do asset não encontrado'); });
    if (!sniffImageMime(bytes)) throw notImage();
  }
  private async validateDeviceFrontAsset(frontAssetId?: string) { return this.validateDeviceAsset(frontAssetId, 'front'); }
  /**
   * Model create/edit rules: a front image is required on create (FRONT_IMAGE_REQUIRED) and cannot be removed on edit.
   * Models that have no front image yet (migrated ones) can still be edited; inventory quality flags them.
   * A portLayout in the body is normalised to v2 and validated per face.
   */
  private async prepareModelWrite(dto: CreateDeviceModelDto, current: { frontAssetId: string | null; backAssetId?: string | null; portLayout: unknown } | null) {
    const data: Record<string, unknown> = { ...dto };
    const removesFront = dto.frontAssetId === null || dto.frontAssetId === '';
    if (!current && !dto.frontAssetId) throw new BadRequestException({ code: 'FRONT_IMAGE_REQUIRED', message: 'A imagem frontal do modelo é obrigatória.' });
    if (current && removesFront && current.frontAssetId) throw new BadRequestException({ code: 'FRONT_IMAGE_REQUIRED', message: 'A imagem frontal do modelo é obrigatória e não pode ser removida.' });
    if (removesFront) data.frontAssetId = null;
    if (dto.backAssetId === '') data.backAssetId = null;
    for (const [face, assetId, attached] of [['front', data.frontAssetId, current?.frontAssetId], ['rear', data.backAssetId, current?.backAssetId]] as const) if (typeof assetId === 'string') await this.assertFaceImage(assetId, face, this.prisma, attached);
    if (dto.portLayout !== undefined) {
      const layout = normalizePortLayout(dto.portLayout);
      if (layout) for (const face of ['front', 'rear'] as const) if (layout.faces[face]) assertWritableLayout(layout, face, { ...dto });
      if (layout) data.portLayout = layout; else delete data.portLayout;
    }
    return data;
  }
  private async validateRackPlacement(dto: CreateDeviceDto, deviceId?: string) { if (!dto.rackId) return; if (!dto.rackUnitStart || !dto.rackUnitSize) throw new ConflictException('Define a unidade inicial e o tamanho do equipamento'); const rack = await this.prisma.rack.findUnique({ where: { id: dto.rackId }, include: { room: { include: { building: true } }, devices: true } }); if (!rack) throw new NotFoundException('Bastidor não encontrado'); if (dto.rackUnitStart < 1 || dto.rackUnitStart + dto.rackUnitSize - 1 > rack.units) throw new ConflictException('A posição do equipamento excede as unidades do bastidor'); if (dto.siteId && dto.siteId !== rack.room.building.siteId) throw new ConflictException('O bastidor não pertence ao Site selecionado'); const end = dto.rackUnitStart + dto.rackUnitSize - 1; const overlap = rack.devices.some((device) => device.id !== deviceId && device.rackUnitStart && device.rackUnitSize && dto.rackUnitStart! <= device.rackUnitStart + device.rackUnitSize - 1 && end >= device.rackUnitStart); if (overlap) throw new ConflictException('A posição indicada já está ocupada no bastidor'); }
  private async rackSiteId(rackId: string) { return (await this.prisma.rack.findUnique({ where: { id: rackId }, select: { room: { select: { building: { select: { siteId: true } } } } } }))?.room.building.siteId; }
  private async validateManagementIp(user: AuthenticatedUser, managementIpAddressId: string | undefined, siteId: string) {
    if (!managementIpAddressId) return;
    const ip = await this.ipamAccess.assertIp(user, 'UPDATE', managementIpAddressId);
    if (ip.subnet.siteId !== siteId) throw new ConflictException({ code: 'MANAGEMENT_IP_SITE_MISMATCH', message: 'O IP de gestão tem de pertencer ao mesmo Site do equipamento.' });
  }
  /**
   * Keeps PDU outlet assignments consistent after a device write inside the same transaction:
   * moved to another rack or out of a rack => every assignment is deleted (the user re-runs the power step);
   * plug count reduced => assignments for plugs that no longer exist are deleted. Returns the number removed.
   */
  private async releaseDevicePower(tx: any, deviceId: string, previousRackId: string | null) {
    const device = await tx.device.findUnique({ where: { id: deviceId }, select: { rackId: true, powerPlugCount: true, model: { select: { powerPlugCount: true } } } });
    if (!device || (!device.rackId && !previousRackId)) return 0;
    if (device.rackId !== previousRackId || !device.rackId) return (await tx.pduOutletAssignment.deleteMany({ where: { deviceId } })).count;
    return (await tx.pduOutletAssignment.deleteMany({ where: { deviceId, plugIndex: { gt: resolvePlugCount(device).count } } })).count;
  }
  async createDevice(dto: CreateDeviceDto, user: AuthenticatedUser) {
    dto = this.normalizeDeviceAssetFields(dto);
    this.assertDeviceCapability(user, dto.type);
    const status = (dto.rackId && dto.status !== 'RETIRED' ? 'ACTIVE' : (dto.status ?? 'UNKNOWN'));
    // Required configurations (docs/device-required-config.md): every config that applies must be filled on create.
    // `power` is assumed satisfiable here when a power block is sent; the allocation is re-checked inside the transaction.
    const model = dto.modelId ? await this.prisma.deviceModel.findUnique({ where: { id: dto.modelId }, select: { backAssetId: true, powerPlugCount: true } }) : null;
    const planned = { name: dto.name, type: dto.type, siteId: dto.siteId, rackId: dto.rackId, status, backAssetId: dto.backAssetId ?? null, modelBackAssetId: model?.backAssetId ?? null, powerPlugCount: dto.power?.powerPlugCount !== undefined ? dto.power.powerPlugCount : dto.powerPlugCount, modelPowerPlugCount: model?.powerPlugCount ?? null, connectedPlugs: dto.power ? 1 : 0 };
    const violations = createViolations(planned);
    if (violations.length) throw new RequiredConfigException(violations);
    if (dto.rackId) await this.access.assertRack(user, 'CREATE', dto.rackId, 'DEVICE', dto.type); else if (dto.siteId) await this.access.assertSite(user, 'CREATE', dto.siteId, 'DEVICE', dto.type);
    await this.validateDeviceModel(dto.modelId); await this.validateDeviceFrontAsset(dto.frontAssetId); await this.validateDeviceAsset(dto.backAssetId, 'rear'); await this.validateRackPlacement(dto);
    const targetSiteId = dto.rackId ? await this.rackSiteId(dto.rackId) : dto.siteId;
    if (!targetSiteId) throw new NotFoundException('Site do equipamento não encontrado');
    await this.validateManagementIp(user, dto.managementIpAddressId, targetSiteId);
    try {
      const item = await this.prisma.$transaction(async (tx) => {
        const data = { ...dto, siteId: targetSiteId, status: status as never } as any; delete data.managementIpAddressId; delete data.power;
        const created = await tx.device.create({ data });
        if (dto.managementIpAddressId) await tx.ipAddress.update({ where: { id: dto.managementIpAddressId }, data: { deviceId: created.id } });
        if (dto.power) {
          const { allocation, fieldChanges } = await applyDevicePowerInTransaction(tx, { ...created, model }, dto.power);
          const missing = createViolations({ ...planned, ...('powerPlugCount' in fieldChanges ? { powerPlugCount: fieldChanges.powerPlugCount } : {}), connectedPlugs: allocation.assignments.length }).filter((error) => error.config === 'power');
          if (missing.length) throw new RequiredConfigException(missing.map((error) => allocation.unplugged.some((plug) => plug.reason === 'NO_FREE_OUTLET') ? requiredConfigError('power', 'NO_FREE_OUTLET', 'O bastidor não tem tomadas livres para ligar o equipamento. Liberta uma tomada ou aumenta o número de tomadas da PDU.') : error));
        }
        return created;
      });
      await this.log(user, 'DEVICE_CREATED', 'Device', item.id, dto.power ? { power: true } : undefined);
      return this.getDevice(item.id, user);
    } catch (error) {
      if (error instanceof HttpException) throw error;
      throw new ConflictException('Não foi possível criar o equipamento');
    }
  }
  private async buildDevicePlacementPlan(client: any, id: string, dto: PlaceDeviceDto) {
    const device = await client.device.findUnique({ where: { id }, include: { rack: { include: { room: { include: { building: true } } } } } });
    if (!device) throw new NotFoundException('Equipamento não encontrado');
    const targetRack = await client.rack.findUnique({ where: { id: dto.rackId }, include: { room: { include: { building: true } } } });
    if (!targetRack) throw new NotFoundException('Bastidor de destino não encontrado');
    const targetSiteId = targetRack.room.building.siteId;
    if (device.rackId) {
      if (targetSiteId !== device.rack.room.building.siteId) throw new ConflictException('O bastidor de destino tem de pertencer ao mesmo Site do equipamento');
      if (targetRack.room.id !== device.rack.room.id) throw new ConflictException('O equipamento só pode ser movido entre bastidores da mesma sala');
      if (!device.rackUnitStart || !device.rackUnitSize) throw new ConflictException('O equipamento não tem uma posição válida no bastidor de origem');
    } else if (device.siteId !== targetSiteId) {
      throw new ConflictException('O bastidor não pertence ao Site do equipamento');
    }

    const rackIds = [...new Set([...(device.rackId ? [device.rackId] : []), dto.rackId])];
    const racks = await client.rack.findMany({
      where: { id: { in: rackIds } },
      include: { devices: { where: { status: { not: 'RETIRED' } } } },
    });
    try {
      const placementRacks = racks.map((rack: any) => ({
          id: rack.id,
          name: rack.name,
          units: rack.units,
          devices: rack.devices
            .filter((item: any) => item.rackUnitStart && item.rackUnitSize)
            .map((item: any) => ({ id: item.id, name: item.name, rackId: rack.id, rackUnitStart: item.rackUnitStart, rackUnitSize: item.rackUnitSize })),
        }));
      if (!device.rackId) {
        const target = placementRacks.find((rack: any) => rack.id === dto.rackId)!;
        target.devices.push({ id: device.id, name: device.name, rackId: dto.rackId, rackUnitStart: dto.rackUnitStart, rackUnitSize: device.rackUnitSize ?? 1 });
      }
      return planRackPlacement(
        placementRacks,
        id,
        dto.rackId,
        dto.rackUnitStart,
      );
    } catch (error) {
      throw new ConflictException(error instanceof Error ? error.message : 'Não foi possível posicionar o equipamento');
    }
  }
  async previewDevicePlacement(id: string, dto: PlaceDeviceDto, user: AuthenticatedUser) { const device = await this.access.assertDevice(user, 'UPDATE', id); this.assertDeviceCapability(user, device.type); await this.access.assertRack(user, 'UPDATE', dto.rackId, 'DEVICE', device.type); return this.buildDevicePlacementPlan(this.prisma, id, dto); }
  async placeDevice(id: string, dto: PlaceDeviceDto, user: AuthenticatedUser) {
    const device = await this.access.assertDevice(user, 'UPDATE', id);
    this.assertDeviceCapability(user, device.type);
    await this.access.assertRack(user, 'UPDATE', dto.rackId, 'DEVICE', device.type);
    let plan: RackPlacementPlan;
    const powerReleased: { deviceId: string; removed: number }[] = [];
    try {
      plan = await this.prisma.$transaction(async (tx) => {
        const next = await this.buildDevicePlacementPlan(tx, id, dto);
        for (const change of next.changes) {
          const previous = await tx.device.findUnique({ where: { id: change.id }, select: { rackId: true } });
          const rack = await tx.rack.findUnique({ where: { id: change.rackId }, select: { room: { select: { building: { select: { siteId: true } } } } } });
          await tx.device.update({ where: { id: change.id }, data: { rackId: change.rackId, rackUnitStart: change.rackUnitStart, siteId: rack!.room.building.siteId, status: 'ACTIVE' } });
          const released = await this.releaseDevicePower(tx, change.id, previous?.rackId ?? null);
          if (released) powerReleased.push({ deviceId: change.id, removed: released });
        }
        return next;
      }, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error instanceof ConflictException) throw error;
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
        throw new ConflictException('A localização foi alterada por outra operação. Atualiza os bastidores e tenta novamente.');
      }
      throw error;
    }
    await this.log(user, 'DEVICE_PLACEMENT_UPDATED', 'Device', id, { changes: plan.changes, ...(powerReleased.length ? { powerReleased } : {}) });
    return plan;
  }
  /**
   * PATCH devices/:id. `preserveRequestedStatus` is the bulk-update path: it skips the required-config rule
   * (bulk moves cannot carry per-device images or outlets; affected devices surface in the topbar alert instead).
   */
  async updateDevice(id: string, dto: UpdateDeviceDto, user: AuthenticatedUser, preserveRequestedStatus = false) {
    const enforceRequiredConfig = !preserveRequestedStatus;
    dto = this.normalizeDeviceAssetFields(dto);
    const current = await this.prisma.device.findUnique({ where: { id }, select: { id: true, name: true, status: true, siteId: true, rackId: true, modelId: true, frontAssetId: true, backAssetId: true, type: true, powerPlugCount: true, estimatedWatts: true, model: { select: { backAssetId: true, powerPlugCount: true, typicalWatts: true, maxWatts: true } }, _count: { select: { pduOutlets: true } }, rack: { select: { room: { select: { building: { select: { siteId: true } } } } } } } });
    if (!current) throw new NotFoundException('Equipamento não encontrado');
    this.assertDeviceCapability(user, current.type); this.assertDeviceCapability(user, dto.type);
    await this.access.assertDevice(user, 'UPDATE', id);
    if (dto.rackId && dto.rackId !== current.rackId) await this.access.assertRack(user, 'UPDATE', dto.rackId, 'DEVICE', dto.type);
    if (dto.modelId && dto.modelId !== current.modelId) await this.validateDeviceModel(dto.modelId);
    await this.validateDeviceAsset(dto.frontAssetId === undefined ? current.frontAssetId : dto.frontAssetId, 'front', current.frontAssetId);
    await this.validateDeviceAsset(dto.backAssetId === undefined ? current.backAssetId : dto.backAssetId, 'rear', current.backAssetId);
    await this.validateRackPlacement(dto, id);
    const currentSiteId = current.rack?.room.building.siteId ?? current.siteId;
    const targetSiteId = dto.rackId ? await this.rackSiteId(dto.rackId) : dto.siteId ?? currentSiteId;
    if (!targetSiteId) throw new NotFoundException('Site do equipamento não encontrado');
    if (dto.rackId && dto.siteId && dto.siteId !== targetSiteId) throw new ConflictException('O bastidor não pertence ao Site selecionado');
    if (!dto.rackId && targetSiteId !== currentSiteId) await this.access.assertSite(user, 'UPDATE', targetSiteId, 'DEVICE', dto.type);
    await this.validateManagementIp(user, dto.managementIpAddressId, targetSiteId);
    const status = !preserveRequestedStatus && dto.rackId && current.status !== 'RETIRED' ? 'ACTIVE' : (dto.status ?? current.status);
    // Required configurations (updateViolations): core always; placing into a rack = like create; filled configs can't be cleared.
    const before = toDeviceConfigState(current);
    const targetModelId = dto.modelId === undefined ? current.modelId : dto.modelId || null;
    const targetModel = targetModelId === current.modelId ? current.model : targetModelId ? await this.prisma.deviceModel.findUnique({ where: { id: targetModelId }, select: { backAssetId: true, powerPlugCount: true, typicalWatts: true, maxWatts: true } }) : null;
    const targetRackId = dto.rackId === undefined ? current.rackId : dto.rackId || null;
    const planned = { ...before, name: dto.name, type: dto.type, siteId: targetSiteId, rackId: targetRackId, status, backAssetId: dto.backAssetId === undefined ? current.backAssetId : dto.backAssetId, modelBackAssetId: targetModel?.backAssetId ?? null, powerPlugCount: dto.power?.powerPlugCount !== undefined ? dto.power.powerPlugCount : dto.powerPlugCount === undefined ? current.powerPlugCount : dto.powerPlugCount, modelPowerPlugCount: targetModel?.powerPlugCount ?? null };
    const rackChanged = targetRackId !== current.rackId;
    const rackPowerMessage = 'Ao colocar o equipamento num bastidor indica as tomadas da PDU (power) ou 0 fichas se não tiver alimentação; as tomadas do bastidor anterior são libertadas.';
    if (enforceRequiredConfig) {
      // Precheck returns every error at once; power is estimated (a move frees outlets, `power` will plug in) and
      // re-checked authoritatively inside the transaction.
      const estimatedPlugs = dto.power ? 1 : rackChanged ? 0 : before.connectedPlugs;
      const violations = updateViolations(before, { ...planned, connectedPlugs: estimatedPlugs })
        .map((error) => error.config === 'power' && rackChanged ? requiredConfigError('power', error.reason, rackPowerMessage) : error);
      if (violations.length) throw new RequiredConfigException(violations);
    }
    let powerAssignmentsRemoved = 0;
    const item = await this.prisma.$transaction(async (tx) => {
      const data = { ...dto, siteId: targetSiteId, status: status as never, managementIpAddressId: undefined } as any; delete data.managementIpAddressId; delete data.power;
      for (const field of ['frontAssetId', 'backAssetId']) if (data[field] === undefined) delete data[field];
      const updated = await tx.device.update({ where: { id }, data });
      if (dto.managementIpAddressId) await tx.ipAddress.update({ where: { id: dto.managementIpAddressId }, data: { deviceId: id } });
      powerAssignmentsRemoved = await this.releaseDevicePower(tx, id, current.rackId);
      let connectedPlugs = await tx.pduOutletAssignment.count({ where: { deviceId: id } });
      let noFreeOutlet = false;
      if (dto.power) {
        const { allocation } = await applyDevicePowerInTransaction(tx, { ...updated, model: targetModel }, dto.power);
        connectedPlugs = allocation.assignments.length; noFreeOutlet = allocation.unplugged.some((plug) => plug.reason === 'NO_FREE_OUTLET');
      }
      if (enforceRequiredConfig) {
        const after = await tx.device.findUnique({ where: { id }, select: { powerPlugCount: true } });
        const violations = updateViolations(before, { ...planned, powerPlugCount: after?.powerPlugCount ?? null, connectedPlugs }, ['power']);
        if (violations.length) throw new RequiredConfigException(violations.map((error) => noFreeOutlet
          ? requiredConfigError('power', 'NO_FREE_OUTLET', 'O bastidor não tem tomadas livres para ligar o equipamento. Liberta uma tomada ou aumenta o número de tomadas da PDU.')
          : rackChanged && !dto.power ? requiredConfigError('power', error.reason, rackPowerMessage) : error));
      }
      return updated;
    }).catch((error: unknown) => { if (error instanceof HttpException) throw error; throw new ConflictException('Não foi possível atualizar o equipamento e o respetivo IP de gestão'); });
    try { await this.log(user, 'DEVICE_UPDATED', 'Device', id, { rackId: dto.rackId, managementIp: dto.managementIp, managementIpAddressId: dto.managementIpAddressId, ...(dto.power ? { power: true } : {}), ...(powerAssignmentsRemoved ? { powerAssignmentsRemoved } : {}) }); } catch (error) { if (preserveRequestedStatus) throw new PersistedDeviceAuditError(id); throw error; }
    return preserveRequestedStatus ? item : this.getDevice(item.id, user);
  }
  async deleteDevice(_id: string, _user: AuthenticatedUser) { throw new ConflictException('A retirada exige a revisão do checklist. Consulta GET /api/v1/devices/:id/retirement-review e confirma em POST /api/v1/devices/:id/retire.'); }
  async deviceRetirementReview(id: string, user: AuthenticatedUser, permission: 'READ' | 'DELETE' = 'READ') {
    await this.access.assertDevice(user, permission, id);
    const device = await this.prisma.device.findUnique({ where: { id }, select: { id: true, name: true, siteId: true, interfaces: { select: { id: true, name: true, ipAddresses: { select: { id: true, address: true, subnet: { select: { cidr: true } } } } } }, ipAddresses: { select: { id: true, address: true, subnet: { select: { cidr: true } }, interface: { select: { id: true, name: true } } } }, topologyNodes: { select: { map: { select: { id: true, name: true, type: true } } } } } });
    if (!device) throw new NotFoundException('Equipamento não encontrado');
    return { device: { id: device.id, name: device.name }, interfaces: device.interfaces.map(({ id, name }) => ({ id, name })), ipAddresses: device.ipAddresses, mapReferences: device.topologyNodes.map(({ map }) => map) };
  }
  async confirmDeviceRetirement(id: string, user: AuthenticatedUser, operatorConfirmed: boolean) {
    if (!operatorConfirmed) throw new BadRequestException('A confirmação do operador é obrigatória');
    await this.access.assertDevice(user, 'DELETE', id);
    const review = await this.deviceRetirementReview(id, user, 'DELETE');
    const metadata = { operatorConfirmed, interfaceCount: review.interfaces.length, ipAddressIds: review.ipAddresses.map((ip) => ip.id), mapIds: review.mapReferences.map((map) => map.id) };
    const updated = await this.prisma.$transaction(async (tx) => {
      const device = await tx.device.update({ where: { id }, data: { status: 'RETIRED' } }).catch(() => { throw new NotFoundException('Equipamento não encontrado'); });
      await tx.auditLog.create({ data: { userId: user.id, action: 'DEVICE_RETIREMENT_CONFIRMED', entityType: 'Device', entityId: id, metadata } });
      return device;
    });
    await this.audit.scheduleInventoryQualityReconcile('Device');
    return { success: true, device: updated };
  }
  private readonly vlanInclude = { include: { subnets: { take: 1, orderBy: { id: 'asc' as const } } } };
  async listInterfaces(user: AuthenticatedUser, deviceId?: string, search?: string) { if (deviceId) await this.access.assertDevice(user, 'READ', deviceId); const [roomIds, unplacedSiteIds] = deviceId ? [[], []] : await Promise.all([this.access.visibleRoomIds(user), this.access.visibleUnplacedSiteIds(user)]); const items = await this.prisma.deviceInterface.findMany({ where: { ...(deviceId ? { deviceId } : { device: { OR: [{ rackId: null, siteId: { in: unplacedSiteIds } }, { rack: { roomId: { in: roomIds } } }] } }), ...(search ? { OR: [{ name: { contains: search, mode: 'insensitive' } }, { description: { contains: search, mode: 'insensitive' } }] } : {}) }, include: { device: { include: { model: true } }, nativeVlan: this.vlanInclude, accessVlan: this.vlanInclude, allowedVlans: { include: { vlan: this.vlanInclude } }, ipAddresses: { include: { subnet: true, host: true } } } }); const natural = (value: string) => value.toLocaleLowerCase().split(/(\d+)/).map((part) => /^\d+$/.test(part) ? Number(part) : part); const compare = (a: any, b: any) => { const aa = natural(a.name ?? a.portKey ?? ''); const bb = natural(b.name ?? b.portKey ?? ''); for (let index = 0; index < Math.max(aa.length, bb.length); index++) { if (aa[index] === undefined) return -1; if (bb[index] === undefined) return 1; if (aa[index] === bb[index]) continue; return aa[index] < bb[index] ? -1 : 1; } return String(a.name).localeCompare(String(b.name)); }; return normalizeModelLayouts(items.sort((a, b) => a.deviceId.localeCompare(b.deviceId) || compare(a, b))); }
  async getInterface(id: string, user: AuthenticatedUser) { await this.access.assertInterface(user, 'READ', id); const item = await this.prisma.deviceInterface.findUnique({ where: { id }, include: { device: { include: { model: true } }, nativeVlan: this.vlanInclude, accessVlan: this.vlanInclude, allowedVlans: { include: { vlan: this.vlanInclude } }, ipAddresses: { include: { subnet: true, host: true } } } }); if (!item) throw new NotFoundException('Interface não encontrada'); return normalizeModelLayouts(item); }
  async createInterface(deviceId: string, dto: CreateInterfaceDto, user: AuthenticatedUser) { await Promise.all([this.access.assertDevice(user, 'CREATE', deviceId), this.assertDeviceIdCapability(user, deviceId)]); try { const { allowedVlanIds, ...fields } = dto; const item = await this.prisma.deviceInterface.create({ data: { ...fields, deviceId, allowedVlans: { create: (allowedVlanIds ?? []).map((vlanId) => ({ vlanId })) } } as never }); await this.log(user, 'DEVICE_INTERFACE_CREATED', 'DeviceInterface', item.id); return this.getInterface(item.id, user); } catch { throw new ConflictException('Não foi possível criar a interface'); } }
  async updateInterface(id: string, dto: UpdateInterfaceDto, user: AuthenticatedUser) { await this.access.assertInterface(user, 'UPDATE', id); const { allowedVlanIds, id: _ignoredId, source: _ignoredSource, lastSeenAt: _ignoredLastSeenAt, deviceId: _ignoredDeviceId, device: _ignoredDevice, nativeVlan: _ignoredNativeVlan, accessVlan: _ignoredAccessVlan, allowedVlans: _ignoredAllowedVlans, ipAddresses: _ignoredIpAddresses, ...fields } = dto; const item = await this.prisma.deviceInterface.update({ where: { id }, data: { ...fields, allowedVlans: allowedVlanIds ? { deleteMany: {}, create: allowedVlanIds.map((vlanId) => ({ vlanId })) } : undefined } as never }).catch(() => { throw new NotFoundException('Interface não encontrada'); }); await this.log(user, 'DEVICE_INTERFACE_UPDATED', 'DeviceInterface', id); return this.getInterface(item.id, user); }
  async generateInterfaces(deviceId: string, user: AuthenticatedUser) { await Promise.all([this.access.assertDevice(user, 'CREATE', deviceId), this.assertDeviceIdCapability(user, deviceId)]); const device = await this.prisma.device.findUnique({ where: { id: deviceId }, include: { model: true, interfaces: { select: { name: true, portKey: true } } } }); if (!device) throw new NotFoundException('Equipamento não encontrado'); const layout = allLayoutPorts(normalizePortLayout(device.model?.portLayout)).filter(isPortMapped); const count = device.model ? expectedNetworkPorts(device.model) : 0; const ports: Array<{ portKey: string; label?: string; interfaceType?: string }> = layout.length ? layout : Array.from({ length: count }, (_, index) => ({ portKey: `ethernet1/${index + 1}`, label: `${index + 1}`, interfaceType: 'ETHERNET' })); const existing = new Set(device.interfaces.map((item) => item.portKey || item.name)); let created = 0; for (const port of ports) { const name = String(port.label || port.portKey); if (existing.has(String(port.portKey)) || existing.has(name)) continue; await this.prisma.deviceInterface.create({ data: { deviceId, name, portKey: String(port.portKey), interfaceType: String(port.interfaceType ?? 'ETHERNET'), adminUp: true, operUp: false } as never }); created++; } await this.log(user, 'DEVICE_INTERFACES_GENERATED', 'Device', deviceId, { created, total: ports.length }); return { created, total: ports.length }; }
  async deleteInterface(id: string, user: AuthenticatedUser) { await this.access.assertInterface(user, 'DELETE', id); await this.prisma.deviceInterface.delete({ where: { id } }).catch(() => { throw new NotFoundException('Interface não encontrada'); }); await this.log(user, 'DEVICE_INTERFACE_DELETED', 'DeviceInterface', id); return { success: true }; }
  private readonly portLayoutSelect = { id: true, model: true, frontAssetId: true, backAssetId: true, frontAsset: true, backAsset: true, portLayout: true, networkPortCount: true, portCount: true, supportsNetworkPorts: true } as const;
  /** GET port-layout: the whole v2 layout plus the requested face, its image and the mandatory-mapping status. */
  async getPortLayout(id: string, face: PortLayoutFace = 'rear') {
    const item = await this.prisma.deviceModel.findUnique({ where: { id }, select: this.portLayoutSelect });
    if (!item) throw new NotFoundException('Modelo não encontrado');
    const portLayout = normalizePortLayout(item.portLayout);
    return { ...item, portLayout, revision: portLayoutRevision(item), face, faceLayout: portLayout?.faces[face] ?? null, asset: face === 'front' ? item.frontAsset : item.backAsset, mapping: portMappingStatus(item) };
  }
  /** Locks the model row for the rest of the transaction, so concurrent layout saves are serialised. */
  private async lockModel(tx: any, id: string) { await tx.$queryRaw`SELECT "id" FROM "DeviceModel" WHERE "id"::text = ${id} FOR UPDATE`; }
  private assertRevision(revision: string | undefined, current: { portLayout?: unknown; frontAssetId?: string | null; backAssetId?: string | null }) {
    if (revision === undefined) return;
    const actual = portLayoutRevision(current);
    if (revision !== actual) throw new ConflictException({ code: 'PORT_LAYOUT_CONFLICT', message: 'O mapa de portas foi alterado por outra pessoa. Recarrega e volta a aplicar as alterações.', revision: actual });
  }
  /**
   * Atomic save of both faces: PUT device-models/:id/port-layout/faces { revision, faces: { front?, rear? } }.
   * A face object replaces that face (and sets its image when assetId is given), null removes that face's map
   * (the image stays), an absent key leaves the face alone. Both faces are validated together and written in one
   * transaction under a row lock; a stale revision gets 409 PORT_LAYOUT_CONFLICT.
   */
  async savePortLayoutFaces(id: string, dto: { revision?: string; faces?: unknown }, user: AuthenticatedUser) {
    if (typeof dto.revision !== 'string' || !dto.revision) throw new BadRequestException({ code: 'PORT_LAYOUT_REVISION_REQUIRED', message: 'Indica a revisão (revision) devolvida pelo GET port-layout.' });
    const faces = dto.faces;
    if (!faces || typeof faces !== 'object' || Array.isArray(faces)) throw new BadRequestException({ code: 'PORT_LAYOUT_FACES_REQUIRED', message: 'Indica as faces a guardar (faces.front e/ou faces.rear).' });
    const keys = Object.keys(faces);
    const unknown = keys.filter((key) => key !== 'front' && key !== 'rear');
    if (unknown.length) throw new BadRequestException({ code: 'PORT_LAYOUT_FACE_INVALID', message: `Face desconhecida: ${unknown.join(', ')}. Usa front ou rear.` });
    if (!keys.length) throw new BadRequestException({ code: 'PORT_LAYOUT_FACES_REQUIRED', message: 'Indica as faces a guardar (faces.front e/ou faces.rear).' });
    const input = faces as FacesInput;
    const saved = await this.prisma.$transaction(async (tx: any) => {
      await this.lockModel(tx, id);
      const model = await tx.deviceModel.findUnique({ where: { id }, select: { portLayout: true, frontAssetId: true, backAssetId: true, supportsNetworkPorts: true, networkPortCount: true, portCount: true } });
      if (!model) throw new NotFoundException('Modelo não encontrado');
      this.assertRevision(dto.revision, model);
      const layout = applyFaces(model.portLayout, input);
      assertWritableFaces(layout, PORT_LAYOUT_FACES, model);
      const images: Record<string, string> = {};
      for (const face of PORT_LAYOUT_FACES) {
        const assetId = input[face]?.assetId;
        if (assetId === undefined || assetId === null) continue;
        if (typeof assetId !== 'string' || !assetId) throw new BadRequestException({ code: 'ASSET_ID_REQUIRED', message: 'assetId tem de ser o id de uma imagem.' });
        await this.assertFaceImage(assetId, face, tx, model[faceAssetField(face)]);
        images[faceAssetField(face)] = assetId;
      }
      await tx.deviceModel.update({ where: { id }, data: { portLayout: layout as never, ...images } });
      return { layout, images };
    });
    await this.log(user, 'DEVICE_MODEL_PORT_LAYOUT_UPDATED', 'DeviceModel', id, { faces: keys, ports: { front: saved.layout.faces.front?.ports.length ?? 0, rear: saved.layout.faces.rear?.ports.length ?? 0 }, ...saved.images });
    const { face: _face, faceLayout: _faceLayout, asset: _asset, ...result } = await this.getPortLayout(id);
    return result;
  }
  async setModelFrontAsset(id: string, assetId: string, user: AuthenticatedUser) { return this.setModelFaceAsset(id, 'front', assetId, user); }
  async setModelFaceAsset(id: string, face: PortLayoutFace, assetId: string, user: AuthenticatedUser) {
    if (!assetId) throw new BadRequestException({ code: 'ASSET_ID_REQUIRED', message: 'Indica o assetId da imagem.' });
    await this.assertFaceImage(assetId, face);
    const item = await this.prisma.deviceModel.update({ where: { id }, data: { [faceAssetField(face)]: assetId } }).catch(() => { throw new NotFoundException('Modelo não encontrado'); });
    await this.log(user, 'ASSET_ASSOCIATED', 'DeviceModel', id, { assetId, role: face === 'front' ? 'front' : 'rear' });
    return normalizeModelLayouts(item);
  }
  /** Port keys the other face already uses, so a generated grid for this face never collides with it. */
  private gridPorts(count: number, taken: Set<string>, label: (n: number) => string, interfaceType: string, extra: (index: number, columns: number, rows: number) => Record<string, number>) {
    const columns = Math.max(1, Math.min(24, count)); const rows = Math.max(1, Math.ceil(count / columns));
    const ports: Array<Record<string, unknown>> = []; let n = 0;
    while (ports.length < count) { n++; const portKey = `ethernet1/${n}`; if (taken.has(portKey)) continue; const index = ports.length; ports.push({ portKey, label: label(n), interfaceType, ...extra(index, columns, rows) }); }
    return ports;
  }
  private otherFaceKeys(layout: unknown, face: PortLayoutFace) { const other = face === 'front' ? 'rear' : 'front'; return { other, ports: (normalizePortLayout(layout)?.faces[other]?.ports ?? []).filter(isPortMapped) }; }
  async detectPortLayout(id: string, dto: DetectPortLayoutDto, face: PortLayoutFace = 'rear') {
    const model = await this.prisma.deviceModel.findUnique({ where: { id }, select: { supportsNetworkPorts: true, networkPortCount: true, portCount: true, model: true, portLayout: true } }); if (!model) throw new NotFoundException('Modelo não encontrado');
    const { ports: otherPorts } = this.otherFaceKeys(model.portLayout, face);
    const count = dto.portCount ?? Math.max(0, expectedNetworkPorts(model) - otherPorts.length);
    if (!count) throw new ConflictException('Define primeiro o número de portas do modelo');
    const columns = Math.min(dto.columns ?? (count > 24 ? 24 : count), count); const rows = Math.ceil(count / columns); const type = dto.portType ?? 'GIGABIT_ETHERNET';
    const ports = this.gridPorts(count, new Set(otherPorts.map((port) => port.portKey)), (n) => `Gi1/${n}`, type, (index) => ({ x: ((index % columns) + 0.5) / columns, y: ((Math.floor(index / columns)) + 0.5) / rows, width: 0.62 / columns, height: 0.34 / rows }));
    return { face, imageWidth: dto.imageWidth ?? 1000, imageHeight: dto.imageHeight ?? 300, confidence: 0.35, ports, warnings: ['A deteção atual é uma grelha geométrica, não uma análise da imagem; confirma as zonas antes de guardar.'] };
  }
  /**
   * Writes one face of the port layout. PUT replaces that face (merge=false); the legacy PATCH merges into it (merge=true).
   * The other face is never touched, and only the edited face's image column is written when assetId is given.
   */
  async updatePortLayout(id: string, dto: FaceInput & { assetId?: string; warnings?: unknown; revision?: string }, user: AuthenticatedUser, face: PortLayoutFace = 'rear', merge = false) {
    const { assetId, warnings: _warnings, revision, ...faceInput } = dto;
    const layout = await this.prisma.$transaction(async (tx: any) => {
      await this.lockModel(tx, id);
      const model = await tx.deviceModel.findUnique({ where: { id }, select: { portLayout: true, frontAssetId: true, backAssetId: true, supportsNetworkPorts: true, networkPortCount: true, portCount: true } }); if (!model) throw new NotFoundException('Modelo não encontrado');
      this.assertRevision(revision, model);
      const next = writeFace(model.portLayout, face, faceInput, merge);
      assertWritableLayout(next, face, model);
      if (assetId) await this.assertFaceImage(assetId, face, tx, model[faceAssetField(face)]);
      await tx.deviceModel.update({ where: { id }, data: { portLayout: next as never, ...(assetId ? { [faceAssetField(face)]: assetId } : {}) } });
      return next;
    });
    await this.log(user, 'DEVICE_MODEL_PORT_LAYOUT_UPDATED', 'DeviceModel', id, { face, ports: layout.faces[face]?.ports.length ?? 0, assetId });
    return this.getPortLayout(id, face);
  }
  async generatePortLayout(id: string, user: AuthenticatedUser, face: PortLayoutFace = 'rear') {
    const model = await this.prisma.deviceModel.findUnique({ where: { id }, select: { supportsNetworkPorts: true, networkPortCount: true, portCount: true, portLayout: true } }); if (!model) throw new NotFoundException('Modelo não encontrado');
    const { ports: otherPorts } = this.otherFaceKeys(model.portLayout, face);
    const count = Math.max(0, expectedNetworkPorts(model) - otherPorts.length);
    const current = normalizePortLayout(model.portLayout)?.faces[face];
    const ports = this.gridPorts(count, new Set(otherPorts.map((port) => port.portKey)), (n) => `${n}`, 'RJ45', (index, columns, rows) => ({ x: (index % columns + 0.5) / columns, y: (Math.floor(index / columns) + 0.5) / rows, width: 0.62 / columns, height: 0.34 / rows }));
    return this.updatePortLayout(id, { imageWidth: current?.imageWidth ?? 1000, imageHeight: current?.imageHeight ?? 300, viewport: current?.viewport ?? undefined, ports }, user, face);
  }
}
