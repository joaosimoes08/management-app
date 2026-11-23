// Lab-only OpenID issuer for the SNMP trap lab. Never used outside the isolated lab network.
import { createServer } from 'node:http';
import { createSign, generateKeyPairSync, randomUUID } from 'node:crypto';

const issuer = 'http://oidc:8080/realms/lab';
const { publicKey, privateKey } = generateKeyPairSync('rsa', { modulusLength: 2048 });
const kid = 'snmplab';
const jwk = { ...publicKey.export({ format: 'jwk' }), kid, alg: 'RS256', use: 'sig' };
const b64 = (value) => Buffer.from(typeof value === 'string' ? value : JSON.stringify(value)).toString('base64url');

function token() {
  const now = Math.floor(Date.now() / 1000);
  const header = b64({ alg: 'RS256', typ: 'JWT', kid });
  const payload = b64({ iss: issuer, sub: 'snmplab-admin', aud: 'simoes-api', azp: 'simoes-api', preferred_username: 'snmplab-admin', name: 'SNMP lab admin', realm_access: { roles: ['ADMIN'] }, iat: now, exp: now + 3600, jti: randomUUID() });
  const signature = createSign('RSA-SHA256').update(`${header}.${payload}`).sign(privateKey).toString('base64url');
  return `${header}.${payload}.${signature}`;
}

createServer((request, response) => {
  if (request.url === '/health') { response.writeHead(200); return response.end('ok'); }
  if (request.url === '/realms/lab/protocol/openid-connect/certs') { response.writeHead(200, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ keys: [jwk] })); }
  if (request.url === '/token') { response.writeHead(200, { 'Content-Type': 'application/json' }); return response.end(JSON.stringify({ access_token: token() })); }
  response.writeHead(404); response.end();
}).listen(8080, '0.0.0.0');
