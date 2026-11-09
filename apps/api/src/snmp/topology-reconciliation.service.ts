import { ConflictException, Injectable, NotFoundException } from '@nestjs/common';
import { PrismaClient } from '@simoes/database';
import { AuthenticatedUser } from '../auth/auth.service';
import { InfrastructureAccessService } from '../infrastructure/infrastructure-access.service';

const editableFields = ['description', 'macAddress', 'adminUp', 'operUp', 'speedMbps'] as const;
type EditableField = typeof editableFields[number];
const objectValue = (value: unknown): Record<string, any> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, any> : {};
const expectedFields = (value: Record<string, any>, fields: readonly string[]) => Object.fromEntries(fields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]]));

@Injectable()
export class TopologyReconciliationService {
  constructor(private readonly prisma: PrismaClient, private readonly access: InfrastructureAccessService) {}

  async list(deviceId: string, user: AuthenticatedUser) {
    await this.access.assertDevice(user, 'READ', deviceId);
    return this.prisma.topologyProposal.findMany({ where: { deviceId }, include: { snapshot: { select: { observedAt: true } }, interface: { select: { id: true, name: true } } }, orderBy: [{ createdAt: 'desc' }, { proposalKey: 'asc' }], take: 500 });
  }

  async observations(deviceId: string, user: AuthenticatedUser) {
    await this.access.assertDevice(user, 'READ', deviceId);
    return this.prisma.lldpObservation.findMany({ where: { deviceId }, orderBy: [{ observedAt: 'desc' }, { id: 'asc' }], take: 500 });
  }

  private async proposal(id: string, user: AuthenticatedUser) {
    const item = await this.prisma.topologyProposal.findUnique({ where: { id }, include: { snapshot: { select: { observedAt: true } } } });
    if (!item?.deviceId) throw new NotFoundException('Proposta de topologia não encontrada');
    await this.access.assertDevice(user, 'UPDATE', item.deviceId);
    return item;
  }

