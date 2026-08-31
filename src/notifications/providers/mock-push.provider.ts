import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DeliveryResult, PushMessage, PushProvider } from './notification-provider.interface.js';

/** Development push adapter. In-app notifications remain fully functional. */
export class MockPushProvider implements PushProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly logger = new Logger('MockPush');

  async send(message: PushMessage): Promise<DeliveryResult> {
    if (!message.tokens.length) {
      return { delivered: false, provider: this.name, error: 'No device tokens registered', mocked: true };
    }
    this.logger.log(`[MOCK PUSH] devices=${message.tokens.length} title="${message.title}"`);
    return {
      delivered: true,
      provider: this.name,
      providerMessageId: `mock-${randomUUID()}`,
      mocked: true,
    };
  }
}
