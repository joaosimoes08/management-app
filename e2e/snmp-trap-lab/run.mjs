// SNMP trap lab: packet -> receiver -> trap row -> reconciler -> OperationalAlert -> alerts API.
// Runs inside the `sender` container of e2e/snmp-trap-lab/docker-compose.yml (see README.md).
// PLAN.md Phase 1 step 6 and acceptance steps 1-4 of section 0.
import { strict as assert } from 'node:assert';
import { execFile } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { after, before, test } from 'node:test';
import { promisify } from 'node:util';
import { PrismaClient } from '@simoes/database';
import { encryptCredential, parseKeyring } from '@simoes/snmp-core';

const run = promisify(execFile);
const env = (name, fallback) => process.env[name] ?? fallback;
const API = env('LAB_API_URL', 'http://api:3001/api/v1');
const OIDC = env('LAB_OIDC_URL', 'http://oidc:8080');
const METRICS = env('LAB_SNMP_METRICS_URL', 'http://snmp:3002/metrics');
const RECEIVER = env('LAB_RECEIVER', '10.250.62.10:1162');
const RECEIVER_V3ONLY = env('LAB_RECEIVER_V3ONLY', '10.250.62.11:1162');
const CORE_SWITCH = env('LAB_CORE_SWITCH', '10.250.62.30:1161');
const BUDGET = Number(env('LAB_UNTRUSTED_ROWS_PER_MINUTE', '30'));
/** The API reconciler runs every 10 s; "no alert" checks wait for at least two full passes. */
const RECONCILE_MS = 10_000;
const ALERT_TIMEOUT_MS = 45_000;

const prisma = new PrismaClient();
const keyring = parseKeyring(readFileSync(env('SNMP_KEYRING_FILE', '/run/secrets/snmp_keyring'), 'utf8'));

const NET = '10.250.62';
const id = (n) => `5e000000-0000-4000-8000-${String(n).padStart(12, '0')}`;
const ids = { site: id(1), core: id(10), sw1: id(11), sw2: id(12), sw3: id(13) };
const ip = { sw1: `${NET}.20`, unregistered: `${NET}.21`, sw2: `${NET}.22`, sw3: `${NET}.23`, marker: `${NET}.24`, core: `${NET}.30` };
const v3 = {
  sha1: { user: 'labtrap-sha1', auth: 'SHA', authProtocol: 'SHA1', authKey: 'lab-auth-sha1-pass', priv: 'AES', privProtocol: 'AES128', privKey: 'lab-priv-aes-pass' },
  sha256: { user: 'labtrap-sha256', auth: 'SHA-256', authProtocol: 'SHA256', authKey: 'lab-auth-sha256-pass', priv: 'AES', privProtocol: 'AES128', privKey: 'lab-priv-aes-pass2' },
};
const COMMUNITY = 'lab-v2c-community';
const OID = {
  linkDown: '1.3.6.1.6.3.1.1.5.3', linkUp: '1.3.6.1.6.3.1.1.5.4',
  ifIndex: '1.3.6.1.2.1.2.2.1.1', ifAdmin: '1.3.6.1.2.1.2.2.1.7', ifOper: '1.3.6.1.2.1.2.2.1.8', ifName: '1.3.6.1.2.1.31.1.1.1.1',
};

// sysUpTime carried by every trap: a fixed boot ~10 h ago plus wall-clock time, so linkDown/linkUp pass the same-boot check.
const BOOT = Date.now() - 10 * 60 * 60 * 1000;
const uptime = () => String(Math.round((Date.now() - BOOT) / 10));
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function waitFor(label, check, timeoutMs = ALERT_TIMEOUT_MS) {
  const started = Date.now();
  let last;
  while (Date.now() - started < timeoutMs) {
    last = await check();
    if (last) return { value: last, ms: Date.now() - started };
    await sleep(1000);
  }
  throw new Error(`timed out after ${timeoutMs} ms waiting for ${label}`);
}