  async reject(id: string, user: AuthenticatedUser) {
    const item = await this.proposal(id, user);
    if (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') await this.assertConnectionEndpoints(item, user);
    if (item.status !== 'PENDING') throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_PENDING', message: 'A proposta já foi revista.' });
    await this.prisma.$transaction(async (tx) => {
      const result = await tx.topologyProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'REJECTED', reviewedBy: user.id, reviewedAt: new Date() } });
      if (result.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_PENDING', message: 'A proposta já foi revista.' });
      await tx.auditLog.create({ data: { userId: user.id, action: 'TOPOLOGY_PROPOSAL_REJECTED', entityType: 'TopologyProposal', entityId: id, metadata: { deviceId: item.deviceId, action: item.action } } });
    });
    return this.prisma.topologyProposal.findUnique({ where: { id } });
  }

  async apply(id: string, user: AuthenticatedUser) {
    const item = await this.proposal(id, user);
    if (!item.deviceId) throw new NotFoundException('Proposta de topologia não encontrada');
    if (item.action === 'REMOVAL_CANDIDATE') throw new ConflictException({ code: 'TOPOLOGY_REMOVAL_APPLY_FORBIDDEN', message: 'Candidatos a remoção não podem ser aplicados.' });
    if (item.status !== 'PENDING') throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_PENDING', message: 'A proposta já foi revista.' });
    if (!item.snapshot) throw new ConflictException({ code: 'TOPOLOGY_SNAPSHOT_UNAVAILABLE', message: 'A observação de origem já não está disponível; a proposta não pode ser aplicada.' });
    const deviceId = item.deviceId;
    const snapshot = item.snapshot;
    const values = objectValue(item.observedValues);
    const entityId = await this.reviewTransaction(async (tx) => {
    let appliedEntityId: string;
    if (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') {
      const sourceDeviceId = values.sourceDeviceId, targetDeviceId = values.targetDeviceId;
      if (!sourceDeviceId || !targetDeviceId || sourceDeviceId === targetDeviceId || !values.siteId || !values.sourceInterfaceId || !values.targetInterfaceId) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_INVALID', message: 'A proposta não contém endpoints de ligação completos.' });
      await this.access.assertDevice(user, 'UPDATE', sourceDeviceId);
      await this.access.assertDevice(user, 'UPDATE', targetDeviceId);
      const endpoints = await tx.device.findMany({ where: { id: { in: [sourceDeviceId, targetDeviceId] }, siteId: values.siteId }, select: { id: true } });
      if (endpoints.length !== 2) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'Os equipamentos já não pertencem ao Site observado.' });
      const interfaces = await tx.deviceInterface.findMany({ where: { id: { in: [values.sourceInterfaceId, values.targetInterfaceId] } }, select: { id: true, deviceId: true } });
      if (interfaces.length !== 2 || !interfaces.some((endpoint: any) => endpoint.id === values.sourceInterfaceId && endpoint.deviceId === sourceDeviceId) || !interfaces.some((endpoint: any) => endpoint.id === values.targetInterfaceId && endpoint.deviceId === targetDeviceId)) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'As interfaces observadas já não correspondem aos equipamentos.' });
      if (item.action === 'CONNECTION_ADD') {
        const duplicate = await tx.deviceConnection.findFirst({ where: { siteId: values.siteId, sourceDeviceId, targetDeviceId, sourceInterfaceId: values.sourceInterfaceId, targetInterfaceId: values.targetInterfaceId } });
        if (duplicate) throw new ConflictException({ code: 'TOPOLOGY_CONNECTION_ALREADY_EXISTS', message: 'A ligação já existe no inventário.' });
        const connection = await tx.deviceConnection.create({ data: { siteId: values.siteId, sourceDeviceId, targetDeviceId, sourceInterfaceId: values.sourceInterfaceId, targetInterfaceId: values.targetInterfaceId, type: values.type === 'LOGICAL' ? 'LOGICAL' : 'PHYSICAL', label: typeof values.label === 'string' ? values.label : null, createdById: user.id } });
        appliedEntityId = connection.id;
      } else {
        if (!item.connectionId) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'A ligação da proposta já não existe.' });
        const before = objectValue(item.beforeValues);
        if (!Object.hasOwn(before, 'sourceInterfaceId') || !Object.hasOwn(before, 'targetInterfaceId') || !Object.hasOwn(before, 'label') || !Object.hasOwn(before, 'type')) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_INVALID', message: 'A proposta não contém o estado anterior completo da ligação.' });
        const changed = await tx.deviceConnection.updateMany({ where: { id: item.connectionId, siteId: values.siteId, sourceDeviceId, targetDeviceId, sourceInterfaceId: before.sourceInterfaceId, targetInterfaceId: before.targetInterfaceId, label: before.label, type: before.type }, data: { sourceInterfaceId: values.sourceInterfaceId, targetInterfaceId: values.targetInterfaceId } });
        if (changed.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'A ligação foi alterada desde a observação; gera uma proposta atualizada.' });
        await this.bumpConnectionMapRevisions(tx, item.connectionId);
        appliedEntityId = item.connectionId;
      }
    } else if (item.action === 'ADD') {
      const name = typeof values.name === 'string' ? values.name.trim() : '';
      if (!name) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_INVALID', message: 'A proposta não contém um nome de interface válido.' });
      const duplicate = await tx.deviceInterface.findUnique({ where: { deviceId_name: { deviceId, name } } });
      if (duplicate) throw new ConflictException({ code: 'TOPOLOGY_INTERFACE_ALREADY_EXISTS', message: 'A interface já existe no inventário; atualiza a observação antes de aplicar.' });
      const added = await tx.deviceInterface.create({ data: { deviceId, name, portKey: typeof values.portKey === 'string' ? values.portKey : null, source: 'SNMP', lastSeenAt: snapshot.observedAt, ...this.safeFields(values) } });
      appliedEntityId = added.id;
    } else {
      if (!item.interfaceId) throw new ConflictException({ code: 'TOPOLOGY_INTERFACE_MISSING', message: 'A interface da proposta já não existe.' });
      const current = await tx.deviceInterface.findUnique({ where: { id: item.interfaceId } });
      if (!current || current.deviceId !== deviceId) throw new ConflictException({ code: 'TOPOLOGY_INTERFACE_MISSING', message: 'A interface da proposta já não existe.' });
      const before = objectValue(item.beforeValues);
      for (const field of Object.keys(values) as EditableField[]) if (editableFields.includes(field) && current[field] !== before[field]) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'A interface foi alterada desde a observação; gera uma proposta atualizada.' });
      const expected = { ...expectedFields(before, Object.keys(values).filter((field) => editableFields.includes(field as EditableField))), ...(Object.hasOwn(before, 'lastSeenAt') ? { lastSeenAt: this.asDate(before.lastSeenAt) } : {}) };
      const changed = await tx.deviceInterface.updateMany({ where: { id: item.interfaceId, deviceId, ...expected }, data: { ...this.safeFields(values), lastSeenAt: snapshot.observedAt } });
      if (changed.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_STALE', message: 'A interface foi alterada desde a observação; gera uma proposta atualizada.' });
      appliedEntityId = item.interfaceId;
    }
    const now = new Date();
    const claimed = await tx.topologyProposal.updateMany({ where: { id, status: 'PENDING' }, data: { status: 'APPLIED', reviewedBy: user.id, reviewedAt: now, appliedAt: now, appliedEntityId } });
    if (claimed.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_PENDING', message: 'A proposta já foi revista.' });
    await tx.auditLog.create({ data: { userId: user.id, action: 'TOPOLOGY_PROPOSAL_APPLIED', entityType: 'TopologyProposal', entityId: id, metadata: { deviceId: item.deviceId, action: item.action, appliedEntityId, beforeValues: item.beforeValues, observedValues: item.observedValues } } });
    return appliedEntityId;
    });
    return this.prisma.topologyProposal.findUnique({ where: { id } });
  }

  async undo(id: string, user: AuthenticatedUser) {
    const item = await this.proposal(id, user);
    if (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') await this.assertConnectionEndpoints(item, user);
    if (item.status !== 'APPLIED' || !item.appliedEntityId) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_APPLIED', message: 'Só propostas aplicadas podem ser revertidas.' });
    await this.reviewTransaction(async (tx) => {
      if (item.action === 'CONNECTION_ADD' || item.action === 'CONNECTION_UPDATE') {
      const values = objectValue(item.observedValues);
      if (item.action === 'CONNECTION_ADD') {
        const current = await tx.deviceConnection.findUnique({ where: { id: item.appliedEntityId }, include: { _count: { select: { maps: true } } } });
        const expectedType = values.type === 'LOGICAL' ? 'LOGICAL' : 'PHYSICAL';
        const expectedLabel = typeof values.label === 'string' ? values.label : null;
        if (!current || current.siteId !== values.siteId || current.sourceDeviceId !== values.sourceDeviceId || current.targetDeviceId !== values.targetDeviceId || current.sourceInterfaceId !== values.sourceInterfaceId || current.targetInterfaceId !== values.targetInterfaceId || current.label !== expectedLabel || current.type !== expectedType || current._count.maps) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A ligação foi alterada ou já está em uso; a reversão automática não é segura.' });
        const deleted = await tx.deviceConnection.deleteMany({ where: { id: current.id, siteId: values.siteId, sourceDeviceId: values.sourceDeviceId, targetDeviceId: values.targetDeviceId, sourceInterfaceId: values.sourceInterfaceId, targetInterfaceId: values.targetInterfaceId, label: expectedLabel, type: expectedType } });
        if (deleted.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A ligação foi alterada; a reversão automática não é segura.' });
      } else {
        const before = objectValue(item.beforeValues);
        const changed = await tx.deviceConnection.updateMany({ where: { id: item.appliedEntityId, siteId: values.siteId, sourceDeviceId: values.sourceDeviceId, targetDeviceId: values.targetDeviceId, sourceInterfaceId: values.sourceInterfaceId, targetInterfaceId: values.targetInterfaceId }, data: { sourceInterfaceId: before.sourceInterfaceId, targetInterfaceId: before.targetInterfaceId } });
        if (changed.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A ligação foi novamente alterada; a reversão automática não é segura.' });
        await this.bumpConnectionMapRevisions(tx, item.appliedEntityId!);
      }
    } else if (item.action === 'ADD') {
      const current = await tx.deviceInterface.findUnique({ where: { id: item.appliedEntityId! }, include: { _count: { select: { ipAddresses: true, sourceConnections: true, targetConnections: true } } } });
      if (!current || current.deviceId !== item.deviceId) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface criada já não está disponível para reversão.' });
      if (current._count.ipAddresses || current._count.sourceConnections || current._count.targetConnections) throw new ConflictException({ code: 'TOPOLOGY_UNDO_REFERENCED', message: 'A interface já tem relações de inventário e não pode ser removida pela reversão.' });
      const expected = { id: current.id, deviceId: item.deviceId, ...this.interfaceSnapshot(current) };
      const deleted = await tx.deviceInterface.deleteMany({ where: expected });
      if (deleted.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface foi alterada; a reversão automática não é segura.' });
    } else if (item.action === 'UPDATE') {
      if (!item.interfaceId) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface já não está disponível para reversão.' });
      const current = await tx.deviceInterface.findUnique({ where: { id: item.interfaceId } });
      if (!current || current.deviceId !== item.deviceId) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface já não está disponível para reversão.' });
      const after = objectValue(item.observedValues);
      for (const field of Object.keys(after) as EditableField[]) if (editableFields.includes(field) && current[field] !== after[field]) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface foi novamente alterada; a reversão automática não é segura.' });
      const before = objectValue(item.beforeValues);
      const expected = { id: item.interfaceId, deviceId: item.deviceId, ...this.expectedInterfaceValues(after), lastSeenAt: this.asDate(after.lastSeenAt) };
      const restored = await tx.deviceInterface.updateMany({ where: expected, data: { ...this.safeFields(before), lastSeenAt: this.asDate(before.lastSeenAt) } });
      if (restored.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_UNDO_STALE', message: 'A interface foi novamente alterada; a reversão automática não é segura.' });
    }
    const changed = await tx.topologyProposal.updateMany({ where: { id, status: 'APPLIED' }, data: { status: 'UNDONE', undoneAt: new Date() } });
    if (changed.count !== 1) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_NOT_APPLIED', message: 'A proposta já foi alterada.' });
    await tx.auditLog.create({ data: { userId: user.id, action: 'TOPOLOGY_PROPOSAL_UNDONE', entityType: 'TopologyProposal', entityId: id, metadata: { deviceId: item.deviceId, action: item.action, appliedEntityId: item.appliedEntityId, beforeValues: item.beforeValues, observedValues: item.observedValues } } });
    });
    return this.prisma.topologyProposal.findUnique({ where: { id } });
  }

  private safeFields(value: Record<string, any>): Partial<Record<EditableField, any>> {
    return Object.fromEntries(editableFields.filter((field) => Object.hasOwn(value, field)).map((field) => [field, value[field]])) as Partial<Record<EditableField, any>>;
  }

  private async assertConnectionEndpoints(item: { observedValues: unknown }, user: AuthenticatedUser) {
    const values = objectValue(item.observedValues);
    if (typeof values.sourceDeviceId !== 'string' || typeof values.targetDeviceId !== 'string' || values.sourceDeviceId === values.targetDeviceId) throw new ConflictException({ code: 'TOPOLOGY_PROPOSAL_INVALID', message: 'A proposta não contém endpoints válidos.' });
    await this.access.assertDevice(user, 'UPDATE', values.sourceDeviceId);
    await this.access.assertDevice(user, 'UPDATE', values.targetDeviceId);
  }

  private async bumpConnectionMapRevisions(tx: any, connectionId: string) {
    const maps = await tx.topologyMapConnection.findMany({ where: { connectionId }, select: { mapId: true } });
    for (const association of maps) await tx.topologyMap.update({ where: { id: association.mapId }, data: { revision: { increment: 1 } } });
  }

  private expectedInterfaceValues(value: unknown) {
    return expectedFields(objectValue(value), editableFields);
  }

  private asDate(value: unknown): Date | null {
    return value == null ? null : value instanceof Date ? value : new Date(String(value));
  }

  private interfaceSnapshot(value: Record<string, any>) {
    return expectedFields(value, ['name', 'portKey', 'interfaceType', 'description', 'adminUp', 'operUp', 'speedMbps', 'mode', 'nativeVlanId', 'accessVlanId', 'macAddress', 'source', 'lastSeenAt']);
  }

  private async reviewTransaction<T>(work: (tx: any) => Promise<T>): Promise<T> {
    try {
      return await this.prisma.$transaction(work, { isolationLevel: 'Serializable' });
    } catch (error) {
      if (error && typeof error === 'object' && 'code' in error && error.code === 'P2034') {
        throw new ConflictException({ code: 'TOPOLOGY_REVIEW_CONCURRENT_CHANGE', message: 'A interface foi alterada durante a revisão; atualiza a proposta e tenta novamente.' });
      }
      throw error;
    }
  }
}
