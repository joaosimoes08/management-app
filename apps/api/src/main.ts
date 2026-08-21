import 'reflect-metadata';
import { config as loadEnv } from 'dotenv';
import { resolve } from 'node:path';
import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';

// The API can also be started directly from apps/api. Always load the
// repository .env and override inherited values so a stale DATABASE_URL
// cannot switch the PostgreSQL client to Prisma Accelerate mode.
loadEnv({ path: resolve(__dirname, '../../../.env'), override: true });

const databaseProtocol = process.env.DATABASE_URL?.split('://', 1)[0];
if (!['postgresql', 'postgres'].includes(databaseProtocol ?? '')) {
  throw new Error('DATABASE_URL must use a direct PostgreSQL URL (postgresql:// or postgres://).');
}

async function bootstrap() {
  // Asset uploads are sent as JSON with a data URL. A 10 MB image expands to
  // roughly 13.3 MB in Base64, so leave a small margin for the JSON envelope.
  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter({ bodyLimit: 15 * 1024 * 1024 }));
  app.enableShutdownHooks();
  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
  app.setGlobalPrefix('api');
  const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: configuredCorsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization'],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({ whitelist: true, transform: true, forbidNonWhitelisted: true }));
  const swaggerConfig = new DocumentBuilder()
    .setTitle('SIMOES Management API')
    .setDescription('API da plataforma de gestão de infraestrutura e ciberdefesa')
    .setVersion('1.0')
    .addBearerAuth()
    .build();
  SwaggerModule.setup('api', app, SwaggerModule.createDocument(app, swaggerConfig));
  await app.listen(process.env.API_PORT ?? 3001, '0.0.0.0');
}
void bootstrap();
