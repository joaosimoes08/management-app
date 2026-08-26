const baseUrl = (process.env.KEYCLOAK_ADMIN_URL || 'http://localhost:8080').replace(/\/$/, '');
const realm = process.env.KEYCLOAK_ADMIN_REALM || 'COCiber';
const username = process.env.KEYCLOAK_ADMIN_USERNAME;
const password = process.env.KEYCLOAK_ADMIN_PASSWORD;
const clientId = process.env.KEYCLOAK_ADMIN_CLIENT_ID || 'simoes-settings-admin';
const clientSecret = process.env.KEYCLOAK_ADMIN_CLIENT_SECRET;
if (!username || !password || !clientSecret) throw new Error('Define KEYCLOAK_ADMIN_USERNAME, KEYCLOAK_ADMIN_PASSWORD e KEYCLOAK_ADMIN_CLIENT_SECRET.');

const tokenResponse = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username, password }) });
if (!tokenResponse.ok) throw new Error(`Falha ao autenticar no Keycloak (${tokenResponse.status}).`);
const token = (await tokenResponse.json()).access_token;
const request = async (path, init = {}) => {
  const response = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  if (!response.ok) throw new Error(`${init.method || 'GET'} ${path} falhou (${response.status}): ${await response.text()}`);
  if (response.status === 204) return undefined;
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
};

let [client] = await request(`/clients?clientId=${encodeURIComponent(clientId)}`);
const representation = { clientId, name: 'SIMOES Settings Administration', enabled: true, protocol: 'openid-connect', publicClient: false, clientAuthenticatorType: 'client-secret', secret: clientSecret, standardFlowEnabled: false, directAccessGrantsEnabled: false, serviceAccountsEnabled: true };
if (!client) { await request('/clients', { method: 'POST', body: JSON.stringify(representation) }); [client] = await request(`/clients?clientId=${encodeURIComponent(clientId)}`); }
else await request(`/clients/${client.id}`, { method: 'PUT', body: JSON.stringify({ ...client, ...representation }) });
const serviceAccount = await request(`/clients/${client.id}/service-account-user`);
const [realmManagement] = await request('/clients?clientId=realm-management');
const [manageUsers, queryUsers] = await Promise.all([
  request(`/clients/${realmManagement.id}/roles/manage-users`),
  request(`/clients/${realmManagement.id}/roles/query-users`),
]);
await request(`/users/${serviceAccount.id}/role-mappings/clients/${realmManagement.id}`, { method: 'POST', body: JSON.stringify([manageUsers, queryUsers]) });
console.info(`Client ${clientId} provisionado no realm ${realm}.`);
