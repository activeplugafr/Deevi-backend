import { Injectable, Logger, OnApplicationBootstrap, OnModuleDestroy } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { QueueService } from './queue.service.js';
import { JobName } from './queue.types.js';
import { loadConfiguration } from '../config/configuration.js';

/**
 * In-process worker. Fine for MVP scale; when throughput demands it, run this
 * same class in a separate process with QUEUE_WORKER_ENABLED=false on the API
 * instances. Nothing else has to change.
 */
@Injectable()
export class QueueWorker implements OnApplicationBootstrap, OnModuleDestroy {
  private readonly logger = new Logger(QueueWorker.name);
  private readonly config = loadConfiguration();
  private readonly workerId = `worker-${randomUUID().slice(0, 8)}`;
  private timer?: NodeJS.Timeout;
  private maintenanceTimer?: NodeJS.Timeout;
  private running = false;
  private stopped = false;

  constructor(private readonly queue: QueueService) {}

  onApplicationBootstrap() {
    if (!this.queue.workerEnabled) {
      this.logger.log('Background worker disabled (QUEUE_WORKER_ENABLED=false)');
      return;
    }

    this.timer = setInterval(() => void this.tick(), this.config.queue.pollIntervalMs);
    this.timer.unref?.();

    // Housekeeping: recover abandoned jobs and schedule recurring maintenance.
    this.maintenanceTimer = setInterval(() => void this.maintenance(), 5 * 60_000);
    this.maintenanceTimer.unref?.();

    this.logger.log(
      `Background worker ${this.workerId} started (poll ${this.config.queue.pollIntervalMs}ms, ` +
      `concurrency ${this.config.queue.concurrency})`,
    );
  }

  onModuleDestroy() {
    this.stopped = true;
    if (this.timer) clearInterval(this.timer);
    if (this.maintenanceTimer) clearInterval(this.maintenanceTimer);
  }

  /** Exposed for tests and for an admin-triggered drain. */
  async tick(): Promise<number> {
    if (this.running || this.stopped) return 0;
    this.running = true;

    try {
      const jobs = await this.queue.claim('default', this.config.queue.concurrency, this.workerId);
      if (!jobs.length) return 0;

      await Promise.all(jobs.map(async (job) => {
        const handler = this.queue.getHandler(job.name);
        if (!handler) {
          await this.queue.fail(job, new Error(`No handler registered for "${job.name}"`));
          return;
        }
        try {
          await handler(job.payload, job);
          await this.queue.complete(job.id);
        } catch (err) {
          await this.queue.fail(job, err as Error);
        }
      }));

      return jobs.length;
    } catch (err) {
      this.logger.error(`Worker tick failed: ${(err as Error).message}`);
      return 0;
    } finally {
      this.running = false;
    }
  }

  private async maintenance(): Promise<void> {
    try {
      const requeued = await this.queue.requeueStuckJobs();
      if (requeued) this.logger.warn(`Requeued ${requeued} stuck job(s)`);

      await this.queue.enqueue(JobName.EXPIRE_JOB_POSTS, {}, {
        dedupeKey: 'maintenance:expire-job-posts',
      });
      await this.queue.enqueue(JobName.EXPIRE_SUBSCRIPTIONS, {}, {
        dedupeKey: 'maintenance:expire-subscriptions',
      });
    } catch (err) {
      this.logger.error(`Maintenance sweep failed: ${(err as Error).message}`);
    }
  }
}
