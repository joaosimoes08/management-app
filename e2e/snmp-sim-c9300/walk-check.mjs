#!/usr/bin/env node
// Walks the simulated C9300 (healthy and degraded) over SNMPv2c and SNMPv3 authPriv and checks the key OIDs
// and the healthy/degraded differences. Exits 1 on any failure.
// Needs net-snmp's snmpbulkwalk/snmpget on PATH (with AES support) and the compose stack up:
//   docker compose -f e2e/snmp-sim-c9300/docker-compose.yml up -d --build
//   node e2e/snmp-sim-c9300/walk-check.mjs
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const run = promisify(execFile);
const env = (name, fallback) => process.env[name] || fallback;
const TARGETS = { healthy: env('SIM_HEALTHY', '127.0.0.1:16161'), degraded: env('SIM_DEGRADED', '127.0.0.1:16162') };
// Lab-only test credentials (see docker-compose.yml).
const COMMUNITY = env('SIM_COMMUNITY', 'lab-public');
const V3 = ['-v3', '-l', 'authPriv', '-u', env('SIM_V3_USER', 'labpoll'), '-a', 'SHA', '-A', env('SIM_V3_AUTH_KEY', 'lab-poll-auth-pass'), '-x', 'AES', '-X', env('SIM_V3_PRIV_KEY', 'lab-poll-priv-pass')];
const AUTH = { v2c: ['-v2c', '-c', COMMUNITY], v3: V3 };
const COMMON = ['-On', '-Oe', '-Ot', '-Oq', '-t', '3', '-r', '2'];

let failures = 0;
const ok = (msg) => console.log(`  ok   ${msg}`);
const fail = (msg) => { failures += 1; console.log(`  FAIL ${msg}`); };
const expect = (cond, msg) => (cond ? ok(msg) : fail(msg));

async function walk(target, auth) {
  const { stdout } = await run('snmpbulkwalk', [...AUTH[auth], ...COMMON, '-Cr25', target, '.1'], { timeout: 60_000, maxBuffer: 10 * 1024 * 1024 });
  const map = new Map();
  for (const line of stdout.split('\n')) {
    if (!line.trim()) continue;
    const at = line.indexOf(' ');
    const oid = (at < 0 ? line : line.slice(0, at)).replace(/^\./, '');
    let value = at < 0 ? '' : line.slice(at + 1).trim();
    if (value.startsWith('"') && value.endsWith('"')) value = value.slice(1, -1);
    map.set(oid, value);
  }
  return map;
}

const num = (m, oid) => Number(m.get(oid));
const sub = (m, prefix) => [...m.keys()].filter((k) => k.startsWith(`${prefix}.`));

