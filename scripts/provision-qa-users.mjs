import crypto from 'node:crypto';
import fs from 'node:fs';
import dotenv from 'dotenv';

dotenv.config({ path: '.env' });
const credentialsPath = '.env.qa';
if (!fs.existsSync(credentialsPath)) {
  const password = () => crypto.randomBytes(24).toString('base64url');
  const contents = [
    '# Local persistent QA credentials. Never commit this file.',
    `QA_ADMIN_PASSWORD=${password()}`,
    `QA_NETWORK_SCOPED_PASSWORD=${password()}`,
    `QA_NETWORK_LEGACY_PASSWORD=${password()}`,
    `QA_AUDITOR_PASSWORD=${password()}`,
    `QA_READONLY_PASSWORD=${password()}`,
    '',
  ].join('\n');
  fs.writeFileSync(credentialsPath, contents, { mode: 0o600, flag: 'wx' });
}
dotenv.config({ path: credentialsPath, override: true });

const baseUrl = `http://localhost:${process.env.KEYCLOAK_PORT || '8080'}`;
const realm = process.env.KEYCLOAK_ADMIN_REALM || 'COCiber';
const adminUsername = process.env.KEYCLOAK_ADMIN_USERNAME;
const adminPassword = process.env.KEYCLOAK_ADMIN_PASSWORD;
if (!adminUsername || !adminPassword) throw new Error('Keycloak bootstrap credentials are not configured.');

const definitions = [
  { username: 'qa-admin', role: 'ADMIN', password: process.env.QA_ADMIN_PASSWORD, name: 'QA Admin' },
  { username: 'qa-network-scoped', role: 'NETWORK_OPERATOR', password: process.env.QA_NETWORK_SCOPED_PASSWORD, name: 'QA Network Scoped' },
  { username: 'qa-network-legacy', role: 'NETWORK_OPERATOR', password: process.env.QA_NETWORK_LEGACY_PASSWORD, name: 'QA Network Legacy' },
  { username: 'qa-auditor', role: 'AUDITOR', password: process.env.QA_AUDITOR_PASSWORD, name: 'QA Auditor' },
  { username: 'qa-readonly', role: 'READ_ONLY', password: process.env.QA_READONLY_PASSWORD, name: 'QA Read Only' },
];
for (const definition of definitions) definition.email = `${definition.username}@qa.local`;
if (definitions.some((item) => !item.password)) throw new Error(`Missing credentials in ${credentialsPath}.`);

const tokenResponse = await fetch(`${baseUrl}/realms/master/protocol/openid-connect/token`, {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({ grant_type: 'password', client_id: 'admin-cli', username: adminUsername, password: adminPassword }),
});
if (!tokenResponse.ok) throw new Error(`Keycloak admin authentication failed (${tokenResponse.status}).`);
const { access_token: accessToken } = await tokenResponse.json();

async function request(path, init = {}) {
  const response = await fetch(`${baseUrl}/admin/realms/${encodeURIComponent(realm)}${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, 'content-type': 'application/json', ...init.headers },
  });
  if (!response.ok) throw new Error(`Keycloak request failed (${response.status}) for ${path}.`);
  const text = await response.text();
  return text ? JSON.parse(text) : undefined;
}

const applicationRoles = ['ADMIN', 'NETWORK_OPERATOR', 'SYSTEMS_OPERATOR', 'STORAGE_OPERATOR', 'AUDITOR', 'READ_ONLY'];
const roleEntries = await Promise.all(applicationRoles.map((name) => request(`/roles/${encodeURIComponent(name)}`)));
const roleMap = new Map(roleEntries.map((role) => [role.name, role]));

for (const definition of definitions) {
  let users = await request(`/users?username=${encodeURIComponent(definition.username)}&exact=true`);
  if (!users.length) {
    await request('/users', {
      method: 'POST',
      body: JSON.stringify({ username: definition.username, enabled: true, firstName: definition.name, lastName: 'Pilot', email: definition.email, emailVerified: true, attributes: { qaManaged: ['true'] } }),
    });
    users = await request(`/users?username=${encodeURIComponent(definition.username)}&exact=true`);
  }
  const user = users[0];
  await request(`/users/${encodeURIComponent(user.id)}`, {
    method: 'PUT',
    body: JSON.stringify({ ...user, enabled: true, firstName: definition.name, lastName: 'Pilot', email: definition.email, emailVerified: true, requiredActions: [], attributes: { ...(user.attributes || {}), qaManaged: ['true'] } }),
  });
  await request(`/users/${encodeURIComponent(user.id)}/reset-password`, {
    method: 'PUT',
    body: JSON.stringify({ type: 'password', value: definition.password, temporary: false }),
  });
  const direct = await request(`/users/${encodeURIComponent(user.id)}/role-mappings/realm`);
  const unwanted = direct.filter((role) => applicationRoles.includes(role.name) && role.name !== definition.role);
  if (unwanted.length) await request(`/users/${encodeURIComponent(user.id)}/role-mappings/realm`, { method: 'DELETE', body: JSON.stringify(unwanted) });
  if (!direct.some((role) => role.name === definition.role)) {
    await request(`/users/${encodeURIComponent(user.id)}/role-mappings/realm`, { method: 'POST', body: JSON.stringify([roleMap.get(definition.role)]) });
  }
}

console.log(`Provisioned ${definitions.length} persistent QA users in realm ${realm}; credentials kept in ${credentialsPath}.`);
