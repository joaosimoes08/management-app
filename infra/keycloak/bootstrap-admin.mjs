const baseUrl = (process.env.KEYCLOAK_ADMIN_URL || 'http://localhost:8080').replace(/\/$/, '');
const realm = process.env.KEYCLOAK_ADMIN_REALM || 'COCiber';
const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin@admin.test';
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
const startupTimeoutMs = Number(process.env.KEYCLOAK_BOOTSTRAP_TIMEOUT_MS || 120_000);
const requestTimeoutMs = 5_000;

if (!Number.isSafeInteger(startupTimeoutMs) || startupTimeoutMs < 1 || startupTimeoutMs > 120_000) {
  throw new Error('KEYCLOAK_BOOTSTRAP_TIMEOUT_MS must be an integer between 1 and 120000.');
}

if (!password || !adminUsername || !adminPassword) {
  throw new Error('Missing bootstrap administrator or Keycloak bootstrap credentials.');
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    throw new Error(`Keycloak Admin API request failed with HTTP ${response.status} for ${new URL(path, baseUrl).pathname}; response body omitted to avoid exposing credentials.`);
  }
  return response;
}

function permanentError(message) {
  return Object.assign(new Error(message), { permanent: true });
}

function safeNetworkFailure(error) {
  const safeNames = new Set(['AbortError', 'TimeoutError', 'TypeError']);
  const name = safeNames.has(error?.name) ? error.name : 'Error';
  const code = error?.cause?.code;
  const safeCodes = new Set([
    'ECONNREFUSED', 'ECONNRESET', 'ECONNABORTED', 'ENOTFOUND', 'EAI_AGAIN', 'ETIMEDOUT',
    'EHOSTUNREACH', 'ENETUNREACH', 'EPIPE', 'UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_SOCKET',
    'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'UND_ERR_ABORTED',
  ]);
  if (typeof code === 'string' && safeCodes.has(code)) {
    return `network failure (${code})`;
  }
  return `network failure (${name})`;
}

async function acquireToken() {
  const endpoint = `${baseUrl}/realms/master/protocol/openid-connect/token`;
  const deadline = Date.now() + startupTimeoutMs;
  let lastFailure = 'no response received';

  while (Date.now() < deadline) {
    try {
      const response = await fetch(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUsername, password: adminPassword }),
        signal: AbortSignal.timeout(Math.min(requestTimeoutMs, Math.max(1, deadline - Date.now()))),
      });
      if (response.ok) {
        let payload;
        try { payload = await response.json(); }
        catch { throw permanentError('Keycloak token endpoint returned invalid JSON after a successful HTTP response.'); }
        if (typeof payload?.access_token !== 'string' || !payload.access_token) {
          throw permanentError('Keycloak token endpoint returned no access token.');
        }
        return payload.access_token;
      }

      if (response.status === 400 || response.status === 401 || response.status === 403) {
        throw permanentError(`Keycloak rejected the configured master administrator credentials (HTTP ${response.status}). Verify KEYCLOAK_ADMIN_USERNAME and KEYCLOAK_ADMIN_PASSWORD. These bootstrap values create the initial master administrator only; they do not reset credentials in an existing Keycloak data volume.`);
      }
      if (![408, 425, 429].includes(response.status) && response.status < 500) {
        throw permanentError(`Keycloak token endpoint returned non-retryable HTTP ${response.status}; verify KEYCLOAK_ADMIN_URL and the master realm configuration.`);
      }

      lastFailure = `HTTP ${response.status}`;
      if (response.body) await response.body.cancel().catch(() => {});
    } catch (error) {
      if (error?.permanent) throw error;
      lastFailure = safeNetworkFailure(error);
    }

    const remainingMs = deadline - Date.now();
    if (remainingMs > 0) await new Promise((resolve) => setTimeout(resolve, Math.min(2_000, remainingMs)));
  }

  throw new Error(`Keycloak token endpoint did not become ready within ${startupTimeoutMs} ms at ${new URL(baseUrl).origin}. Last result: ${lastFailure}. Check 'docker compose ps keycloak' and 'docker compose logs --tail=200 keycloak'; verify KEYCLOAK_ADMIN_URL points to the reachable Keycloak service.`);
}

async function main() {
  const token = await acquireToken();

  const headers = { authorization: `Bearer ${token}`, 'content-type': 'application/json' };
  const usersResponse = await request(`/admin/realms/${encodeURIComponent(realm)}/users?username=${encodeURIComponent(username)}&exact=true`, { headers });
  const users = await usersResponse.json();
  let userId;
  if (users.length) {
    userId = users[0].id;
  } else {
    const createResponse = await request(`/admin/realms/${encodeURIComponent(realm)}/users`, {
      method: 'POST',
      headers,
      body: JSON.stringify({
        username,
        email: username,
        enabled: true,
        emailVerified: false,
        requiredActions: ['UPDATE_PASSWORD'],
        credentials: [{ type: 'password', value: password, temporary: true }],
      }),
    });
    const location = createResponse.headers.get('location');
    if (!location) throw new Error('Keycloak created the administrator but did not return its user location.');
    userId = location.split('/').at(-1);
  }
  const roleResponse = await request(`/admin/realms/${encodeURIComponent(realm)}/roles/ADMIN`, { headers });
  const role = await roleResponse.json();
  const mappingsResponse = await request(`/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, { headers });
  const mappings = await mappingsResponse.json();
  const alreadyAdmin = mappings.some((mapping) => mapping.id === role.id || mapping.name === role.name);
  if (!alreadyAdmin) {
  await request(`/admin/realms/${encodeURIComponent(realm)}/users/${encodeURIComponent(userId)}/role-mappings/realm`, {
    method: 'POST', headers, body: JSON.stringify([role]),
  });
  }
  console.log(users.length ? 'EXISTS' : 'CREATED');
}

await main();
