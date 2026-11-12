const baseUrl = (process.env.KEYCLOAK_ADMIN_URL || 'http://localhost:8080').replace(/\/$/, '');
const realm = process.env.KEYCLOAK_ADMIN_REALM || 'COCiber';
const username = process.env.BOOTSTRAP_ADMIN_USERNAME || 'admin@admin.test';
const password = process.env.BOOTSTRAP_ADMIN_PASSWORD;
const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;

if (!password || !adminUsername || !adminPassword) {
  throw new Error('Missing bootstrap administrator or Keycloak bootstrap credentials.');
}

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}${path}`, init);
  if (!response.ok) {
    const detail = await response.text();
    throw new Error(`Keycloak request failed (${response.status}): ${detail.slice(0, 240)}`);
  }
  return response;
}

async function main() {
  let token;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    try {
      const response = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
        method: 'POST',
        headers: { 'content-type': 'application/x-www-form-urlencoded' },
        body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUsername, password: adminPassword }),
      });
      if (response.ok) {
        token = (await response.json()).access_token;
        break;
      }
    } catch {}
    if (attempt === 59) throw new Error('Keycloak did not become ready for administrator provisioning within 120 seconds.');
    await new Promise((resolve) => setTimeout(resolve, 2000));
  }

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
