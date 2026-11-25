import { PrismaPg } from '@prisma/adapter-pg';
import { Prisma, PrismaClient as GeneratedPrismaClient } from '../generated/client';

export * from '../generated/client';

/** Everything PrismaClient accepts except the connection, which this package supplies. */
export type DatabaseClientOptions = Omit<Prisma.PrismaClientOptions, 'adapter' | 'accelerateUrl'>;

/**
 * Prisma 7 no longer reads DATABASE_URL by itself: every client needs a driver adapter.
 * This subclass keeps `new PrismaClient()` working for the API, workers, SNMP services and scripts
 * by connecting through node-postgres with the DATABASE_URL set when the client is created.
 * The timeouts match Prisma 6's defaults (5 s to connect, idle connections closed after 300 s).
 */
export class PrismaClient extends GeneratedPrismaClient {
  constructor(options: DatabaseClientOptions = {}) {
    const adapter = new PrismaPg({
      connectionString: process.env.DATABASE_URL,
      connectionTimeoutMillis: 5_000,
      idleTimeoutMillis: 300_000,
    });
    super({ ...options, adapter } as Prisma.PrismaClientOptions);
  }
}