let cachedToken;
async function token() {
  if (!cachedToken) cachedToken = (await (await fetch(`${OIDC}/token`)).json()).access_token;
  return cachedToken;
}
async function api(path) {
  const response = await fetch(`${API}${path}`, { headers: { authorization: `Bearer ${await token()}` } });
  assert.equal(response.status, 200, `GET ${path} -> ${response.status} ${await response.clone().text()}`);
  return response.json();
}
async function alerts(query = {}) {
  const params = new URLSearchParams({ pageSize: '100', ...query });
  return (await api(`/operations/alerts?${params}`)).items;
}
async function metric(name) {
  const text = await (await fetch(METRICS)).text();
  const line = text.split('\n').find((item) => item.startsWith(`${name} `));
  return Number(line?.split(' ')[1] ?? NaN);
}

function portVarbinds(ifIndex, name, up) {
  return [
    `${OID.ifIndex}.${ifIndex}`, 'i', String(ifIndex),
    `${OID.ifAdmin}.${ifIndex}`, 'i', '1',
    `${OID.ifOper}.${ifIndex}`, 'i', up ? '1' : '2',
    `${OID.ifName}.${ifIndex}`, 's', name,
  ];
}
function v3Args(profile, user = profile.user) {
  return ['-v3', '-u', user, '-l', 'authPriv', '-a', profile.auth, '-A', profile.authKey, '-x', profile.priv, '-X', profile.privKey];
}
/** net-snmp snmptrap / snmpinform from a chosen source address on the sender. */
async function send({ from, to = RECEIVER, inform = false, auth, oid, varbinds }) {
  const command = inform ? 'snmpinform' : 'snmptrap';
  const args = [`--clientaddr=${from}`, '-r', '1', '-t', '3', ...auth, to, uptime(), oid, ...varbinds];
  // snmptrap v3 needs the sender's own (authoritative) engine ID; snmpinform discovers the receiver's.
  if (!inform && auth[0] === '-v3') args.splice(1, 0, '-e', `0x80001f8880${Buffer.from(from).toString('hex')}`);
  const at = new Date();
  await run(command, args, { timeout: 20_000 });
  return at;
}
const linkDown = (from, auth, ifIndex, name, extra = {}) => send({ from, auth, oid: OID.linkDown, varbinds: portVarbinds(ifIndex, name, false), ...extra });
const linkUp = (from, auth, ifIndex, name, extra = {}) => send({ from, auth, oid: OID.linkUp, varbinds: portVarbinds(ifIndex, name, true), ...extra });

const trapRows = (where, since) => prisma.snmpTrapEvent.findMany({ where: { ...where, receivedAt: { gte: new Date(since.getTime() - 2000) } }, orderBy: { receivedAt: 'desc' } });
const deviceTrapAlerts = async (deviceId, query = {}) => (await alerts({ source: 'SNMP_TRAP', ...query })).filter((alert) => alert.relatedDeviceId === deviceId);
const portAlert = async (deviceId, port, query = {}) => (await deviceTrapAlerts(deviceId, query)).find((alert) => alert.title.includes(port));

async function credential(deviceId, version, data, secret) {
  const envelope = encryptCredential(secret, keyring);
  const row = { deviceId, purpose: 'TRAP', version, label: 'snmplab', enabled: true, ...data, ...envelope };
  await prisma.snmpCredential.upsert({ where: { deviceId_purpose: { deviceId, purpose: 'TRAP' } }, create: row, update: row });
}

