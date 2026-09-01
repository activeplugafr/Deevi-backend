export interface EmailMessage {
  to: string;
  subject: string;
  body: string;
  html?: string;
  templateId?: string;
  data?: Record<string, unknown>;
}

export interface PushMessage {
  tokens: string[];
  title: string;
  body: string;
  data?: Record<string, unknown>;
}

export interface DeliveryResult {
  delivered: boolean;
  provider: string;
  providerMessageId?: string;
  error?: string;
  /** True when the send was simulated rather than actually transmitted. */
  mocked: boolean;
}

export interface EmailProvider {
  readonly name: string;
  readonly isMock: boolean;
  send(message: EmailMessage): Promise<DeliveryResult>;
}

export interface PushProvider {
  readonly name: string;
  readonly isMock: boolean;
  send(message: PushMessage): Promise<DeliveryResult>;
}

export const EMAIL_PROVIDER = Symbol('EMAIL_PROVIDER');
export const PUSH_PROVIDER = Symbol('PUSH_PROVIDER');
