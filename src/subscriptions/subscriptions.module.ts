import { Global, Logger, Module } from '@nestjs/common';
import { SubscriptionsController } from './subscriptions.controller.js';
import { SubscriptionsService } from './subscriptions.service.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.interface.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import { PaystackProvider } from './providers/paystack.provider.js';
import { loadConfiguration } from '../config/configuration.js';

const paymentProviderFactory = (): PaymentProvider => {
  const config = loadConfiguration();
  const logger = new Logger('SubscriptionsModule');

  if (config.payments.provider === 'paystack' && config.payments.configured) {
    logger.log('Payment provider: Paystack');
    return new PaystackProvider(config.payments.secretKey, config.payments.webhookSecret);
  }

  logger.warn('Payment provider: MOCK. Subscriptions activate without a real charge.');
  return new MockPaymentProvider();
};

@Global()
@Module({
  controllers: [SubscriptionsController],
  providers: [
    SubscriptionsService,
    { provide: PAYMENT_PROVIDER, useFactory: paymentProviderFactory },
  ],
  exports: [SubscriptionsService, PAYMENT_PROVIDER],
})
export class SubscriptionsModule {}