async function seed() {
  await prisma.site.upsert({ where: { id: ids.site }, update: {}, create: { id: ids.site, name: 'SNMP Lab', code: 'SNMPLAB' } });
  const devices = [
    { id: ids.core, name: 'core-sw-01', managementIp: ip.core, ports: ['Te1/1/1', 'Te1/1/2', 'Te1/1/3', 'Te1/1/4'] },
    { id: ids.sw1, name: 'sw-access-01', managementIp: ip.sw1, ports: ['Gi1/0/48', 'Gi1/0/46', 'Gi1/0/1'] },
    { id: ids.sw2, name: 'sw-access-02', managementIp: ip.sw2, ports: ['Gi1/0/48'] },
    { id: ids.sw3, name: 'sw-access-03', managementIp: ip.sw3, ports: ['Gi1/0/48'] },
  ];
  const ifaces = {};
  for (const device of devices) {
    await prisma.device.upsert({ where: { id: device.id }, update: {}, create: { id: device.id, name: device.name, hostname: device.name, type: 'SWITCH', status: 'ACTIVE', managementIp: device.managementIp, siteId: ids.site } });
    for (const port of device.ports) {
      const row = await prisma.deviceInterface.upsert({ where: { deviceId_name: { deviceId: device.id, name: port } }, update: {}, create: { deviceId: device.id, name: port, portKey: port } });
      ifaces[`${device.name}:${port}`] = row.id;
    }
  }
  // Documented uplinks (Phase 1 step 2.1): only these ports may raise port-down alerts. sw-access-01 Gi1/0/1 is an access port.
  const links = [['sw-access-01', 'Gi1/0/48', 'Te1/1/1'], ['sw-access-01', 'Gi1/0/46', 'Te1/1/2'], ['sw-access-02', 'Gi1/0/48', 'Te1/1/3'], ['sw-access-03', 'Gi1/0/48', 'Te1/1/4']];
  for (const [name, port, corePort] of links) {
    const sourceDeviceId = devices.find((device) => device.name === name).id;
    const exists = await prisma.deviceConnection.findFirst({ where: { sourceInterfaceId: ifaces[`${name}:${port}`] } });
    if (!exists) await prisma.deviceConnection.create({ data: { siteId: ids.site, type: 'PHYSICAL', label: `${name} ${port} uplink`, sourceDeviceId, sourceInterfaceId: ifaces[`${name}:${port}`], targetDeviceId: ids.core, targetInterfaceId: ifaces[`core-sw-01:${corePort}`] } });
  }
  for (const [deviceId, profile] of [[ids.sw1, v3.sha1], [ids.sw2, v3.sha256]]) {
    await credential(deviceId, 'V3', { username: profile.user, authProtocol: profile.authProtocol, privProtocol: profile.privProtocol }, { username: profile.user, authKey: profile.authKey, privKey: profile.privKey });
  }
  // A v2c TRAP credential written straight to the DB (Phase 1 step 1.3, rev. 4: v2c is accepted unless SNMP_ALLOW_V2C=false).
  await credential(ids.sw3, 'V2C', {}, { community: COMMUNITY });
}

before(async () => {
  await waitFor('API health', async () => (await fetch(`${API}/health`).catch(() => undefined))?.ok, 120_000);
  await seed();
  // The receivers reload TRAP credentials every 30 s; wait for both to have the seeded users.
  await sleep(33_000);
}, { timeout: 200_000 });

after(async () => { await prisma.$disconnect(); });

test('lab sanity: the simulated core switch answers an SNMPv3 GET', async () => {
  const { stdout } = await run('snmpget', ['-v3', '-u', 'labpoll', '-l', 'authPriv', '-a', 'SHA', '-A', 'lab-poll-auth-pass', '-x', 'AES', '-X', 'lab-poll-priv-pass', '-n', 'core-sw-01', '-t', '3', '-r', '2', CORE_SWITCH, '1.3.6.1.2.1.1.5.0'], { timeout: 20_000 });
  assert.match(stdout, /core-sw-01/);
});

