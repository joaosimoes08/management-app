/** Disposable Keycloak for the production-browser benchmark. Stores generated secrets only in memory. */
import { execFileSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { createServer } from 'node:http';

const container = 'mgmtapp-step18-keycloak';
const origin = 'http://localhost:4080';
const username = 'perf-qa';
const password = randomBytes(24).toString('base64url');
const adminPassword = randomBytes(24).toString('base64url');
const startup = AbortSignal.timeout(90_000);
const webOrigin = 'http://localhost:4000';
const image = process.env.PERF_KEYCLOAK_IMAGE ?? 'quay.io/keycloak/keycloak:26.3.3';

const docker = (args, env = process.env) => execFileSync('docker', args, { env, stdio: ['ignore', 'pipe', 'pipe'] });
const token = (realm, data) => fetch(`${origin}/realms/${realm}/protocol/openid-connect/token`, {
  method: 'POST', body: new URLSearchParams(data), signal: AbortSignal.timeout(6000),
});
const admin = async (url, value, bearer, method = 'POST') => {
  const response = await fetch(`${origin}/admin/realms${url}`, {
    method,
    headers: { Authorization: `Bearer ${bearer}`, 'Content-Type': 'application/json' },
    ...(value === undefined ? {} : { body: JSON.stringify(value) }),
    signal: AbortSignal.timeout(8000),
  });
  if (!response.ok) throw new Error(`Identity setup HTTP ${response.status}`);
  return response;
};

let started = false;
function stop() {
  if (!started) return;
  started = false;
  docker(['stop', '-t', '3', container]);
}
process.once('SIGTERM', () => { stop(); process.exit(0); });
process.once('SIGINT', () => { stop(); process.exit(0); });
try {
  docker(['run', '--rm', '-d', '--name', container, '-p', '127.0.0.1:4080:8080',
    '--env', 'KC_BOOTSTRAP_ADMIN_USERNAME=perf-admin', '--env', 'KC_BOOTSTRAP_ADMIN_PASSWORD', image, 'start-dev'],
    { ...process.env, KC_BOOTSTRAP_ADMIN_PASSWORD: adminPassword });
  started = true;
  let bearer;
  while (!startup.aborted) {
    let response;
    try {
      response = await token('master', { client_id: 'admin-cli', username: 'perf-admin', password: adminPassword, grant_type: 'password' });
    } catch { /* The isolated container is still starting. */ }
    if (response?.ok) { bearer = (await response.json()).access_token; break; }
    await new Promise((resolve) => setTimeout(resolve, 500));
  }
  if (!bearer) throw new Error('Isolated Keycloak did not become ready');
  const original = JSON.parse(readFileSync(new URL('../../infra/keycloak/realm-cociber.json', import.meta.url), 'utf8'));
  const web = original.clients.find(({ clientId }) => clientId === 'simoes-web');
  const realm = {
    realm: 'COCiber', enabled: true, displayName: 'Capacity QA',
    sslRequired: 'none', accessTokenLifespan: 600, roles: original.roles,
    clients: [{ ...web, redirectUris: [`${webOrigin}/*`], webOrigins: [webOrigin],
      attributes: { ...web.attributes, 'post.logout.redirect.uris': `${webOrigin}/*` } },
    { clientId: 'perf-cli', enabled: true, protocol: 'openid-connect', publicClient: true, directAccessGrantsEnabled: true,
      standardFlowEnabled: false, protocolMappers: web.protocolMappers }],
    users: [{ username, enabled: true, firstName: 'Performance', lastName: 'Fixture', email: 'perf@example.test', emailVerified: true,
      credentials: [{ type: 'password', value: password, temporary: false }], realmRoles: ['ADMIN'] }],
  };
  await admin('', realm, bearer);

  let browserCredentialAvailable = true;
  const server = createServer(async (request, response) => {
    response.setHeader('Cache-Control', 'no-store');
    if (request.method === 'POST' && request.url === '/one-time-browser-login' && request.headers.origin === origin && browserCredentialAvailable) {
      browserCredentialAvailable = false;
      response.setHeader('Access-Control-Allow-Origin', origin);
      response.setHeader('Content-Type', 'application/json');
      return response.end(JSON.stringify({ username, password }));
    }
    if (request.method === 'POST' && request.url === '/api-token' && !request.headers.origin && !request.headers['sec-fetch-site']) {
      try {
        const result = await token('COCiber', { client_id: 'perf-cli', username, password, grant_type: 'password' });
        if (!result.ok) throw new Error();
        response.setHeader('Content-Type', 'application/json');
        return response.end(JSON.stringify({ access_token: (await result.json()).access_token }));
      } catch {
        response.statusCode = 502;
        return response.end();
      }
    }
    response.statusCode = 404;
    response.end();
  });
  server.listen(4081, '127.0.0.1', () => process.stdout.write('Isolated Keycloak ready on port 4080\n'));
} catch (error) {
  stop();
  throw error;
}
