import assert from 'node:assert/strict';
import { spawn } from 'node:child_process';
import { createServer } from 'node:http';
import { test } from 'node:test';

const script = new URL('../infra/keycloak/bootstrap-admin.mjs', import.meta.url);

async function runProvisioning(existingUsers = []) {
  const state = { created: null, roleMappings: null, userWrites: 0 };
  const server = createServer(async (request, response) => {
    const chunks = [];
    for await (const chunk of request) chunks.push(chunk);
    const body = Buffer.concat(chunks).toString();
    if (request.url === '/realms/master/protocol/openid-connect/token') {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ access_token: 'test-token' }));
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
          KEYCLOAK_ADMIN_URL: `http://127.0.0.1:${address.port}`,
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
    assert.equal(result.status, 0, result.stderr);
    return { ...state, output: result.stdout.trim() };
  } finally {
    await new Promise((resolve, reject) => server.close((error) => error ? reject(error) : resolve()));
  }
}

test('creates the COCiber application admin with a temporary password and ADMIN role', async () => {
  const result = await runProvisioning();
  assert.equal(result.output, 'CREATED');
  assert.equal(result.created.username, 'admin@admin.test');
  assert.equal(result.created.email, 'admin@admin.test');
  assert.deepEqual(result.created.requiredActions, ['UPDATE_PASSWORD']);
  assert.deepEqual(result.created.credentials, [{ type: 'password', value: 'random-initial-password', temporary: true }]);
  assert.deepEqual(result.roleMappings, [{ id: 'admin-role', name: 'ADMIN' }]);
});

test('keeps an existing account password intact and does not duplicate the user', async () => {
  const result = await runProvisioning([{ id: 'existing-user' }]);
  assert.equal(result.output, 'EXISTS');
  assert.equal(result.userWrites, 0);
  assert.deepEqual(result.roleMappings, [{ id: 'admin-role', name: 'ADMIN' }]);
});
