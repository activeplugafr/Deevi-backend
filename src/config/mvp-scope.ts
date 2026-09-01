/**
 * MVP scope.
 *
 * Deevi's domain model is deliberately wider than the MVP surface. The tables,
 * services and provider abstractions for boosts, subscriptions and payments all
 * exist and are exercised by tests, but their HTTP endpoints are not registered,
 * so none of it is reachable in production.
 *
 * Keeping them dormant rather than deleting them means the growth path stays
 * open (no migration, no re-architecture) while the deployed surface stays small
 * and honest about what Deevi actually does today.
 *
 * To reactivate a feature: add its controller back to the `controllers` array of
 * the module named below, flip the flag here, and wire the provider credentials.
 */
export const MvpScope = {
  /**
   * Deevi Boosts. Tables (`boosts`, `boost_transactions`), BoostsService and the
   * bounded ranking multiplier in the feed SQL all exist. With no boost rows
   * written, the feed multiplier is a constant 1.0 and boosted ordering is inert.
   * Reactivate: BoostsModule -> controllers: [BoostsController].
   */
  boosts: { active: false, module: 'BoostsModule', controller: 'BoostsController' },

  /**
   * Premium artisan subscriptions. Tables, SubscriptionsService, the payment
   * provider abstraction and the Paystack adapter all exist. No checkout is
   * reachable, so no subscription can be created and nothing charges anyone.
   * Reactivate: SubscriptionsModule -> controllers: [SubscriptionsController].
   */
  subscriptions: { active: false, module: 'SubscriptionsModule', controller: 'SubscriptionsController' },

  /**
   * Per-plan monthly application quotas. Dormant with subscriptions: an artisan
   * must never be blocked from bidding by a plan they cannot buy. Abuse is
   * handled by the per-route rate limiter instead (30 applications/hour).
   */
  applicationQuotas: { active: false, replacedBy: 'RateLimitGuard' },

  /**
   * Job payments are settled directly between customer and artisan. Nothing in
   * Deevi claims otherwise: `jobs.payment_mode` is CHECK-constrained to OFFLINE,
   * so the database itself refuses to record a processed payment.
   */
  customerPayments: { active: false, note: 'Off-platform by design for MVP' },

  /**
   * Second review direction. The schema is already two-sided (`reviews.direction`
   * plus a unique index per reviewer, job and direction); only CUSTOMER_TO_ARTISAN
   * is enabled at the service layer. Enabling the reverse needs no migration.
   */
  artisanToCustomerReviews: { active: false, module: 'ReviewsModule' },
} as const;

/** Feature summary for GET /health, so the deployed scope is discoverable. */
export const dormantFeatures = () =>
  Object.entries(MvpScope)
    .filter(([, value]) => !value.active)
    .map(([name]) => name);
