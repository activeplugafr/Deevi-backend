import 'reflect-metadata';
import { Logger, ValidationPipe } from '@nestjs/common';
import { NestFactory, Reflector } from '@nestjs/core';
import { SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { json, urlencoded } from 'express';
import { writeFileSync } from 'node:fs';
import { AppModule, ObserveInstrument } from './app.module.js';
import { loadConfiguration } from './config/configuration.js';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter.js';
import { SupabaseAuthGuard } from './auth/guards/supabase-auth.guard.js';
import { RolesGuard } from './auth/guards/roles.guard.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';
import { buildSwaggerDocument } from './swagger.js';

async function bootstrap() {
  const config = loadConfiguration();
  const logger = new Logger('Bootstrap');

  const app = await NestFactory.create(AppModule, {
    instrument: ObserveInstrument,
    bufferLogs: false,
  });

  // Webhook signature verification needs the exact bytes received, so the
  // raw body is stashed before JSON parsing rewrites it.
  app.use(json({
    limit: '2mb',
    verify: (req: any, _res: any, buf: Buffer) => { req.rawBody = buf.toString('utf8'); },
  }));
  app.use(urlencoded({ extended: true, limit: '2mb' }));

  app.setGlobalPrefix(config.apiPrefix, {
    exclude: ['health', 'health/ready', 'health/live'],
  });

  // Secure headers. CSP is disabled because this process serves JSON and the
  // Swagger UI, not an app shell; Swagger's inline assets need the relaxation.
  app.use(helmet({ contentSecurityPolicy: false, crossOriginEmbedderPolicy: false }));

  app.enableCors({
    origin: config.corsOrigins.includes('*') ? true : config.corsOrigins,
    credentials: true,
    methods: ['GET', 'POST', 'PATCH', 'PUT', 'DELETE', 'OPTIONS'],
    allowedHeaders: ['Content-Type', 'Authorization', 'X-Request-Id'],
    exposedHeaders: ['X-RateLimit-Limit', 'X-RateLimit-Remaining', 'X-RateLimit-Reset'],
    maxAge: 86400,
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: false },
      validationError: { target: false, value: false },
    }),
  );

  app.useGlobalFilters(new AllExceptionsFilter());

  // Order matters: authenticate, then rate limit (so limits are per user),
  // then authorize. Registering these globally makes protection the default.
  const reflector = app.get(Reflector);
  app.useGlobalGuards(
    app.get(SupabaseAuthGuard),
    app.get(RateLimitGuard),
    new RolesGuard(reflector),
  );

  app.enableShutdownHooks();

  const document = buildSwaggerDocument(app, config);
  SwaggerModule.setup(`${config.apiPrefix}/docs`, app, document, {
    swaggerOptions: { persistAuthorization: true, tagsSorter: 'alpha', operationsSorter: 'alpha' },
    customSiteTitle: 'Deevi API',
  });

  if (process.env.EXPORT_OPENAPI) {
    writeFileSync(process.env.EXPORT_OPENAPI, JSON.stringify(document, null, 2));
    logger.log(`OpenAPI written to ${process.env.EXPORT_OPENAPI}`);
    await app.close();
    return;
  }

  await app.listen(config.port);

  logger.log(`Deevi API listening on http://localhost:${config.port}/${config.apiPrefix}`);
  logger.log(`Swagger UI at http://localhost:${config.port}/${config.apiPrefix}/docs`);
  if (!config.supabase.configured) logger.error('Supabase is NOT configured -- most endpoints will fail.');
  if (!config.google.configured) logger.warn('Google OAuth is mocked (no GOOGLE_CLIENT_ID).');
  if (!config.email.configured) logger.warn('Email provider is mocked (no EMAIL_API_KEY).');
  if (!config.payments.configured) logger.warn('Payment provider is mocked (no PAYMENT_SECRET_KEY).');
  if (!config.redis.configured) logger.warn('Redis is not configured; using the in-memory cache fallback.');
}

await bootstrap();
