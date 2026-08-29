import dotenv from 'dotenv';
import realmConfig from '../infra/keycloak/realm-cociber.json' with { type: 'json' };

dotenv.config({ path: '.env', quiet: true });
dotenv.config({ path: '.env.qa', override: true, quiet: true });

const apiBase = 'http://localhost:3001/api/v1';
const tokenUrl = `http://localhost:${process.env.KEYCLOAK_PORT || '8080'}/realms/COCiber/protocol/openid-connect/token`;
const client = realmConfig.clients.find((item) => item.clientId === 'simoes-api');
const identities = [
  ['qa-admin', 'QA_ADMIN_PASSWORD'],
  ['qa-network-scoped', 'QA_NETWORK_SCOPED_PASSWORD'],
  ['qa-network-legacy', 'QA_NETWORK_LEGACY_PASSWORD'],
  ['qa-auditor', 'QA_AUDITOR_PASSWORD'],
  ['qa-readonly', 'QA_READONLY_PASSWORD'],
];

async function tokenFor(username, password) {
  const response = await fetch(tokenUrl, { method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' }, body: new URLSearchParams({ grant_type: 'password', client_id: client.clientId, client_secret: client.secret, username, password }) });
  if (!response.ok) throw new Error(`OIDC login failed for ${username} (${response.status}).`);
  return (await response.json()).access_token;
}

async function api(token, path, init = {}) {
  const response = await fetch(`${apiBase}${path}`, { ...init, headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json', ...init.headers } });
  const text = await response.text();
  const body = text ? JSON.parse(text) : undefined;
  if (!response.ok) throw new Error(`API ${init.method || 'GET'} ${path} failed (${response.status}): ${body?.code || body?.message || 'unknown'}`);
  return body;
}

let adminToken;
for (const [username, passwordKey] of identities) {
  const token = await tokenFor(username, process.env[passwordKey]);
  const me = await api(token, '/auth/me');
  if (me.username !== username) throw new Error(`Unexpected synchronized identity for ${username}.`);
  if (username === 'qa-admin') adminToken = token;
}

const sites = await api(adminToken, '/sites?search=QA-PILOT&pageSize=20');
const site = sites.items.find((item) => item.code === 'QA-PILOT');
if (!site) throw new Error('QA-PILOT Site not found. Run npm run pilot:seed first.');
const subnets = await api(adminToken, `/subnets?siteId=${encodeURIComponent(site.id)}&search=${encodeURIComponent('10.254.250.0/30')}`);
const subnet = subnets.items.find((item) => item.cidr === '10.254.250.0/30');
if (!subnet) throw new Error('QA pilot subnet not found.');
const users = await api(adminToken, '/settings/access-group-users?search=qa-network-scoped');
const scopedUser = users.find((item) => item.username === 'qa-network-scoped');
if (!scopedUser) throw new Error('Scoped user was not synchronized.');

let groups = await api(adminToken, '/settings/access-groups');
let group = groups.find((item) => item.name === 'QA-NETWORK-SCOPED');
if (!group) group = await api(adminToken, '/settings/access-groups', { method: 'POST', body: JSON.stringify({ name: 'QA-NETWORK-SCOPED', description: 'Persistent pilot scope limited to the QA Site.' }) });
await api(adminToken, `/settings/access-groups/${group.id}/sites/${site.id}`, { method: 'PUT', body: JSON.stringify({ permissions: ['READ', 'CREATE', 'UPDATE', 'DISCOVER'] }) });
groups = await api(adminToken, '/settings/access-groups');
group = groups.find((item) => item.id === group.id);
if (!group.members.some((member) => member.userId === scopedUser.id)) await api(adminToken, `/settings/access-groups/${group.id}/members`, { method: 'POST', body: JSON.stringify({ userId: scopedUser.id }) });

console.log('Synchronized 5 QA identities and configured QA-NETWORK-SCOPED on one pilot Site.');
