import { Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import type { DeliveryResult, EmailMessage, EmailProvider } from './notification-provider.interface.js';

/**
 * Development email adapter. It does not transmit anything: it logs the
 * message and reports `mocked: true`, and the caller persists a row in
 * notification_deliveries so the send is still inspectable and testable.
 *
 * Deevi must never imply an email reached a user when it did not, hence the
 * explicit `mocked` flag rather than a silent success.
 */
export class MockEmailProvider implements EmailProvider {
  readonly name = 'mock';
  readonly isMock = true;
  private readonly logger = new Logger('MockEmail');

  async send(message: EmailMessage): Promise<DeliveryResult> {
    this.logger.log(`[MOCK EMAIL] to=${message.to} subject="${message.subject}"`);
    this.logger.debug(message.body);
    return {
      delivered: true,
      provider: this.name,
      providerMessageId: `mock-${randomUUID()}`,
      mocked: true,
    };
  }
}
