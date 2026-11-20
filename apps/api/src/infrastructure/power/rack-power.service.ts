import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuditService } from '../../audit/audit.service';
import { AuthenticatedUser } from '../../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure-access.service';
import { DevicePowerDto, RackPowerDto } from './dto';
import { allocatePlugs, defaultPlugRequests, planPduSettings, resolvePlugCount, summarizeRackPower, type AllocationPdu, type PduInput, type PlugRequest, type PowerDeviceInput, type RackPowerSummary } from './rack-power';

/** Prisma include that loads everything summarizeRackPower needs for a rack. */
export const RACK_POWER_PDU_INCLUDE = { outlets: { select: { outletIndex: true, deviceId: true, plugIndex: true } } } as const;

/** Merges the power read model into a rack loaded with `pdus: { include: RACK_POWER_PDU_INCLUDE }` and `devices: { include: { model } }`. */
export function attachRackPower<T extends { pdus?: unknown; devices?: unknown[] }>(rack: T) {
  const summary = summarizeRackPower((rack.pdus ?? []) as PduInput[], (rack.devices ?? []) as PowerDeviceInput[]);
  const byDevice = new Map(summary.devices.map((item) => [item.deviceId, item]));
  return {
    ...rack,
    powerMode: summary.mode,
    pdus: summary.pdus,
    power: { mode: summary.mode, totals: summary.totals },
    devices: ((rack.devices ?? []) as { id: string }[]).map((device) => ({ ...device, power: byDevice.get(device.id) ?? null })),
  };
}

function isUniqueViolation(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2002';
}
function isSerializationFailure(error: unknown) {
  return !!error && typeof error === 'object' && 'code' in error && (error as { code?: string }).code === 'P2034';
}

@Injectable()
export class RackPowerService {
  constructor(private readonly prisma: PrismaClient, private readonly audit: AuditService, private readonly access: InfrastructureAccessService) {}

  /** Power read model for one rack (used by the write endpoints' responses). */
  async rackPower(rackId: string, client: any = this.prisma): Promise<RackPowerSummary> {
    const rack = await client.rack.findUnique({ where: { id: rackId }, select: { pdus: { include: RACK_POWER_PDU_INCLUDE }, devices: { select: { id: true, name: true, type: true, powerPlugCount: true, estimatedWatts: true, model: { select: { powerPlugCount: true, typicalWatts: true, maxWatts: true } } } } } });
    if (!rack) throw new NotFoundException('Bastidor não encontrado');
    return summarizeRackPower(rack.pdus, rack.devices);
  }

  private async lockRackPdus(tx: any, rackId: string) {
    await tx.$queryRaw`SELECT "id" FROM "RackPdu" WHERE "rackId"::text = ${rackId} FOR UPDATE`;
  }

