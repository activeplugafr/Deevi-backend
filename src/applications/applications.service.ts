import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { ArtisansService } from '../artisans/artisans.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import {
  ConflictError, DomainException, ForbiddenError, NotFoundError,
} from '../common/errors/domain.exception.js';
import { OPEN_JOB_POST_STATUSES } from '../jobs/job-lifecycle.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type {
  ApplicationsQueryDto, CreateApplicationDto, UpdateApplicationDto,
} from './dto/application.dto.js';

const APPLICATION_COLUMNS = [
  'id', 'job_post_id', 'artisan_id', 'message', 'proposed_price', 'price_type', 'currency',
  'estimated_duration_value', 'estimated_duration_unit', 'availability_note', 'can_start_at',
  'relevant_experience', 'status', 'is_boosted', 'customer_viewed_at', 'shortlisted_at',
  'responded_at', 'withdrawn_at', 'rejection_reason', 'created_at', 'updated_at',
].join(', ');

/** Artisan detail joined onto an application for the customer's review screen. */
const ARTISAN_PREVIEW =
  'artisan_profiles(id, headline, business_name, years_of_experience, rating_average, rating_count, ' +
  'jobs_completed_count, availability_status, base_city, is_premium, users(id, first_name, last_name, avatar_url))';

@Injectable()
export class ApplicationsService {
  private readonly logger = new Logger(ApplicationsService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly artisans: ArtisansService,
    private readonly notifications: NotificationsService,
  ) {}

  /* ----------------------------- artisan side ---------------------------- */

  async apply(user: AuthUser, dto: CreateApplicationDto) {
    const artisanId = this.artisans.assertApproved(user);

    const post = await this.db.maybeOne<any>(
      'job_posts',
      'id, customer_id, title, status, service_id, sub_service_id, deleted_at, expires_at',
      { id: dto.jobPostId },
    );
    if (!post || post.deleted_at) throw new NotFoundError('Job post');

    if (post.customer_id === user.id) {
      throw new DomainException('CANNOT_APPLY_TO_OWN_JOB', 'You cannot apply to your own job post');
    }
    if (!OPEN_JOB_POST_STATUSES.includes(post.status)) {
      throw new ConflictError(
        'JOB_NOT_OPEN',
        post.status === 'ARTISAN_SELECTED' || post.status === 'ACCEPTED'
          ? 'An artisan has already been selected for this job'
          : `This job is ${post.status.toLowerCase().replace(/_/g, ' ')} and no longer accepts applications`,
      );
    }
    if (post.expires_at && new Date(post.expires_at) < new Date()) {
      throw new ConflictError('JOB_EXPIRED', 'This job post has expired');
    }

    // Only apply for work you actually advertise. This keeps the marketplace
    // honest in both directions and matches what the feed already shows you.
    const offersService = await this.db.count('artisan_services', {
      artisan_id: artisanId, service_id: post.service_id,
    });
    if (!offersService) {
      throw new DomainException(
        'SERVICE_NOT_OFFERED',
        'You do not offer this service. Add it to your profile first.',
        HttpStatus.FORBIDDEN,
      );
    }

    const duplicate = await this.db.maybeOne('job_applications', 'id, status', {
      job_post_id: dto.jobPostId, artisan_id: artisanId,
    });
    if (duplicate) {
      throw new ConflictError('ALREADY_APPLIED', 'You have already applied to this job');
    }

    // No per-plan application quota in the MVP: subscriptions are dormant, and
    // an artisan must never be blocked from bidding by a plan they cannot buy.
    // Abuse is handled by the route rate limiter (30 applications/hour).

    const application = await this.db.insertOne('job_applications', {
      job_post_id: dto.jobPostId,
      artisan_id: artisanId,
      message: dto.message,
      proposed_price: dto.proposedPrice ?? null,
      price_type: dto.priceType ?? 'FIXED',
      estimated_duration_value: dto.estimatedDurationValue ?? null,
      estimated_duration_unit: dto.estimatedDurationUnit ?? null,
      availability_note: dto.availabilityNote ?? null,
      can_start_at: dto.canStartAt ?? null,
      relevant_experience: dto.relevantExperience ?? null,
      status: 'SUBMITTED',
    }, APPLICATION_COLUMNS);

    await this.notifications.notify({
      userId: post.customer_id,
      type: NotificationType.APPLICATION_RECEIVED,
      entityType: 'JOB_APPLICATION',
      entityId: application.id,
      template: {
        jobTitle: post.title,
        actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'An artisan',
      },
      data: { jobPostId: post.id, applicationId: application.id },
    });

    return application;
  }

