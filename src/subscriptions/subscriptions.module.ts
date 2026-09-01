import { Global, Logger, Module } from '@nestjs/common';
import { SubscriptionsService } from './subscriptions.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.interface.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PaystackProvider } from './providers/paystack.provider.js';
import { loadConfiguration } from '../config/configuration.js';

/**
 * Premium subscriptions are DORMANT for the MVP (see src/config/mvp-scope.ts).
 *
 * The service, the payment provider abstraction and the Paystack adapter all
 * remain, and the webhook pipeline still resolves against them, so the growth
 * path needs no migration. SubscriptionsController is deliberately not
 * registered: there is no reachable checkout, so no subscription can be created
 * and nothing charges anyone.
 *
 * To reactivate: import SubscriptionsController, add it to `controllers`, and
 * set PAYMENT_PROVIDER + PAYMENT_SECRET_KEY + PAYMENT_WEBHOOK_SECRET.
 */
const paymentProviderFactory = (): PaymentProvider => {
  const config = loadConfiguration();
  const logger = new Logger('SubscriptionsModule');

  if (config.payments.provider === 'paystack' && config.payments.configured) {
    logger.log('Payment provider: Paystack (subscriptions remain dormant for MVP)');
    return new PaystackProvider(config.payments.secretKey, config.payments.webhookSecret);
  }

  return new MockPaymentProvider();
};

@Global()
@Module({
  controllers: [],
  providers: [
    SubscriptionsService,
    { provide: PAYMENT_PROVIDER, useFactory: paymentProviderFactory },
  ],
  exports: [SubscriptionsService, PAYMENT_PROVIDER],
})
export class SubscriptionsModule {}
