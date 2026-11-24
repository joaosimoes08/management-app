import { strict as assert } from 'node:assert';
import { describe, it } from 'node:test';
import { buildNeighborEvidence, EvidenceObservation, EvidenceProposal } from './discovery-topology-link';

const at = (minutes: number) => new Date(Date.UTC(2026, 10, 24, 12, minutes));
const observation = (item: Partial<EvidenceObservation> & { id: string }): EvidenceObservation => ({
  deviceId: 'sw-a', deviceName: 'Switch A', snapshotId: 'snap-a2', protocol: 'LLDP', observedAt: at(30), confidence: 95,
  localPortNumber: 49, localPortId: 'Te1/1/1', localPortDescription: null, remoteSystemName: 'core-sw-01', remotePortId: 'Te1/0/1', remoteChassisId: 'aa:bb',
  managementAddress: '10.0.0.1', resolvedDeviceId: null, ...item,
});
const proposal = (item: Partial<EvidenceProposal> & { id: string }): EvidenceProposal => ({ deviceId: 'sw-a', action: 'CONNECTION_ADD', status: 'PENDING', confidence: 95, createdAt: at(30), context: {}, observedValues: {}, ...item });
const build = (input: Partial<Parameters<typeof buildNeighborEvidence>[0]>) => buildNeighborEvidence({
  observations: [], latestSnapshotByDevice: new Map([['sw-a', 'snap-a2'], ['sw-b', 'snap-b1']]), registered: new Map(), readableDeviceIds: new Set(['sw-a', 'sw-b', 'core']), proposals: [], ...input,
});

describe('Discovery D-P1d: neighbour evidence for discovery candidates', () => {
  it('keeps one row per observing port, from its newest sighting, and marks whether the latest poll still sees it', () => {
    const map = build({ observations: [
      observation({ id: 'o1', snapshotId: 'snap-a1', observedAt: at(0) }),
      observation({ id: 'o2', localPortId: 'te1/1/1', snapshotId: 'snap-a2', observedAt: at(30), protocol: 'CDP', confidence: 90 }),
      observation({ id: 'o3', deviceId: 'sw-b', deviceName: 'Switch B', snapshotId: 'snap-b0', observedAt: at(40), localPortId: null, localPortNumber: 3 }),
    ] });
    const rows = map.get('10.0.0.1')!;
    assert.deepEqual(rows.map((row) => [row.observationId, row.observer.deviceId, row.protocol, row.current]), [['o2', 'sw-a', 'CDP', true], ['o3', 'sw-b', 'LLDP', false]], 'current first; sw-b was not seen in its latest poll');
    assert.equal(rows[0].confidence, 90);
    assert.deepEqual(rows[0].remote, { systemName: 'core-sw-01', portId: 'Te1/0/1', chassisId: 'aa:bb' });
  });

  it('says why a neighbour is or is not linkable', () => {
    const map = build({
      observations: [
        observation({ id: 'r', managementAddress: '10.0.0.1', resolvedDeviceId: 'core' }),
        observation({ id: 'g', managementAddress: '10.0.0.2' }),
        observation({ id: 'm', managementAddress: '10.0.0.3' }),
        observation({ id: 'u', managementAddress: '10.0.0.4' }),
      ],
      registered: new Map([['10.0.0.1', [{ id: 'core', name: 'Core' }]], ['10.0.0.2', [{ id: 'new', name: 'New' }]], ['10.0.0.3', [{ id: 'd1', name: 'D1' }, { id: 'd2', name: 'D2' }]]]),
      readableDeviceIds: new Set(['sw-a', 'core', 'new', 'd1']),
    });
    const one = (address: string) => map.get(address)![0];
    assert.equal(one('10.0.0.1').resolution, 'RESOLVED');
    assert.deepEqual(one('10.0.0.1').devices, [{ id: 'core', name: 'Core' }]);
    assert.equal(one('10.0.0.2').resolution, 'REGISTERED');
    assert.equal(one('10.0.0.3').resolution, 'AMBIGUOUS');
    assert.deepEqual(one('10.0.0.3').devices, [{ id: 'd1', name: 'D1' }], 'd2 is not readable, so it is counted but not named');
    assert.equal(one('10.0.0.4').resolution, 'UNREGISTERED');
    assert.deepEqual(one('10.0.0.4').devices, []);
  });

  it('matches the proposal the sightings created first, then a pending one for the same device pair', () => {
    const observations = [observation({ id: 'o1', observedAt: at(0), snapshotId: 'snap-a1', resolvedDeviceId: 'core' }), observation({ id: 'o2', resolvedDeviceId: 'core' })];
    const own = build({ observations, proposals: [
      proposal({ id: 'old-applied', status: 'APPLIED', createdAt: at(0), context: { observationId: 'o1' } }),
      proposal({ id: 'pending', context: { observationId: 'o1' }, createdAt: at(1) }),
      proposal({ id: 'not-a-link', action: 'INTERFACE_UPDATE', context: { observationId: 'o2' } }),
    ] }).get('10.0.0.1')![0];
    assert.deepEqual([own.proposal?.id, own.proposal?.match, own.proposal?.status], ['pending', 'OBSERVATION', 'PENDING'], 'pending wins over an older applied one');

    const pair = build({ observations, proposals: [
      proposal({ id: 'far-end', deviceId: 'core', context: { observationId: 'elsewhere' }, observedValues: { sourceDeviceId: 'core', targetDeviceId: 'sw-a' } }),
      proposal({ id: 'rejected-pair', status: 'REJECTED', deviceId: 'core', observedValues: { sourceDeviceId: 'sw-a', targetDeviceId: 'core' } }),
    ] }).get('10.0.0.1')![0];
    assert.deepEqual([pair.proposal?.id, pair.proposal?.match], ['far-end', 'DEVICE_PAIR']);

    const unresolved = build({ observations: [observation({ id: 'o9' })], proposals: [proposal({ id: 'x', observedValues: { sourceDeviceId: 'sw-a', targetDeviceId: 'core' } })] }).get('10.0.0.1')![0];
    assert.equal(unresolved.proposal, null, 'an unresolved neighbour has no device pair to match');
  });

  it('never shows a proposal on a device the caller cannot read', () => {
    const rows = build({
      observations: [observation({ id: 'o1', resolvedDeviceId: 'core' })],
      readableDeviceIds: new Set(['sw-a']),
      proposals: [proposal({ id: 'hidden', deviceId: 'core', observedValues: { sourceDeviceId: 'core', targetDeviceId: 'sw-a' } })],
    }).get('10.0.0.1')!;
    assert.equal(rows[0].proposal, null);
    assert.deepEqual(rows[0].devices, []);
    assert.equal(rows[0].resolution, 'RESOLVED');
  });

  it('ignores rows without a management address', () => {
    assert.equal(build({ observations: [observation({ id: 'o1', managementAddress: null })] }).size, 0);
  });
});
