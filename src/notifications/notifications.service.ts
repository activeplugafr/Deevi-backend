import { Inject, Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { JobName } from '../queue/queue.types.js';
import { channelsFor } from './notification-types.js';
import { renderNotification, type TemplateInput } from './notification-templates.js';
import {
  EMAIL_PROVIDER, PUSH_PROVIDER,
  type EmailProvider, type PushProvider,
} from './providers/notification-provider.interface.js';
import { type Paginated } from '../common/dto/pagination.dto.js';
import { NotFoundError } from '../common/errors/domain.exception.js';

export interface NotifyInput {
  userId: string;
  type: string;
  entityType?: string;
  entityId?: string;
  data?: Record<string, unknown>;
  template?: TemplateInput;
  priority?: 'LOW' | 'NORMAL' | 'HIGH';
  /** Overrides the type's default channel policy. */
  channels?: Partial<{ inApp: boolean; email: boolean; push: boolean }>;
}

const NOTIFICATION_COLUMNS =
  'id, type, title, body, data, entity_type, entity_id, priority, read_at, created_at';

/**
 * In-app notifications are written synchronously (they are the user-visible
 * record); email and push are handed to the queue so a slow or broken
 * provider can never slow down or fail the request that triggered it.
 */
@Injectable()
export class NotificationsService implements OnModuleInit {
  private readonly logger = new Logger(NotificationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    @Inject(EMAIL_PROVIDER) private readonly email: EmailProvider,
    @Inject(PUSH_PROVIDER) private readonly push: PushProvider,
  ) {}

  onModuleInit() {
    this.queue.register(JobName.SEND_EMAIL, (payload: any) => this.deliverEmail(payload));
    this.queue.register(JobName.SEND_PUSH, (payload: any) => this.deliverPush(payload));
    this.queue.register(JobName.REVIEW_REMINDER, (payload: any) => this.sendReviewReminder(payload));

    if (this.email.isMock) {
      this.logger.warn('EMAIL provider is MOCK: messages are logged and recorded, not sent.');
    }
    if (this.push.isMock) {
      this.logger.warn('PUSH provider is MOCK: in-app notifications remain fully functional.');
    }
  }

  /** Fire-and-forget: notification failures never break a domain action. */
  async notify(input: NotifyInput): Promise<void> {
    try {
      await this.dispatch(input);
    } catch (err) {
      this.logger.error(`Failed to notify user ${input.userId} (${input.type}): ${(err as Error).message}`);
    }
  }

  async notifyMany(inputs: NotifyInput[]): Promise<void> {
    await Promise.all(inputs.map((input) => this.notify(input)));
  }

  private async dispatch(input: NotifyInput): Promise<void> {
    const rendered = renderNotification(input.type, input.template ?? {});
    const policy = { ...channelsFor(input.type), ...input.channels };

    const prefs = await this.db.maybeOne<any>(
      'notification_preferences',
      'in_app_enabled, email_enabled, push_enabled, muted_types, push_tokens',
      { user_id: input.userId },
    );

    const muted: string[] = prefs?.muted_types ?? [];
    if (muted.includes(input.type)) return;

    const notification = await this.db.insertOne<{ id: string }>('notifications', {
      user_id: input.userId,
      type: input.type,
      title: rendered.title,
      body: rendered.body,
      data: input.data ?? {},
      entity_type: input.entityType ?? null,
      entity_id: input.entityId ?? null,
      priority: input.priority ?? 'NORMAL',
    }, 'id');

    if (policy.email && (prefs?.email_enabled ?? true)) {
      const user = await this.db.maybeOne<{ email: string | null }>('users', 'email', { id: input.userId });
      if (user?.email) {
        await this.queue.enqueue(JobName.SEND_EMAIL, {
          notificationId: notification.id,
          userId: input.userId,
          to: user.email,
          subject: rendered.emailSubject,
          body: rendered.emailBody,
        });
      }
    }

    if (policy.push && (prefs?.push_enabled ?? true)) {
      const tokens: string[] = prefs?.push_tokens ?? [];
      if (tokens.length) {
        await this.queue.enqueue(JobName.SEND_PUSH, {
          notificationId: notification.id,
          userId: input.userId,
          tokens,
          title: rendered.title,
          body: rendered.body,
          data: { type: input.type, entityId: input.entityId ?? null },
        });
      }
    }
  }

  private async deliverEmail(payload: any): Promise<void> {
    const result = await this.email.send({
      to: payload.to,
      subject: payload.subject,
      body: payload.body,
    });

    await this.db.from('notification_deliveries').insert({
      notification_id: payload.notificationId ?? null,
      user_id: payload.userId ?? null,
      channel: 'EMAIL',
      provider: result.provider,
      destination: payload.to,
      subject: payload.subject,
      payload: { mocked: result.mocked, providerMessageId: result.providerMessageId ?? null },
      status: result.delivered ? 'SENT' : 'FAILED',
      error: result.error ?? null,
      attempts: 1,
      sent_at: result.delivered ? new Date().toISOString() : null,
    });

    if (!result.delivered) throw new Error(result.error ?? 'Email delivery failed');
  }

  private async deliverPush(payload: any): Promise<void> {
    const result = await this.push.send({
      tokens: payload.tokens ?? [],
      title: payload.title,
      body: payload.body,
      data: payload.data,
    });

    await this.db.from('notification_deliveries').insert({
      notification_id: payload.notificationId ?? null,
      user_id: payload.userId ?? null,
      channel: 'PUSH',
      provider: result.provider,
      payload: { mocked: result.mocked, tokens: (payload.tokens ?? []).length },
      status: result.delivered ? 'SENT' : 'FAILED',
      error: result.error ?? null,
      attempts: 1,
      sent_at: result.delivered ? new Date().toISOString() : null,
    });
  }

  private async sendReviewReminder(payload: any): Promise<void> {
    const job = await this.db.maybeOne<any>(
      'jobs', 'id, customer_id, job_post_id, status', { id: payload.jobId },
    );
    if (!job || job.status !== 'COMPLETED') return;

    const existing = await this.db.count('reviews', {
      job_id: job.id, reviewer_id: job.customer_id,
    });
    if (existing > 0) return;

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    await this.notify({
      userId: job.customer_id,
      type: 'REVIEW_REMINDER',
      entityType: 'JOB',
      entityId: job.id,
      template: { jobTitle: post?.title },
      data: { jobId: job.id },
    });
  }
}

/* ------------------------------------------------------------------ */
/* Read-side API used by the notifications controller                  */
/* ------------------------------------------------------------------ */

export interface ListNotificationsOptions {
  page: number;
  limit: number;
  unreadOnly?: boolean;
  type?: string;
}

@Injectable()
export class NotificationsReadService {
  constructor(private readonly db: DatabaseService) {}

  async list(userId: string, options: ListNotificationsOptions): Promise<Paginated<any>> {
    let query = this.db
      .select('notifications', NOTIFICATION_COLUMNS)
      .eq('user_id', userId)
      .is('archived_at', null)
      .order('created_at', { ascending: false });

    if (options.unreadOnly) query = query.is('read_at', null);
    if (options.type) query = query.eq('type', options.type);

    return this.db.paginate(query, options.page, options.limit, 'notifications:list');
  }

  async unreadCount(userId: string): Promise<number> {
    const { count, error } = await this.db
      .from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null)
      .is('archived_at', null);
    if (error) throw error;
    return count ?? 0;
  }

  async markRead(userId: string, notificationId: string): Promise<{ id: string; readAt: string }> {
    const now = new Date().toISOString();
    const row = await this.db.updateIf<any>(
      'notifications',
      { id: notificationId, user_id: userId },
      { read_at: now },
      'id, read_at',
    );
    if (!row) throw new NotFoundError('Notification');
    return { id: row.id, readAt: row.read_at };
  }

  async markAllRead(userId: string): Promise<number> {
    const { data, error } = await this.db
      .from('notifications')
      .update({ read_at: new Date().toISOString() })
      .eq('user_id', userId)
      .is('read_at', null)
      .select('id');
    if (error) throw error;
    return data?.length ?? 0;
  }

  async archive(userId: string, notificationId: string): Promise<void> {
    const row = await this.db.updateIf<any>(
      'notifications',
      { id: notificationId, user_id: userId },
      { archived_at: new Date().toISOString() },
      'id',
    );
    if (!row) throw new NotFoundError('Notification');
  }

  async getPreferences(userId: string): Promise<any> {
    const existing = await this.db.maybeOne<any>(
      'notification_preferences',
      'user_id, in_app_enabled, email_enabled, push_enabled, sms_enabled, muted_types, quiet_hours_start, quiet_hours_end, push_tokens',
      { user_id: userId },
    );
    if (existing) return existing;

    return this.db.insertOne('notification_preferences', { user_id: userId });
  }

  async updatePreferences(userId: string, values: Record<string, unknown>): Promise<any> {
    await this.getPreferences(userId);
    return this.db.updateOne(
      'notification_preferences',
      { user_id: userId },
      values,
      'user_id, in_app_enabled, email_enabled, push_enabled, sms_enabled, muted_types',
      'Notification preferences',
    );
  }

  async registerPushToken(userId: string, token: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const tokens: string[] = prefs.push_tokens ?? [];
    if (tokens.includes(token)) return;
    await this.db.from('notification_preferences')
      .update({ push_tokens: [...tokens, token].slice(-10) })
      .eq('user_id', userId);
  }

  async removePushToken(userId: string, token: string): Promise<void> {
    const prefs = await this.getPreferences(userId);
    const tokens: string[] = prefs.push_tokens ?? [];
    await this.db.from('notification_preferences')
      .update({ push_tokens: tokens.filter((t) => t !== token) })
      .eq('user_id', userId);
  }
}
