import type { INestApplication } from '@nestjs/common';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import type { DeeviConfig } from './config/configuration.js';

/**
 * The OpenAPI document is the contract the frontend is built against, so it
 * is assembled deliberately rather than as a side effect: every tag carries a
 * description, and the bearer scheme is named so `@ApiBearerAuth()` binds.
 */
export const buildSwaggerDocument = (app: INestApplication, config: DeeviConfig) => {
  const builder = new DocumentBuilder()
    .setTitle('Deevi API')
    .setDescription(
      [
        'Deevi is a two-sided marketplace for local services in Nigeria.',
        '',
        '## The marketplace loop',
        '1. A customer posts a job with its own service location.',
        '2. Relevant, approved artisans see it in their ranked feed.',
        '3. Artisans apply with a price, duration and availability.',
        '4. The customer reviews applications, messages artisans and shortlists.',
        '5. The customer selects one artisan; an engagement (`Job`) is created.',
        '6. The artisan accepts, works, and both sides move it to completion.',
        '7. The customer reviews the artisan.',
        '',
        'A secondary flow lets a customer ask Deevi to recommend reliable artisans directly.',
        '',
        '## Conventions',
        '- Authenticate with `Authorization: Bearer <accessToken>` from `/auth/login`.',
        '- List endpoints return `{ items, meta }` and are always paginated (`page`, `limit`, max 100).',
        '- Errors always return `{ statusCode, code, message, path, timestamp, requestId }`.',
        '  Branch on `code`, never on `message`.',
        '- All timestamps are ISO 8601 UTC. All money is minor-unit-free decimal in `currency` (NGN by default).',
        '',
        '## Payments',
        'Deevi does not process payment for jobs in this MVP: customers and artisans settle directly.',
        'The only money flow modelled here is the artisan premium subscription.',
      ].join('\n'),
    )
    .setVersion('1.0.0')
    .addBearerAuth(
      { type: 'http', scheme: 'bearer', bearerFormat: 'JWT', in: 'header' },
      'bearer',
    )
    .addServer(`http://localhost:${config.port}`, 'Local development')
    .addTag('Health', 'Liveness, readiness and integration status')
    .addTag('Authentication', 'Signup, login, Google OAuth, password management')
    .addTag('Users', 'The authenticated user account and profile')
    .addTag('Customers', 'Customer profile and saved locations')
    .addTag('Artisans', 'Artisan onboarding, services, service areas, portfolio, verification')
    .addTag('Catalogue', 'Public service categories, services and sub-services')
    .addTag('Jobs', 'Customer job posts and the job lifecycle')
    .addTag('Job Feed', 'The ranked, relevance-ordered job feed for artisans')
    .addTag('Applications', 'Artisan bids and customer selection')
    .addTag('Matching', 'Deevi-recommended artisans for a customer')
    .addTag('Messaging', 'Job-scoped conversations and messages')
    .addTag('Reviews', 'Post-completion reviews')
    .addTag('Reports', 'Reports and disputes raised by either side')
    .addTag('Notifications', 'In-app notifications and delivery preferences')
    .addTag('Subscriptions', 'Artisan premium plans and subscriptions')
    .addTag('Boosts', 'Paid visibility primitives (reserved)')
    .addTag('Storage', 'Signed upload URLs for images, video and documents')
    .addTag('Webhooks', 'Inbound provider webhooks')
    .addTag('Admin', 'Operations, verification, moderation and metrics');

  return SwaggerModule.createDocument(app, builder.build(), {
    operationIdFactory: (controllerKey, methodKey) =>
      `${controllerKey.replace(/Controller$/, '')}_${methodKey}`,
  });
};
