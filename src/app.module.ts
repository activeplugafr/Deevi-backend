import { Module } from '@nestjs/common';
import { ConfigModule } from '@nestjs/config';
import { createObserveModule } from '@nestjs/observe';

import { CONFIG_TOKEN, loadConfiguration } from './config/configuration.js';
import { SupabaseModule } from './supabase/supabase.module.js';
import { CacheModule } from './cache/cache.module.js';
import { QueueModule } from './queue/queue.module.js';
import { AuditModule } from './audit/audit.module.js';
import { StorageModule } from './storage/storage.module.js';
import { NotificationsModule } from './notifications/notifications.module.js';
import { AuthModule } from './auth/auth.module.js';
import { HealthModule } from './health/health.module.js';
import { CatalogueModule } from './catalogue/catalogue.module.js';
import { UsersModule } from './users/users.module.js';
import { CustomersModule } from './customers/customers.module.js';
import { ArtisansModule } from './artisans/artisans.module.js';
import { JobsModule } from './jobs/jobs.module.js';
import { FeedModule } from './feed/feed.module.js';
import { ApplicationsModule } from './applications/applications.module.js';
import { MatchingModule } from './matching/matching.module.js';
import { MessagingModule } from './messaging/messaging.module.js';
import { ReviewsModule } from './reviews/reviews.module.js';
import { ReportsModule } from './reports/reports.module.js';
import { SubscriptionsModule } from './subscriptions/subscriptions.module.js';
import { BoostsModule } from './boosts/boosts.module.js';
import { WebhooksModule } from './webhooks/webhooks.module.js';
import { AdminModule } from './admin/admin.module.js';
import { RateLimitGuard } from './common/guards/rate-limit.guard.js';

export const { ObserveModule, ObserveInstrument } = createObserveModule();

/**
 * Infrastructure modules are @Global so domain modules stay focused on their
 * own concern instead of re-importing plumbing everywhere.
 */
@Module({
  imports: [
    ConfigModule.forRoot({ isGlobal: true, cache: true }),

    // Distributed tracing, auto-correlated logs, request/job metrics, error
    // telemetry, alarms, and more. Sign up at https://observe.nestjs.com
    ObserveModule.forRoot({
      appKey: process.env.OBSERVE_APP_KEY ?? 'YOUR_APP_KEY',
      appSecret: process.env.OBSERVE_APP_SECRET ?? 'YOUR_APP_SECRET',
      serviceId: 'deevi-backend',
    }),

    SupabaseModule,
    CacheModule,
    QueueModule,
    AuditModule,
    StorageModule,
    NotificationsModule,
    AuthModule,
    HealthModule,

    // Domain modules, in marketplace-loop order.
    CatalogueModule,
    UsersModule,
    CustomersModule,
    ArtisansModule,
    SubscriptionsModule,
    JobsModule,
    FeedModule,
    ApplicationsModule,
    MatchingModule,
    MessagingModule,
    ReviewsModule,
    ReportsModule,
    BoostsModule,
    WebhooksModule,
    AdminModule,
  ],
  providers: [
    RateLimitGuard,
    { provide: CONFIG_TOKEN, useFactory: loadConfiguration },
  ],
})
export class AppModule {}