  async listMine(user: AuthUser, query: ApplicationsQueryDto) {
    const artisanId = this.artisans.requireArtisanId(user);

    let builder = this.db
      .select(
        'job_applications',
        `${APPLICATION_COLUMNS}, job_posts(id, title, status, city, neighbourhood, urgency, budget_min, budget_max, currency, service_id)`,
      )
      .eq('artisan_id', artisanId);

    if (query.status) builder = builder.eq('status', query.status);
    builder = builder.order('created_at', { ascending: false });

    return this.db.paginate(builder, query.page, query.limit, 'applications:mine');
  }

  /** Artisans may revise their bid only while it is still in play. */
  async update(user: AuthUser, applicationId: string, dto: UpdateApplicationDto) {
    const artisanId = this.artisans.requireArtisanId(user);
    const application = await this.db.maybeOne<any>('job_applications', 'id, artisan_id, status', {
      id: applicationId, artisan_id: artisanId,
    });
    if (!application) throw new NotFoundError('Application');

    if (!['SUBMITTED', 'SHORTLISTED'].includes(application.status)) {
      throw new ConflictError(
        'APPLICATION_NOT_EDITABLE',
        `A ${application.status.toLowerCase()} application can no longer be edited`,
      );
    }

    return this.db.updateOne('job_applications', { id: applicationId }, compact({
      message: dto.message,
      proposed_price: dto.proposedPrice,
      price_type: dto.priceType,
      estimated_duration_value: dto.estimatedDurationValue,
      estimated_duration_unit: dto.estimatedDurationUnit,
      availability_note: dto.availabilityNote,
      can_start_at: dto.canStartAt,
      relevant_experience: dto.relevantExperience,
    }), APPLICATION_COLUMNS, 'Application');
  }

  async withdraw(user: AuthUser, applicationId: string) {
    const artisanId = this.artisans.requireArtisanId(user);
    const application = await this.db.maybeOne<any>(
      'job_applications', 'id, artisan_id, status, job_post_id', { id: applicationId, artisan_id: artisanId },
    );
    if (!application) throw new NotFoundError('Application');

    if (application.status === 'ACCEPTED') {
      throw new ConflictError(
        'CANNOT_WITHDRAW_ACCEPTED',
        'You have been selected for this job. Decline the engagement instead so the customer is notified.',
      );
    }
    if (!['SUBMITTED', 'SHORTLISTED'].includes(application.status)) {
      throw new ConflictError('CANNOT_WITHDRAW', `A ${application.status.toLowerCase()} application cannot be withdrawn`);
    }

    const withdrawn = await this.db.updateIf<any>(
      'job_applications',
      { id: applicationId, status: application.status },
      { status: 'WITHDRAWN', withdrawn_at: new Date().toISOString() },
      'id, job_post_id, status',
    );
    if (!withdrawn) {
      throw new ConflictError('CONCURRENT_MODIFICATION', 'This application just changed. Reload and try again.');
    }

    const post = await this.db.maybeOne<any>('job_posts', 'id, customer_id, title, applications_count', {
      id: application.job_post_id,
    });
    if (post) {
      await this.db.from('job_posts')
        .update({ applications_count: Math.max((post.applications_count ?? 1) - 1, 0) })
        .eq('id', post.id);

      await this.notifications.notify({
        userId: post.customer_id,
        type: NotificationType.APPLICATION_WITHDRAWN,
        entityType: 'JOB_POST',
        entityId: post.id,
        template: {
          jobTitle: post.title,
          actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'An artisan',
        },
        data: { jobPostId: post.id, applicationId },
      });
    }

    return { message: 'Application withdrawn' };
  }

  /* ---------------------------- customer side ---------------------------- */

