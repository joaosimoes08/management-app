import { appendFileSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { gzipSync } from 'node:zlib';
import { getFixture, sql } from './fixture.mjs';

const options = new Set(process.argv.slice(2));
const output = resolve(process.env.PERF_OUTPUT_DIR ?? '/tmp/mgmtapp-step18');
const api = 'http://localhost:4001';
const fields = (rows, keys = [...new Set(rows.flatMap(Object.keys))]) => (
  [keys.join(','), ...rows.map((row) => keys.map((key) => {
    const value = row[key];
    return value === undefined || value === null ? '' : `"${String(value).replaceAll('"', '""')}"`;
  }).join(','))].join('\n') + '\n'
);
const quantile = (values, p) => {
  const sorted = values.filter(Number.isFinite).sort((a, b) => a - b);
  if (!sorted.length) return null;
  if (p === 0.5 && sorted.length % 2 === 0) return (sorted[sorted.length / 2 - 1] + sorted[sorted.length / 2]) / 2;
  return sorted[Math.ceil(sorted.length * p) - 1];
};
function summarize(samples, keys, metrics) {
  const grouped = new Map();
  for (const row of samples) {
    const key = JSON.stringify(keys.map((field) => row[field]));
    const group = grouped.get(key) ?? [];
    group.push(row);
    grouped.set(key, group);
  }
  return [...grouped.values()].map((rows) => ({
    ...Object.fromEntries(keys.map((key) => [key, rows[0][key]])),
    samples: rows.length,
    ...Object.fromEntries(metrics.flatMap((metric) => [
      [`${metric}_median`, quantile(rows.map((row) => row[metric]), 0.5)],
      [`${metric}_p95`, quantile(rows.map((row) => row[metric]), 0.95)],
    ])),
  }));
}
const query = (url, params) => `${url}?${new URLSearchParams(params)}`;
const pause = (duration) => new Promise((done) => setTimeout(done, duration));
const parseTiming = (header) => Object.fromEntries((header ?? '').split(',').flatMap((item) => {
  const match = item.trim().match(/^(\w+);dur=([\d.]+)/);
  return match ? [[match[1], Number(match[2])]] : [];
}));

let bearer = '';
let expires = 0;
async function accessToken() {
  if (process.env.PERF_ACCESS_TOKEN) return process.env.PERF_ACCESS_TOKEN;
  if (Date.now() < expires) return bearer;
  const result = await fetch('http://127.0.0.1:4081/api-token', { method: 'POST', signal: AbortSignal.timeout(10000) });
  if (!result.ok) throw new Error(`Fixture identity failed (HTTP ${result.status})`);
  bearer = (await result.json()).access_token;
  if (!bearer) throw new Error('Fixture identity returned no token.');
  expires = Date.now() + 5 * 60_000;
  return bearer;
}

async function hit(run, group, mode, index, endpoint) {
  const [label, path, request = {}] = endpoint;
  const token = await accessToken();
  const start = performance.now();
  try {
    const response = await fetch(new URL(`/api/v1${path}`, api), {
      method: request.method ?? 'GET',
      headers: { Authorization: `Bearer ${token}`, 'Accept-Language': 'pt-PT',
        ...(request.exclude ? { 'x-perf-variant': 'exclude-http' } : {}),
        ...(request.body ? { 'Content-Type': 'application/json' } : {}) },
      body: request.body ? JSON.stringify(request.body) : undefined,
      signal: AbortSignal.timeout(55_000),
    });
    const headers_ms = performance.now() - start;
    const payload = Buffer.from(await response.arrayBuffer());
    const total_ms = performance.now() - start;
    const time = parseTiming(response.headers.get('server-timing'));
    const search = label.startsWith('global-search');
    const matches = search && response.ok ? JSON.parse(payload.toString()).items : null;
    return { run, group, mode, sample: index, endpoint: label, status: response.status, total_ms, headers_ms,
      raw_bytes: payload.length, gzip_bytes: gzipSync(payload).length, auth_ms: time.auth ?? null,
      api_ms: time.api ?? null, db_ms: time.db ?? null, prisma_operations: time.prisma ?? null,
      sql_count: mode === 'sequential' ? time.sql ?? null : null,
      audit_results: matches?.filter(({ type }) => type === 'AUDIT_EVENT').length ?? null,
      http_audit_results: matches?.filter(({ type, title }) => type === 'AUDIT_EVENT' && /^(GET|POST|PUT|PATCH|DELETE|HEAD|OPTIONS) \/api\//.test(title)).length ?? null };
  } catch {
    return { run, group, mode, sample: index, endpoint: label, status: 'transport-error' };
  }
}

function stats() {
  const tables = ['Site', 'Rack', 'Device', 'IpAddress', 'Subnet', 'AuditLog', 'ChangePlan',
    'SnmpSnapshot', 'SnmpInterfaceObservation', 'InventoryFinding', 'CriticalAsset', 'TopologyMap', 'ApplicationLink'];
  const known = new Set(sql("SELECT tablename FROM pg_tables WHERE schemaname='public';").split('\n'));
  const counts = sql(tables.filter((table) => known.has(table)).map((table) => `SELECT '${table}', count(*) FROM "${table}";`).join('\n'))
    .split('\n').map((line) => { const [table, count] = line.split('|'); return { table, count: Number(count) }; });
  const hours = sql(`
    SELECT date_trunc('hour', "createdAt") AT TIME ZONE 'UTC',
      count(*), count(*) FILTER (WHERE "entityType" = 'HTTP_REQUEST'),
      count(*) FILTER (WHERE action LIKE 'GET /api/v1/operations/events%'),
      count(*) FILTER (WHERE action = 'AUTHENTICATED')
    FROM "AuditLog"
    WHERE "createdAt" >= date_trunc('hour', (SELECT max("createdAt") FROM "AuditLog")) - interval '24 hour'
      AND "createdAt" < date_trunc('hour', (SELECT max("createdAt") FROM "AuditLog"))
    GROUP BY 1 ORDER BY 1;
  `).split('\n').filter(Boolean).map((line) => {
    const [hour, rows, http, events, authenticated] = line.split('|');
    return { hour, rows: Number(rows), http: Number(http), events: Number(events), authenticated: Number(authenticated) };
  });
  writeFileSync(resolve(output, 'dataset-counts.csv'), fields(counts));
  writeFileSync(resolve(output, 'audit-growth.csv'), fields(hours));
  process.stdout.write(`Snapshot profile: ${counts.length} tables and ${hours.length} complete audit hours.\n`);
}

async function runApi() {
  const fixture = getFixture();
  const { site, rack, subnet, map, device, change } = fixture;
  const scoped = (url, more = {}, siteId = site) => query(url, { siteId, ...more });
  const allTypes = 'SITE,DEVICE,INTERFACE,HOST,SERVICE,VLAN,SUBNET,IP,APPLICATION,CHANGE_PLAN,AUDIT_EVENT,QUALITY_FINDING';
  const search = (term) => query('/dashboard/search', { q: term, limit: 12, types: allTypes });
  const endpoints = [
    ['sites', '/sites?pageSize=100'], ['profile-identity', '/auth/me'], ['setup-status', '/setup/status'],
    ['dashboard-summary', '/dashboard/summary'], ['topbar', '/dashboard/topbar-state'],
    ['dashboard-ops', scoped('/dashboard/operational-summary', { role: 'ADMIN' })],
    ['rack-list', `/sites/${rack.siteId}/racks`], ['rack-detail', `/racks/${rack.id}`],
    ['rack-power', `/racks/${rack.id}/power-summary`], ['devices', scoped('/devices', { page: 1, pageSize: 100 })],
    ['ipam-subnets', scoped('/subnets', { page: 1, pageSize: 50 }, subnet.siteId)],
    ['ipam-ips', query('/ip-addresses', { subnetId: subnet.id, page: 1, pageSize: 50 })],
    ['ipam-usage', `/subnets/${subnet.id}/usage`], ['ipam-history', `/subnets/${subnet.id}/capacity-history`],
    ['topology-list', scoped('/topology/maps', { pageSize: 50 }, map.siteId)], ['topology-detail', `/topology/maps/${map.id}`],
    ['audit-page', query('/audit/events/page', { limit: 50, from: `${fixture.auditFrom}Z` })],
    ['audit-facets', query('/audit/facets', { from: `${fixture.auditFrom}Z` })],
    ['changes-list', scoped('/change-plans')], ['changes-summary', scoped('/change-plans/summary')],
    ...(change ? [['change-detail', `/change-plans/${change}`]] : []),
    ['quality-findings', scoped('/inventory-quality/findings', { page: 1, pageSize: 100, status: 'OPEN' })],
    ['quality-facets', scoped('/inventory-quality/facets')], ['attestation', scoped('/critical-assets')],
    ['snmp-fleet', scoped('/snmp/fleet/summary')], ['snmp-device', `/snmp/devices/${device}`],
    ['snmp-metrics', `/snmp/devices/${device}/metrics?days=7`], ['global-search-api', search('api')],
    ['global-search-miss', search('zz-perf-no-match')],
  ].filter(([label]) => !process.env.PERF_ONLY || process.env.PERF_ONLY.split(',').includes(label));
  const runs = Number(process.env.PERF_PASSES ?? 2);
  const sequential = Number(process.env.PERF_SEQUENTIAL ?? 50);
  const concurrency = Number(process.env.PERF_CONCURRENCY ?? 10);
  if (!endpoints.length || !Number.isInteger(runs) || runs < 1 || !Number.isInteger(sequential) || sequential < 1 ||
    !Number.isInteger(concurrency) || concurrency < 1 || concurrency > 10) throw new Error('Invalid baseline run configuration.');
  const results = [];
  const file = resolve(output, 'api-raw.csv');
  const allKeys = ['run','group','mode','sample','endpoint','status','total_ms','headers_ms','raw_bytes','gzip_bytes',
    'auth_ms','api_ms','db_ms','prisma_operations','sql_count','audit_results','http_audit_results'];
  writeFileSync(file, allKeys.join(',') + '\n');
  const record = (rows) => {
    results.push(...rows);
    appendFileSync(file, fields(rows, allKeys).split('\n').slice(1).join('\n'));
  };
  const lastStarted = new Map();
  const traffic = (endpoint) => endpoint[0].startsWith('global-search') ? 'global-search' : endpoint[0];
  const priorRequests = new Map();
  const pace = async (endpoint, count) => {
    const key = traffic(endpoint);
    const now = Date.now();
    const expiresAt = lastStarted.get(key);
    if (expiresAt && now < expiresAt && (priorRequests.get(key) ?? 0) + count > 95) {
      await pause(expiresAt - now);
    }
    if (!expiresAt || Date.now() >= expiresAt) {
      lastStarted.set(key, Date.now() + 61_000);
      priorRequests.set(key, 0);
    }
    priorRequests.set(key, (priorRequests.get(key) ?? 0) + count);
  };
  for (let pass = 1; pass <= runs; pass++) {
    for (const endpoint of endpoints) {
      await pace(endpoint, sequential + concurrency);
      const rows = [];
      for (let index = 1; index <= sequential; index++) rows.push(await hit(pass, 'baseline', 'sequential', index, endpoint));
      record(rows);
      record(await Promise.all(Array.from({ length: concurrency }, (_, index) => hit(pass, 'baseline', 'concurrent', index + 1, endpoint))));
      process.stdout.write(`Pass ${pass} ${endpoint[0]} p50 ${quantile(rows.map((row) => row.total_ms), 0.5)?.toFixed(1) ?? 'n/a'} ms\n`);
    }
  }

  if (!process.env.PERF_ONLY && !options.has('--skip-search-ab')) {
    for (const [label, term] of [['api', 'api'], ['miss', 'zz-perf-no-match']]) {
      const endpointsAb = [
        [`global-search-${label}-unchanged`, search(term)],
        [`global-search-${label}-exclude-http`, search(term), { exclude: true }],
      ];
      await pace(endpointsAb[0], 20);
      for (let index = 1; index <= 10; index++) {
        for (const endpoint of index % 2 ? endpointsAb : [...endpointsAb].reverse()) {
          record([await hit(1, 'search-ab', 'sequential', index, endpoint)]);
        }
      }
    }
  }
  const ok = results.filter((row) => row.status >= 200 && row.status < 300);
  writeFileSync(resolve(output, 'api-summary.csv'), fields(summarize(ok, ['run', 'group', 'mode', 'endpoint'],
    ['total_ms', 'api_ms', 'auth_ms', 'db_ms', 'sql_count', 'prisma_operations', 'raw_bytes', 'gzip_bytes', 'audit_results', 'http_audit_results'])));
}

async function plans() {
  const queries = await fetch(`${api}/__perf/db`).then((response) => response.json());
  writeFileSync(resolve(output, 'db-top20.csv'), fields(queries));
  const results = [];
  for (const entry of queries.filter((row) => row.name.startsWith('SELECT')).slice(0, 10)) {
    const response = await fetch(`${api}/__perf/plan/${entry.id}`, { signal: AbortSignal.timeout(28_000) });
    results.push({ id: entry.id, name: entry.name, status: response.status, ...(await response.json().catch(() => ({}))) });
  }
  writeFileSync(resolve(output, 'db-explain.json'), JSON.stringify(results, null, 2) + '\n');
}

function browser() {
  const pathname = process.env.PERF_BROWSER_OUT ?? '/tmp/mgmtapp-step18-browser.jsonl';
  const rows = readFileSync(pathname, 'utf8').trim().split('\n').filter(Boolean).map(JSON.parse);
  writeFileSync(resolve(output, 'browser-raw.csv'), fields(rows));
  writeFileSync(resolve(output, 'browser-summary.csv'), fields(summarize(rows, ['pass', 'page', 'cache'],
    ['ttfb_ms','lcp_ms','visible_ms','search_after_input_ms','js_bytes','transferred_bytes','request_entries','network_entries','api_requests',
      'keycloak_to_identity_ms','critical_request_ms','critical_api_ms','critical_prisma_ms','critical_auth_ms','critical_network_ms','render_after_critical_ms'])));
}
mkdirSync(output, { recursive: true });
if (options.has('--dataset')) stats();
else if (options.has('--browser')) browser();
else if (options.has('--plans')) await plans();
else await runApi();
