import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { buildPaginationMeta, type Paginated } from '../common/dto/pagination.dto.js';
import { DomainException, ForbiddenError, NotFoundError } from '../common/errors/domain.exception.js';
import { OPEN_JOB_POST_STATUSES } from '../jobs/job-lifecycle.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { RecommendArtisansQueryDto, RecommendForJobQueryDto } from './dto/matching.dto.js';

/**
 * The secondary flow: instead of waiting for artisans to find their job, a
 * customer asks Deevi who it would recommend.
 *
 * Same deterministic philosophy as the artisan feed, scored from the job's
 * side: only APPROVED artisans who actually offer the service and can reach
 * the location, ranked on proximity, availability, rating, completed volume,
 * experience and recent activity, with cancellations counting against.
 */
@Injectable()
export class MatchingService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalogue: CatalogueService,
    private readonly notifications: NotificationsService,
  ) {}

  async recommend(query: RecommendArtisansQueryDto): Promise<Paginated<any>> {
    await this.catalogue.resolveServiceReference(query.serviceId, query.subServiceId);

    const rows = await this.db.rpc<any[]>('deevi_recommend_artisans', {
      p_service_id: query.serviceId,
      p_sub_service_id: query.subServiceId ?? null,
      p_latitude: query.latitude ?? null,
      p_longitude: query.longitude ?? null,
      p_city: query.city ?? null,
      p_limit: query.limit,
      p_offset: (query.page - 1) * query.limit,
      p_min_rating: query.minRating ?? null,
    });

    const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;

    return {
      items: (rows ?? []).map(({ total_count: _count, ...artisan }) => ({
        ...artisan,
        match_score: Number(artisan.match_score ?? 0),
      })),
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  /**
   * Recommendations for a specific job post, using the job's own service and
   * location rather than asking the customer to re-enter them.
   */
  async recommendForJob(user: AuthUser, jobPostId: string, query: RecommendForJobQueryDto) {
    const post = await this.db.maybeOne<any>(
      'job_posts',
      'id, customer_id, service_id, sub_service_id, latitude, longitude, city, status, deleted_at',
      { id: jobPostId },
    );
    if (!post || post.deleted_at) throw new NotFoundError('Job post');
    if (post.customer_id !== user.id && !user.roles.includes('ADMIN')) {
      throw new ForbiddenError('You do not own this job post', 'NOT_JOB_OWNER');
    }

    const result = await this.recommend({
      serviceId: post.service_id,
      subServiceId: post.sub_service_id ?? undefined,
      latitude: post.latitude ?? undefined,
      longitude: post.longitude ?? undefined,
      city: post.city ?? undefined,
      minRating: query.minRating,
      page: query.page,
      limit: query.limit,
    } as RecommendArtisansQueryDto);

    // Flag anyone who has already applied so the customer is not invited to
    // invite them a second time.
    const { data: applications } = await this.db
      .from('job_applications')
      .select('artisan_id, status')
      .eq('job_post_id', jobPostId);

    const applied = new Map((applications ?? []).map((a: any) => [a.artisan_id, a.status]));

    return {
      ...result,
      items: result.items.map((artisan: any) => ({
        ...artisan,
        hasApplied: applied.has(artisan.artisan_id),
        applicationStatus: applied.get(artisan.artisan_id) ?? null,
      })),
    };
  }

  /**
   * Invites a recommended artisan to look at a job. This is a notification,
   * not an assignment: the artisan still applies and the customer still
   * chooses, so the marketplace loop is never short-circuited.
   */
  async inviteArtisan(user: AuthUser, artisanId: string, jobPostId: string, message?: string) {
    const post = await this.db.maybeOne<any>(
      'job_posts', 'id, customer_id, title, status, deleted_at', { id: jobPostId },
    );
    if (!post || post.deleted_at) throw new NotFoundError('Job post');
    if (post.customer_id !== user.id) {
      throw new ForbiddenError('You do not own this job post', 'NOT_JOB_OWNER');
    }
    if (!OPEN_JOB_POST_STATUSES.includes(post.status)) {
      throw new DomainException('JOB_NOT_OPEN', 'This job is no longer open to applications');
    }

    const artisan = await this.db.maybeOne<any>(
      'artisan_profiles', 'id, user_id, verification_status', { id: artisanId, deleted_at: null },
    );
    if (!artisan || artisan.verification_status !== 'APPROVED') throw new NotFoundError('Artisan');

    const alreadyApplied = await this.db.count('job_applications', {
      job_post_id: jobPostId, artisan_id: artisanId,
    });
    if (alreadyApplied) {
      throw new DomainException('ALREADY_APPLIED', 'This artisan has already applied to your job');
    }

    await this.notifications.notify({
      userId: artisan.user_id,
      type: NotificationType.JOB_MATCHING_ARTISANS,
      entityType: 'JOB_POST',
      entityId: jobPostId,
      priority: 'HIGH',
      template: {
        jobTitle: post.title,
        actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'A customer',
        messagePreview: message ?? `A customer invited you to apply for "${post.title}".`,
      },
      data: { jobPostId, invited: true, message: message ?? null },
    });

    return { message: 'Invitation sent. The artisan still needs to apply, and you still choose.' };
  }
}
