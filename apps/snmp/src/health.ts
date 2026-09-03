import { createServer, Server } from 'node:http';
import { PrismaClient } from '@simoes/database';
import Redis from 'ioredis';

export type SnmpMetrics = { jobsCompleted: number; jobsFailed: number; trapsProcessed: number };

export function startHealthServer(prisma: PrismaClient, redis: Redis, receiverReady: () => boolean, metrics: SnmpMetrics) {
  const server = createServer(async (request, response) => {
    if (request.url === '/metrics') {
      response.writeHead(200, { 'Content-Type': 'text/plain; version=0.0.4' });
      return response.end(`snmp_jobs_completed_total ${metrics.jobsCompleted}\nsnmp_jobs_failed_total ${metrics.jobsFailed}\nsnmp_traps_processed_total ${metrics.trapsProcessed}\n`);
    }
    if (request.url !== '/health' && request.url !== '/ready') { response.writeHead(404); return response.end(); }
    try {
      await prisma.$queryRaw`SELECT 1`; const redisReady = await redis.ping() === 'PONG';
      const body = { status: redisReady && receiverReady() ? 'ok' : 'degraded', postgres: true, redis: redisReady, receiver: receiverReady() };
      response.writeHead(body.status === 'ok' ? 200 : 503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify(body));
    } catch { response.writeHead(503, { 'Content-Type': 'application/json' }); response.end(JSON.stringify({ status: 'down' })); }
  });
  server.listen(Number(process.env.SNMP_HEALTH_PORT ?? 3002), process.env.SNMP_HEALTH_ADDRESS ?? '0.0.0.0');
  return server as Server;
}
