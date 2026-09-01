import { Logger } from '@nestjs/common';
import { createHmac, randomUUID, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutRequest, CheckoutSession, PaymentProvider,
  ProviderSubscriptionState, WebhookVerification,
} from './payment-provider.interface.js';

/**
 * Development payment adapter.
 *
 * It issues a checkout reference and a URL pointing back at Deevi's own mock
 * confirmation endpoint, so the entire subscription lifecycle -- checkout,
 * webhook, activation, cancellation -- is exercisable before any PSP account
 * exists. It never claims money moved: `mocked` is true throughout, and the
 * subscription record records provider = MOCK.
 */
export class MockPaymentProvider implements PaymentProvider {
  readonly name = 'MOCK';
  readonly isMock = true;
  private readonly logger = new Logger('MockPayments');
  private readonly secret = process.env.PAYMENT_WEBHOOK_SECRET ?? 'deevi-mock-webhook-secret';

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    this.logger.log(
      `[MOCK CHECKOUT] ${request.planCode} ${request.currency} ${request.amount} for ${request.customerEmail}`,
    );
    return {
      provider: this.name,
      reference: request.reference,
      authorizationUrl: `/api/v1/subscriptions/mock-checkout?reference=${request.reference}`,
      providerCustomerId: `mock_cus_${randomUUID().slice(0, 12)}`,
      providerSubscriptionId: `mock_sub_${randomUUID().slice(0, 12)}`,
      mocked: true,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState> {
    this.logger.log(`[MOCK CANCEL] ${providerSubscriptionId}`);
    return {
      status: 'CANCELLED',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      providerSubscriptionId,
    };
  }

  /**
   * Signature checking is real even in mock mode, so the webhook path is
   * genuinely tested rather than waved through.
   */
  verifyWebhook(rawBody: string, signature: string | undefined, payload: any): WebhookVerification {
    const expected = createHmac('sha512', this.secret).update(rawBody).digest('hex');

    let valid = false;
    if (signature) {
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      valid = a.length === b.length && timingSafeEqual(a, b);
    }

    return {
      valid,
      eventId: payload?.id ?? payload?.data?.reference ?? null,
      eventType: payload?.event ?? payload?.type ?? null,
      reason: valid ? undefined : 'Signature missing or does not match',
    };
  }
}
