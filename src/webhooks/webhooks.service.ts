import { Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { QueueService } from '../queue/queue.service.js';
import { JobName } from '../queue/queue.types.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { OnModuleInit } from '@nestjs/common';

export interface WebhookIngestResult {
  received: boolean;
  eventId: string | null;
  duplicate: boolean;
  signatureValid: boolean;
}

/**
 * Generic inbound webhook pipeline, provider-agnostic by design.
 *
 * The contract every provider gets:
 *  1. verify the signature over the RAW body before parsing anything
 *  2. persist the event first, so nothing is lost if processing crashes
 *  3. de-duplicate on (provider, event_id) via a unique index -- providers
 *     retry aggressively and at-least-once delivery is the norm
 *  4. acknowledge with 200 immediately and process asynchronously, because a
 *     slow handler causes the provider to retry and amplify load
 *  5. retry failures with backoff, capped, then park the event for inspection
 */
@Injectable()
export class WebhooksService implements OnModuleInit {
  private readonly logger = new Logger(WebhooksService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly queue: QueueService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  onModuleInit() {
    this.queue.register(JobName.PROCESS_WEBHOOK, (payload: any) => this.process(payload.webhookEventId));
  }

  async ingest(
    provider: string,
    rawBody: string,
    signature: string | undefined,
    headers: Record<string, unknown>,
    payload: any,
  ): Promise<WebhookIngestResult> {
    const verification = provider === 'payments'
      ? this.subscriptions.provider.verifyWebhook(rawBody, signature, payload)
      : { valid: false, eventId: null, eventType: null, reason: `Unknown provider "${provider}"` };

    const providerName = provider === 'payments' ? this.subscriptions.providerName : provider;

    // Rejected events are still stored: a stream of bad signatures is a
    // security signal worth being able to see.
    const { data, error } = await this.db
      .from('webhook_events')
      .insert({
        provider: providerName,
        event_id: verification.eventId,
        event_type: verification.eventType,
        payload,
        headers: this.safeHeaders(headers),
        signature: signature ?? null,
        signature_valid: verification.valid,
        status: verification.valid ? 'RECEIVED' : 'REJECTED',
        error: verification.valid ? null : verification.reason ?? 'Invalid signature',
      })
      .select('id')
      .maybeSingle();

    if (error) {
      if (error.code === '23505') {
        this.logger.log(`Duplicate webhook ${providerName}/${verification.eventId} ignored`);
        return { received: true, eventId: verification.eventId, duplicate: true, signatureValid: verification.valid };
      }
      throw error;
    }

    if (!verification.valid) {
      this.logger.warn(`Rejected ${providerName} webhook: ${verification.reason}`);
      return { received: true, eventId: verification.eventId, duplicate: false, signatureValid: false };
    }

    await this.queue.enqueue(
      JobName.PROCESS_WEBHOOK,
      { webhookEventId: data!.id },
      { maxAttempts: 5, dedupeKey: `webhook:${data!.id}` },
    );

    return { received: true, eventId: verification.eventId, duplicate: false, signatureValid: true };
  }

  /** Idempotent: a re-run of an already-processed event is a no-op. */
  async process(webhookEventId: string): Promise<void> {
    const event = await this.db.maybeOne<any>(
      'webhook_events', 'id, provider, event_type, payload, status, attempts', { id: webhookEventId },
    );
    if (!event) return;
    if (event.status === 'PROCESSED') return;

    await this.db.from('webhook_events')
      .update({ status: 'PROCESSING', attempts: (event.attempts ?? 0) + 1 })
      .eq('id', webhookEventId);

    try {
      await this.handlePaymentEvent(event.event_type, event.payload);
      await this.db.from('webhook_events')
        .update({ status: 'PROCESSED', processed_at: new Date().toISOString(), error: null })
        .eq('id', webhookEventId);
    } catch (err) {
      const message = (err as Error).message;
      await this.db.from('webhook_events')
        .update({ status: 'FAILED', error: message.slice(0, 1000) })
        .eq('id', webhookEventId);
      // Rethrow so the queue applies its backoff and retry budget.
      throw err;
    }
  }

  private async handlePaymentEvent(eventType: string | null, payload: any): Promise<void> {
    const reference = payload?.data?.reference ?? payload?.reference;
    if (!reference) {
      this.logger.warn(`Payment webhook ${eventType} carried no reference; ignoring`);
      return;
    }

    switch (eventType) {
      case 'charge.success':
      case 'subscription.create':
      case 'invoice.payment_succeeded':
      case 'payment.succeeded':
        await this.subscriptions.activateByReference(
          reference, payload?.data?.subscription_code ?? payload?.data?.subscription ?? undefined,
        );
        break;

      case 'charge.failed':
      case 'invoice.payment_failed':
      case 'payment.failed':
        await this.subscriptions.markPaymentFailed(reference, payload?.data?.gateway_response);
        break;

      case 'subscription.disable':
      case 'subscription.not_renew':
        this.logger.log(`Subscription cancellation event for ${reference}`);
        break;

      default:
        this.logger.log(`Unhandled payment event "${eventType}"; stored for audit`);
    }
  }

  /** Never persist authorization headers verbatim. */
  private safeHeaders(headers: Record<string, unknown>): Record<string, unknown> {
    const redacted = ['authorization', 'cookie', 'x-api-key'];
    return Object.fromEntries(
      Object.entries(headers)
        .filter(([key]) => !redacted.includes(key.toLowerCase()))
        .slice(0, 40),
    );
  }

  async listEvents(page: number, limit: number, status?: string, provider?: string) {
    let builder = this.db
      .select('webhook_events',
        'id, provider, event_id, event_type, status, signature_valid, attempts, error, processed_at, created_at')
      .order('created_at', { ascending: false });

    if (status) builder = builder.eq('status', status);
    if (provider) builder = builder.eq('provider', provider);

    return this.db.paginate(builder, page, limit, 'webhooks:list');
  }

  /** Manual replay, for an event that failed for a reason since fixed. */
  async replay(webhookEventId: string) {
    const event = await this.db.one<any>('webhook_events', 'id, status', { id: webhookEventId }, 'Webhook event');
    await this.db.from('webhook_events').update({ status: 'RECEIVED', error: null }).eq('id', event.id);
    await this.queue.enqueue(JobName.PROCESS_WEBHOOK, { webhookEventId: event.id }, { maxAttempts: 3 });
    return { message: 'Webhook queued for reprocessing' };
  }
}
