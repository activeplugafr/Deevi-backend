import { Logger } from '@nestjs/common';
import type { DeliveryResult, EmailMessage, EmailProvider } from './notification-provider.interface.js';

/**
 * Real transactional email over Resend's HTTP API (no SDK dependency).
 * Selected automatically when EMAIL_PROVIDER=resend and EMAIL_API_KEY is set.
 * Any other vendor is a drop-in: implement EmailProvider and register it in
 * NotificationsModule.
 */
export class ResendEmailProvider implements EmailProvider {
  readonly name = 'resend';
  readonly isMock = false;
  private readonly logger = new Logger('ResendEmail');

  constructor(
    private readonly apiKey: string,
    private readonly from: string,
  ) {}

  async send(message: EmailMessage): Promise<DeliveryResult> {
    try {
      const response = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          Authorization: `Bearer ${this.apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          from: this.from,
          to: [message.to],
          subject: message.subject,
          text: message.body,
          ...(message.html ? { html: message.html } : {}),
        }),
      });

      if (!response.ok) {
        const detail = await response.text();
        this.logger.error(`Resend rejected the message: ${response.status} ${detail}`);
        return { delivered: false, provider: this.name, error: `${response.status}: ${detail.slice(0, 200)}`, mocked: false };
      }

      const body = (await response.json()) as { id?: string };
      return { delivered: true, provider: this.name, providerMessageId: body.id, mocked: false };
    } catch (err) {
      const error = (err as Error).message;
      this.logger.error(`Resend request failed: ${error}`);
      return { delivered: false, provider: this.name, error, mocked: false };
    }
  }
}
