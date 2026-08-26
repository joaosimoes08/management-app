import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { createApp } from './app.factory';

// The API can also be started directly from apps/api. Always load the
// repository .env and override inherited values so a stale DATABASE_URL
// cannot switch the PostgreSQL client to Prisma Accelerate mode.
loadEnv({ path: resolve(__dirname, '../../../.env'), override: true });

const databaseProtocol = process.env.DATABASE_URL?.split('://', 1)[0];
if (!['postgresql', 'postgres'].includes(databaseProtocol ?? '')) {
  throw new Error('DATABASE_URL must use a direct PostgreSQL URL (postgresql:// or postgres://).');
}

async function bootstrap() {
  const app = await createApp();
  await app.listen(process.env.API_PORT ?? 3001, '0.0.0.0');
}
void bootstrap();
