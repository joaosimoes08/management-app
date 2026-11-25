import { defineConfig } from 'prisma/config';

// Prisma 7 reads connection URLs from this file instead of schema.prisma.
// DATABASE_URL comes from the environment (dotenv-cli, Docker or CI); `prisma generate` does not need it.
export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: { path: 'prisma/migrations' },
  datasource: { url: process.env.DATABASE_URL ?? '' },
});
