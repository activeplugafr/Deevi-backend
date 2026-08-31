import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { loadConfiguration } from '../config/configuration.js';
import type { BackgroundJob, EnqueueOptions, JobHandler } from './queue.types.js';

/**
 * Background work abstraction.
 *
 * The default adapter is the `background_jobs` table plus SELECT ... FOR
 * UPDATE SKIP LOCKED, which gives durable, multi-worker-safe queuing with no
 * extra infrastructure -- important because Deevi must run end to end before
 * anyone provisions Redis or SQS. Swapping in a broker later means
 * reimplementing `enqueue`/`claim` only; producers never change.
 */
@Injectable()
export class QueueService {
  private readonly logger = new Logger(QueueService.name);
  private readonly config = loadConfiguration();
  private readonly handlers = new Map<string, JobHandler>();

  constructor(private readonly db: DatabaseService) {}

  register(name: string, handler: JobHandler): void {
    if (this.handlers.has(name)) {
      this.logger.warn(`Handler for "${name}" was replaced`);
    }
    this.handlers.set(name, handler);
  }

  getHandler(name: string): JobHandler | undefined {
    return this.handlers.get(name);
  }

  get registeredJobNames(): string[] {
    return [...this.handlers.keys()];
  }

  async enqueue(
    name: string,
    payload: Record<string, unknown> = {},
    options: EnqueueOptions = {},
  ): Promise<string | null> {
    const runAt = new Date(Date.now() + (options.delaySeconds ?? 0) * 1000).toISOString();

    const { data, error } = await this.db
      .from('background_jobs')
      .insert({
        queue: options.queue ?? 'default',
        name,
        payload,
        priority: options.priority ?? 0,
        max_attempts: options.maxAttempts ?? 3,
        run_at: runAt,
        dedupe_key: options.dedupeKey ?? null,
      })
      .select('id')
      .maybeSingle();

    // A unique violation here means an identical job is already queued.
    if (error) {
      if (error.code === '23505') {
        this.logger.debug(`Deduplicated job ${name} (${options.dedupeKey})`);
        return null;
      }
      // Async work must never break the request that scheduled it.
      this.logger.error(`Failed to enqueue ${name}: ${error.message}`);
      return null;
    }

    return data?.id ?? null;
  }

  /** Claims a batch of jobs for this worker. */
  async claim(queue = 'default', limit = 5, worker = 'api'): Promise<BackgroundJob[]> {
    const rows = await this.db.rpc<any[]>('deevi_dequeue_background_jobs', {
      p_queue: queue,
      p_limit: limit,
      p_worker: worker,
    });

    return (rows ?? []).map((row) => ({
      id: row.id,
      queue: row.queue,
      name: row.name,
      payload: row.payload ?? {},
      attempts: row.attempts,
      maxAttempts: row.max_attempts,
    }));
  }

  async complete(jobId: string): Promise<void> {
    await this.db.from('background_jobs')
      .update({ status: 'COMPLETED', completed_at: new Date().toISOString(), locked_at: null })
      .eq('id', jobId);
  }

  /** Exponential backoff, then the dead-letter state for inspection. */
  async fail(job: BackgroundJob, error: Error): Promise<void> {
    const exhausted = job.attempts >= job.maxAttempts;
    const backoffSeconds = Math.min(2 ** job.attempts * 30, 3600);

    await this.db.from('background_jobs')
      .update({
        status: exhausted ? 'DEAD' : 'PENDING',
        last_error: error.message.slice(0, 1000),
        locked_at: null,
        locked_by: null,
        run_at: exhausted ? undefined : new Date(Date.now() + backoffSeconds * 1000).toISOString(),
      })
      .eq('id', job.id);

    if (exhausted) {
      this.logger.error(`Job ${job.name} (${job.id}) is dead after ${job.attempts} attempts: ${error.message}`);
    } else {
      this.logger.warn(`Job ${job.name} (${job.id}) failed, retrying in ${backoffSeconds}s: ${error.message}`);
    }
  }

  /** Frees jobs whose worker died mid-flight. */
  async requeueStuckJobs(olderThanMinutes = 15): Promise<number> {
    const cutoff = new Date(Date.now() - olderThanMinutes * 60_000).toISOString();
    const { data, error } = await this.db
      .from('background_jobs')
      .update({ status: 'PENDING', locked_at: null, locked_by: null })
      .eq('status', 'PROCESSING')
      .lt('locked_at', cutoff)
      .select('id');
    if (error) {
      this.logger.warn(`Could not requeue stuck jobs: ${error.message}`);
      return 0;
    }
    return data?.length ?? 0;
  }

  async stats(): Promise<Record<string, number>> {
    const statuses = ['PENDING', 'PROCESSING', 'COMPLETED', 'FAILED', 'DEAD'];
    const counts = await Promise.all(
      statuses.map((status) => this.db.count('background_jobs', { status })),
    );
    return Object.fromEntries(statuses.map((s, i) => [s.toLowerCase(), counts[i]]));
  }

  get workerEnabled(): boolean {
    return this.config.queue.workerEnabled;
  }
}