let uplinkAlertId;
test('case 1: v3 SHA/AES-128 linkDown on an uplink shows up in the alerts API', { timeout: 90_000 }, async () => {
  const sent = await linkDown(ip.sw1, v3Args(v3.sha1), 48, 'Gi1/0/48');
  const { value: [row] } = await waitFor('PROCESSED linkDown row', async () => {
    const rows = await trapRows({ deviceId: ids.sw1, trapOid: OID.linkDown, status: 'PROCESSED' }, sent);
    return rows.length ? rows : undefined;
  });
  assert.equal(row.version, 'V3');
  assert.equal(row.sourceAddress, ip.sw1);
  const { value: alert, ms } = await waitFor('uplink alert', () => portAlert(ids.sw1, 'Gi1/0/48'));
  console.log(`# case 1: alert visible in the API ${ms} ms after the trap row was processed`);
  assert.equal(alert.status, 'OPEN');
  assert.equal(alert.severity, 'HIGH');
  assert.equal(alert.siteId, ids.site);
  assert.match(alert.title, /Uplink em baixo: sw-access-01 Gi1\/0\/48/);
  uplinkAlertId = alert.id;
});

test('case 1b: linkDown on a port that is not an uplink is stored but raises no alert', { timeout: 90_000 }, async () => {
  const sent = await linkDown(ip.sw1, v3Args(v3.sha1), 1, 'Gi1/0/1');
  await waitFor('PROCESSED access-port row', async () => (await trapRows({ deviceId: ids.sw1, trapOid: OID.linkDown, status: 'PROCESSED' }, sent))
    .find((row) => row.varbinds.some((item) => item.oid === `${OID.ifIndex}.1`)));
  await sleep(RECONCILE_MS * 2 + 1000);
  assert.equal(await portAlert(ids.sw1, 'Gi1/0/1', { status: 'OPEN' }), undefined);
});

test('case 2: the matching linkUp resolves the alert', { timeout: 90_000 }, async () => {
  assert.ok(uplinkAlertId, 'case 1 must have produced an alert');
  await sleep(1500);
  await linkUp(ip.sw1, v3Args(v3.sha1), 48, 'Gi1/0/48');
  const { ms } = await waitFor('resolved uplink alert', async () => (await alerts({ source: 'SNMP_TRAP', status: 'RESOLVED' })).find((alert) => alert.id === uplinkAlertId));
  console.log(`# case 2: alert resolved ${ms} ms after the linkUp`);
  assert.equal(await portAlert(ids.sw1, 'Gi1/0/48'), undefined, 'the alert must leave the open list');
});

let sha256AlertId;
test('case 3: a SHA-256 (AES-128) trap is accepted and alerts', { timeout: 90_000 }, async () => {
  const sent = await linkDown(ip.sw2, v3Args(v3.sha256), 48, 'Gi1/0/48');
  const { value: [row] } = await waitFor('PROCESSED SHA-256 row', async () => {
    const rows = await trapRows({ deviceId: ids.sw2, status: 'PROCESSED' }, sent);
    return rows.length ? rows : undefined;
  });
  assert.equal(row.version, 'V3');
  const { value: alert } = await waitFor('sw-access-02 uplink alert', () => portAlert(ids.sw2, 'Gi1/0/48'));
  assert.equal(alert.severity, 'HIGH');
  sha256AlertId = alert.id;
});

test('case 4: an SNMPv3 inform is acknowledged, stored once and alerts', { timeout: 90_000 }, async () => {
  // snmpinform exits 0 only when the receiver acknowledged the inform (engine ID discovery included).
  const sent = await linkDown(ip.sw1, v3Args(v3.sha1), 46, 'Gi1/0/46', { inform: true });
  const { value: rows } = await waitFor('PROCESSED inform row', async () => {
    const found = (await trapRows({ deviceId: ids.sw1, status: 'PROCESSED' }, sent)).filter((row) => row.dedupKey);
    return found.length ? found : undefined;
  });
  assert.equal(rows.length, 1, 'an acknowledged inform (with retries) must be stored once');
  assert.equal(rows[0].pduType, '166', 'InformRequest PDU');
  await waitFor('Gi1/0/46 uplink alert', () => portAlert(ids.sw1, 'Gi1/0/46'));
});

