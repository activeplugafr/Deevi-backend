import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { QueueService } from './queue.service.js';
import { JobName } from './queue.types.js';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys } from '../cache/cache-keys.js';

/** Recurring housekeeping that keeps marketplace state honest over time. */
@Injectable()
export class MaintenanceHandlers implements OnModuleInit {
  private readonly logger = new Logger(MaintenanceHandlers.name);

  constructor(
    private readonly queue: QueueService,
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  onModuleInit() {
    this.queue.register(JobName.EXPIRE_JOB_POSTS, async () => {
      const expired = await this.db.rpc<number>('deevi_expire_stale_job_posts');
      if (expired) this.logger.log(`Expired ${expired} stale job post(s)`);
    });

    this.queue.register(JobName.EXPIRE_SUBSCRIPTIONS, async () => {
      const result = await this.db.rpc<Record<string, number>>('deevi_expire_subscriptions_and_boosts');
      this.logger.log(`Subscription/boost sweep: ${JSON.stringify(result)}`);
    });

    this.queue.register(JobName.RECALCULATE_METRICS, async () => {
      await this.cache.del(CacheKeys.adminMetrics());
    });
  }
}
