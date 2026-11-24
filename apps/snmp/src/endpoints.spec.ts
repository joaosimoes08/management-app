import { strict as assert } from 'node:assert';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { MAX_MAC_ENTRIES, normaliseMac, OIDS, parseBridgeFdb, parseBridgePorts, parseFdbVlans, parseIpNetToMedia, parseIpNetToPhysical, parseQBridgeFdb, pollEndpoints } from './endpoints';

/** A walk over a committed simulator data file, typed the way net-snmp hands values over (OctetString -> Buffer). */
function simulatorWalk(variant: 'healthy' | 'degraded' | 'nolldp') {
  const text = readFileSync(join(__dirname, '../../../e2e/snmp-sim-c9300/data', `c9300-${variant}.snmprec`), 'utf8');
  const rows = text.trim().split('\n').map((line) => {
    const [oid, type, value] = line.split('|');
    return { oid, value: type === '4x' ? Buffer.from(value, 'hex') : type === '4' ? Buffer.from(value) : ['2', '65', '66', '67'].includes(type) ? Number(value) : value };
  });
  const walked: string[] = [];
  const walk = async (_session: unknown, oid: string) => { walked.push(oid); return rows.filter((row) => row.oid.startsWith(`${oid}.`)); };
  return { walk, walked };
}

const vb = (oid: string, value: unknown) => ({ oid, value });

describe('D-P1e endpoint tables: MAC normalisation', () => {
  it('turns Buffers, hex and separated forms into lowercase colon form and refuses junk', () => {
    assert.equal(normaliseMac(Buffer.from('00A3D1AB0031', 'hex')), '00:a3:d1:ab:00:31');
    assert.equal(normaliseMac('00A3D1AB0031'), '00:a3:d1:ab:00:31');
    assert.equal(normaliseMac('0:a3:d1:ab:0:31'), '00:a3:d1:ab:00:31');
    assert.equal(normaliseMac('00-a3-d1-ab-00-31'), '00:a3:d1:ab:00:31');
    for (const bad of [Buffer.alloc(6), Buffer.from('ffffffffffff', 'hex'), Buffer.from('00a3d1', 'hex'), 'not-a-mac', 42, null]) assert.equal(normaliseMac(bad), null);
  });
});

describe('D-P1e endpoint tables: parsers', () => {
  it('reads IPv4 rows of ipNetToPhysicalTable, skips IPv6 and invalid entries', () => {
    const base = OIDS.ipNetToPhysical;
    const rows = parseIpNetToPhysical([
      vb(`${base}.4.7.1.4.10.0.0.5`, Buffer.from('00a3d1000005', 'hex')), vb(`${base}.6.7.1.4.10.0.0.5`, 3),
      vb(`${base}.4.7.1.4.10.0.0.6`, Buffer.from('00a3d1000006', 'hex')), vb(`${base}.6.7.1.4.10.0.0.6`, 2), // invalid
      vb(`${base}.4.7.2.16.${'254.128.0.0.0.0.0.0.0.0.0.0.0.0.0.1'}`, Buffer.from('00a3d1000007', 'hex')), // IPv6
      vb(`${base}.4.7.1.4.10.0.0.8`, Buffer.alloc(6)), // incomplete entry, all-zero MAC
    ]);
    assert.deepEqual(rows, [{ ipAddress: '10.0.0.5', macAddress: '00:a3:d1:00:00:05', ifIndex: 7, type: 'DYNAMIC' }]);
  });

  it('reads the legacy ipNetToMediaTable', () => {
    const base = OIDS.ipNetToMedia;
    assert.deepEqual(parseIpNetToMedia([vb(`${base}.2.3.192.168.1.9`, Buffer.from('00a3d1000009', 'hex')), vb(`${base}.4.3.192.168.1.9`, 4)]), [{ ipAddress: '192.168.1.9', macAddress: '00:a3:d1:00:00:09', ifIndex: 3, type: 'STATIC' }]);
  });

  it('maps Q-BRIDGE FDB ids to VLANs and bridge ports to ifIndex; shared FDBs leave the VLAN unknown', () => {
    const ports = parseBridgePorts([vb(`${OIDS.dot1dBasePortIfIndex}.1`, 101), vb(`${OIDS.dot1dBasePortIfIndex}.2`, 102)]);
    const vlans = parseFdbVlans([vb(`${OIDS.dot1qVlanFdbId}.0.10`, 5), vb(`${OIDS.dot1qVlanFdbId}.0.20`, 9), vb(`${OIDS.dot1qVlanFdbId}.0.21`, 9)]);
    assert.deepEqual([...vlans], [[5, 10]]);
    const rows = parseQBridgeFdb([
      vb(`${OIDS.dot1qTpFdb}.2.5.0.163.209.0.0.1`, 1), vb(`${OIDS.dot1qTpFdb}.3.5.0.163.209.0.0.1`, 3),
      vb(`${OIDS.dot1qTpFdb}.2.9.0.163.209.0.0.2`, 2), vb(`${OIDS.dot1qTpFdb}.3.9.0.163.209.0.0.2`, 3),
      vb(`${OIDS.dot1qTpFdb}.2.5.0.163.209.0.0.3`, 2), vb(`${OIDS.dot1qTpFdb}.3.5.0.163.209.0.0.3`, 2), // invalid
    ], vlans, ports);
    assert.deepEqual(rows, [
      { vlanId: 10, macAddress: '00:a3:d1:00:00:01', bridgePort: 1, ifIndex: 101, status: 'LEARNED' },
      { vlanId: null, macAddress: '00:a3:d1:00:00:02', bridgePort: 2, ifIndex: 102, status: 'LEARNED' },
    ]);
    // Without dot1qVlanFdbId the FDB id is the VLAN (independent VLAN learning).
    assert.equal(parseQBridgeFdb([vb(`${OIDS.dot1qTpFdb}.2.30.0.163.209.0.0.1`, 1)], new Map(), ports)[0].vlanId, 30);
  });

  it('reads BRIDGE-MIB dot1dTpFdbTable with no VLAN', () => {
    const rows = parseBridgeFdb([vb(`${OIDS.dot1dTpFdb}.2.0.163.209.0.0.1`, 4), vb(`${OIDS.dot1dTpFdb}.3.0.163.209.0.0.1`, 3)], new Map([[4, 44]]));
    assert.deepEqual(rows, [{ vlanId: null, macAddress: '00:a3:d1:00:00:01', bridgePort: 4, ifIndex: 44, status: 'LEARNED' }]);
  });
});