// Structural checks that both variants must pass.
function common(m, label) {
  expect(m.get('1.3.6.1.2.1.1.5.0') === 'sim-c9300-01', `${label} sysName = sim-c9300-01`);
  expect(/CAT9K_IOSXE/.test(m.get('1.3.6.1.2.1.1.1.0') ?? ''), `${label} sysDescr is IOS XE Cat9k`);
  expect(m.get('1.3.6.1.2.1.1.2.0') === '.1.3.6.1.4.1.9.1.2494' || m.get('1.3.6.1.2.1.1.2.0') === '1.3.6.1.4.1.9.1.2494', `${label} sysObjectID in Cisco subtree`);
  // ENTITY-MIB: stack, 2 chassis members, 4 PSUs, 4 fans.
  const classes = sub(m, '1.3.6.1.2.1.47.1.1.1.1.5').map((k) => num(m, k));
  expect(classes.filter((c) => c === 11).length === 1, `${label} ENTITY-MIB 1 stack`);
  expect(classes.filter((c) => c === 3).length === 2, `${label} ENTITY-MIB 2 chassis members`);
  expect(classes.filter((c) => c === 6).length === 4, `${label} ENTITY-MIB 4 power supplies`);
  expect(classes.filter((c) => c === 7).length === 4, `${label} ENTITY-MIB 4 fans`);
  expect(m.get('1.3.6.1.2.1.47.1.1.1.1.13.1000') === 'C9300-48P', `${label} member 1 model C9300-48P`);
  // CPU 5 s / 1 min / 5 min for both members.
  for (const col of [6, 7, 8]) expect(sub(m, `1.3.6.1.4.1.9.9.109.1.1.1.1.${col}`).length === 2, `${label} cpmCPUTotal column ${col} has 2 rows`);
  expect(m.get('1.3.6.1.4.1.9.9.48.1.1.1.2.1') === 'Processor', `${label} memory pool 1 = Processor`);
  // IF-MIB / ifXTable: 8 interfaces, 2 UPLINK- aliases, 6 access ports, error counters present.
  expect(num(m, '1.3.6.1.2.1.2.1.0') === 8, `${label} ifNumber = 8`);
  const aliases = sub(m, '1.3.6.1.2.1.31.1.1.1.18').map((k) => m.get(k));
  expect(aliases.filter((a) => a.startsWith('UPLINK-')).length === 2, `${label} 2 ifAlias UPLINK-*`);
  expect(aliases.filter((a) => a.startsWith('ACCESS-')).length === 6, `${label} 6 access ports`);
  expect(sub(m, '1.3.6.1.2.1.2.2.1.14').length === 8 && sub(m, '1.3.6.1.2.1.2.2.1.20').length === 8, `${label} ifInErrors/ifOutErrors on every port`);
  expect(sub(m, '1.3.6.1.2.1.31.1.1.1.6').length === 8, `${label} ifHCInOctets on every port`);
  expect(num(m, '1.3.6.1.2.1.2.2.1.8.49') === 1, `${label} uplink 1 (Te1/1/1) oper up`);
  // ENVMON, StackWise, neighbours.
  expect(sub(m, '1.3.6.1.4.1.9.9.13.1.5.1.3').length === 4 && sub(m, '1.3.6.1.4.1.9.9.13.1.4.1.3').length === 4, `${label} ENVMON 4 supplies + 4 fans`);
  expect(sub(m, '1.3.6.1.4.1.9.9.13.1.3.1.3').length === 2, `${label} ENVMON 2 temperature sensors`);
  expect(sub(m, '1.3.6.1.4.1.9.9.500.1.2.1.1.6').length === 2, `${label} StackWise 2 members`);
  expect(num(m, '1.3.6.1.4.1.9.9.500.1.2.1.1.3.1000') === 1, `${label} StackWise member 1 is master`);
  expect(m.get('1.3.6.1.4.1.9.9.23.1.2.1.1.6.49.1') === 'core-sw-01', `${label} CDP neighbour on uplink 1 = core-sw-01`);
  expect(m.get('1.0.8802.1.1.2.1.4.1.1.9.0.49.1') === 'core-sw-01', `${label} LLDP neighbour on uplink 1 = core-sw-01`);
  expect(m.get('1.0.8802.1.1.2.1.3.3.0') === 'sim-c9300-01', `${label} lldpLocSysName`);
}

function healthy(m, label) {
  expect(num(m, '1.3.6.1.2.1.1.3.0') > 8_640_000, `${label} sysUpTime > 1 day`);
  for (const col of [6, 7, 8]) expect(sub(m, `1.3.6.1.4.1.9.9.109.1.1.1.1.${col}`).every((k) => num(m, k) < 50), `${label} CPU column ${col} < 50 %`);
  const used = num(m, '1.3.6.1.4.1.9.9.48.1.1.1.5.1'); const free = num(m, '1.3.6.1.4.1.9.9.48.1.1.1.6.1');
  expect(used / (used + free) < 0.5, `${label} Processor memory < 50 % used`);
  expect([...sub(m, '1.3.6.1.4.1.9.9.13.1.5.1.3'), ...sub(m, '1.3.6.1.4.1.9.9.13.1.4.1.3')].every((k) => num(m, k) === 1), `${label} every PSU and fan normal`);
  expect(num(m, '1.3.6.1.2.1.2.2.1.8.50') === 1, `${label} uplink 2 (Te2/1/1) oper up`);
  expect(sub(m, '1.3.6.1.4.1.9.9.500.1.2.1.1.6').every((k) => num(m, k) === 4), `${label} every stack member ready`);
  expect(num(m, '1.3.6.1.4.1.9.9.500.1.1.3.0') === 1, `${label} stack ring redundant`);
  expect(num(m, '1.3.6.1.2.1.2.2.1.14.49') < 100 && num(m, '1.3.6.1.2.1.2.2.1.14.50') < 100, `${label} uplink ifInErrors low`);
  expect(m.get('1.3.6.1.4.1.9.9.23.1.2.1.1.6.50.1') === 'core-sw-02' && m.get('1.0.8802.1.1.2.1.4.1.1.9.0.50.1') === 'core-sw-02', `${label} CDP+LLDP neighbour on uplink 2 = core-sw-02`);
}

