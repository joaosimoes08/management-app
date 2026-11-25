import { ValidationPipe, VersioningType } from '@nestjs/common';
import { NestFactory } from '@nestjs/core';
import { FastifyAdapter, NestFastifyApplication } from '@nestjs/platform-fastify';
import helmet from '@fastify/helmet';
import { AppModule } from './app.module';
import { ApiExceptionFilter } from './api-exception.filter';
import { trustProxyHops, trustProxyOptions } from './common/trust-proxy';
import { setupSwagger, swaggerEnabledFromEnv, SwaggerSetupOptions } from './docs/swagger';

/** Request headers browsers may send cross-origin. Test-only headers must never be listed here. */
export const CORS_ALLOWED_HEADERS = ['Content-Type', 'Authorization', 'Accept-Language'] as const;

export type ConfigureAppOptions = {
  /** Mount Swagger (UI + spec). Defaults to SWAGGER_ENABLED (on outside production, off in production). */
  swagger?: boolean;
  swaggerSetup?: SwaggerSetupOptions;
};

export async function configureApp(app: NestFastifyApplication, options: ConfigureAppOptions = {}) {
  await app.register(helmet, { contentSecurityPolicy: false });
  app.enableVersioning({ type: VersioningType.URI, prefix: 'v' });
  app.setGlobalPrefix('api');
  const configuredCorsOrigins = (process.env.CORS_ORIGINS ?? 'http://localhost:3000,http://127.0.0.1:3000')
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean);
  app.enableCors({
    origin: configuredCorsOrigins,
    methods: ['GET', 'HEAD', 'POST', 'PUT', 'PATCH', 'DELETE', 'OPTIONS'],
    allowedHeaders: [...CORS_ALLOWED_HEADERS],
    // Lets the browser read the audit CSV export's row count / truncation headers.
    exposedHeaders: ['X-Export-Row-Count', 'X-Export-Truncated', 'Content-Disposition'],
    credentials: true,
  });
  app.useGlobalPipes(new ValidationPipe({
    whitelist: true,
    transform: true,
    forbidNonWhitelisted: true,
    validationError: { target: false, value: false },
  }));
  app.useGlobalFilters(new ApiExceptionFilter());
  if (options.swagger ?? swaggerEnabledFromEnv()) setupSwagger(app, options.swaggerSetup);
  return app;
}

export async function createApp() {
  const app = await NestFactory.create<NestFastifyApplication>(
    AppModule,
    new FastifyAdapter({ bodyLimit: 15 * 1024 * 1024, ...trustProxyOptions(trustProxyHops()) }),
  );
  app.enableShutdownHooks();
  return configureApp(app);
}
