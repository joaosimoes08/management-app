import dotenv from 'dotenv';
import client from '../packages/database/generated/client/index.js';

dotenv.config({ path: '.env' });
dotenv.config({ path: '.env.qa', override: true });

const { PrismaClient } = client;
const prisma = new PrismaClient();
const result = await prisma.discoveryResult.findFirst({
  where: { job: { name: 'QA Pilot Review Evidence' }, address: '10.254.250.2' },
});
if (!result) throw new Error('QA pilot Discovery result was not found.');

const tokenResponse = await fetch('http://localhost:8080/realms/COCiber/protocol/openid-connect/token', {
  method: 'POST',
  headers: { 'content-type': 'application/x-www-form-urlencoded' },
  body: new URLSearchParams({
    grant_type: 'password',
    client_id: process.env.KEYCLOAK_API_CLIENT_ID || 'simoes-api',
    client_secret: process.env.KEYCLOAK_API_CLIENT_SECRET || 'change-me-api-client-secret',
    username: 'qa-admin',
    password: process.env.QA_ADMIN_PASSWORD || '',
  }),
});
if (!tokenResponse.ok) throw new Error(`QA token request failed (${tokenResponse.status}).`);
const { access_token: token } = await tokenResponse.json();

for (let attempt = 0; attempt < 2; attempt += 1) {
  const response = await fetch(`http://localhost:3001/api/v1/discovery/results/${result.id}/review`, {
    method: 'POST',
    headers: { authorization: `Bearer ${token}`, 'content-type': 'application/json' },
    body: JSON.stringify({ status: 'APPROVED' }),
  });
  if (!response.ok) throw new Error(`Repeated approval failed (${response.status}).`);
}

const [ips, hosts, services, audits] = await Promise.all([
  prisma.ipAddress.count({ where: { address: '10.254.250.2', subnet: { cidr: '10.254.250.0/30' } } }),
  prisma.host.count({ where: { name: 'QA-HOST-PILOT-01' } }),
  prisma.service.count({ where: { host: { name: 'QA-HOST-PILOT-01' }, protocol: 'TCP', port: 443 } }),
  prisma.auditLog.count({ where: { action: 'DISCOVERY_RESULT_APPROVED', entityId: result.id } }),
]);
await prisma.$disconnect();

if (ips !== 1 || hosts !== 1 || services !== 1 || audits !== 1) {
  throw new Error(`Idempotency failed: ${JSON.stringify({ ips, hosts, services, audits })}`);
}
console.log(JSON.stringify({ status: 'PASS', resultId: result.id, ips, hosts, services, audits }, null, 2));
