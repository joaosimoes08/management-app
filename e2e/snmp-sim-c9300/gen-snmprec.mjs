#!/usr/bin/env node
// Generates the snmpsim data files for the simulated Cisco Catalyst C9300 2-member stack:
//   data/c9300-healthy.snmprec, data/c9300-degraded.snmprec and data/c9300-nolldp.snmprec
// All come from one model so they stay structurally identical; the degraded variant only changes values, and the
// nolldp variant is the healthy stack with LLDP-MIB absent (IOS XE default without `lldp run`), so only CDP
// reports neighbours (Phase 2 step 11).
// The data is synthetic (lab-only): names, serials, MACs and addresses are made up.
//
//   node e2e/snmp-sim-c9300/gen-snmprec.mjs          # rewrite both files
//   node e2e/snmp-sim-c9300/gen-snmprec.mjs --check  # exit 1 if the committed files are out of date
import { readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));

// snmprec value types (snmpsim): 2 INTEGER, 4 OCTET STRING, 4x OCTET STRING as hex, 6 OID, 64 IpAddress,
// 65 Counter32, 66 Gauge32, 67 TimeTicks, 70 Counter64.
const T = { int: '2', str: '4', hex: '4x', oid: '6', ip: '64', c32: '65', g32: '66', ticks: '67', c64: '70' };

const mac = (last) => `00a3d1c930${last.toString(16).padStart(2, '0')}`;
const ipHex = (ip) => ip.split('.').map((o) => Number(o).toString(16).padStart(2, '0')).join('');

