import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { SubscriptionsService } from '../subscriptions/subscriptions.service.js';
import { DomainException, NotFoundError } from '../common/errors/domain.exception.js';
import type { AuthUser } from '../common/types/auth-user.js';

const BOOST_COLUMNS =
  'id, artisan_id, boost_type, target_type, target_id, status, credits_spent, amount, currency, weight, starts_at, ends_at, created_at';

/**
 * Deevi Boosts: extensible domain structure, deliberately narrow behaviour.
 *
 * The architectural commitment that matters is the bound. A boost applies a
 * multiplier of at most 1.5x to an ALREADY-RELEVANT result, enforced by a
 * CHECK constraint on boosts.weight and applied at the very end of the feed
 * scoring query. Paid visibility can therefore reorder results a customer or
 * artisan would have seen anyway; it can never inject an artisan into a feed
 * they do not qualify for, or push an irrelevant job in front of anyone.
 *
 * Purchasing boosts with real money is out of scope for MVP: credits come
 * from a subscription plan, and boost_transactions already models purchase,
 * spend and refund so a paid flow slots in without a migration.
 */
@Injectable()
export class BoostsService {
  /** Kept low on purpose. Relevance must remain the dominant signal. */
  private static readonly MAX_WEIGHT = 1.5;

  constructor(
    private readonly db: DatabaseService,
    private readonly subscriptions: SubscriptionsService,
  ) {}

  async listMine(artisanId: string, page: number, limit: number) {
    const builder = this.db
      .select('boosts', BOOST_COLUMNS)
      .eq('artisan_id', artisanId)
      .order('created_at', { ascending: false });
    return this.db.paginate(builder, page, limit, 'boosts:mine');
  }

  async getBalance(artisanId: string) {
    const entitlements = await this.subscriptions.getEntitlements(artisanId);

    const { data } = await this.db
      .from('boost_transactions')
      .select('transaction_type, credits')
      .eq('artisan_id', artisanId);

    const spent = (data ?? [])
      .filter((t: any) => t.transaction_type === 'SPEND')
      .reduce((sum: number, t: any) => sum + t.credits, 0);
    const granted = (data ?? [])
      .filter((t: any) => ['GRANT', 'PURCHASE', 'REFUND'].includes(t.transaction_type))
      .reduce((sum: number, t: any) => sum + t.credits, 0);

    return {
      planCredits: entitlements.boostCredits,
      granted,
      spent,
      available: Math.max(entitlements.boostCredits + granted - spent, 0),
    };
  }

  /**
   * Spends credits to promote one application. Scoped to the artisan's own
   * application, time-bounded, and weight-capped.
   */
  async boostApplication(user: AuthUser, artisanId: string, applicationId: string, days = 7) {
    const application = await this.db.maybeOne<any>(
      'job_applications', 'id, artisan_id, job_post_id, status', { id: applicationId, artisan_id: artisanId },
    );
    if (!application) throw new NotFoundError('Application');

    if (!['SUBMITTED', 'SHORTLISTED'].includes(application.status)) {
      throw new DomainException(
        'APPLICATION_NOT_BOOSTABLE',
        'Only an application still in play can be promoted',
        HttpStatus.CONFLICT,
      );
    }

    const balance = await this.getBalance(artisanId);
    const cost = 1;
    if (balance.available < cost) {
      throw new DomainException(
        'INSUFFICIENT_BOOST_CREDITS',
        'You have no boost credits left. Premium plans include credits each month.',
        HttpStatus.PAYMENT_REQUIRED,
      );
    }

    const now = new Date();
    const endsAt = new Date(now.getTime() + days * 86_400_000);

    const boost = await this.db.insertOne('boosts', {
      artisan_id: artisanId,
      boost_type: 'APPLICATION_PROMOTION',
      target_type: 'JOB_APPLICATION',
      target_id: applicationId,
      status: 'ACTIVE',
      credits_spent: cost,
      weight: BoostsService.MAX_WEIGHT,
      starts_at: now.toISOString(),
      ends_at: endsAt.toISOString(),
    }, BOOST_COLUMNS);

    await this.db.from('boost_transactions').insert({
      artisan_id: artisanId,
      boost_id: boost.id,
      transaction_type: 'SPEND',
      credits: cost,
      balance_after: balance.available - cost,
      status: 'COMPLETED',
    });

    await this.db.from('job_applications')
      .update({ is_boosted: true, boost_id: boost.id })
      .eq('id', applicationId);

    return {
      message: 'Application promoted. It will appear higher in the customer list until it expires.',
      boost,
      creditsRemaining: balance.available - cost,
    };
  }

  async cancelBoost(artisanId: string, boostId: string) {
    const boost = await this.db.maybeOne<any>('boosts', 'id, target_id, status', {
      id: boostId, artisan_id: artisanId,
    });
    if (!boost) throw new NotFoundError('Boost');
    if (boost.status !== 'ACTIVE') {
      throw new DomainException('BOOST_NOT_ACTIVE', 'This boost is not active', HttpStatus.CONFLICT);
    }

    await this.db.from('boosts').update({ status: 'CANCELLED' }).eq('id', boostId);
    if (boost.target_id) {
      await this.db.from('job_applications')
        .update({ is_boosted: false, boost_id: null })
        .eq('id', boost.target_id);
    }

    return { message: 'Boost cancelled. Credits already spent are not refunded.' };
  }
}
