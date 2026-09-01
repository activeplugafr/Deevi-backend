import { Global, Module } from '@nestjs/common';
import { NotificationsController } from './notifications.controller.js';
import { NotificationsReadService, NotificationsService } from './notifications.service.js';
import {
  EMAIL_PROVIDER, PUSH_PROVIDER,
  type EmailProvider, type PushProvider,
} from './providers/notification-provider.interface.js';
import { MockEmailProvider } from './providers/mock-email.provider.js';
import { MockPushProvider } from './providers/mock-push.provider.js';
import { ResendEmailProvider } from './providers/resend-email.provider.js';
import { loadConfiguration } from '../config/configuration.js';

/**
 * Provider selection happens once, here. Missing credentials pick the mock
 * adapter rather than crashing the app -- the whole marketplace has to work
 * before anyone opens an account with an email vendor.
 */
const emailProviderFactory = (): EmailProvider => {
  const config = loadConfiguration();
  if (config.email.provider === 'resend' && config.email.configured) {
    return new ResendEmailProvider(config.email.apiKey, config.email.from);
  }
  return new MockEmailProvider();
};

const pushProviderFactory = (): PushProvider => new MockPushProvider();

@Global()
@Module({
  controllers: [NotificationsController],
  providers: [
    NotificationsService,
    NotificationsReadService,
    { provide: EMAIL_PROVIDER, useFactory: emailProviderFactory },
    { provide: PUSH_PROVIDER, useFactory: pushProviderFactory },
  ],
  exports: [NotificationsService, NotificationsReadService, EMAIL_PROVIDER, PUSH_PROVIDER],
})
export class NotificationsModule {}