  /** PUT racks/:id/pdus — set power mode and PDU settings. 409 when removing/shrinking a PDU would orphan connections. */
  async updateRackPdus(rackId: string, dto: RackPowerDto, user: AuthenticatedUser) {
    await this.access.assertRack(user, 'UPDATE', rackId);
    return this.prisma.$transaction(async (tx: any) => {
      const rack = await tx.rack.findUnique({ where: { id: rackId }, select: { id: true } });
      if (!rack) throw new NotFoundException('Bastidor não encontrado');
      await this.lockRackPdus(tx, rackId);
      const pdus = await tx.rackPdu.findMany({ where: { rackId }, include: { outlets: { select: { outletIndex: true, deviceId: true, plugIndex: true, device: { select: { name: true } } } } } });
      const current = pdus.map((pdu: any) => ({ ...pdu, outlets: pdu.outlets.map((outlet: any) => ({ outletIndex: outlet.outletIndex, deviceId: outlet.deviceId, plugIndex: outlet.plugIndex, deviceName: outlet.device?.name })) }));
      const next = planPduSettings(current, { mode: dto.mode, supplier: dto.supplier, ups: dto.mode === 'SUPPLIER_AND_UPS' ? dto.ups : undefined });
      for (const item of next.delete) await tx.rackPdu.delete({ where: { id: item.id } });
      for (const item of next.update) await tx.rackPdu.update({ where: { id: item.id }, data: item.data });
      for (const item of next.create) await tx.rackPdu.create({ data: { ...item, rackId } });
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'RACK_POWER_UPDATED', entityType: 'Rack', entityId: rackId, metadata: { mode: dto.mode, created: next.create, updated: next.update, deleted: next.delete } });
      return this.rackPower(rackId, tx);
    }).catch((error: unknown) => {
      if (isUniqueViolation(error) || isSerializationFailure(error)) throw new ConflictException({ code: 'RACK_POWER_CHANGED', message: 'As PDUs do bastidor foram alteradas por outra operação. Atualiza e tenta novamente.' });
      throw error;
    });
  }

  /** PUT devices/:id/power — replace every outlet assignment of the device in one transaction. */
  async updateDevicePower(deviceId: string, dto: DevicePowerDto, user: AuthenticatedUser) {
    await this.access.assertDevice(user, 'UPDATE', deviceId);
    const result = await this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "Device" WHERE "id"::text = ${deviceId} FOR UPDATE`;
      const device = await tx.device.findUnique({ where: { id: deviceId }, select: { id: true, name: true, type: true, rackId: true, powerPlugCount: true, estimatedWatts: true, model: { select: { powerPlugCount: true, typicalWatts: true, maxWatts: true } } } });
      if (!device) throw new NotFoundException('Equipamento não encontrado');
      if (!device.rackId) throw new ConflictException({ code: 'DEVICE_NOT_IN_RACK', message: 'O equipamento não está num bastidor: não pode ser ligado a uma PDU.' });
      await this.access.assertRack(user, 'UPDATE', device.rackId, 'DEVICE', device.type);
      await this.lockRackPdus(tx, device.rackId);

      const fieldChanges: { powerPlugCount?: number | null; estimatedWatts?: number | null } = {};
      if (dto.powerPlugCount !== undefined) fieldChanges.powerPlugCount = dto.powerPlugCount;
      if (dto.estimatedWatts !== undefined) fieldChanges.estimatedWatts = dto.estimatedWatts;
      const effective = { ...device, ...fieldChanges };
      const plugCount = resolvePlugCount(effective).count;

      const pdus = await tx.rackPdu.findMany({ where: { rackId: device.rackId }, include: { outlets: { where: { deviceId: { not: deviceId } }, select: { outletIndex: true } } } });
      const allocationPdus: AllocationPdu[] = pdus.map((pdu: any) => ({ id: pdu.id, source: pdu.source, outletCount: pdu.outletCount, taken: new Set(pdu.outlets.map((outlet: any) => outlet.outletIndex)) }));
      const requests: PlugRequest[] = dto.plugs === undefined
        ? defaultPlugRequests(plugCount, allocationPdus)
        : dto.plugs.map((plug) => ({ plugIndex: plug.plugIndex, pduId: plug.pduId ?? null, outletIndex: plug.outletIndex ?? null }));
      const allocation = allocatePlugs(plugCount, requests, allocationPdus);

      if (Object.keys(fieldChanges).length) await tx.device.update({ where: { id: deviceId }, data: fieldChanges });
      const removed = await tx.pduOutletAssignment.deleteMany({ where: { deviceId } });
      if (allocation.assignments.length) await tx.pduOutletAssignment.createMany({ data: allocation.assignments.map((item) => ({ ...item, deviceId })) });
      await this.audit.recordInTransaction(tx, { userId: user.id, action: 'DEVICE_POWER_UPDATED', entityType: 'Device', entityId: deviceId, metadata: { rackId: device.rackId, ...fieldChanges, plugCount, removedAssignments: removed.count, assignments: allocation.assignments, unplugged: allocation.unplugged } });
      return { rackId: device.rackId as string, plugCount, allocation, power: await this.rackPower(device.rackId, tx) };
    }).catch((error: unknown) => {
      if (isUniqueViolation(error) || isSerializationFailure(error)) throw new ConflictException({ code: 'PDU_OUTLET_TAKEN', message: 'Uma das tomadas foi ocupada entretanto. Atualiza o bastidor e tenta novamente.' });
      throw error;
    });
    const power = result.power;
    const warnings: string[] = [];
    if (result.allocation.unplugged.some((item) => item.reason === 'NO_FREE_OUTLET')) warnings.push('NO_FREE_OUTLET');
    if (result.allocation.unplugged.length) warnings.push('PLUGS_NOT_CONNECTED');
    const devicePower = power.devices.find((item) => item.deviceId === deviceId) ?? null;
    if (devicePower && devicePower.plugCount > 1 && power.mode === 'SUPPLIER_ONLY') warnings.push('NO_REDUNDANT_FEED');
    return { deviceId, rackId: result.rackId, mode: power.mode, device: devicePower, unplugged: result.allocation.unplugged, warnings, pdus: power.pdus, totals: power.totals };
  }

  /**
   * DELETE racks/:rackId/pdus/:pduId/devices/:deviceId — "Desligar": frees the device's outlets on that PDU.
   * Same checks and locks as updateDevicePower: device-type scoped rack permission, device row lock, rack PDU lock.
   */
  async disconnectDevice(rackId: string, pduId: string, deviceId: string, user: AuthenticatedUser) {
    return this.prisma.$transaction(async (tx: any) => {
      await tx.$queryRaw`SELECT "id" FROM "Device" WHERE "id"::text = ${deviceId} FOR UPDATE`;
      const device = await tx.device.findUnique({ where: { id: deviceId }, select: { id: true, type: true } });
      if (!device) throw new NotFoundException('Equipamento não encontrado');
      await this.access.assertRack(user, 'UPDATE', rackId, 'DEVICE', device.type);
      await this.lockRackPdus(tx, rackId);
      const pdu = await tx.rackPdu.findUnique({ where: { id: pduId }, select: { id: true, rackId: true, source: true } });
      if (!pdu || pdu.rackId !== rackId) throw new NotFoundException('PDU não encontrada neste bastidor');
      const outlets = await tx.pduOutletAssignment.findMany({ where: { pduId, deviceId }, select: { outletIndex: true, plugIndex: true } });
      const result = await tx.pduOutletAssignment.deleteMany({ where: { pduId, deviceId } });
      if (result.count) await this.audit.recordInTransaction(tx, { userId: user.id, action: 'DEVICE_POWER_DISCONNECTED', entityType: 'Device', entityId: deviceId, metadata: { rackId, pduId, source: pdu.source, outlets } });
      const power = await this.rackPower(rackId, tx);
      return { removed: result.count, mode: power.mode, pdus: power.pdus, totals: power.totals };
    }).catch((error: unknown) => {
      if (isSerializationFailure(error)) throw new ConflictException({ code: 'RACK_POWER_CHANGED', message: 'As PDUs do bastidor foram alteradas por outra operação. Atualiza e tenta novamente.' });
      throw error;
    });
  }
}
