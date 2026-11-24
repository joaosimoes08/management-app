import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { SnmpScalar, SnmpWalk } from './device-health';
import { cdpAddress, CISCO_NEIGHBOR_VENDOR, fallbackOnPortsWithoutLldp, FallbackNeighbor, GENERIC_NEIGHBOR_VENDOR, NEIGHBOR_OIDS, neighborVendorFor, parseCdpCache } from './neighbors';

/** Loads a simulated C9300 data file (e2e/snmp-sim-c9300) the way the poller normalises live varbinds. */
function simulatorWalk(variant: 'healthy' | 'degraded' | 'nolldp'): SnmpWalk {
  const file = join(__dirname, '..', '..', '..', 'e2e', 'snmp-sim-c9300', 'data', `c9300-${variant}.snmprec`);
  const walk: SnmpWalk = new Map();
  for (const line of readFileSync(file, 'utf8').split('\n')) {
    if (!line.trim()) continue;
    const [oid, type, ...rest] = line.split('|');
    const raw = rest.join('|');
    let value: SnmpScalar;
    if (type === '4x') { const text = Buffer.from(raw, 'hex').toString('utf8'); value = /^[\x20-\x7E]*$/.test(text) ? text : raw; }
    else if (['4', '6', '64', '70'].includes(type)) value = raw;
    else value = Number(raw);
    walk.set(oid, value);
  }
  return walk;
}

const cdp = NEIGHBOR_OIDS.cdpCacheEntry;
const neighbour = (ifIndex: number, remoteDeviceId = `peer-${ifIndex}`): FallbackNeighbor => ({ protocol: 'CDP', ifIndex, remoteIndex: 1, remoteDeviceId, remotePort: 'Gi0/1', platform: null, softwareVersion: null, managementAddress: null, capabilities: null, rawIdentifiers: {} });

describe('SNMP Phase 2 step 11: neighbour vendor selection', () => {
  it('walks CDP only for Cisco; other vendors stay on LLDP', () => {
    assert.equal(neighborVendorFor('1.3.6.1.4.1.9.1.2494').id, 'cisco');
    assert.equal(neighborVendorFor('.1.3.6.1.4.1.9.1.2494').id, 'cisco');
    assert.equal(neighborVendorFor('1.3.6.1.4.1.99.1').id, 'generic', 'a different enterprise that only shares the prefix digits');
    assert.equal(neighborVendorFor('1.3.6.1.4.1.2636.1.1.1.2.29').id, 'generic');
    assert.equal(neighborVendorFor(undefined).id, 'generic');
    assert.deepEqual(GENERIC_NEIGHBOR_VENDOR.fallbackWalks, []);
    assert.ok(CISCO_NEIGHBOR_VENDOR.fallbackWalks.every((oid) => oid.startsWith(`${cdp}.`)));
  });
});

