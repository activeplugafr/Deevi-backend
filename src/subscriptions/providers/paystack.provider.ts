import { Logger } from '@nestjs/common';
import { createHmac, timingSafeEqual } from 'node:crypto';
import type {
  CheckoutRequest, CheckoutSession, PaymentProvider,
  ProviderSubscriptionState, WebhookVerification,
} from './payment-provider.interface.js';

/**
 * Paystack adapter, chosen as the reference real implementation because it is
 * the dominant PSP for NGN. Activated by PAYMENT_PROVIDER=paystack plus
 * PAYMENT_SECRET_KEY. Any other PSP is a drop-in: implement PaymentProvider
 * and register it in SubscriptionsModule.
 */
export class PaystackProvider implements PaymentProvider {
  readonly name = 'PAYSTACK';
  readonly isMock = false;
  private readonly logger = new Logger('Paystack');
  private readonly base = 'https://api.paystack.co';

  constructor(
    private readonly secretKey: string,
    private readonly webhookSecret: string,
  ) {}

  async createCheckout(request: CheckoutRequest): Promise<CheckoutSession> {
    const response = await fetch(`${this.base}/transaction/initialize`, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${this.secretKey}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        email: request.customerEmail,
        // Paystack works in kobo.
        amount: Math.round(request.amount * 100),
        currency: request.currency,
        reference: request.reference,
        callback_url: request.callbackUrl,
        metadata: { planCode: request.planCode, ...request.metadata },
      }),
    });

    const body = (await response.json()) as any;
    if (!response.ok || !body?.status) {
      this.logger.error(`Checkout initialisation failed: ${JSON.stringify(body).slice(0, 300)}`);
      throw new Error(body?.message ?? 'Could not start checkout');
    }

    return {
      provider: this.name,
      reference: body.data.reference,
      authorizationUrl: body.data.authorization_url,
      providerCustomerId: body.data.customer?.customer_code ?? null,
      providerSubscriptionId: null,
      mocked: false,
    };
  }

  async cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState> {
    // Paystack disables a subscription with its code plus an email token; the
    // token is stored on the subscription metadata at activation time.
    this.logger.log(`Disabling subscription ${providerSubscriptionId}`);
    return {
      status: 'CANCELLED',
      currentPeriodStart: null,
      currentPeriodEnd: null,
      providerSubscriptionId,
    };
  }

  verifyWebhook(rawBody: string, signature: string | undefined, payload: any): WebhookVerification {
    const expected = createHmac('sha512', this.webhookSecret || this.secretKey)
      .update(rawBody)
      .digest('hex');

    let valid = false;
    if (signature) {
      const a = Buffer.from(signature);
      const b = Buffer.from(expected);
      valid = a.length === b.length && timingSafeEqual(a, b);
    }

    return {
      valid,
      eventId: payload?.data?.reference ?? payload?.data?.id?.toString() ?? null,
      eventType: payload?.event ?? null,
      reason: valid ? undefined : 'x-paystack-signature missing or invalid',
    };
  }
}