  private async requireOwnedPost(user: AuthUser, jobPostId: string) {
    const post = await this.db.maybeOne<any>(
      'job_posts', 'id, customer_id, title, status, selected_application_id', { id: jobPostId, deleted_at: null },
    );
    if (!post) throw new NotFoundError('Job post');
    if (post.customer_id !== user.id && !user.roles.includes('ADMIN')) {
      throw new ForbiddenError('You do not own this job post', 'NOT_JOB_OWNER');
    }
    return post;
  }

  async listForJob(user: AuthUser, jobPostId: string, query: ApplicationsQueryDto) {
    await this.requireOwnedPost(user, jobPostId);

    let builder = this.db
      .select('job_applications', `${APPLICATION_COLUMNS}, ${ARTISAN_PREVIEW}`)
      .eq('job_post_id', jobPostId);

    if (query.status) builder = builder.eq('status', query.status);
    else builder = builder.neq('status', 'WITHDRAWN');

    switch (query.sort) {
      case 'price_asc': builder = builder.order('proposed_price', { ascending: true, nullsFirst: false }); break;
      case 'price_desc': builder = builder.order('proposed_price', { ascending: false, nullsFirst: false }); break;
      case 'rating': builder = builder.order('created_at', { ascending: false }); break;
      default: builder = builder.order('is_boosted', { ascending: false }).order('created_at', { ascending: false });
    }

    const result = await this.db.paginate<any>(builder, query.page, query.limit, 'applications:job');

    // Sorting by artisan rating needs the joined row, so it happens here on
    // the already-bounded page rather than as an unbounded database sort.
    if (query.sort === 'rating') {
      result.items.sort((a, b) =>
        (b.artisan_profiles?.rating_average ?? 0) - (a.artisan_profiles?.rating_average ?? 0));
    }

    // Mark the page as seen so the artisan can tell their bid was read.
    const unseen = result.items.filter((item) => !item.customer_viewed_at).map((item) => item.id);
    if (unseen.length) {
      void this.db.from('job_applications')
        .update({ customer_viewed_at: new Date().toISOString() })
        .in('id', unseen);
    }

    return result;
  }

  async getOne(user: AuthUser, applicationId: string) {
    const application = await this.db.maybeOne<any>(
      'job_applications', `${APPLICATION_COLUMNS}, ${ARTISAN_PREVIEW}`, { id: applicationId },
    );
    if (!application) throw new NotFoundError('Application');

    const isOwnArtisan = user.artisanProfileId === application.artisan_id;
    if (!isOwnArtisan) await this.requireOwnedPost(user, application.job_post_id);

    return application;
  }

  async shortlist(user: AuthUser, applicationId: string) {
    const application = await this.db.one<any>(
      'job_applications', 'id, job_post_id, artisan_id, status', { id: applicationId }, 'Application',
    );
    const post = await this.requireOwnedPost(user, application.job_post_id);

    if (application.status !== 'SUBMITTED') {
      throw new ConflictError(
        'CANNOT_SHORTLIST',
        `Only submitted applications can be shortlisted; this one is ${application.status.toLowerCase()}`,
      );
    }

    const updated = await this.db.updateIf<any>(
      'job_applications',
      { id: applicationId, status: 'SUBMITTED' },
      { status: 'SHORTLISTED', shortlisted_at: new Date().toISOString() },
      APPLICATION_COLUMNS,
    );
    if (!updated) {
      throw new ConflictError('CONCURRENT_MODIFICATION', 'This application just changed. Reload and try again.');
    }

    const artisan = await this.db.maybeOne<any>('artisan_profiles', 'user_id', { id: application.artisan_id });
    if (artisan) {
      await this.notifications.notify({
        userId: artisan.user_id,
        type: NotificationType.APPLICATION_SHORTLISTED,
        entityType: 'JOB_APPLICATION',
        entityId: applicationId,
        template: { jobTitle: post.title },
        data: { jobPostId: post.id, applicationId },
      });
    }

    return updated;
  }

