import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { PollProcessor } from './poll';

describe('SNMP topology proposal generation', () => {
  it('creates deterministic add and update records without inferring removals from a partial walk', async () => {
    let recorded: any[] = [];
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = { $transaction: async (work: any) => work({ topologyProposal: { findMany: async () => [], createMany: async ({ data }: any) => { recorded = data; } } }) };
    const inventory = [
      { id: 'if-a', name: 'GigabitEthernet1', portKey: 'Gi1', description: 'old description', macAddress: null, adminUp: true, operUp: true, speedMbps: 1000, nativeVlanId: 'vlan-native', accessVlanId: null, allowedVlans: [{ vlanId: 'vlan-allowed' }] },
      { id: 'if-b', name: 'GigabitEthernet2', portKey: null, description: null, macAddress: null, adminUp: null, operUp: null, speedMbps: null, nativeVlanId: null, accessVlanId: null, allowedVlans: [] },
    ];
    const observed = [
      { ifIndex: 1, name: 'GigabitEthernet1', description: 'new description', adminUp: true, counters: {} },
      { ifIndex: 3, name: 'GigabitEthernet3', description: 'new port', macAddress: '00:11:22:33:44:55', counters: {} },
    ];
    await processor.createTopologyProposals('device', 'snapshot', observed, inventory, 'site');
    assert.deepEqual(recorded.map((item) => item.proposalKey), ['UPDATE:if-a', 'ADD:3']);
    assert.equal(recorded[0].confidence, 95);
    assert.deepEqual(recorded[0].observedValues, { description: 'new description' });
    assert.deepEqual(recorded[0].context.allowedVlanIds, ['vlan-allowed']);
    assert.equal(recorded[1].action, 'ADD');
  });

  it('does not classify the inventory as missing when an observation has no interfaces', async () => {
    let recorded: any[] = [];
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = { $transaction: async (work: any) => work({ topologyProposal: { findMany: async () => [], createMany: async ({ data }: any) => { recorded = data; } } }) };
    await processor.createTopologyProposals('device', 'snapshot', [], [{ id: 'if-a', name: 'Gi1', portKey: null, allowedVlans: [] }], 'site');
    assert.deepEqual(recorded, []);
  });

  it('skips an existing pending key across snapshots while allowing reviewed history', async () => {
    let inserted: any[] = [];
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = { $transaction: async (work: any) => work({ topologyProposal: {
      findMany: async () => [{ deviceId: 'device', action: 'ADD', proposalKey: 'ADD:3' }],
      createMany: async ({ data }: any) => { inserted = data; },
    } }) };
    await processor.createPendingProposals([
      { deviceId: 'device', snapshotId: 'new-snapshot', action: 'ADD', proposalKey: 'ADD:3' },
      { deviceId: 'device', snapshotId: 'new-snapshot', action: 'ADD', proposalKey: 'ADD:4' },
    ]);
    assert.deepEqual(inserted.map((item) => item.proposalKey), ['ADD:4']);
  });

  it('rechecks pending keys after a serializable race and does not insert a duplicate', async () => {
    let calls = 0;
    let inserts = 0;
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = { $transaction: async (work: any) => {
      calls++;
      if (calls === 1) { const error: any = new Error('serialization conflict'); error.code = 'P2034'; throw error; }
      return work({ topologyProposal: {
        findMany: async () => [{ deviceId: 'device', action: 'UPDATE', proposalKey: 'UPDATE:if-a' }],
        createMany: async () => { inserts++; },
      } });
    } };
    await processor.createPendingProposals([{ deviceId: 'device', snapshotId: 'snapshot', action: 'UPDATE', proposalKey: 'UPDATE:if-a' }]);
    assert.equal(calls, 2);
    assert.equal(inserts, 0);
  });
});
