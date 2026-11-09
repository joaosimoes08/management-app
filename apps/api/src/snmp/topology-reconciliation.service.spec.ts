import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { ConflictException, NotFoundException } from '@nestjs/common';
import { TopologyReconciliationService } from './topology-reconciliation.service';

describe('topology reconciliation review safeguards', () => {
  it('never allows applying a removal candidate', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    service.proposal = async () => ({ action: 'REMOVAL_CANDIDATE', status: 'PENDING', deviceId: 'device' });
    await assert.rejects(service.apply('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof ConflictException && (error as any).response.code === 'TOPOLOGY_REMOVAL_APPLY_FORBIDDEN');
  });

  it('requires update access to both devices before applying an observed link', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    const checked: string[] = [];
    let created = false;
    service.proposal = async () => ({ id: 'proposal', deviceId: 'local', action: 'CONNECTION_ADD', status: 'PENDING', snapshot: { observedAt: new Date() }, observedValues: { siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port' } });
    service.access = { assertDevice: async (_user: unknown, _action: string, deviceId: string) => { checked.push(deviceId); if (deviceId === 'remote') throw new Error('target denied'); } };
    service.prisma = { $transaction: async (work: (tx: any) => Promise<unknown>) => work({ device: { findMany: async () => [{ id: 'local' }, { id: 'remote' }] }, deviceInterface: { findMany: async () => [{ id: 'local-port', deviceId: 'local' }, { id: 'remote-port', deviceId: 'remote' }] }, deviceConnection: { findFirst: async () => null, create: async () => { created = true; return { id: 'connection' }; } } }) };
    await assert.rejects(service.apply('proposal', { id: 'reviewer' }), /target denied/);
    assert.deepEqual(checked, ['local', 'remote']);
    assert.equal(created, false);
  });

  it('does not replace a shared connection after its observed compare-and-swap becomes stale', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    let claimed = false;
    let where: any;
    service.proposal = async () => ({ id: 'proposal', deviceId: 'local', connectionId: 'connection', action: 'CONNECTION_UPDATE', status: 'PENDING', snapshot: { observedAt: new Date() }, beforeValues: { sourceInterfaceId: 'old-local', targetInterfaceId: 'old-remote', label: null, type: 'PHYSICAL' }, observedValues: { siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'new-local', targetInterfaceId: 'new-remote' } });
    service.access = { assertDevice: async () => undefined };
    service.prisma = { $transaction: async (work: (tx: any) => Promise<unknown>) => work({ device: { findMany: async () => [{ id: 'local' }, { id: 'remote' }] }, deviceInterface: { findMany: async () => [{ id: 'new-local', deviceId: 'local' }, { id: 'new-remote', deviceId: 'remote' }] }, deviceConnection: { updateMany: async (args: any) => { where = args.where; return { count: 0 }; } }, topologyProposal: { updateMany: async () => { claimed = true; return { count: 1 }; } } }) };
    await assert.rejects(service.apply('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof ConflictException && (error as any).response.code === 'TOPOLOGY_PROPOSAL_STALE');
    assert.deepEqual(where, { id: 'connection', siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'old-local', targetInterfaceId: 'old-remote', label: null, type: 'PHYSICAL' });
    assert.equal(claimed, false);
  });

  it('limits applied fields to the reviewed interface schema', () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    assert.deepEqual(service.safeFields({ description: 'port', adminUp: false, nativeVlanId: 'unexpected', name: 'unexpected' }), { description: 'port', adminUp: false });
  });

  it('writes rejection audit in the same transaction as the state change', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    let inTransaction = false;
    let auditSawTransaction = false;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'device', action: 'UPDATE', status: 'PENDING' });
    service.prisma = {
      $transaction: async (work: (tx: any) => Promise<void>) => {
        inTransaction = true;
        try { await work({
          topologyProposal: { updateMany: async () => ({ count: 1 }) },
          auditLog: { create: async () => { auditSawTransaction = inTransaction; throw new Error('audit failed'); } },
        }); } finally { inTransaction = false; }
      },
      topologyProposal: { findUnique: async () => ({ id: 'proposal', status: 'REJECTED' }) },
    };
    await assert.rejects(service.reject('proposal', { id: 'reviewer' }), /audit failed/);
    assert.equal(auditSawTransaction, true);
  });

  it('writes apply audit in the same transaction as the inventory change', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    let auditSawTransaction = false;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'device', action: 'ADD', status: 'PENDING', snapshot: { observedAt: new Date() }, observedValues: { name: 'Gi1' } });
    service.prisma = {
      $transaction: async (work: (tx: any) => Promise<void>) => work({
        deviceInterface: { findUnique: async () => null, create: async () => ({ id: 'interface' }) },
        topologyProposal: { updateMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => { auditSawTransaction = true; throw new Error('audit failed'); } },
      }),
    };
    await assert.rejects(service.apply('proposal', { id: 'reviewer' }), /audit failed/);
    assert.equal(auditSawTransaction, true);
  });

  it('writes undo audit in the same transaction as the inventory change', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    let auditSawTransaction = false;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'device', action: 'ADD', status: 'APPLIED', appliedEntityId: 'interface' });
    service.prisma = {
      $transaction: async (work: (tx: any) => Promise<void>) => work({
        deviceInterface: { findUnique: async () => ({ id: 'interface', deviceId: 'device', name: 'Gi1', portKey: null, _count: { ipAddresses: 0, sourceConnections: 0, targetConnections: 0 } }), deleteMany: async () => ({ count: 1 }) },
        topologyProposal: { updateMany: async () => ({ count: 1 }) },
        auditLog: { create: async () => { auditSawTransaction = true; throw new Error('audit failed'); } },
      }),
    };
    await assert.rejects(service.undo('proposal', { id: 'reviewer' }), /audit failed/);
    assert.equal(auditSawTransaction, true);
  });

  it('keeps detached proposal evidence unavailable for mutation', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    service.prisma = { topologyProposal: { findUnique: async () => ({ id: 'proposal', deviceId: null }) } };
    await assert.rejects(service.proposal('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof NotFoundException);
  });

  it('uses a nullable field compare-and-swap before applying an update', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'device', interfaceId: 'interface', action: 'UPDATE', status: 'PENDING', snapshot: { observedAt: new Date() }, beforeValues: { description: null, lastSeenAt: null }, observedValues: { description: 'observed' } });
    let writeWhere: any;
    service.prisma = {
      $transaction: async (work: (tx: any) => Promise<void>) => work({
        deviceInterface: {
          findUnique: async () => ({ id: 'interface', deviceId: 'device', description: null }),
          updateMany: async ({ where }: any) => { writeWhere = where; return { count: 0 }; },
        },
      }),
    };
    await assert.rejects(service.apply('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof ConflictException && (error as any).response.code === 'TOPOLOGY_PROPOSAL_STALE');
    assert.deepEqual(writeWhere, { id: 'interface', deviceId: 'device', description: null, lastSeenAt: null });
  });

  it('does not undo an update when a concurrent edit wins the compare-and-swap', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'device', interfaceId: 'interface', action: 'UPDATE', status: 'APPLIED', appliedEntityId: 'interface', beforeValues: { description: null }, observedValues: { description: 'observed' } });
    let claimed = false;
    service.prisma = {
      $transaction: async (work: (tx: any) => Promise<void>) => work({
        deviceInterface: {
          findUnique: async () => ({ id: 'interface', deviceId: 'device', description: 'observed' }),
          updateMany: async () => ({ count: 0 }),
        },
        topologyProposal: { updateMany: async () => { claimed = true; return { count: 1 }; } },
      }),
    };
    await assert.rejects(service.undo('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof ConflictException && (error as any).response.code === 'TOPOLOGY_UNDO_STALE');
    assert.equal(claimed, false);
  });

  it('refuses to undo an added connection when its label or type changed', async () => {
    for (const changedField of ['label', 'type']) {
      const service = Object.create(TopologyReconciliationService.prototype) as any;
      let deletes = 0;
      service.access = { assertDevice: async () => undefined };
      service.proposal = async () => ({ id: 'proposal', deviceId: 'local', action: 'CONNECTION_ADD', status: 'APPLIED', appliedEntityId: 'connection', observedValues: { siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port', label: 'observed label', type: 'PHYSICAL' } });
      const current: any = { id: 'connection', siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port', label: 'observed label', type: 'PHYSICAL', _count: { maps: 0 } };
      current[changedField] = changedField === 'label' ? 'edited label' : 'LOGICAL';
      service.prisma = { $transaction: async (work: any) => work({
        deviceConnection: { findUnique: async () => current, deleteMany: async () => { deletes++; return { count: 1 }; } },
        topologyProposal: { updateMany: async () => ({ count: 1 }) },
      }) };
      await assert.rejects(service.undo('proposal', { id: 'reviewer' }), (error: unknown) => error instanceof ConflictException && (error as any).response.code === 'TOPOLOGY_UNDO_STALE');
      assert.equal(deletes, 0, `${changedField} change must prevent deletion`);
    }
  });

  it('includes the applied label and type in the conditional connection delete', async () => {
    const service = Object.create(TopologyReconciliationService.prototype) as any;
    let where: any;
    service.access = { assertDevice: async () => undefined };
    service.proposal = async () => ({ id: 'proposal', deviceId: 'local', action: 'CONNECTION_ADD', status: 'APPLIED', appliedEntityId: 'connection', observedValues: { siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port', label: null, type: 'LOGICAL' } });
    service.prisma = { $transaction: async (work: any) => work({
      deviceConnection: {
        findUnique: async () => ({ id: 'connection', siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port', label: null, type: 'LOGICAL', _count: { maps: 0 } }),
        deleteMany: async (args: any) => { where = args.where; return { count: 1 }; },
      },
      topologyProposal: { updateMany: async () => ({ count: 1 }) },
      auditLog: { create: async () => undefined },
    }), topologyProposal: { findUnique: async () => ({ id: 'proposal', status: 'UNDONE' }) } };
    await service.undo('proposal', { id: 'reviewer' });
    assert.deepEqual(where, { id: 'connection', siteId: 'site', sourceDeviceId: 'local', targetDeviceId: 'remote', sourceInterfaceId: 'local-port', targetInterfaceId: 'remote-port', label: null, type: 'LOGICAL' });
  });
});
