import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const script = new URL('../infra/keycloak/bootstrap-admin.mjs', import.meta.url);

async function runProvisioning(existingUsers = [], tokenResponses = [], timeoutMs = 120_000, adminUrlOverride = null) {
  const state = { created: null, roleMappings: null, userWrites: 0, tokenAttempts: 0 };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/realms/master/protocol/openid-connect/token') {
      const tokenResponse = tokenResponses[state.tokenAttempts++] || {};
      if (tokenResponse.reject) {
        response.destroy(new Error('simulated socket error containing master-test-password and access-token-secret'));
      } else {
        response.writeHead(tokenResponse.status ?? 200, { 'content-type': 'application/json' })
          .end(tokenResponse.body ?? JSON.stringify({ access_token: 'test-token' }));
      }
    } else if (request.url?.startsWith('/admin/realms/COCiber/users?')) {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify(existingUsers));
    } else if (request.url === '/admin/realms/COCiber/users' && request.method === 'POST') {
      state.userWrites += 1;
      state.created = JSON.parse(body);
      response.writeHead(201, { location: '/admin/realms/COCiber/users/new-user' }).end();
    } else if (request.url === '/admin/realms/COCiber/roles/ADMIN') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ id: 'admin-role', name: 'ADMIN' }));
    } else if (request.url?.endsWith('/role-mappings/realm') && request.method === 'GET') {
      response.writeHead(200, { 'content-type': 'application/json' }).end('[]');
    } else if (request.url?.endsWith('/role-mappings/realm') && request.method === 'POST') {
      state.roleMappings = JSON.parse(body);
      response.writeHead(204).end();
    } else {
      response.writeHead(404).end('unexpected request');
    }
  });
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve));
  const address = server.address();
  try {
    const result = await new Promise((resolve, reject) => {
      const child = spawn(process.execPath, [script.pathname], {
        env: {
          ...process.env,
          KEYCLOAK_ADMIN_URL: adminUrlOverride || `http://127.0.0.1:${address.port}`,
          KEYCLOAK_BOOTSTRAP_TIMEOUT_MS: String(timeoutMs),
          KEYCLOAK_ADMIN_USERNAME: 'kc-admin-test',
          KEYCLOAK_ADMIN_PASSWORD: 'master-test-password',
          BOOTSTRAP_ADMIN_USERNAME: 'admin@admin.test',
          BOOTSTRAP_ADMIN_PASSWORD: 'random-initial-password',
        },
      });
      let stdout = '';
      let stderr = '';
      child.stdout.setEncoding('utf8').on('data', (chunk) => { stdout += chunk; });
      child.stderr.setEncoding('utf8').on('data', (chunk) => { stderr += chunk; });
      child.on('error', reject);
      child.on('close', (status) => resolve({ status, stdout, stderr }));
    });
    return { ...state, ...result, output: result.stdout.trim() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('creates the COCiber application admin with a temporary password and ADMIN role', async () => {
  const result = await runProvisioning();
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'CREATED');
  assert.equal(result.created.username, 'admin@admin.test');
  assert.equal(result.created.email, 'admin@admin.test');
  assert.deepEqual(result.created.requiredActions, ['UPDATE_PASSWORD']);
  assert.deepEqual(result.created.credentials, [{ type: 'password', value: 'random-initial-password', temporary: true }]);
  assert.deepEqual(result.roleMappings, [{ id: 'admin-role', name: 'ADMIN' }]);
});

test('keeps an existing account password intact and does not duplicate the user', async () => {
  const result = await runProvisioning([{ id: 'existing-user' }]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'EXISTS');
  assert.equal(result.userWrites, 0);
  assert.deepEqual(result.roleMappings, [{ id: 'admin-role', name: 'ADMIN' }]);
});

test('fails immediately on permanent Keycloak authentication statuses without leaking credentials or response content', async () => {
  for (const status of [400, 401, 403]) {
    const result = await runProvisioning([], [{
      status,
      body: JSON.stringify({ error: 'invalid_grant', error_description: 'master-test-password', access_token: 'access-token-secret' }),
    }], 250);
    assert.notEqual(result.status, 0);
    assert.match(result.stderr, new RegExp(`HTTP ${status}`));
    assert.equal(result.tokenAttempts, 1);
    assert.doesNotMatch(result.stderr, /master-test-password|random-initial-password|access-token-secret|invalid_grant/);
  }
});

test('retries HTTP 503, reports the final transient status at timeout, and does not leak the response body', async () => {
  const result = await runProvisioning([], [
    { status: 503, body: 'master-test-password access-token-secret server still starting' },
    { status: 200, body: JSON.stringify({ access_token: 'test-token' }) },
  ]);
  assert.equal(result.status, 0, result.stderr);
  assert.equal(result.output, 'CREATED');
  assert.equal(result.tokenAttempts, 2);
  assert.doesNotMatch(`${result.stdout}\n${result.stderr}`, /master-test-password|random-initial-password|access-token-secret|server still starting/);

  const timedOut = await runProvisioning([], [
    { status: 503, body: 'master-test-password access-token-secret server still starting' },
  ], 250);
  assert.notEqual(timedOut.status, 0);
  assert.match(timedOut.stderr, /Last result: HTTP 503/);
  assert.doesNotMatch(timedOut.stderr, /master-test-password|random-initial-password|access-token-secret|server still starting/);
});

test('reports ECONNREFUSED without exposing raw network messages or credentials', async () => {
  const reservation = createServer();
  await new Promise((resolve) => reservation.listen(0, '127.0.0.1', resolve));
  const { port } = reservation.address();
  await new Promise((resolve, reject) => reservation.close((error) => error ? reject(error) : resolve()));

  const result = await runProvisioning([], [], 250, `http://127.0.0.1:${port}`);
  assert.notEqual(result.status, 0);
  assert.match(result.stderr, /Last result: network failure \(ECONNREFUSED\)/);
  assert.doesNotMatch(result.stderr, /master-test-password|random-initial-password|access-token-secret|simulated socket error/);
});
