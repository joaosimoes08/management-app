import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import * as snmp from 'net-snmp';
import { NEIGHBOR_OIDS } from '@simoes/snmp-core';
import { observedNeighbors, pollFallbackNeighbors } from './neighbors';
import { PollProcessor } from './poll';

const cdp = NEIGHBOR_OIDS.cdpCacheEntry;
const CISCO = '1.3.6.1.4.1.9.1.2494';
const str = (oid: string, value: string) => ({ oid, type: snmp.ObjectType.OctetString, value: Buffer.from(value) });
const CDP_ROWS: Record<string, any[]> = {
  [`${cdp}.3`]: [{ oid: `${cdp}.3.49.1`, type: snmp.ObjectType.Integer, value: 1 }],
  [`${cdp}.4`]: [{ oid: `${cdp}.4.49.1`, type: snmp.ObjectType.OctetString, value: Buffer.from([10, 250, 70, 1]) }],
  [`${cdp}.6`]: [str(`${cdp}.6.49.1`, 'core-sw-01')],
  [`${cdp}.7`]: [str(`${cdp}.7.49.1`, 'TenGigabitEthernet1/0/1')],
  [`${cdp}.8`]: [str(`${cdp}.8.49.1`, 'cisco C9500-24Y4C')],
};

describe('SNMP Phase 2 step 11: CDP walk behind the vendor interface', () => {
  it('walks cdpCacheTable for a Cisco device and decodes the neighbour', async () => {
    const walked: string[] = [];
    const rows = await pollFallbackNeighbors({} as any, CISCO, async (_session, oid) => { walked.push(oid); return CDP_ROWS[oid] ?? []; });
    assert.ok(walked.length > 0 && walked.every((oid) => oid.startsWith(`${cdp}.`)));
    assert.deepEqual(rows.map((row) => [row.ifIndex, row.remoteDeviceId, row.remotePort, row.managementAddress, row.platform]), [[49, 'core-sw-01', 'TenGigabitEthernet1/0/1', '10.250.70.1', 'cisco C9500-24Y4C']]);
  });

  it('does not walk anything for a non-Cisco device', async () => {
    const walked: string[] = [];
    assert.deepEqual(await pollFallbackNeighbors({} as any, '1.3.6.1.4.1.2636.1.1.1.2.29', async (_session, oid) => { walked.push(oid); return []; }), []);
    assert.deepEqual(walked, []);
  });

  it('a failed CDP column walk loses only that column, never the poll', async () => {
    const rows = await pollFallbackNeighbors({} as any, CISCO, async (_session, oid) => { if (oid === `${cdp}.8`) throw new Error('timeout'); return CDP_ROWS[oid] ?? []; });
    assert.equal(rows.length, 1);
    assert.equal(rows[0].platform, null);
  });
});

describe('SNMP Phase 2 step 11: LLDP first, CDP on the remaining ports', () => {
  const interfaces = [{ ifIndex: 1, name: 'Gi1/0/1', counters: {} }, { ifIndex: 49, name: 'Te1/1/1', counters: {} }];
  const cdpRows = [
    { protocol: 'CDP' as const, ifIndex: 1, remoteIndex: 1, remoteDeviceId: 'ap-1', remotePort: 'Gi0', platform: 'AP', softwareVersion: null, managementAddress: '10.0.0.31', capabilities: '00000002', rawIdentifiers: { [`${cdp}.6.1.1`]: 'ap-1' } },
    { protocol: 'CDP' as const, ifIndex: 49, remoteIndex: 1, remoteDeviceId: 'core-sw-01', remotePort: 'Te1/0/1', platform: null, softwareVersion: null, managementAddress: '10.0.0.1', capabilities: null, rawIdentifiers: {} },
  ];

  it('stores LLDP as is and maps CDP to the same fields, named by the local ifName', () => {
    const lldp = [{ localPortNumber: 49, localPortId: 'Te1/1/1', remoteIndex: 3, systemName: 'core-sw-01', portId: 'Te1/0/1', rawIdentifiers: {} }];
    const rows = observedNeighbors(lldp, cdpRows, interfaces);
    assert.deepEqual(rows.map((row) => [row.protocol, row.localPortId]), [['LLDP', 'Te1/1/1'], ['CDP', 'Gi1/0/1']], 'CDP on Te1/1/1 is dropped because LLDP saw it');
    const cdpRow = rows[1];
    assert.equal(cdpRow.localPortNumber, 1);
    assert.equal(cdpRow.systemName, 'ap-1');
    assert.equal(cdpRow.chassisId, 'ap-1');
    assert.equal(cdpRow.portId, 'Gi0');
    assert.equal(cdpRow.managementAddress, '10.0.0.31');
    assert.equal(cdpRow.rawIdentifiers.platform, 'AP');
  });

  it('with no LLDP at all every CDP neighbour is kept', () => {
    assert.deepEqual(observedNeighbors([], cdpRows, interfaces).map((row) => [row.protocol, row.localPortNumber]), [['CDP', 1], ['CDP', 49]]);
  });
});

