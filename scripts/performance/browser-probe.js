// Served by the isolated benchmark proxy, before app hydration.
(() => {
  const sample = new URL(location.href).searchParams.get('__perfSample');
  if (!sample || window.top !== window) return;
  const apiOrigin = 'http://localhost:4001';
  const requests = [];
  const nativeFetch = window.fetch.bind(window);
  window.fetch = async (input, options) => {
    const url = new URL(typeof input === 'string' || input instanceof URL ? input : input.url, location.href);
    const tracked = url.origin === apiOrigin && url.pathname.startsWith('/api/') && !url.pathname.endsWith('/operations/events');
    const state = tracked ? { path: url.pathname, start: performance.now() } : null;
    try {
      const result = await nativeFetch(input, options);
      if (state) {
        const entry = result.headers.get('server-timing');
        Object.assign(state, { headersAt: performance.now(), status: result.status, server: entry });
        // Observe the already-buffered resource entry when available. Do not consume or clone response bodies.
        requests.push(state);
      }
      return result;
    } catch (error) { throw error; }
  };
  let lcp = 0;
  try {
    new PerformanceObserver((list) => { lcp = list.getEntries().at(-1)?.startTime ?? lcp; })
      .observe({ type: 'largest-contentful-paint', buffered: true });
  } catch { /* Report missing LCP on an unsupported browser. */ }
  const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
  const find = (selector) => [...document.querySelectorAll(selector)].find((item) => item.getClientRects().length && !item.closest('[aria-busy="true"]'));
  const timing = (raw) => Object.fromEntries((raw ?? '').split(',').flatMap((metric) => {
    const match = metric.trim().match(/^(\w+);dur=([\d.]+)/);
    return match ? [[match[1], Number(match[2])]] : [];
  }));
  let recorded = false;
  async function run() {
    const plan = await nativeFetch(`/__perf/plan/${encodeURIComponent(sample)}`).then((r) => r.json());
    if (!plan.page) return;
    let observed = '';
    let searchAt;
    let dataVisible;
    let last;
    let topologySelected = false;
    const deadline = performance.now() + 24_000;
    while (performance.now() < deadline) {
      if (plan.page === 'global-search' && !searchAt && find('.dashboard-kpi-strip')) {
        window.dispatchEvent(new KeyboardEvent('keydown', { key: 'k', metaKey: true, bubbles: true }));
        await wait(50);
        const input = find('.command-palette input');
        if (input) {
          const platform = [...document.querySelectorAll('.command-palette button')].find((button) => button.textContent.includes('Toda a plataforma'));
          platform?.click();
          searchAt = performance.now();
          Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, 'value').set.call(input, plan.search);
          input.dispatchEvent(new Event('input', { bubbles: true }));
        }
      }
      if (plan.page === 'topology' && !topologySelected) {
        const picker = find('select[aria-label="Mapa do site"]');
        if (picker && [...picker.options].some(({ value }) => value === plan.mapId)) {
          topologySelected = true;
          picker.value = plan.mapId;
          picker.dispatchEvent(new Event('change', { bubbles: true }));
        }
      }
      last = requests.filter((request) => request.status >= 200 && request.status < 300 && plan.endpoints.some((fragment) => request.path.includes(fragment))).at(-1);
      if (last && find(plan.selector)) { observed = 'rendered'; dataVisible = performance.now(); break; }
      if (last && plan.empty && performance.now() - last.headersAt > 150 && find(plan.empty)) {
        observed = 'empty-state';
        dataVisible = performance.now();
        break;
      }
      await wait(25);
    }
    if (recorded) return;
    recorded = true;
    if (dataVisible) await wait(800);
    const navigation = performance.getEntriesByType('navigation')[0];
    const resources = performance.getEntriesByType('resource');
    const http = resources.filter((resource) => resource.name.startsWith('http') && !resource.name.includes('/__perf/'));
    const firstAuth = requests.find(({ path }) => path.endsWith('/auth/me'));
    const resource = last && http.filter((item) => new URL(item.name).pathname === last.path).at(-1);
    // Cross-origin Timing-Allow-Origin makes exact response bytes and Server-Timing available on the copy's API.
    const server = resource?.serverTiming?.length
      ? Object.fromEntries(resource.serverTiming.map((metric) => [metric.name, metric.duration]))
      : timing(last?.server);
    const row = {
      sample, page: plan.page, cache: plan.cache, pass: plan.pass, run: plan.run,
      status: observed || (firstAuth ? 'timeout' : 'auth-unavailable'),
      ttfb_ms: navigation?.responseStart ?? null, lcp_ms: lcp || null, visible_ms: dataVisible ?? null,
      search_after_input_ms: searchAt && dataVisible ? dataVisible - searchAt : null,
      js_bytes: http.filter((item) => new URL(item.name).pathname.endsWith('.js')).reduce((sum, item) => sum + item.transferSize, 0),
      transferred_bytes: (navigation?.transferSize ?? 0) + http.reduce((sum, item) => sum + item.transferSize, 0),
      request_entries: http.length + (navigation ? 1 : 0),
      network_entries: http.filter((item) => item.transferSize > 0).length + (navigation?.transferSize ? 1 : 0),
      api_requests: requests.length,
      keycloak_to_identity_ms: firstAuth?.start ?? null,
      critical_request_ms: last ? last.headersAt - last.start : null,
      critical_api_ms: server.api ?? null, critical_prisma_ms: server.db ?? null,
      critical_auth_ms: server.auth ?? null,
      critical_network_ms: resource && 'api' in server ? Math.max(0, resource.responseStart - resource.startTime - server.api) : null,
      render_after_critical_ms: resource && dataVisible ? Math.max(0, dataVisible - resource.responseEnd) : null,
    };
    const response = await nativeFetch('/__perf/result', { method: 'POST', body: JSON.stringify(row), credentials: 'same-origin' });
    const { next } = await response.json();
    location.assign(next);
  }
  run().catch(() => { document.title = 'Performance measurement failed'; });
})();
