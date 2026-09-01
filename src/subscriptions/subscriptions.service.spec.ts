import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SubscriptionsService } from './subscriptions.service.js';
import { MockPaymentProvider } from './providers/mock-payment.provider.js';
import {
  createMockDb, createMockNotifications, makeArtisan, type MockDb,
} from '../../test/helpers/mock-db.js';

const FREE_PLAN = {
  id: 'plan-free', code: 'FREE', name: 'Free', amount: 0, currency: 'NGN',
  billing_interval: 'MONTHLY', monthly_application_limit: 15,
  features: { featured_profile: false, boost_credits: 0 },
};

const PREMIUM_PLAN = {
  id: 'plan-premium', code: 'PREMIUM_MONTHLY', name: 'Premium Monthly', amount: 3500,
  currency: 'NGN', billing_interval: 'MONTHLY', monthly_application_limit: null,
  features: { featured_profile: true, boost_credits: 10 },
};

/**
 * getEntitlements makes two very different queries: the live-subscription
 * lookup (driven by __setQueryResult) and a head-count of this month's
 * applications. Route by table so each gets what it expects.
 */
const withApplicationCount = (db: MockDb, count: number) => {
  const realFrom = db.from.getMockImplementation()!;
  db.from.mockImplementation((table?: string) =>
    table === 'job_applications'
      ? ({ select: () => ({ eq: () => ({ gte: () => Promise.resolve({ count, error: null }) }) }) } as any)
      : realFrom(table));
};