test('case 5: a wrong v3 user is stored as REJECTED and raises no device alert', { timeout: 90_000 }, async () => {
  const before = (await deviceTrapAlerts(ids.sw1)).map((alert) => alert.id).sort();
  const sent = await linkDown(ip.sw1, v3Args(v3.sha1, 'labtrap-wrong'), 48, 'Gi1/0/48');
  const { value: [row] } = await waitFor('REJECTED row', async () => {
    const rows = await trapRows({ sourceAddress: ip.sw1, status: 'REJECTED' }, sent);
    return rows.length ? rows : undefined;
  });
  assert.equal(row.errorCode, 'SNMP_TRAP_UNKNOWN_USER');
  assert.equal(row.deviceId, null);
  assert.deepEqual(row.varbinds, [], 'a rejected trap keeps no payload');
  await sleep(RECONCILE_MS * 2 + 1000);
  assert.deepEqual((await deviceTrapAlerts(ids.sw1)).map((alert) => alert.id).sort(), before, 'no new SNMP_TRAP alert for the device');
});

test('case 6: an unregistered source is stored as UNMATCHED and raises an SNMP_TRAP_SOURCE alert', { timeout: 90_000 }, async () => {
  const sent = await linkDown(ip.unregistered, v3Args(v3.sha1), 48, 'Gi1/0/48');
  const { value: [row] } = await waitFor('UNMATCHED row', async () => {
    const rows = await trapRows({ sourceAddress: ip.unregistered, status: 'UNMATCHED' }, sent);
    return rows.length ? rows : undefined;
  });
  assert.equal(row.deviceId, null);
  const { value: alert } = await waitFor('SNMP_TRAP_SOURCE alert', async () => (await alerts({ source: 'SNMP_TRAP_SOURCE' })).find((item) => item.dedupKey === `snmp:trap-source:${ip.unregistered}`));
  assert.equal(alert.severity, 'WARNING');
  assert.ok(!(await alerts({ source: 'SNMP_TRAP' })).some((item) => item.title.includes(ip.unregistered) || item.detail.includes(ip.unregistered)), 'no device trap alert for an unknown source');
});

test('case 7: v2c is accepted by default and refused only when SNMP_ALLOW_V2C=false', { timeout: 120_000 }, async () => {
  const v2c = ['-v2c', '-c', COMMUNITY];
  // (b) The receiver started with the admin opt-out SNMP_ALLOW_V2C=false loads no community: stored REJECTED, no alert.
  const refused = await linkDown(ip.sw3, v2c, 48, 'Gi1/0/48', { to: RECEIVER_V3ONLY });
  const { value: [row] } = await waitFor('REJECTED v2c row (SNMP_ALLOW_V2C=false)', async () => {
    const rows = await trapRows({ sourceAddress: ip.sw3, status: 'REJECTED' }, refused);
    return rows.length ? rows : undefined;
  });
  assert.equal(row.version, 'V2C');
  assert.equal(row.errorCode, 'SNMP_V2C_DISABLED');
  assert.deepEqual(row.varbinds, [], 'a rejected trap keeps no payload');
  await sleep(RECONCILE_MS * 2 + 1000);
  assert.equal(await portAlert(ids.sw3, 'Gi1/0/48'), undefined, 'refused v2c trap must not alert');
  // (a) Same trap with the valid community to the default receiver (SNMP_ALLOW_V2C unset): accepted, processed and alerted.
  const accepted = await linkDown(ip.sw3, v2c, 48, 'Gi1/0/48');
  const { value: [processed] } = await waitFor('PROCESSED v2c row (default receiver)', async () => {
    const rows = await trapRows({ deviceId: ids.sw3, status: 'PROCESSED' }, accepted);
    return rows.length ? rows : undefined;
  });
  assert.equal(processed.version, 'V2C');
  assert.equal(processed.sourceAddress, ip.sw3);
  await waitFor('sw-access-03 uplink alert', () => portAlert(ids.sw3, 'Gi1/0/48'));
});

