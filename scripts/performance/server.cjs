/** Loopback-only instrumented production API for a disposable database copy. */
require('reflect-metadata');
const { AsyncLocalStorage } = require('node:async_hooks');
const { createHash } = require('node:crypto');
const { execFileSync } = require('node:child_process');
const { readFileSync } = require('node:fs');
const { parseEnv } = require('node:util');
const { Test } = require('@nestjs/testing');
const { FastifyAdapter } = require('@nestjs/platform-fastify');

Object.assign(process.env, parseEnv(readFileSync('.env', 'utf8')), {
  NODE_ENV: 'production', AUTH_DISABLED: 'false',
  OIDC_ISSUER_URL: process.env.PERF_ISSUER ?? 'http://localhost:4080/realms/COCiber',
  CORS_ORIGINS: 'http://localhost:4000',
  REDIS_URL: process.env.PERF_REDIS_URL ?? 'redis://127.0.0.1:4639',
});
const database = new URL(process.env.DATABASE_URL);
if (!['localhost', '127.0.0.1'].includes(database.hostname) || !database.pathname.endsWith('_perf')) {
  throw new Error('The baseline API requires a loopback database copy ending in _perf.');
}
const { PrismaClient } = require('@simoes/database');
const { AppModule } = require('../../apps/api/dist/app.module');
const { configureApp } = require('../../apps/api/dist/app.factory');
const { AuthGuard } = require('../../apps/api/dist/auth/auth.guard');

