import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { DatabaseService } from '../supabase/database.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { DomainException, NotFoundError } from '../common/errors/domain.exception.js';
import { PAYMENT_PROVIDER, type PaymentProvider } from './providers/payment-provider.interface.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { StartSubscriptionDto } from './dto/subscription.dto.js';

const PLAN_COLUMNS =
  'id, code, name, description, amount, currency, billing_interval, trial_days, monthly_application_limit, features, sort_order, is_active';
const SUBSCRIPTION_COLUMNS =
  'id, user_id, artisan_id, plan_id, status, provider, provider_customer_id, provider_subscription_id, ' +
  'provider_checkout_reference, current_period_start, current_period_end, trial_ends_at, cancel_at_period_end, cancelled_at, created_at';

const LIVE_STATUSES = ['TRIALING', 'ACTIVE', 'PAST_DUE'];

/**
 * Artisan premium subscriptions: the only money Deevi handles in this MVP.
 *
 * Job payments stay off-platform between customer and artisan, and the data
 * model never pretends otherwise -- `jobs.payment_mode` is constrained to
 * OFFLINE precisely so a future reader cannot mistake an arranged price for a
 * processed one.
 */
@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
    @Inject(PAYMENT_PROVIDER) private readonly payments: PaymentProvider,
  ) {}

  async listPlans() {
    const { data } = await this.db
      .from('subscription_plans')
      .select(PLAN_COLUMNS)
      .eq('is_active', true)
      .order('sort_order', { ascending: true });
    return data ?? [];
  }

  async getMySubscription(user: AuthUser) {
    const { data } = await this.db
      .from('subscriptions')
      .select(`${SUBSCRIPTION_COLUMNS}, subscription_plans(${PLAN_COLUMNS})`)
      .eq('user_id', user.id)
      .order('created_at', { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  }

  private async getLiveSubscription(artisanId: string) {
    const { data } = await this.db
      .from('subscriptions')
      .select(`${SUBSCRIPTION_COLUMNS}, subscription_plans(${PLAN_COLUMNS})`)
      .eq('artisan_id', artisanId)
      .in('status', LIVE_STATUSES)
      .limit(1);
    return data?.[0] ?? null;
  }

  private async freePlan() {
    return this.db.maybeOne<any>('subscription_plans', PLAN_COLUMNS, { code: 'FREE' });
  }

  /**
   * What this artisan is currently entitled to. Falls back to the FREE plan,
   * so an artisan who never subscribed still has well-defined limits.
   */
  async getEntitlements(artisanId: string) {
    const [live, free] = await Promise.all([this.getLiveSubscription(artisanId), this.freePlan()]);
    const plan = live?.subscription_plans ?? free;

    const monthStart = new Date();
    monthStart.setUTCDate(1);
    monthStart.setUTCHours(0, 0, 0, 0);

    const { count } = await this.db
      .from('job_applications')
      .select('id', { count: 'exact', head: true })
      .eq('artisan_id', artisanId)
      .gte('created_at', monthStart.toISOString());

    const used = count ?? 0;
    const limit = plan?.monthly_application_limit ?? null;

    return {
      isPremium: Boolean(live),
      planCode: plan?.code ?? 'FREE',
      monthlyApplicationLimit: limit,
      applicationsThisMonth: used,
      applicationsRemaining: limit === null ? null : Math.max(limit - used, 0),
      featuredProfile: Boolean(plan?.features?.featured_profile),
      boostCredits: Number(plan?.features?.boost_credits ?? 0),
      subscription: live ?? null,
    };
  }

  /**
   * Enforces the monthly application quota. Called before an artisan bids;
   * the free tier is generous enough to be usable and the paid tier removes
   * the ceiling entirely.
   */
  async assertCanApply(user: AuthUser, artisanId: string): Promise<void> {
    const entitlements = await this.getEntitlements(artisanId);
    if (entitlements.monthlyApplicationLimit === null) return;

    if (entitlements.applicationsThisMonth >= entitlements.monthlyApplicationLimit) {
      throw new DomainException(
        'APPLICATION_LIMIT_REACHED',
        `You have used all ${entitlements.monthlyApplicationLimit} applications on the ` +
        `${entitlements.planCode} plan this month. Upgrade to Premium for unlimited applications.`,
        HttpStatus.PAYMENT_REQUIRED,
      );
    }
  }

  /* ----------------------------- checkout ----------------------------- */

  async startCheckout(user: AuthUser, artisanId: string, dto: StartSubscriptionDto) {
    const plan = await this.db.maybeOne<any>('subscription_plans', PLAN_COLUMNS, {
      code: dto.planCode, is_active: true,
    });
    if (!plan) throw new NotFoundError('Subscription plan', 'PLAN_NOT_FOUND');

    if (Number(plan.amount) <= 0) {
      throw new DomainException('PLAN_NOT_PURCHASABLE', 'The free plan does not require checkout');
    }

    const existing = await this.getLiveSubscription(artisanId);
    if (existing) {
      throw new DomainException(
        'SUBSCRIPTION_ALREADY_ACTIVE',
        'You already have an active subscription. Cancel it before starting a new one.',
        HttpStatus.CONFLICT,
      );
    }

    const reference = `deevi_${randomUUID().replace(/-/g, '')}`;

    const session = await this.payments.createCheckout({
      reference,
      planCode: plan.code,
      amount: Number(plan.amount),
      currency: plan.currency,
      customerEmail: user.email ?? `${user.id}@no-email.deevi`,
      customerName: [user.firstName, user.lastName].filter(Boolean).join(' '),
      callbackUrl: dto.callbackUrl,
      metadata: { userId: user.id, artisanId },
    });

    // INCOMPLETE until the provider confirms payment via webhook. The
    // subscription is never treated as live on the strength of a redirect.
    const subscription = await this.db.insertOne('subscriptions', {
      user_id: user.id,
      artisan_id: artisanId,
      plan_id: plan.id,
      status: 'INCOMPLETE',
      provider: session.provider,
      provider_customer_id: session.providerCustomerId,
      provider_subscription_id: session.providerSubscriptionId,
      provider_checkout_reference: session.reference,
      metadata: { mocked: session.mocked },
    }, SUBSCRIPTION_COLUMNS);

    return {
      provider: session.provider,
      reference: session.reference,
      authorizationUrl: session.authorizationUrl,
      mocked: session.mocked,
      subscriptionId: subscription.id,
    };
  }

  /**
   * Activates a subscription. Called by the webhook handler on a verified
   * provider event, and by the mock confirmation endpoint in development.
   * Idempotent: re-delivering the same event is a no-op.
   */
  async activateByReference(reference: string, providerSubscriptionId?: string) {
    const subscription = await this.db.maybeOne<any>(
      'subscriptions', `${SUBSCRIPTION_COLUMNS}, subscription_plans(${PLAN_COLUMNS})`,
      { provider_checkout_reference: reference },
    );
    if (!subscription) {
      this.logger.warn(`Payment event for unknown reference ${reference}`);
      return null;
    }
    if (LIVE_STATUSES.includes(subscription.status)) return subscription;

    const plan = subscription.subscription_plans;
    const now = new Date();
    const periodEnd = new Date(now);
    switch (plan?.billing_interval) {
      case 'YEARLY': periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 1); break;
      case 'QUARTERLY': periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 3); break;
      case 'LIFETIME': periodEnd.setUTCFullYear(periodEnd.getUTCFullYear() + 100); break;
      default: periodEnd.setUTCMonth(periodEnd.getUTCMonth() + 1);
    }

    const activated = await this.db.updateOne('subscriptions', { id: subscription.id }, {
      status: 'ACTIVE',
      provider_subscription_id: providerSubscriptionId ?? subscription.provider_subscription_id,
      current_period_start: now.toISOString(),
      current_period_end: periodEnd.toISOString(),
    }, SUBSCRIPTION_COLUMNS, 'Subscription');

    if (subscription.artisan_id) {
      await this.db.from('artisan_profiles').update({
        is_premium: true,
        premium_until: periodEnd.toISOString(),
        ...(plan?.features?.featured_profile ? { featured_until: periodEnd.toISOString() } : {}),
      }).eq('id', subscription.artisan_id);
    }

    await this.db.from('subscription_invoices').insert({
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      amount: plan?.amount ?? 0,
      currency: plan?.currency ?? 'NGN',
      status: 'PAID',
      provider: subscription.provider,
      provider_reference: reference,
      period_start: now.toISOString(),
      period_end: periodEnd.toISOString(),
      paid_at: now.toISOString(),
    });

    await this.notifications.notify({
      userId: subscription.user_id,
      type: NotificationType.SUBSCRIPTION_ACTIVATED,
      entityType: 'SUBSCRIPTION',
      entityId: subscription.id,
      data: { planCode: plan?.code },
    });

    return activated;
  }

  async markPaymentFailed(reference: string, detail?: string) {
    const subscription = await this.db.maybeOne<any>(
      'subscriptions', 'id, user_id, status', { provider_checkout_reference: reference },
    );
    if (!subscription) return null;

    await this.db.from('subscriptions')
      .update({ status: subscription.status === 'ACTIVE' ? 'PAST_DUE' : 'INCOMPLETE' })
      .eq('id', subscription.id);

    await this.db.from('subscription_invoices').insert({
      subscription_id: subscription.id,
      user_id: subscription.user_id,
      amount: 0,
      status: 'FAILED',
      provider_reference: reference,
    });

    await this.notifications.notify({
      userId: subscription.user_id,
      type: NotificationType.SUBSCRIPTION_PAYMENT_FAILED,
      entityType: 'SUBSCRIPTION',
      entityId: subscription.id,
      data: { reference, detail: detail ?? null },
    });

    return subscription.id;
  }

  /**
   * Cancels at period end by default: the artisan keeps what they paid for
   * until the term runs out, which is both fairer and fewer support tickets.
   */
  async cancel(user: AuthUser, immediate = false) {
    const subscription = await this.db.maybeOne<any>(
      'subscriptions', SUBSCRIPTION_COLUMNS,
      { user_id: user.id },
    );
    if (!subscription || !LIVE_STATUSES.includes(subscription.status)) {
      throw new NotFoundError('Active subscription', 'NO_ACTIVE_SUBSCRIPTION');
    }

    if (subscription.provider_subscription_id) {
      try {
        await this.payments.cancelSubscription(subscription.provider_subscription_id);
      } catch (err) {
        this.logger.error(`Provider cancellation failed: ${(err as Error).message}`);
      }
    }

    const now = new Date().toISOString();
    const updated = await this.db.updateOne('subscriptions', { id: subscription.id }, immediate
      ? { status: 'CANCELLED', cancelled_at: now, ended_at: now, cancel_at_period_end: false }
      : { cancel_at_period_end: true, cancelled_at: now },
      SUBSCRIPTION_COLUMNS, 'Subscription');

    if (immediate && subscription.artisan_id) {
      await this.db.from('artisan_profiles')
        .update({ is_premium: false, premium_until: null, featured_until: null })
        .eq('id', subscription.artisan_id);
    }

    await this.notifications.notify({
      userId: user.id,
      type: NotificationType.SUBSCRIPTION_CANCELLED,
      entityType: 'SUBSCRIPTION',
      entityId: subscription.id,
    });

    return {
      message: immediate
        ? 'Subscription cancelled immediately'
        : `Subscription will end on ${subscription.current_period_end ?? 'the end of the current period'}`,
      subscription: updated,
    };
  }

  async listInvoices(user: AuthUser, page: number, limit: number) {
    const builder = this.db
      .select('subscription_invoices',
        'id, subscription_id, amount, currency, status, provider, provider_reference, period_start, period_end, paid_at, created_at')
      .eq('user_id', user.id)
      .order('created_at', { ascending: false });
    return this.db.paginate(builder, page, limit, 'subscriptions:invoices');
  }

  get providerName(): string {
    return this.payments.name;
  }

  get providerIsMock(): boolean {
    return this.payments.isMock;
  }

  get provider(): PaymentProvider {
    return this.payments;
  }
}
