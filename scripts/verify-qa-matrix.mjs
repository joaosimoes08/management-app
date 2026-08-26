import dotenv from 'dotenv';
import client from '../packages/database/generated/client/index.js';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.qa', override: true });
const { PrismaClient } = client;
const prisma = new PrismaClient();

const definitions = [
  ['ADMIN', 'qa-admin', process.env.QA_ADMIN_PASSWORD],
  ['NETWORK_OPERATOR_SCOPED', 'qa-network-scoped', process.env.QA_NETWORK_SCOPED_PASSWORD],
  ['NETWORK_OPERATOR_LEGACY', 'qa-network-legacy', process.env.QA_NETWORK_LEGACY_PASSWORD],
  ['AUDITOR', 'qa-auditor', process.env.QA_AUDITOR_PASSWORD],
  ['READ_ONLY', 'qa-readonly', process.env.QA_READONLY_PASSWORD],
];

async function token(username, password) {
  const response = await fetch('http://localhost:8080/realms/COCiber/protocol/openid-connect/token', {
    method: 'POST',
    headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type: 'password', client_id: 'simoes-api', client_secret: process.env.KEYCLOAK_API_CLIENT_SECRET || 'change-me-api-client-secret', username, password: password || '' }),
  });
  if (!response.ok) throw new Error(`Token request failed for ${username} (${response.status}).`);
  return (await response.json()).access_token;
}

async function request(accessToken, path, init = {}) {
  return fetch(`http://localhost:3001${path}`, {
    ...init,
    headers: { authorization: `Bearer ${accessToken}`, ...(init.body ? { 'content-type': 'application/json' } : {}) },
  });
}

const qaSite = await prisma.site.findUniqueOrThrow({ where: { code: 'QA-PILOT' } });
const qaSubnet = await prisma.subnet.findUniqueOrThrow({ where: { cidr: '10.254.250.0/30' } });
const outsideSubnet = await prisma.subnet.findFirstOrThrow({ where: { id: { not: qaSubnet.id } } });
const tokens = Object.fromEntries(await Promise.all(definitions.map(async ([key, username, password]) => [key, await token(username, password)])));

const results = {};
const adminUsers = await request(tokens.ADMIN, '/api/v1/settings/users?pageSize=5');
results.ADMIN = adminUsers.status === 200;

const scopedSites = await request(tokens.NETWORK_OPERATOR_SCOPED, '/api/v1/sites?pageSize=100');
const scopedPayload = await scopedSites.json();
const scopedInside = await request(tokens.NETWORK_OPERATOR_SCOPED, `/api/v1/subnets/${qaSubnet.id}`);
const scopedOutside = await request(tokens.NETWORK_OPERATOR_SCOPED, `/api/v1/subnets/${outsideSubnet.id}`);
results.NETWORK_OPERATOR_SCOPED = scopedSites.status === 200 && scopedPayload.items.some((site) => site.id === qaSite.id) && scopedInside.status === 200 && scopedOutside.status === 404;

const legacySites = await request(tokens.NETWORK_OPERATOR_LEGACY, '/api/v1/sites?pageSize=100');
results.NETWORK_OPERATOR_LEGACY = legacySites.status === 200 && (await legacySites.json()).items.length > 1;

const auditorRead = await request(tokens.AUDITOR, '/api/v1/audit/events?pageSize=1');
const auditorWrite = await request(tokens.AUDITOR, '/api/v1/ip-addresses', { method: 'POST', body: JSON.stringify({ address: '10.254.250.3', subnetId: qaSubnet.id }) });
results.AUDITOR = auditorRead.status === 200 && auditorWrite.status === 403;

const readOnlyWrite = await request(tokens.READ_ONLY, '/api/v1/ip-addresses', { method: 'POST', body: JSON.stringify({ address: '10.254.250.3', subnetId: qaSubnet.id }) });
const readOnlyAudit = await request(tokens.READ_ONLY, '/api/v1/audit/events?pageSize=1');
results.READ_ONLY = readOnlyWrite.status === 403 && readOnlyAudit.status === 403;

await prisma.$disconnect();
if (Object.values(results).some((passed) => !passed)) throw new Error(`QA matrix failed: ${JSON.stringify(results)}`);
console.log(JSON.stringify({ status: 'PASS', personas: results }, null, 2));
