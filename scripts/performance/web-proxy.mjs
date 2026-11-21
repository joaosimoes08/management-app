/** Local production-web gateway. Keep the benchmark runtime probe out of the app bundle. */
import { createServer, request as upstreamRequest } from 'node:http';
import { appendFileSync, readFileSync } from 'node:fs';
import { getFixture } from './fixture.mjs';

const probe = readFileSync(new URL('./browser-probe.js', import.meta.url), 'utf8');
const output = process.env.PERF_BROWSER_OUT ?? '/tmp/mgmtapp-step18-browser.jsonl';
const fixture = getFixture();
const withQuery = (path, params) => `${path}?${new URLSearchParams(params)}`;
const site = (path, siteId = fixture.site) => withQuery(path, { siteId });
const pages = [
  ['dashboard', site('/'), ['dashboard/operational-summary', 'dashboard/summary'], '.dashboard-kpi-strip .dashboard-kpi-value', '.dashboard-kpi-strip'],
  ['ipam', withQuery('/ipam', { siteId: fixture.subnet.siteId, subnetId: fixture.subnet.id, tab: 'subnets' }), ['/ip-addresses', '/usage'], '.ip-table tbody tr', '.usage-summary,.page-primary-card .empty-context'],
  ['rack', withQuery('/infraestrutura', { siteId: fixture.rack.siteId, rackId: fixture.rack.id, roomId: fixture.rack.roomId, buildingId: fixture.rack.buildingId }), ['/racks'], '.rack-view .rack-figure,.rack-view .rack-detail-head,.rack-view'],
  ['topology', site('/topology', fixture.map.siteId), ['/topology/maps/'], '.react-flow__node', '.react-flow__pane'],
  ['audit', '/auditoria', ['audit/events/page'], '.ip-table tbody tr', '.no-data,.ipam-alert'],
  ['changes', site('/alteracoes'), ['/change-plans'], '.change-list-card .ip-table tbody tr', '.change-list-card .no-data,.change-list-card .ipam-alert,.change-list-card .subtle-text'],
  ['quality', site('/qualidade-inventario'), ['inventory-quality/findings'], '.ip-table tbody tr', '.no-data,.ipam-alert'],
  ['attestation', site('/attestacao-ativos'), ['/critical-assets'], '.critical-assets-table tbody tr', '.critical-assets-count'],
  ['snmp', site('/snmp'), ['snmp/fleet/summary'], '[aria-label="Resumo da frota SNMP"]'],
  ['global-search', site('/'), ['dashboard/search'], '.command-palette .command-result,.command-palette [role="option"]', '.command-palette .command-empty'],
];
const runtime = `window.__COCIBER_CONFIG__={apiUrl:"http://localhost:4001",keycloakUrl:"http://localhost:4080",keycloakRealm:"COCiber",keycloakClientId:"simoes-web",organizationName:"Benchmark QA",locale:"pt-PT"};\n${probe}`;
let samples = [];
const resultIds = new Set();
const options = (response, headers = {}) => { response.writeHead(200, { 'Cache-Control': 'no-store', ...headers }); };
const sendJson = (response, value) => { options(response, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(value)); };
const redirect = (response, url, headers = {}) => { response.writeHead(303, { 'Cache-Control': 'no-store', Location: url, ...headers }); response.end(); };
function buildSamples(runs, passes) {
  return Array.from({ length: passes }, (_, p) => pages.flatMap(([page, path, endpoints, selector, empty]) => (
    Array.from({ length: runs }, (_, r) => ['cold', 'warm'].map((cache) => ({ page, path, endpoints, selector, empty,
      search: 'api', mapId: fixture.map.id, pass: p + 1, run: r + 1, cache }))).flat()
  ))).flat();
}
const nextUrl = (index) => {
  const plan = samples[index];
  if (!plan) return '/__perf/done';
  return `/__perf/load/${index}`;
};
createServer(async (request, response) => {
  const url = new URL(request.url, 'http://localhost:4000');
  if (url.pathname === '/runtime-config.js') {
    options(response, { 'Content-Type': 'text/javascript; charset=utf-8' });
    return response.end(runtime);
  }
  if (url.pathname === '/__perf/start') {
    if (samples.length && resultIds.size < samples.length) return response.end('Measurement is already running');
    samples = buildSamples(Number(url.searchParams.get('runs') ?? 5), Number(url.searchParams.get('passes') ?? 2));
    resultIds.clear();
    return redirect(response, nextUrl(0));
  }
  if (url.pathname === '/__perf/done') return response.end(`Finished ${resultIds.size} browser observations.`);
  if (url.pathname.startsWith('/__perf/load/')) {
    const index = Number(url.pathname.split('/').at(-1));
    const plan = samples[index];
    if (!plan) return response.writeHead(404).end();
    const target = new URL(plan.path, url.origin);
    target.searchParams.set('__perfSample', index);
    if (plan.cache === 'warm') return redirect(response, `${target.pathname}${target.search}`);
    options(response, { 'Content-Type': 'text/html; charset=utf-8', 'Clear-Site-Data': '"cache"' });
    return response.end(`<!doctype html><title>Cold browser navigation</title><script>setTimeout(() => location.replace(${JSON.stringify(target.pathname + target.search)}), 350);</script>`);
  }
  if (url.pathname.startsWith('/__perf/plan/')) return sendJson(response, samples[Number(url.pathname.split('/').at(-1))] ?? {});
  if (request.method === 'POST' && url.pathname === '/__perf/result') {
    if (request.headers.origin && request.headers.origin !== url.origin) return response.writeHead(403).end();
    let body = '';
    for await (const chunk of request) {
      body += chunk;
      if (body.length > 4000) return response.writeHead(413).end();
    }
    let record;
    try { record = JSON.parse(body); } catch { return response.writeHead(400).end(); }
    const index = Number(record.sample);
    if (!samples[index]) return response.writeHead(400).end();
    if (!resultIds.has(index)) {
      resultIds.add(index);
      appendFileSync(output, JSON.stringify(record) + '\n', { mode: 0o600 });
    }
    return sendJson(response, { next: nextUrl(index + 1) });
  }

  const proxy = upstreamRequest({ hostname: '127.0.0.1', port: 4002, path: request.url, method: request.method, headers: request.headers }, (upstream) => {
    response.writeHead(upstream.statusCode, upstream.headers);
    upstream.pipe(response);
  });
  proxy.on('error', () => response.writeHead(502).end('Production web server unavailable'));
  request.pipe(proxy);
}).listen(4000, '127.0.0.1', () => process.stdout.write('Benchmark web ready on port 4000\n'));