describe('SNMP Phase 2 step 11: CDP rows feed the reviewed topology proposal flow', () => {
  function harness() {
    const observations: any[] = [];
    const proposals: any[] = [];
    const pendingKeys = new Set<string>();
    const processor = Object.create(PollProcessor.prototype) as any;
    processor.prisma = {
      device: { findMany: async () => [{ id: 'dev-b' }] },
      lldpObservation: { create: async ({ data }: any) => { observations.push(data); return { id: `obs-${observations.length}` }; } },
      deviceInterface: { findMany: async ({ where }: any) => (where.deviceId === 'dev-b' ? [{ id: 'if-b' }] : [{ id: 'if-a' }]) },
      deviceConnection: { findMany: async () => [] },
      $transaction: async (work: any) => work({ topologyProposal: {
        findMany: async () => [...pendingKeys].map((key) => { const [deviceId, action, ...rest] = key.split('|'); return { deviceId, action, proposalKey: rest.join('|') }; }),
        createMany: async ({ data }: any) => { for (const item of data) { proposals.push(item); pendingKeys.add(`${item.deviceId}|${item.action}|${item.proposalKey}`); } },
      } }),
    };
    return { processor, observations, proposals };
  }
  const documented = [{ id: 'if-a', name: 'Te1/1/1', portKey: null }];
  const lldpRow = { protocol: 'LLDP' as const, localPortNumber: 49, localPortId: 'Te1/1/1', remoteIndex: 1, systemName: 'core-sw-01', portId: 'Te1/0/1', managementAddress: '10.0.0.1', rawIdentifiers: {} };
  const cdpRow = { ...lldpRow, protocol: 'CDP' as const, chassisId: 'core-sw-01' };

  it('stores the CDP observation with protocol CDP and proposes the link for review, 5 points below LLDP', async () => {
    const { processor, observations, proposals } = harness();
    await processor.storeLldpObservations('dev-a', 'snap', 'site', [cdpRow], documented);
    assert.equal(observations[0].protocol, 'CDP');
    assert.equal(observations[0].confidence, 90);
    assert.equal(proposals.length, 1);
    assert.equal(proposals[0].action, 'CONNECTION_ADD');
    assert.equal(proposals[0].confidence, 90);
    assert.equal(proposals[0].context.protocol, 'CDP');
    assert.equal(proposals[0].status, undefined, 'created with the table default (PENDING): nothing is applied without review');
  });

  it('the same link from LLDP and then CDP (or the far end) keeps one pending proposal', async () => {
    const { processor, observations, proposals } = harness();
    await processor.storeLldpObservations('dev-a', 'snap-1', 'site', [lldpRow], documented);
    await processor.storeLldpObservations('dev-a', 'snap-2', 'site', [cdpRow], documented);
    assert.deepEqual(observations.map((item) => [item.protocol, item.confidence]), [['LLDP', 95], ['CDP', 90]]);
    assert.equal(proposals.length, 1, 'same proposal key, so the CDP pass adds nothing');
    assert.equal(proposals[0].context.protocol, 'LLDP');
  });
});