  async reject(user: AuthUser, applicationId: string, reason?: string) {
    const application = await this.db.one<any>(
      'job_applications', 'id, job_post_id, artisan_id, status', { id: applicationId }, 'Application',
    );
    const post = await this.requireOwnedPost(user, application.job_post_id);

    if (!['SUBMITTED', 'SHORTLISTED'].includes(application.status)) {
      throw new ConflictError('CANNOT_REJECT', `A ${application.status.toLowerCase()} application cannot be rejected`);
    }

    const updated = await this.db.updateIf<any>(
      'job_applications',
      { id: applicationId, status: application.status },
      { status: 'REJECTED', responded_at: new Date().toISOString(), rejection_reason: reason ?? null },
      APPLICATION_COLUMNS,
    );
    if (!updated) {
      throw new ConflictError('CONCURRENT_MODIFICATION', 'This application just changed. Reload and try again.');
    }

    const artisan = await this.db.maybeOne<any>('artisan_profiles', 'user_id', { id: application.artisan_id });
    if (artisan) {
      await this.notifications.notify({
        userId: artisan.user_id,
        type: NotificationType.APPLICATION_REJECTED,
        entityType: 'JOB_APPLICATION',
        entityId: applicationId,
        template: { jobTitle: post.title, reason },
        data: { jobPostId: post.id, applicationId },
      });
    }

    return updated;
  }

  /**
   * Selects an artisan for a job.
   *
   * This is the most race-sensitive operation in the product: two rapid taps,
   * two tabs, or a retried request must never produce two accepted artisans.
   * The whole decision is therefore pushed into a single Postgres function
   * that takes a row lock on the job post, re-validates ownership and status
   * under that lock, accepts exactly one application, rejects the rest and
   * creates the engagement -- all in one transaction. A partial unique index
   * on (job_post_id) WHERE status = 'ACCEPTED' backs it up at the storage
   * layer, so even a bug in this code cannot produce two winners.
   */
  async selectArtisan(user: AuthUser, applicationId: string, agreedPrice?: number) {
    const application = await this.db.one<any>(
      'job_applications', 'id, job_post_id, artisan_id, status, proposed_price', { id: applicationId }, 'Application',
    );
    const post = await this.requireOwnedPost(user, application.job_post_id);

    const result = await this.db.rpc<any>('deevi_select_artisan_for_job', {
      p_job_post_id: post.id,
      p_application_id: applicationId,
      p_customer_id: user.id,
      p_agreed_price: agreedPrice ?? null,
    });

    const job = result?.job ?? {};
    const artisanUserId = result?.artisan_user_id;

    // Open the conversation now, so both sides have somewhere to coordinate
    // without hunting for a "message" button.
    if (artisanUserId) {
      await this.db.from('conversations').upsert({
        job_post_id: post.id,
        job_application_id: applicationId,
        customer_id: user.id,
        artisan_id: application.artisan_id,
        artisan_user_id: artisanUserId,
      }, { onConflict: 'job_post_id,artisan_id', ignoreDuplicates: true });

      await this.notifications.notify({
        userId: artisanUserId,
        type: NotificationType.ARTISAN_SELECTED,
        entityType: 'JOB',
        entityId: job.id,
        priority: 'HIGH',
        template: {
          jobTitle: post.title,
          actorName: [user.firstName, user.lastName].filter(Boolean).join(' ') || 'The customer',
        },
        data: { jobId: job.id, jobPostId: post.id, applicationId },
      });
    }

    // Everyone who lost deserves to hear it promptly rather than wondering.
    const { data: rejected } = await this.db
      .from('job_applications')
      .select('id, artisan_id')
      .eq('job_post_id', post.id)
      .eq('status', 'REJECTED')
      .neq('id', applicationId);

    if (rejected?.length) {
      const { data: losers } = await this.db
        .from('artisan_profiles')
        .select('id, user_id')
        .in('id', rejected.map((r: any) => r.artisan_id));

      await this.notifications.notifyMany((losers ?? []).map((artisan: any) => ({
        userId: artisan.user_id,
        type: NotificationType.APPLICATION_REJECTED,
        entityType: 'JOB_POST',
        entityId: post.id,
        template: { jobTitle: post.title },
        data: { jobPostId: post.id },
      })));
    }

    return {
      message: 'Artisan selected. They now need to accept the job.',
      job: {
        id: job.id,
        jobPostId: post.id,
        applicationId,
        artisanId: application.artisan_id,
        status: job.status ?? 'PENDING_ACCEPTANCE',
        agreedPrice: job.agreed_price ?? agreedPrice ?? application.proposed_price ?? null,
      },
    };
  }
}