test('case 9: a trap alert is not auto-resolved after 24 h (simulated clock)', { timeout: 120_000 }, async () => {
  assert.ok(sha256AlertId, 'case 3 must have produced an alert');
  // Age every sw-access-02 trap (and its alert) by 25 h: the trap leaves the reconciler's 24 h window.
  const aged = new Date(Date.now() - 25 * 60 * 60 * 1000);
  const moved = await prisma.snmpTrapEvent.updateMany({ where: { deviceId: ids.sw2 }, data: { receivedAt: aged, processedAt: aged } });
  assert.ok(moved.count >= 1);
  await prisma.operationalAlert.update({ where: { id: sha256AlertId }, data: { firstOccurredAt: aged, lastOccurredAt: aged } });
  // Marker: a fresh UNMATCHED trap whose source alert can only appear in a reconcile pass that ran after the clock change.
  const sent = await linkDown(ip.marker, v3Args(v3.sha1), 48, 'Gi1/0/48');
  await waitFor('marker source alert', async () => (await alerts({ source: 'SNMP_TRAP_SOURCE' })).find((item) => item.dedupKey === `snmp:trap-source:${ip.marker}`));
  await sleep(RECONCILE_MS + 1000);
  const stored = await prisma.operationalAlert.findUnique({ where: { id: sha256AlertId } });
  assert.notEqual(stored.status, 'RESOLVED', `alert ${sha256AlertId} was auto-resolved (${stored.resolutionReason ?? 'no reason'})`);
  assert.ok(await portAlert(ids.sw2, 'Gi1/0/48'), 'still listed as an open alert in the alerts API');
  assert.ok(sent);
});

test('case 8: a flood from rotating sources is capped by SNMP_TRAP_UNTRUSTED_ROWS_PER_MINUTE', { timeout: 150_000 }, async () => {
  const sources = Array.from({ length: BUDGET * 3 }, (_, index) => `${NET}.${100 + index}`);
  const droppedBefore = await metric('snmp_trap_untrusted_rows_dropped_total');
  assert.ok(Number.isFinite(droppedBefore), 'receiver exposes snmp_trap_untrusted_rows_dropped_total');
  const started = new Date();
  for (let i = 0; i < sources.length; i += 15) {
    await Promise.all(sources.slice(i, i + 15).map((from, n) => linkDown(from, v3Args(v3.sha1), 48, 'Gi1/0/48').catch((error) => { throw new Error(`send from ${from} (#${i + n}) failed: ${error.message}`); })));
  }
  const count = async () => {
    const rows = await prisma.snmpTrapEvent.count({ where: { sourceAddress: { in: sources }, receivedAt: { gte: new Date(started.getTime() - 2000) } } });
    const dropped = (await metric('snmp_trap_untrusted_rows_dropped_total')) - droppedBefore;
    return { rows, dropped };
  };
  const { value: result } = await waitFor('every flood trap stored or counted as dropped', async () => {
    const current = await count();
    return current.rows + current.dropped >= sources.length ? current : undefined;
  }, 60_000);
  console.log(`# case 8: sent ${sources.length} from ${sources.length} sources, budget ${BUDGET}/min: ${result.rows} rows written, ${result.dropped} dropped`);
  assert.equal(result.rows + result.dropped, sources.length);
  // The budget window is one minute; a flood that straddles a window boundary can use two budgets at most.
  assert.ok(result.rows <= BUDGET * 2, `rows written (${result.rows}) must stay within the per-minute budget`);
  assert.ok(result.dropped >= sources.length - BUDGET * 2, `dropped (${result.dropped})`);
});
