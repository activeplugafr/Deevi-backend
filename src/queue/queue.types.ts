export interface EnqueueOptions {
  /** Logical queue name. Workers poll one queue at a time. */
  queue?: string;
  /** Delay before the job becomes eligible, in seconds. */
  delaySeconds?: number;
  /** Higher runs first. */
  priority?: number;
  maxAttempts?: number;
  /**
   * Collapses duplicates: while a job with this key is pending or
   * processing, further enqueues are ignored. Used for things like
   * "recalculate metrics" that need to happen once, not fifty times.
   */
  dedupeKey?: string;
}

export interface BackgroundJob<T = Record<string, unknown>> {
  id: string;
  queue: string;
  name: string;
  payload: T;
  attempts: number;
  maxAttempts: number;
}

export type JobHandler<T = any> = (payload: T, job: BackgroundJob<T>) => Promise<void>;

/** Job names are centralised so producers and consumers cannot drift. */
export const JobName = {
  SEND_EMAIL: 'notification.email',
  SEND_PUSH: 'notification.push',
  FANOUT_NOTIFICATION: 'notification.fanout',
  PROCESS_WEBHOOK: 'webhook.process',
  EXPIRE_JOB_POSTS: 'maintenance.expire-job-posts',
  EXPIRE_SUBSCRIPTIONS: 'maintenance.expire-subscriptions',
  REVIEW_REMINDER: 'reminder.review',
  RECALCULATE_METRICS: 'maintenance.recalculate-metrics',
} as const;
export type JobName = (typeof JobName)[keyof typeof JobName];
