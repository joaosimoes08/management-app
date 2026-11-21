import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { parseEnv } from 'node:util';

const copy = new URL(parseEnv(readFileSync('.env', 'utf8')).DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(copy.hostname) || !copy.pathname.endsWith('_perf')) {
  throw new Error('Set DATABASE_URL to the isolated local _perf copy.');
}
export function sql(query) {
  return execFileSync('docker', ['exec', '-i', process.env.PERF_POSTGRES_CONTAINER ?? 'simoes-mgmtapp-postgres-1',
    'sh', '-c', 'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"', 'psql', copy.pathname.slice(1)],
  { input: query, encoding: 'utf8', stdio: ['pipe', 'pipe', 'pipe'], timeout: 30_000 }).trim();
}
export function getFixture() {
  return JSON.parse(sql(`
    WITH site AS (SELECT s.id FROM "Site" s LEFT JOIN "Device" d ON d."siteId" = s.id
      GROUP BY s.id ORDER BY count(d.id) DESC, s.id LIMIT 1),
    network AS (SELECT s.id, s."siteId" FROM "Subnet" s LEFT JOIN "IpAddress" i ON i."subnetId" = s.id
      WHERE s."siteId" IS NOT NULL GROUP BY s.id ORDER BY count(i.id) DESC, s.id LIMIT 1),
    rack AS (SELECT r.id, q.id AS "roomId", b.id AS "buildingId", b."siteId" FROM "Rack" r
      JOIN "Room" q ON q.id = r."roomId" JOIN "Building" b ON b.id = q."buildingId"
      LEFT JOIN "Device" d ON d."rackId" = r.id GROUP BY r.id, q.id, b.id
      ORDER BY count(d.id) DESC, r.id LIMIT 1),
    topology AS (SELECT m.id, m."siteId" FROM "TopologyMap" m LEFT JOIN "TopologyMapNode" n ON n."mapId" = m.id
      WHERE m."siteId" IS NOT NULL GROUP BY m.id ORDER BY count(n."deviceId") DESC, m.id LIMIT 1)
    SELECT json_build_object(
      'site', (SELECT id FROM site), 'subnet', (SELECT row_to_json(network) FROM network),
      'rack', (SELECT row_to_json(rack) FROM rack), 'map', (SELECT row_to_json(topology) FROM topology),
      'device', (SELECT id FROM "Device" WHERE "siteId" = (SELECT id FROM site) ORDER BY id LIMIT 1),
      'change', (SELECT id FROM "ChangePlan" WHERE "siteId" = (SELECT id FROM site) ORDER BY id LIMIT 1),
      'auditFrom', ((SELECT MAX("createdAt") FROM "AuditLog") - interval '1 day')
    );
  `));
}