function degraded(m, h, label) {
  expect(num(m, '1.3.6.1.2.1.1.3.0') < 60_000, `${label} sysUpTime < 10 min (recent reboot)`);
  for (const col of [6, 7, 8]) expect(num(m, `1.3.6.1.4.1.9.9.109.1.1.1.1.${col}.1`) > 90, `${label} member 1 CPU column ${col} > 90 %`);
  const used = num(m, '1.3.6.1.4.1.9.9.48.1.1.1.5.1'); const free = num(m, '1.3.6.1.4.1.9.9.48.1.1.1.6.1');
  expect(used / (used + free) > 0.9, `${label} Processor memory > 90 % used`);
  expect(num(m, '1.3.6.1.4.1.9.9.13.1.5.1.3.2011') === 6, `${label} Switch 2 Power Supply B notFunctioning`);
  expect(num(m, '1.3.6.1.4.1.9.9.13.1.4.1.3.1021') === 3, `${label} Switch 1 Fan 2 critical`);
  expect(num(m, '1.3.6.1.2.1.2.2.1.7.50') === 1 && num(m, '1.3.6.1.2.1.2.2.1.8.50') === 2, `${label} uplink 2 admin up, oper down`);
  expect(num(m, '1.3.6.1.4.1.9.9.500.1.2.1.1.6.2000') !== 4, `${label} stack member 2 not ready`);
  expect(num(m, '1.3.6.1.4.1.9.9.500.1.1.3.0') === 2, `${label} stack ring not redundant`);
  for (const idx of [49, 50]) {
    expect(num(m, `1.3.6.1.2.1.2.2.1.14.${idx}`) > num(h, `1.3.6.1.2.1.2.2.1.14.${idx}`) * 100, `${label} ifInErrors.${idx} far above healthy`);
    expect(num(m, `1.3.6.1.2.1.2.2.1.20.${idx}`) > num(h, `1.3.6.1.2.1.2.2.1.20.${idx}`), `${label} ifOutErrors.${idx} above healthy`);
  }
  expect(!m.has('1.3.6.1.4.1.9.9.23.1.2.1.1.6.50.1') && !m.has('1.0.8802.1.1.2.1.4.1.1.9.0.50.1'), `${label} no CDP/LLDP neighbour on down uplink 2`);
}

async function rejected(args, msg) {
  try { await run('snmpget', [...args, '-t', '1', '-r', '0', TARGETS.healthy, '1.3.6.1.2.1.1.5.0'], { timeout: 10_000 }); fail(msg); }
  catch { ok(msg); }
}

const walks = {};
for (const variant of ['healthy', 'degraded']) {
  for (const auth of ['v2c', 'v3']) {
    const label = `${variant}/${auth}`;
    try {
      walks[label] = await walk(TARGETS[variant], auth);
      console.log(`${label}: walked ${walks[label].size} OIDs from ${TARGETS[variant]}`);
    } catch (error) {
      fail(`${label} walk failed: ${(error.stderr || error.message || '').toString().trim()}`);
    }
  }
}
for (const label of Object.keys(walks)) { console.log(`checks ${label}`); common(walks[label], label); }
for (const auth of ['v2c', 'v3']) {
  const h = walks[`healthy/${auth}`]; const d = walks[`degraded/${auth}`];
  if (h) { console.log(`healthy checks ${auth}`); healthy(h, `healthy/${auth}`); }
  if (h && d) { console.log(`degraded checks ${auth}`); degraded(d, h, `degraded/${auth}`); }
}
console.log('v2c and v3 return the same data');
for (const variant of ['healthy', 'degraded']) {
  const a = walks[`${variant}/v2c`]; const b = walks[`${variant}/v3`];
  expect(a && b && a.size === b.size && [...a].every(([k, v]) => b.get(k) === v), `${variant} v2c walk == v3 walk`);
}
console.log('bad credentials are refused');
await rejected(['-v2c', '-c', 'wrong-community'], 'v2c with a wrong community gets no answer');
await rejected([...V3.slice(0, V3.indexOf('-A') + 1), 'wrong-auth-pass-123', ...V3.slice(V3.indexOf('-A') + 2)], 'v3 with a wrong auth key is refused');

console.log(failures ? `\nFAILED: ${failures} check(s)` : '\nPASS: all checks');
process.exit(failures ? 1 : 0);
