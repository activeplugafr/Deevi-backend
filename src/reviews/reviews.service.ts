import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys } from '../cache/cache-keys.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { ConflictError, DomainException, NotFoundError } from '../common/errors/domain.exception.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { ArtisanReviewsQueryDto, CreateReviewDto } from './dto/review.dto.js';

const REVIEW_COLUMNS =
  'id, job_id, job_post_id, reviewer_id, reviewee_id, artisan_id, direction, rating, comment, is_visible, created_at';

/**
 * Reviews are anchored to a completed engagement, never written free-hand.
 * That is what makes a Deevi rating mean something: it can only come from
 * someone who actually hired the artisan and saw the job through.
 *
 * The schema is two-sided (a `direction` column and a unique index per
 * reviewer, job and direction). MVP only enables CUSTOMER_TO_ARTISAN at this
 * layer; turning on the reverse direction later needs no migration.
 */
@Injectable()
export class ReviewsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Tells the client whether to show the review prompt, and why not. */
  async checkEligibility(user: AuthUser, jobId: string) {
    const job = await this.db.maybeOne<any>('jobs', 'id, customer_id, artisan_id, status', { id: jobId });
    if (!job) return { canReview: false, reason: 'Job not found', existingReviewId: null };

    if (job.customer_id !== user.id) {
      return {
        canReview: false,
        reason: 'Only the customer who hired the artisan can review this job',
        existingReviewId: null,
      };
    }
    if (job.status !== 'COMPLETED') {
      return {
        canReview: false,
        reason: 'You can review once the job is marked complete',
        existingReviewId: null,
      };
    }

    const existing = await this.db.maybeOne<any>('reviews', 'id', {
      job_id: jobId, reviewer_id: user.id, direction: 'CUSTOMER_TO_ARTISAN',
    });
    if (existing) {
      return { canReview: false, reason: 'You have already reviewed this job', existingReviewId: existing.id };
    }

    return { canReview: true, reason: null, existingReviewId: null };
  }

  async create(user: AuthUser, dto: CreateReviewDto) {
    const job = await this.db.maybeOne<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status', { id: dto.jobId },
    );
    if (!job) throw new NotFoundError('Job');

    if (job.customer_id !== user.id) {
      throw new DomainException(
        'NOT_REVIEW_ELIGIBLE',
        'Only the customer who hired the artisan can review this job',
        HttpStatus.FORBIDDEN,
      );
    }
    if (job.status !== 'COMPLETED') {
      throw new ConflictError('JOB_NOT_COMPLETED', 'You can only review a job once it is complete');
    }

    const duplicate = await this.db.maybeOne('reviews', 'id', {
      job_id: dto.jobId, reviewer_id: user.id, direction: 'CUSTOMER_TO_ARTISAN',
    });
    if (duplicate) throw new ConflictError('ALREADY_REVIEWED', 'You have already reviewed this job');

    const artisan = await this.db.one<any>('artisan_profiles', 'id, user_id', { id: job.artisan_id }, 'Artisan');

    // Rating averages on artisan_profiles are maintained by a database
    // trigger, so they cannot drift from the underlying reviews.
    const review = await this.db.insertOne('reviews', {
      job_id: dto.jobId,
      job_post_id: job.job_post_id,
      reviewer_id: user.id,
      reviewee_id: artisan.user_id,
      artisan_id: job.artisan_id,
      direction: 'CUSTOMER_TO_ARTISAN',
      rating: dto.rating,
      comment: dto.comment ?? null,
    }, REVIEW_COLUMNS);

    await this.cache.del(CacheKeys.publicArtisan(job.artisan_id));

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    await this.notifications.notify({
      userId: artisan.user_id,
      type: NotificationType.REVIEW_RECEIVED,
      entityType: 'REVIEW',
      entityId: review.id,
      template: {
        jobTitle: post?.title,
        actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'A customer',
      },
      data: { reviewId: review.id, rating: dto.rating },
    });

    return review;
  }

  async listForArtisan(artisanId: string, query: ArtisanReviewsQueryDto) {
    let builder = this.db
      .select('reviews', REVIEW_COLUMNS)
      .eq('artisan_id', artisanId)
      .eq('is_visible', true)
      .order('created_at', { ascending: false });

    if (query.rating) builder = builder.eq('rating', query.rating);

    const result = await this.db.paginate<any>(builder, query.page, query.limit, 'reviews:artisan');

    // Attach reviewer identities in one extra query rather than N.
    const reviewerIds = [...new Set(result.items.map((r) => r.reviewer_id))];
    if (reviewerIds.length) {
      const { data } = await this.db
        .from('users').select('id, first_name, last_name, avatar_url').in('id', reviewerIds);
      const byId = new Map((data ?? []).map((u: any) => [u.id, u]));
      result.items = result.items.map((review) => ({ ...review, reviewer: byId.get(review.reviewer_id) ?? null }));
    }

    return result;
  }

  async listMine(user: AuthUser, page: number, limit: number) {
    const builder = this.db
      .select('reviews', REVIEW_COLUMNS)
      .eq('reviewer_id', user.id)
      .order('created_at', { ascending: false });
    return this.db.paginate(builder, page, limit, 'reviews:mine');
  }

  /** Rating distribution, for the histogram on an artisan profile. */
  async getSummary(artisanId: string) {
    const { data } = await this.db
      .from('reviews')
      .select('rating')
      .eq('artisan_id', artisanId)
      .eq('is_visible', true);

    const distribution: Record<number, number> = { 1: 0, 2: 0, 3: 0, 4: 0, 5: 0 };
    for (const row of data ?? []) distribution[(row as any).rating] += 1;

    const total = (data ?? []).length;
    const sum = (data ?? []).reduce((acc: number, row: any) => acc + row.rating, 0);

    return { total, average: total ? Number((sum / total).toFixed(2)) : 0, distribution };
  }
}