describe('SNMP Phase 2 step 11: CDP cache parsing', () => {
  it('reads the simulated C9300 CDP neighbours (LLDP-absent variant)', () => {
    const rows = parseCdpCache(simulatorWalk('nolldp'));
    assert.deepEqual(rows.map((row) => [row.ifIndex, row.remoteDeviceId, row.remotePort, row.managementAddress]), [
      [1, 'ap-floor1-01', 'GigabitEthernet0', '10.250.70.31'],
      [49, 'core-sw-01', 'TenGigabitEthernet1/0/1', '10.250.70.1'],
      [50, 'core-sw-02', 'TenGigabitEthernet1/0/1', '10.250.70.2'],
    ]);
    assert.equal(rows[1].platform, 'cisco C9500-24Y4C');
    assert.equal(rows[1].protocol, 'CDP');
    assert.equal(rows[1].rawIdentifiers[`${cdp}.6.49.1`], 'core-sw-01');
  });

  it('decodes IPv4 from hex or printable text and IPv6, and rejects anything else', () => {
    assert.equal(cdpAddress(1, '0afa4601'), '10.250.70.1');
    assert.equal(cdpAddress(1, 'ABCD'), '65.66.67.68', 'four printable bytes arrive as text');
    assert.equal(cdpAddress(20, '20010db8000000000000000000000001'), '2001:db8:0:0:0:0:0:1');
    assert.equal(cdpAddress(1, '0afa46'), null);
    assert.equal(cdpAddress(2, '0afa4601'), null, 'non-IP address types are not guessed');
    assert.equal(cdpAddress(undefined, '0afa4601'), null);
  });

  it('skips malformed indexes and rows with neither device ID nor port', () => {
    const walk: SnmpWalk = new Map<string, SnmpScalar>([
      [`${cdp}.6.3.7`, 'switch-b'], [`${cdp}.7.3.7`, 'Gi0/2'],
      [`${cdp}.6.0.1`, 'bad-ifindex'],
      [`${cdp}.6.4.1.9`, 'bad-index-length'],
      [`${cdp}.8.5.1`, 'platform only'],
    ]);
    assert.deepEqual(parseCdpCache(walk).map((row) => [row.ifIndex, row.remoteIndex, row.remoteDeviceId]), [[3, 7, 'switch-b']]);
  });
});

describe('SNMP Phase 2 step 11: CDP only where LLDP saw no neighbour', () => {
  const interfaces = [
    { ifIndex: 1, name: 'Gi1/0/1', description: 'GigabitEthernet1/0/1' },
    { ifIndex: 49, name: 'Te1/1/1', description: 'TenGigabitEthernet1/1/1' },
    { ifIndex: 50, name: 'Te2/1/1', description: 'TenGigabitEthernet2/1/1' },
  ];
  const all = [neighbour(1), neighbour(49), neighbour(50)];

  it('keeps every CDP neighbour when LLDP reported nothing', () => {
    assert.deepEqual(fallbackOnPortsWithoutLldp(all, [], interfaces).map((row) => row.ifIndex), [1, 49, 50]);
  });

  it('drops CDP on ports LLDP already covers, matching the LLDP port name to ifName or ifDescr', () => {
    const lldp = [{ localPortNumber: 900, localPortId: 'te1/1/1' }, { localPortNumber: 901, localPortId: 'GigabitEthernet1/0/1' }];
    assert.deepEqual(fallbackOnPortsWithoutLldp(all, lldp, interfaces).map((row) => row.ifIndex), [50], 'lldpLocPortNum 900/901 are not ifIndexes; the names decide');
  });

  it('uses the LLDP port number only when the LLDP row has no usable port name', () => {
    assert.deepEqual(fallbackOnPortsWithoutLldp(all, [{ localPortNumber: 50 }], interfaces).map((row) => row.ifIndex), [1, 49]);
    assert.deepEqual(fallbackOnPortsWithoutLldp(all, [{ localPortNumber: 49, localPortId: 'unknown-port' }], interfaces).map((row) => row.ifIndex), [1, 50]);
  });

  it('on the healthy simulator, LLDP covers every CDP port so CDP adds nothing', () => {
    const walk = simulatorWalk('healthy');
    const lldp = [...walk].filter(([oid]) => oid.startsWith('1.0.8802.1.1.2.1.4.1.1.9.0.')).map(([oid]) => {
      const port = Number(oid.split('.').at(-2));
      return { localPortNumber: port, localPortId: String(walk.get(`1.0.8802.1.1.2.1.3.7.1.3.${port}`)) };
    });
    const simInterfaces = [...walk].filter(([oid]) => oid.startsWith('1.3.6.1.2.1.31.1.1.1.1.')).map(([oid, name]) => ({ ifIndex: Number(oid.split('.').at(-1)), name: String(name) }));
    assert.equal(lldp.length, 3);
    assert.deepEqual(fallbackOnPortsWithoutLldp(parseCdpCache(walk), lldp, simInterfaces), []);
  });
});