const requestContext = new AsyncLocalStorage();
const prisma = new PrismaClient({ log: [{ emit: 'event', level: 'query' }] });
const queryTotals = new Map();
let sqlCount = 0;
const queryName = (sql) => {
  const relations = [...new Set([...sql.matchAll(/(?:FROM|JOIN|UPDATE|INTO)\s+(?:"public"\.)?"([^"]+)"/gi)].map((m) => m[1]))];
  return `${sql.match(/^\s*(\w+)/)?.[1] ?? 'OTHER'} ${relations.join('+')}`.trim();
};
prisma.$on('query', ({ query, params, duration }) => {
  sqlCount++;
  const id = createHash('sha256').update(query).digest('hex').slice(0, 12);
  const entry = queryTotals.get(id) ?? { id, name: queryName(query), query, params, calls: 0, totalMs: 0, maxMs: 0 };
  entry.calls++;
  entry.totalMs += duration;
  entry.maxMs = Math.max(entry.maxMs, duration);
  queryTotals.set(id, entry);
});

const instrumented = prisma.$extends({ query: { $allOperations({ model, operation, args, query }) {
  const state = requestContext.getStore();
  const where = args?.where;
  if (state?.excludeHttp && model === 'AuditLog' && operation === 'findMany' && where?.action?.not === 'HTTP_REQUEST' && where.OR) {
    args = { ...args, where: { ...where, AND: [{ OR: [{ entityType: null }, { entityType: { not: 'HTTP_REQUEST' } }] }] } };
  }
  if (!state) return query(args);
  state.operations++;
  return (async () => {
    const start = performance.now();
    try { return await query(args); }
    finally { state.dbMs += performance.now() - start; }
  })();
} } });

const originalGuard = AuthGuard.prototype.canActivate;
AuthGuard.prototype.canActivate = async function (...args) {
  const state = requestContext.getStore();
  const start = performance.now();
  try { return await originalGuard.apply(this, args); }
  finally { if (state) state.authMs += performance.now() - start; }
};

const names = () => [...queryTotals.values()].sort((a, b) => b.totalMs - a.totalMs);
function planFor({ query, params }) {
  const values = JSON.parse(params);
  const literal = (value) => {
    if (value === null) return 'NULL';
    if (typeof value === 'number') return String(value);
    if (typeof value === 'boolean') return value ? 'TRUE' : 'FALSE';
    if (typeof value === 'string') return "'" + value.replaceAll("'", "''") + "'";
    throw new Error('Unsupported bound value');
  };
  const sql = query.replace(/\$(\d+)/g, (_, index) => literal(values[Number(index) - 1]));
  const result = execFileSync('docker', ['exec', '-i', process.env.PERF_POSTGRES_CONTAINER ?? 'simoes-mgmtapp-postgres-1', 'sh', '-c',
    'psql -X -qAt -v ON_ERROR_STOP=1 -U "$POSTGRES_USER" -d "$1"', 'psql', database.pathname.slice(1)], {
    input: `BEGIN READ ONLY; SET LOCAL statement_timeout = '20s'; EXPLAIN (ANALYZE, BUFFERS, FORMAT JSON) ${sql}; ROLLBACK;\n`,
    encoding: 'utf8', timeout: 25_000, stdio: ['pipe', 'pipe', 'pipe'],
  });
  const [report] = JSON.parse(result);
  const fields = ['Node Type', 'Relation Name', 'Index Name', 'Actual Rows', 'Actual Loops', 'Actual Total Time', 'Rows Removed by Filter',
    'Shared Hit Blocks', 'Shared Read Blocks', 'Temp Read Blocks', 'Temp Written Blocks'];
  const redact = (plan) => Object.fromEntries([
    ...fields.filter((field) => field in plan).map((field) => [field, plan[field]]),
    ...(plan.Plans ? [['Plans', plan.Plans.map(redact)]] : []),
  ]);
  return { planningMs: report['Planning Time'], executionMs: report['Execution Time'], plan: redact(report.Plan) };
}

async function main() {
  const module = await Test.createTestingModule({ imports: [AppModule] })
    .overrideProvider(PrismaClient).useValue(instrumented).compile();
  const app = module.createNestApplication(new FastifyAdapter({ bodyLimit: 15 * 1024 * 1024 }), { logger: ['warn', 'error'] });
  await configureApp(app, { swagger: false });
  app.enableShutdownHooks();
  const fastify = app.getHttpAdapter().getInstance();
  fastify.addHook('onRequest', (request, reply, done) => {
    requestContext.run({ start: performance.now(), authMs: 0, dbMs: 0, operations: 0, sqlAtStart: sqlCount,
      excludeHttp: request.headers['x-perf-variant'] === 'exclude-http' }, done);
  });
  fastify.addHook('onSend', (request, reply, payload, done) => {
    const state = requestContext.getStore();
    if (state) {
      const timing = { api: performance.now() - state.start, auth: state.authMs, db: state.dbMs, prisma: state.operations, sql: sqlCount - state.sqlAtStart };
      reply.header('Server-Timing', Object.entries(timing).map(([name, value]) => `${name};dur=${value.toFixed(2)}`).join(', '));
      reply.header('Timing-Allow-Origin', 'http://localhost:4000');
    }
    done(null, payload);
  });
  // Private tooling is kept out of the production entry point. Any Origin header is refused here.
  fastify.get('/__perf/db', async (request, reply) => {
    if (request.headers.origin || request.headers['sec-fetch-site']) return reply.code(403).send();
    return names().slice(0, 20).map(({ id, name, calls, totalMs, maxMs }) => ({ id, name, calls, totalMs, maxMs }));
  });
  fastify.get('/__perf/plan/:id', async (request, reply) => {
    if (request.headers.origin || request.headers['sec-fetch-site']) return reply.code(403).send();
    const entry = queryTotals.get(request.params.id);
    if (!entry || !/^SELECT\s/i.test(entry.query)) return reply.code(404).send();
    try { return planFor(entry); } catch { return reply.code(500).send({ error: 'Plan unavailable for this bound query' }); }
  });
  await app.listen(4001, '127.0.0.1');
  process.stdout.write('Benchmark API ready on port 4001\n');
}
main().catch((error) => { console.error(`Benchmark API startup failed: ${error.name}`); process.exitCode = 1; });