describe('D-P1e endpoint tables against the simulator data files', () => {
  it('healthy: IP-MIB ARP and Q-BRIDGE FDB keyed by VLAN; the same laptop MAC in two VLANs stays two rows', async () => {
    const { walk } = simulatorWalk('healthy');
    const tables = await pollEndpoints({} as never, walk as never);
    assert.equal(tables.arpSource, 'IP-MIB');
    assert.equal(tables.macSource, 'Q-BRIDGE-MIB');
    assert.equal(tables.truncated, false);
    assert.deepEqual(tables.arp.map((row) => `${row.ipAddress} ${row.macAddress} if${row.ifIndex} ${row.type}`), [
      '10.250.70.1 00:a3:d1:cc:00:01 if49 DYNAMIC',
      '10.250.70.2 00:a3:d1:cc:00:02 if50 STATIC',
      '10.250.70.31 00:a3:d1:ab:00:31 if1 DYNAMIC',
      '10.250.70.50 00:a3:d1:ee:00:50 if2 DYNAMIC',
    ]);
    assert.deepEqual(tables.mac.map((row) => `${row.vlanId} ${row.macAddress} p${row.bridgePort} if${row.ifIndex} ${row.status}`), [
      '70 00:a3:d1:ab:00:31 p1 if1 LEARNED',
      '70 00:a3:d1:cc:00:01 p7 if49 LEARNED',
      '70 00:a3:d1:cc:00:02 p8 if50 LEARNED',
      '70 00:a3:d1:ee:00:50 p2 if2 LEARNED',
      '80 00:a3:d1:c9:30:a1 pnull ifnull SELF',
      '80 00:a3:d1:ee:00:50 p3 if3 LEARNED',
    ]);
  });

  it('degraded: core-sw-02 (uplink 2 down) is gone from both tables', async () => {
    const tables = await pollEndpoints({} as never, simulatorWalk('degraded').walk as never);
    assert.equal(tables.arp.some((row) => row.macAddress === '00:a3:d1:cc:00:02'), false);
    assert.equal(tables.mac.some((row) => row.macAddress === '00:a3:d1:cc:00:02'), false);
    assert.equal(tables.mac.length, 5);
  });

  it('nolldp (legacy MIBs only): falls back to ipNetToMediaTable and dot1dTpFdbTable, VLAN unknown', async () => {
    const { walk, walked } = simulatorWalk('nolldp');
    const tables = await pollEndpoints({} as never, walk as never);
    assert.equal(tables.arpSource, 'RFC1213-MIB');
    assert.equal(tables.macSource, 'BRIDGE-MIB');
    assert.ok(walked.includes(OIDS.ipNetToMedia) && walked.includes(OIDS.dot1dTpFdb));
    assert.equal(tables.arp.length, 4);
    assert.deepEqual(tables.mac.map((row) => `${row.vlanId} ${row.macAddress} if${row.ifIndex}`), [
      'null 00:a3:d1:ab:00:31 if1', 'null 00:a3:d1:cc:00:01 if49', 'null 00:a3:d1:cc:00:02 if50', 'null 00:a3:d1:ee:00:50 if2',
    ]);
  });

  it('a device without the MIBs, or a failing walk, gives empty tables instead of an error', async () => {
    const tables = await pollEndpoints({} as never, (async () => { throw new Error('noSuchName'); }) as never);
    assert.deepEqual(tables, { arp: [], mac: [], arpSource: null, macSource: null, truncated: false });
  });

  it('caps the forwarding table per device and reports truncation', async () => {
    const rows = Array.from({ length: MAX_MAC_ENTRIES + 5 }, (_, n) => vb(`${OIDS.dot1qTpFdb}.2.10.2.0.0.${(n >> 16) & 255}.${(n >> 8) & 255}.${n & 255}`, 1));
    const tables = await pollEndpoints({} as never, (async (_s: unknown, oid: string) => (oid === OIDS.dot1qTpFdb ? rows : [])) as never);
    assert.equal(tables.mac.length, MAX_MAC_ENTRIES);
    assert.equal(tables.truncated, true);
  });
});