describe('SubscriptionsService', () => {
  let db: MockDb;
  let notifications: ReturnType<typeof createMockNotifications>;
  let payments: MockPaymentProvider;
  let service: SubscriptionsService;

  beforeEach(() => {
    db = createMockDb();
    notifications = createMockNotifications();
    payments = new MockPaymentProvider();
    service = new SubscriptionsService(db as any, notifications as any, payments);
  });

  describe('entitlements', () => {
    it('falls back to the free plan for an artisan who never subscribed', async () => {
      db.__setQueryResult([]);
      db.maybeOne.mockResolvedValueOnce(FREE_PLAN);
      withApplicationCount(db, 4);

      const result = await service.getEntitlements('artisan-1');

      expect(result.planCode).toBe('FREE');
      expect(result.isPremium).toBe(false);
      expect(result.monthlyApplicationLimit).toBe(15);
      expect(result.applicationsThisMonth).toBe(4);
      expect(result.applicationsRemaining).toBe(11);
    });

    it('reports unlimited applications on premium', async () => {
      db.__setQueryResult([{
        id: 'sub-1', status: 'ACTIVE', artisan_id: 'artisan-1', subscription_plans: PREMIUM_PLAN,
      }]);
      withApplicationCount(db, 200);

      const result = await service.getEntitlements('artisan-1');

      expect(result.isPremium).toBe(true);
      expect(result.monthlyApplicationLimit).toBeNull();
      expect(result.applicationsRemaining).toBeNull();
      expect(result.featuredProfile).toBe(true);
      expect(result.boostCredits).toBe(10);
    });

    it('never reports negative remaining applications', async () => {
      db.__setQueryResult([]);
      db.maybeOne.mockResolvedValueOnce(FREE_PLAN);
      withApplicationCount(db, 40);

      const result = await service.getEntitlements('artisan-1');
      expect(result.applicationsRemaining).toBe(0);
    });
  });

  describe('the application quota', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    const withEntitlements = (overrides: Record<string, unknown>) =>
      vi.spyOn(service, 'getEntitlements').mockResolvedValue({
        isPremium: false, planCode: 'FREE', monthlyApplicationLimit: 15,
        applicationsThisMonth: 0, applicationsRemaining: 15,
        featuredProfile: false, boostCredits: 0, subscription: null,
        ...overrides,
      } as any);

    it('blocks an artisan who has used their whole allowance', async () => {
      withEntitlements({ applicationsThisMonth: 15, applicationsRemaining: 0 });
      await expect(service.assertCanApply(artisan, 'artisan-1'))
        .rejects.toThrow(/used all 15 applications/);
    });

    it('lets them through with allowance to spare', async () => {
      withEntitlements({ applicationsThisMonth: 3, applicationsRemaining: 12 });
      await expect(service.assertCanApply(artisan, 'artisan-1')).resolves.toBeUndefined();
    });

    it('never blocks an unlimited plan', async () => {
      withEntitlements({
        isPremium: true, planCode: 'PREMIUM_MONTHLY',
        monthlyApplicationLimit: null, applicationsThisMonth: 999, applicationsRemaining: null,
      });
      await expect(service.assertCanApply(artisan, 'artisan-1')).resolves.toBeUndefined();
    });
  });

  describe('checkout', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1', email: 'artisan@deevi.test' });

    it('refuses to charge for the free plan', async () => {
      db.maybeOne.mockResolvedValueOnce(FREE_PLAN);
      await expect(
        service.startCheckout(artisan, 'artisan-1', { planCode: 'FREE' }),
      ).rejects.toThrow(/does not require checkout/i);
    });

    it('404s on an unknown plan', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      await expect(
        service.startCheckout(artisan, 'artisan-1', { planCode: 'MADE_UP' }),
      ).rejects.toThrow(/not found/i);
    });

    it('refuses a second live subscription', async () => {
      db.maybeOne.mockResolvedValueOnce(PREMIUM_PLAN);
      db.__setQueryResult([{ id: 'sub-1', status: 'ACTIVE' }]);

      await expect(
        service.startCheckout(artisan, 'artisan-1', { planCode: 'PREMIUM_MONTHLY' }),
      ).rejects.toThrow(/already have an active subscription/i);
    });

    it('creates the subscription as INCOMPLETE, pending the webhook', async () => {
      db.maybeOne.mockResolvedValueOnce(PREMIUM_PLAN);
      db.__setQueryResult([]);

      const result = await service.startCheckout(artisan, 'artisan-1', { planCode: 'PREMIUM_MONTHLY' });

      expect(result.mocked).toBe(true);
      expect(db.insertOne).toHaveBeenCalledWith('subscriptions', expect.objectContaining({
        status: 'INCOMPLETE', plan_id: 'plan-premium',
      }), expect.any(String));
    });
  });

  describe('activation', () => {
    it('is idempotent for an already-live subscription', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'sub-1', status: 'ACTIVE', artisan_id: 'artisan-1',
        user_id: 'user-1', subscription_plans: PREMIUM_PLAN,
      });

      const result = await service.activateByReference('ref-1');
      expect(result.status).toBe('ACTIVE');
      expect(db.updateOne).not.toHaveBeenCalled();
    });

    it('ignores an event for a reference it does not know', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      await expect(service.activateByReference('unknown-ref')).resolves.toBeNull();
    });

    it('activates an incomplete subscription and notifies', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'sub-1', status: 'INCOMPLETE', artisan_id: 'artisan-1',
        user_id: 'user-1', provider: 'MOCK', subscription_plans: PREMIUM_PLAN,
      });

      await service.activateByReference('ref-1', 'mock_sub_123');

      expect(db.updateOne).toHaveBeenCalledWith('subscriptions', { id: 'sub-1' },
        expect.objectContaining({ status: 'ACTIVE' }), expect.any(String), expect.any(String));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'SUBSCRIPTION_ACTIVATED',
      }));
    });
  });

  describe('the mock payment provider', () => {
    it('still verifies webhook signatures properly', () => {
      const body = JSON.stringify({ event: 'charge.success', data: { reference: 'ref-1' } });
      const bad = payments.verifyWebhook(body, 'not-a-real-signature', JSON.parse(body));
      expect(bad.valid).toBe(false);
      expect(bad.reason).toMatch(/Signature/);
    });

    it('rejects a webhook with no signature at all', () => {
      const body = JSON.stringify({ event: 'charge.success' });
      expect(payments.verifyWebhook(body, undefined, JSON.parse(body)).valid).toBe(false);
    });

    it('flags itself as mocked so nothing claims money moved', async () => {
      const session = await payments.createCheckout({
        reference: 'ref-1', planCode: 'PREMIUM_MONTHLY', amount: 3500,
        currency: 'NGN', customerEmail: 'a@b.test',
      });
      expect(session.mocked).toBe(true);
      expect(payments.isMock).toBe(true);
    });
  });
});
