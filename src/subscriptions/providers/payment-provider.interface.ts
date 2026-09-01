export interface CheckoutRequest {
  reference: string;
  planCode: string;
  amount: number;
  currency: string;
  customerEmail: string;
  customerName?: string;
  callbackUrl?: string;
  metadata?: Record<string, unknown>;
}

export interface CheckoutSession {
  provider: string;
  reference: string;
  /** Where to send the user to pay. */
  authorizationUrl: string;
  providerCustomerId: string | null;
  providerSubscriptionId: string | null;
  /** True when no real charge will occur. */
  mocked: boolean;
}

export interface ProviderSubscriptionState {
  status: 'INCOMPLETE' | 'TRIALING' | 'ACTIVE' | 'PAST_DUE' | 'CANCELLED' | 'EXPIRED';
  currentPeriodStart: string | null;
  currentPeriodEnd: string | null;
  providerSubscriptionId: string | null;
}

export interface WebhookVerification {
  valid: boolean;
  eventId: string | null;
  eventType: string | null;
  reason?: string;
}

export interface PaymentProvider {
  readonly name: string;
  readonly isMock: boolean;
  createCheckout(request: CheckoutRequest): Promise<CheckoutSession>;
  cancelSubscription(providerSubscriptionId: string): Promise<ProviderSubscriptionState>;
  verifyWebhook(rawBody: string, signature: string | undefined, payload: any): WebhookVerification;
}

export const PAYMENT_PROVIDER = Symbol('PAYMENT_PROVIDER');