function model(variant) {
  const degraded = variant === 'degraded';
  const lldp = variant !== 'nolldp';
  const rows = [];
  const add = (oid, type, value) => rows.push([oid, type, String(value)]);

  // ---------- SNMPv2-MIB system group ----------
  const sys = '1.3.6.1.2.1.1';
  add(`${sys}.1.0`, T.str, 'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a, RELEASE SOFTWARE (fc3) - SNMP lab simulation');
  add(`${sys}.2.0`, T.oid, '1.3.6.1.4.1.9.1.2494'); // Cisco enterprise subtree, C9300-48P style sysObjectID
  // Healthy: up 45 days. Degraded: rebooted 4 minutes ago.
  add(`${sys}.3.0`, T.ticks, degraded ? 24_000 : 388_800_000);
  add(`${sys}.4.0`, T.str, 'netops-lab@example.invalid');
  add(`${sys}.5.0`, T.str, 'sim-c9300-01');
  add(`${sys}.6.0`, T.str, 'SNMP lab - simulated IDF-1 rack');
  add(`${sys}.7.0`, T.int, 6);

  // ---------- Interfaces ----------
  // ifIndex: 1-3 Gi1/0/1-3 (member 1), 4-6 Gi2/0/1-3 (member 2), 49 Te1/1/1 uplink 1 (member 1), 50 Te2/1/1 uplink 2 (member 2).
  const ifaces = [
    { idx: 1, name: 'Gi1/0/1', descr: 'GigabitEthernet1/0/1', alias: 'ACCESS-AP-FLOOR1', speed: 1000, oper: 1 },
    { idx: 2, name: 'Gi1/0/2', descr: 'GigabitEthernet1/0/2', alias: 'ACCESS-PRINTER-01', speed: 1000, oper: 1 },
    { idx: 3, name: 'Gi1/0/3', descr: 'GigabitEthernet1/0/3', alias: 'ACCESS-SPARE', speed: 1000, oper: 2 },
    { idx: 4, name: 'Gi2/0/1', descr: 'GigabitEthernet2/0/1', alias: 'ACCESS-DESK-201', speed: 1000, oper: 1 },
    { idx: 5, name: 'Gi2/0/2', descr: 'GigabitEthernet2/0/2', alias: 'ACCESS-DESK-202', speed: 1000, oper: 1 },
    { idx: 6, name: 'Gi2/0/3', descr: 'GigabitEthernet2/0/3', alias: 'ACCESS-SPARE', speed: 1000, oper: 2 },
    { idx: 49, name: 'Te1/1/1', descr: 'TenGigabitEthernet1/1/1', alias: 'UPLINK-CORE-SW-01', speed: 10000, oper: 1, uplink: 1 },
    { idx: 50, name: 'Te2/1/1', descr: 'TenGigabitEthernet2/1/1', alias: 'UPLINK-CORE-SW-02', speed: 10000, oper: degraded ? 2 : 1, uplink: 2 },
  ];
  for (const i of ifaces) {
    // Error counters: healthy is a handful; degraded is much higher on the uplinks and one access port.
    const noisy = i.uplink || i.idx === 4;
    i.inErrors = degraded && noisy ? 48_213 + i.idx * 7 : i.uplink ? 3 : 0;
    i.outErrors = degraded && noisy ? 9_877 + i.idx * 3 : 0;
    i.inDiscards = degraded && noisy ? 15_402 : i.uplink ? 12 : 1;
    i.crc = degraded && noisy ? 31_090 : 0;
    i.inOctets = i.oper === 1 ? (i.uplink ? 912_345_678_901 : 4_567_890_123) + i.idx : 0;
    i.outOctets = i.oper === 1 ? (i.uplink ? 734_567_890_123 : 2_345_678_901) + i.idx : 0;
    i.lastChange = degraded && i.uplink === 2 ? 21_000 : degraded ? 3_000 : 1_200;
  }
  const ifTable = '1.3.6.1.2.1.2.2.1';
  add('1.3.6.1.2.1.2.1.0', T.int, ifaces.length);
  for (const i of ifaces) {
    add(`${ifTable}.1.${i.idx}`, T.int, i.idx);
    add(`${ifTable}.2.${i.idx}`, T.str, i.descr);
    add(`${ifTable}.3.${i.idx}`, T.int, 6); // ethernetCsmacd
    add(`${ifTable}.4.${i.idx}`, T.int, i.uplink ? 9198 : 1500);
    add(`${ifTable}.5.${i.idx}`, T.g32, Math.min(i.speed * 1_000_000, 4_294_967_295));
    add(`${ifTable}.6.${i.idx}`, T.hex, mac(i.idx));
    add(`${ifTable}.7.${i.idx}`, T.int, 1); // adminStatus up on every port
    add(`${ifTable}.8.${i.idx}`, T.int, i.oper);
    add(`${ifTable}.9.${i.idx}`, T.ticks, i.lastChange);
    add(`${ifTable}.10.${i.idx}`, T.c32, i.inOctets % 4_294_967_296);
    add(`${ifTable}.13.${i.idx}`, T.c32, i.inDiscards);
    add(`${ifTable}.14.${i.idx}`, T.c32, i.inErrors);
    add(`${ifTable}.16.${i.idx}`, T.c32, i.outOctets % 4_294_967_296);
    add(`${ifTable}.19.${i.idx}`, T.c32, 0);
    add(`${ifTable}.20.${i.idx}`, T.c32, i.outErrors);
  }
  const ifX = '1.3.6.1.2.1.31.1.1.1';
  for (const i of ifaces) {
    add(`${ifX}.1.${i.idx}`, T.str, i.name);
    add(`${ifX}.6.${i.idx}`, T.c64, i.inOctets);
    add(`${ifX}.10.${i.idx}`, T.c64, i.outOctets);
    add(`${ifX}.15.${i.idx}`, T.g32, i.speed);
    add(`${ifX}.18.${i.idx}`, T.str, i.alias);
  }

  // ---------- ENTITY-MIB entPhysicalTable ----------
  // class: 3 chassis, 6 powerSupply, 7 fan, 11 stack. 1 = stack, 1000/2000 = members, x010/x011 PSUs, x020/x021 fans.
  const ent = [{ idx: 1, descr: 'c93xx Stack', cls: 11, parent: 0, pos: -1, name: 'c93xx Stack', model: '', serial: '' }];
  for (const m of [1, 2]) {
    const base = m * 1000;
    ent.push({ idx: base, descr: 'C9300-48P', cls: 3, parent: 1, pos: m, name: `Switch ${m}`, model: 'C9300-48P', serial: `FOC2601LAB${m}` });
    ent.push({ idx: base + 10, descr: `Switch ${m} - Power Supply A`, cls: 6, parent: base, pos: 1, name: `Switch ${m} - Power Supply A`, model: 'PWR-C1-715WAC-P', serial: `LIT2601PA${m}` });
    ent.push({ idx: base + 11, descr: `Switch ${m} - Power Supply B`, cls: 6, parent: base, pos: 2, name: `Switch ${m} - Power Supply B`, model: 'PWR-C1-715WAC-P', serial: `LIT2601PB${m}` });
    ent.push({ idx: base + 20, descr: `Switch ${m} - Fan 1`, cls: 7, parent: base, pos: 1, name: `Switch ${m} - Fan 1`, model: 'FAN-T1', serial: '' });
    ent.push({ idx: base + 21, descr: `Switch ${m} - Fan 2`, cls: 7, parent: base, pos: 2, name: `Switch ${m} - Fan 2`, model: 'FAN-T1', serial: '' });
  }
  const entT = '1.3.6.1.2.1.47.1.1.1.1';
  for (const e of ent) {
    add(`${entT}.2.${e.idx}`, T.str, e.descr);
    add(`${entT}.4.${e.idx}`, T.int, e.parent);
    add(`${entT}.5.${e.idx}`, T.int, e.cls);
    add(`${entT}.6.${e.idx}`, T.int, e.pos);
    add(`${entT}.7.${e.idx}`, T.str, e.name);
    add(`${entT}.10.${e.idx}`, T.str, e.cls === 3 ? '17.9.4a' : '');
    add(`${entT}.11.${e.idx}`, T.str, e.serial);
    add(`${entT}.13.${e.idx}`, T.str, e.model);
  }

  // ---------- CISCO-PROCESS-MIB cpmCPUTotalTable ----------
  // Index 1 = member 1 (active), 2 = member 2. Degraded: member 1 CPU > 90 % on 5 s / 1 min / 5 min.
  const cpu = '1.3.6.1.4.1.9.9.109.1.1.1.1';
  const cpus = [
    { idx: 1, phys: 1000, s5: degraded ? 97 : 8, m1: degraded ? 94 : 6, m5: degraded ? 91 : 5 },
    { idx: 2, phys: 2000, s5: degraded ? 12 : 4, m1: degraded ? 11 : 4, m5: degraded ? 9 : 3 },
  ];
  for (const c of cpus) add(`${cpu}.2.${c.idx}`, T.int, c.phys);
  for (const c of cpus) add(`${cpu}.6.${c.idx}`, T.g32, c.s5);
  for (const c of cpus) add(`${cpu}.7.${c.idx}`, T.g32, c.m1);
  for (const c of cpus) add(`${cpu}.8.${c.idx}`, T.g32, c.m5);

  // ---------- CISCO-MEMORY-POOL-MIB ciscoMemoryPoolTable ----------
  // Pool 1 Processor, 2 I/O. Degraded: Processor pool 94 % used (> 90 %).
  const mem = '1.3.6.1.4.1.9.9.48.1.1.1';
  const pools = [
    { idx: 1, name: 'Processor', used: degraded ? 1_513_000_000 : 412_000_000, free: degraded ? 96_000_000 : 1_197_000_000 },
    { idx: 2, name: 'lsmpi_io', used: 6_200_000, free: 200_000 },
  ];
  for (const p of pools) add(`${mem}.2.${p.idx}`, T.str, p.name);
  for (const p of pools) add(`${mem}.3.${p.idx}`, T.int, 0);
  for (const p of pools) add(`${mem}.4.${p.idx}`, T.int, 1);
  for (const p of pools) add(`${mem}.5.${p.idx}`, T.g32, p.used);
  for (const p of pools) add(`${mem}.6.${p.idx}`, T.g32, p.free);

  // ---------- CISCO-ENVMON-MIB ----------
  // State: 1 normal, 2 warning, 3 critical, 4 shutdown, 5 notPresent, 6 notFunctioning.
  // Degraded: Switch 2 Power Supply B notFunctioning, Switch 1 Fan 2 critical, inlet temperature warning.
  const env = '1.3.6.1.4.1.9.9.13.1';
  const temps = [
    { idx: 1010, descr: 'Switch 1 - Inlet Temp Sensor', value: degraded ? 51 : 27, threshold: 56, state: degraded ? 2 : 1 },
    { idx: 2010, descr: 'Switch 2 - Inlet Temp Sensor', value: degraded ? 33 : 26, threshold: 56, state: 1 },
  ];
  for (const t of temps) add(`${env}.3.1.2.${t.idx}`, T.str, t.descr);
  for (const t of temps) add(`${env}.3.1.3.${t.idx}`, T.g32, t.value);
  for (const t of temps) add(`${env}.3.1.4.${t.idx}`, T.int, t.threshold);
  for (const t of temps) add(`${env}.3.1.6.${t.idx}`, T.int, t.state);
  const fans = [
    { idx: 1020, descr: 'Switch 1 - Fan 1', state: 1 },
    { idx: 1021, descr: 'Switch 1 - Fan 2', state: degraded ? 3 : 1 },
    { idx: 2020, descr: 'Switch 2 - Fan 1', state: 1 },
    { idx: 2021, descr: 'Switch 2 - Fan 2', state: 1 },
  ];
  for (const f of fans) add(`${env}.4.1.2.${f.idx}`, T.str, f.descr);
  for (const f of fans) add(`${env}.4.1.3.${f.idx}`, T.int, f.state);
  const psus = [
    { idx: 1010, descr: 'Switch 1 - Power Supply A', state: 1 },
    { idx: 1011, descr: 'Switch 1 - Power Supply B', state: 1 },
    { idx: 2010, descr: 'Switch 2 - Power Supply A', state: 1 },
    { idx: 2011, descr: 'Switch 2 - Power Supply B', state: degraded ? 6 : 1 },
  ];
  for (const p of psus) add(`${env}.5.1.2.${p.idx}`, T.str, p.descr);
  for (const p of psus) add(`${env}.5.1.3.${p.idx}`, T.int, p.state);
  for (const p of psus) add(`${env}.5.1.4.${p.idx}`, T.int, 2); // source ac

  // ---------- CISCO-STACKWISE-MIB ----------
  // cswRingRedundant (TruthValue 1 true / 2 false); cswSwitchInfoTable indexed by entPhysicalIndex of each member.
  // cswSwitchRole: 1 master, 2 member, 3 notMember, 4 standby.
  // cswSwitchState: 1 waiting, 2 progressing, 3 added, 4 ready, 5 sdmMismatch, 6 verMismatch, ... Degraded: member 2 verMismatch.
  const csw = '1.3.6.1.4.1.9.9.500.1';
  add(`${csw}.1.1.0`, T.int, 8); // cswMaxSwitchNum
  add(`${csw}.1.3.0`, T.int, degraded ? 2 : 1);
  const members = [
    { phys: 1000, num: 1, role: 1, prio: 15, state: 4, mac: mac(0xa1) },
    { phys: 2000, num: 2, role: 4, prio: 14, state: degraded ? 6 : 4, mac: mac(0xa2) },
  ];
  const swInfo = `${csw}.2.1.1`;
  for (const m of members) add(`${swInfo}.1.${m.phys}`, T.int, m.num);
  for (const m of members) add(`${swInfo}.2.${m.phys}`, T.int, m.num);
  for (const m of members) add(`${swInfo}.3.${m.phys}`, T.int, m.role);
  for (const m of members) add(`${swInfo}.4.${m.phys}`, T.int, m.prio);
  for (const m of members) add(`${swInfo}.5.${m.phys}`, T.int, 5);
  for (const m of members) add(`${swInfo}.6.${m.phys}`, T.int, m.state);
  for (const m of members) add(`${swInfo}.7.${m.phys}`, T.hex, m.mac);

  // ---------- Neighbours: CDP (CISCO-CDP-MIB cdpCacheTable) and LLDP-MIB ----------
  // Uplink 1 -> core-sw-01 Te1/0/1, uplink 2 -> core-sw-02 Te1/0/1, Gi1/0/1 -> an access point.
  // Degraded: uplink 2 is down, so core-sw-02 is no longer a neighbour.
  const neighbours = [
    { ifIndex: 1, name: 'ap-floor1-01', port: 'GigabitEthernet0', platform: 'cisco C9120AXI-E', ip: '10.250.70.31', chassis: '00a3d1ab0031', caps: '00000002', lldpCaps: '0008' },
    { ifIndex: 49, name: 'core-sw-01', port: 'TenGigabitEthernet1/0/1', platform: 'cisco C9500-24Y4C', ip: '10.250.70.1', chassis: '00a3d1cc0001', caps: '00000029', lldpCaps: '0014' },
    ...(degraded ? [] : [{ ifIndex: 50, name: 'core-sw-02', port: 'TenGigabitEthernet1/0/1', platform: 'cisco C9500-24Y4C', ip: '10.250.70.2', chassis: '00a3d1cc0002', caps: '00000029', lldpCaps: '0014' }]),
  ];
  const cdp = '1.3.6.1.4.1.9.9.23.1.2.1.1';
  for (const col of [3, 4, 5, 6, 7, 8, 9]) {
    for (const n of neighbours) {
      const key = `${cdp}.${col}.${n.ifIndex}.1`;
      if (col === 3) add(key, T.int, 1); // ip
      if (col === 4) add(key, T.hex, ipHex(n.ip));
      if (col === 5) add(key, T.str, 'Cisco IOS Software [Cupertino], Version 17.9.4a');
      if (col === 6) add(key, T.str, n.name);
      if (col === 7) add(key, T.str, n.port);
      if (col === 8) add(key, T.str, n.platform);
      if (col === 9) add(key, T.hex, n.caps);
    }
  }
  const lldpLoc = '1.0.8802.1.1.2.1.3';
  add(`${lldpLoc}.1.0`, T.int, 4); // lldpLocChassisIdSubtype macAddress
  add(`${lldpLoc}.2.0`, T.hex, mac(0xa1));
  add(`${lldpLoc}.3.0`, T.str, 'sim-c9300-01');
  add(`${lldpLoc}.4.0`, T.str, 'Cisco IOS Software [Cupertino], Catalyst L3 Switch Software (CAT9K_IOSXE), Version 17.9.4a');
  for (const col of [2, 3, 4]) {
    for (const i of ifaces) {
      const key = `${lldpLoc}.7.1.${col}.${i.idx}`; // lldpLocPortNum = ifIndex
      if (col === 2) add(key, T.int, 5); // interfaceName
      if (col === 3) add(key, T.str, i.name);
      if (col === 4) add(key, T.str, i.descr);
    }
  }
  const lldpRem = '1.0.8802.1.1.2.1.4.1.1'; // index: lldpRemTimeMark.lldpRemLocalPortNum.lldpRemIndex
  for (const col of [4, 5, 6, 7, 8, 9, 10, 11, 12]) {
    for (const n of neighbours) {
      const key = `${lldpRem}.${col}.0.${n.ifIndex}.1`;
      if (col === 4) add(key, T.int, 4);
      if (col === 5) add(key, T.hex, n.chassis);
      if (col === 6) add(key, T.int, 5);
      if (col === 7) add(key, T.str, n.port);
      if (col === 8) add(key, T.str, n.port);
      if (col === 9) add(key, T.str, n.name);
      if (col === 10) add(key, T.str, n.platform);
      if (col === 11) add(key, T.hex, n.lldpCaps);
      if (col === 12) add(key, T.hex, n.lldpCaps);
    }
  }

  // ---------- Endpoints (D-P1e): ARP (IP-MIB) and the bridge forwarding table (Q-BRIDGE/BRIDGE-MIB) ----------
  // healthy/degraded expose the current tables (ipNetToPhysicalTable, dot1qTpFdbTable with an FDB-id -> VLAN map);
  // nolldp exposes only the legacy ones (ipNetToMediaTable, dot1dTpFdbTable) so the parser's fallbacks are exercised.
  // A laptop MAC is learned in two VLANs on purpose: MAC entries are keyed by VLAN, never merged into one identity.
  // Degraded: uplink 2 is down, so core-sw-02 is gone from both tables.
  const legacy = variant === 'nolldp';
  const arp = [
    { ifIndex: 1, ip: '10.250.70.31', mac: '00a3d1ab0031', type: 3 },
    { ifIndex: 2, ip: '10.250.70.50', mac: '00a3d1ee0050', type: 3 },
    { ifIndex: 49, ip: '10.250.70.1', mac: '00a3d1cc0001', type: 3 },
    ...(degraded ? [] : [{ ifIndex: 50, ip: '10.250.70.2', mac: '00a3d1cc0002', type: 4 }]),
  ];
  const ipBytes = (ip) => ip.split('.').map(Number).join('.');
  if (legacy) {
    const media = '1.3.6.1.2.1.4.22.1'; // index: ifIndex.a.b.c.d
    for (const a of arp) add(`${media}.2.${a.ifIndex}.${ipBytes(a.ip)}`, T.hex, a.mac);
    for (const a of arp) add(`${media}.4.${a.ifIndex}.${ipBytes(a.ip)}`, T.int, a.type);
  } else {
    const phys = '1.3.6.1.2.1.4.35.1'; // index: ifIndex.addressType(ipv4=1).length(4).a.b.c.d
    for (const a of arp) add(`${phys}.4.${a.ifIndex}.1.4.${ipBytes(a.ip)}`, T.hex, a.mac);
    for (const a of arp) add(`${phys}.6.${a.ifIndex}.1.4.${ipBytes(a.ip)}`, T.int, a.type);
  }
  // Bridge port n -> ifIndex: 1-6 are the access ports, 7 and 8 the uplinks (ifIndex 49 and 50).
  const bridgePorts = [1, 2, 3, 4, 5, 6, 49, 50];
  bridgePorts.forEach((ifIndex, k) => add(`1.3.6.1.2.1.17.1.4.1.2.${k + 1}`, T.int, ifIndex));
  const macBytes = (m) => m.match(/../g).map((h) => parseInt(h, 16)).join('.');
  const fdb = [
    { vlan: 70, port: 1, mac: '00a3d1ab0031', status: 3 },
    { vlan: 70, port: 2, mac: '00a3d1ee0050', status: 3 },
    { vlan: 70, port: 7, mac: '00a3d1cc0001', status: 3 },
    ...(degraded ? [] : [{ vlan: 70, port: 8, mac: '00a3d1cc0002', status: 3 }]),
    { vlan: 80, port: 3, mac: '00a3d1ee0050', status: 3 },
    { vlan: 80, port: 0, mac: mac(0xa1), status: 4 },
  ];
  if (legacy) {
    // BRIDGE-MIB has no VLAN in its index; keep the VLAN 70 rows (what a Cisco default context answers).
    const tp = '1.3.6.1.2.1.17.4.3.1'; // index: mac (6 bytes)
    const rowsV70 = fdb.filter((f) => f.vlan === 70);
    for (const f of rowsV70) add(`${tp}.1.${macBytes(f.mac)}`, T.hex, f.mac);
    for (const f of rowsV70) add(`${tp}.2.${macBytes(f.mac)}`, T.int, f.port);
    for (const f of rowsV70) add(`${tp}.3.${macBytes(f.mac)}`, T.int, f.status);
  } else {
    // dot1qVlanFdbId: VLAN 70 uses FDB 2, VLAN 80 uses FDB 3 (index: timeMark.vlanIndex).
    add('1.3.6.1.2.1.17.7.1.4.2.1.3.0.70', T.g32, 2);
    add('1.3.6.1.2.1.17.7.1.4.2.1.3.0.80', T.g32, 3);
    const fdbId = (vlan) => (vlan === 70 ? 2 : 3);
    const q = '1.3.6.1.2.1.17.7.1.2.2.1'; // index: fdbId.mac (6 bytes)
    for (const f of fdb) add(`${q}.2.${fdbId(f.vlan)}.${macBytes(f.mac)}`, T.int, f.port);
    for (const f of fdb) add(`${q}.3.${fdbId(f.vlan)}.${macBytes(f.mac)}`, T.int, f.status);
  }

  // nolldp: the device has no LLDP-MIB at all, so the whole 1.0.8802 subtree is missing.
  if (!lldp) for (let k = rows.length - 1; k >= 0; k -= 1) if (rows[k][0].startsWith('1.0.8802.')) rows.splice(k, 1);

  // snmpsim serves GETNEXT/GETBULK from the file order, so sort by numeric OID.
  const cmp = (a, b) => {
    const x = a[0].split('.').map(Number); const y = b[0].split('.').map(Number);
    for (let k = 0; k < Math.min(x.length, y.length); k += 1) if (x[k] !== y[k]) return x[k] - y[k];
    return x.length - y.length;
  };
  rows.sort(cmp);
  for (let k = 1; k < rows.length; k += 1) if (rows[k][0] === rows[k - 1][0]) throw new Error(`duplicate OID ${rows[k][0]}`);
  return rows.map((r) => r.join('|')).join('\n') + '\n';
}

const check = process.argv.includes('--check');
let stale = false;
for (const variant of ['healthy', 'degraded', 'nolldp']) {
  const file = join(here, 'data', `c9300-${variant}.snmprec`);
  const text = model(variant);
  if (check) {
    let current = '';
    try { current = readFileSync(file, 'utf8'); } catch { /* missing */ }
    if (current !== text) { console.error(`${file} is out of date; run node e2e/snmp-sim-c9300/gen-snmprec.mjs`); stale = true; }
  } else {
    writeFileSync(file, text);
    console.log(`wrote ${file} (${text.trimEnd().split('\n').length} OIDs)`);
  }
}
if (stale) process.exit(1);
