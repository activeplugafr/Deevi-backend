import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys, CacheTtl } from '../cache/cache-keys.js';
import { AuditService } from '../audit/audit.service.js';
import { AuthContextService } from '../auth/auth-context.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBucket } from '../storage/storage.constants.js';
import { DomainException } from '../common/errors/domain.exception.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type {
  AdminArtisansQueryDto, AdminUsersQueryDto, CreateAdminDto, ResolveDisputeDto,
  ReviewApplicationDto, UpdateReportDto,
} from './dto/admin.dto.js';

/**
 * Admin operations.
 *
 * Two rules hold throughout: authorization is by capability (see
 * ADMIN_ROLE_CAPABILITIES) rather than by trusting a role name from the
 * client, and every state-changing action writes an audit_logs row with the
 * before and after state.
 */
@Injectable()
export class AdminService {
  private readonly logger = new Logger(AdminService.name);

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly audit: AuditService,
    private readonly authContext: AuthContextService,
    private readonly notifications: NotificationsService,
    private readonly storage: StorageService,
  ) {}

  /* ------------------------------ metrics ------------------------------ */

  async getMetrics() {
    return this.cache.wrap(CacheKeys.adminMetrics(), CacheTtl.adminMetrics, () =>
      this.db.rpc<Record<string, unknown>>('deevi_admin_metrics'));
  }

  /** Time series for the dashboard chart, bucketed by day. */
  async getGrowth(days = 30) {
    const since = new Date(Date.now() - days * 86_400_000).toISOString();

    const [users, jobs, applications] = await Promise.all([
      this.db.from('users').select('created_at').gte('created_at', since).is('deleted_at', null),
      this.db.from('job_posts').select('created_at').gte('created_at', since).is('deleted_at', null),
      this.db.from('job_applications').select('created_at').gte('created_at', since),
    ]);

    const bucket = (rows: any[]) => {
      const counts = new Map<string, number>();
      for (const row of rows ?? []) {
        const day = row.created_at.slice(0, 10);
        counts.set(day, (counts.get(day) ?? 0) + 1);
      }
      return [...counts.entries()].sort().map(([date, count]) => ({ date, count }));
    };

    return {
      days,
      signups: bucket(users.data ?? []),
      jobPosts: bucket(jobs.data ?? []),
      applications: bucket(applications.data ?? []),
    };
  }

  /* ------------------------------- users ------------------------------- */

  async listUsers(query: AdminUsersQueryDto) {
    let builder = this.db
      .select('users',
        'id, email, first_name, last_name, phone, avatar_url, status, email_verified, last_active_at, created_at')
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    if (query.q) {
      const term = `%${query.q}%`;
      builder = builder.or(
        `first_name.ilike.${term},last_name.ilike.${term},email.ilike.${term},phone.ilike.${term}`,
      );
    }

    if (query.role) {
      const { data } = await this.db.from('user_roles').select('user_id').eq('role', query.role);
      const ids = (data ?? []).map((r: any) => r.user_id);
      if (!ids.length) {
        return { items: [], meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      }
      builder = builder.in('id', ids.slice(0, 10_000));
    }

    return this.db.paginate(builder, query.page, query.limit, 'admin:users');
  }

  async getUser(userId: string) {
    const user = await this.db.one<any>('users', '*', { id: userId }, 'User');

    const [roles, customer, artisan, admin, jobsPosted, jobsWorked, reports] = await Promise.all([
      this.db.from('user_roles').select('role').eq('user_id', userId),
      this.db.maybeOne('customer_profiles', '*', { user_id: userId }),
      this.db.maybeOne('artisan_profiles', '*', { user_id: userId }),
      this.db.maybeOne('admin_profiles', 'admin_role, is_active, permissions', { user_id: userId }),
      this.db.count('job_posts', { customer_id: userId }),
      this.db.count('jobs', { customer_id: userId }),
      this.db.count('reports', { reported_user_id: userId }),
    ]);

    return {
      ...user,
      roles: ((roles.data ?? []) as any[]).map((r) => r.role),
      customerProfile: customer,
      artisanProfile: artisan,
      adminProfile: admin,
      stats: { jobsPosted, jobsAsCustomer: jobsWorked, reportsAgainst: reports },
    };
  }

  async suspendUser(actor: AuthUser, userId: string, reason: string) {
    const before = await this.db.one<any>('users', 'id, status, auth_user_id, email', { id: userId }, 'User');

    if (before.id === actor.id) {
      throw new DomainException('CANNOT_SUSPEND_SELF', 'You cannot suspend your own account');
    }

    const after = await this.db.updateOne('users', { id: userId }, {
      status: 'SUSPENDED',
      suspended_at: new Date().toISOString(),
      suspension_reason: reason,
    }, 'id, status, suspended_at', 'User');

    // Drop the cached principal so the suspension bites on the next request
    // rather than up to a minute later.
    await this.authContext.invalidate(before.auth_user_id);

    await this.db.from('artisan_profiles')
      .update({ verification_status: 'SUSPENDED', suspended_at: new Date().toISOString() })
      .eq('user_id', userId);

    await this.audit.record(actor, {
      action: 'USER_SUSPENDED',
      entityType: 'USER',
      entityId: userId,
      summary: `Suspended ${before.email ?? userId}`,
      before, after, metadata: { reason },
    });

    await this.notifications.notify({
      userId,
      type: NotificationType.ACCOUNT_SUSPENDED,
      entityType: 'USER',
      entityId: userId,
      template: { reason },
      priority: 'HIGH',
    });

    return { message: 'User suspended', user: after };
  }

  async reinstateUser(actor: AuthUser, userId: string) {
    const before = await this.db.one<any>('users', 'id, status, auth_user_id, email', { id: userId }, 'User');

    const after = await this.db.updateOne('users', { id: userId }, {
      status: 'ACTIVE', suspended_at: null, suspension_reason: null,
    }, 'id, status', 'User');

    await this.authContext.invalidate(before.auth_user_id);

    await this.audit.record(actor, {
      action: 'USER_REINSTATED',
      entityType: 'USER',
      entityId: userId,
      summary: `Reinstated ${before.email ?? userId}`,
      before, after,
    });

    return { message: 'User reinstated', user: after };
  }

  /* ------------------------------ artisans ----------------------------- */

  async listArtisans(query: AdminArtisansQueryDto) {
    let builder = this.db
      .select('artisan_profiles',
        'id, user_id, headline, business_name, verification_status, availability_status, base_city, ' +
        'years_of_experience, rating_average, rating_count, jobs_completed_count, is_premium, ' +
        'profile_completion, approved_at, created_at, users(id, first_name, last_name, email, phone, status)')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (query.verificationStatus) builder = builder.eq('verification_status', query.verificationStatus);
    if (query.city) builder = builder.ilike('base_city', `%${query.city}%`);

    if (query.serviceId) {
      const { data } = await this.db.from('artisan_services').select('artisan_id').eq('service_id', query.serviceId);
      const ids = (data ?? []).map((r: any) => r.artisan_id);
      if (!ids.length) {
        return { items: [], meta: { page: query.page, limit: query.limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
      }
      builder = builder.in('id', ids.slice(0, 10_000));
    }

    return this.db.paginate(builder, query.page, query.limit, 'admin:artisans');
  }

  /** The verification queue, oldest submission first so nobody is forgotten. */
  async listApplications(status: string | undefined, page: number, limit: number) {
    let builder = this.db
      .select('artisan_applications',
        'id, artisan_id, status, submitted_at, reviewed_at, review_notes, rejection_reason, attempt, snapshot, created_at, ' +
        'artisan_profiles(id, headline, business_name, base_city, years_of_experience, profile_completion, ' +
        'users(id, first_name, last_name, email, phone))')
      .order('submitted_at', { ascending: true, nullsFirst: false });

    builder = status
      ? builder.eq('status', status)
      : builder.in('status', ['PENDING', 'UNDER_REVIEW']);

    return this.db.paginate(builder, page, limit, 'admin:applications');
  }

  async getApplication(applicationId: string) {
    const application = await this.db.one<any>(
      'artisan_applications', '*', { id: applicationId }, 'Artisan application',
    );

    const [artisan, documents, services, areas, portfolio] = await Promise.all([
      this.db.one('artisan_profiles', '*', { id: application.artisan_id }, 'Artisan profile'),
      this.db.from('verification_documents')
        .select('id, document_type, storage_path, original_filename, mime_type, size_bytes, status, review_notes, created_at')
        .eq('artisan_id', application.artisan_id).is('deleted_at', null),
      this.db.from('artisan_services').select('service_id, price_min, price_max, services(name, slug)')
        .eq('artisan_id', application.artisan_id),
      this.db.from('artisan_service_areas').select('city, state, neighbourhood, radius_km')
        .eq('artisan_id', application.artisan_id),
      this.db.from('artisan_portfolio_items').select('id, title, public_url, media_type')
        .eq('artisan_id', application.artisan_id).is('deleted_at', null),
    ]);

    const user = await this.db.one('users', 'id, first_name, last_name, email, phone, created_at',
      { id: (artisan as any).user_id }, 'User');

    return {
      ...application,
      artisan,
      user,
      documents: documents.data ?? [],
      services: services.data ?? [],
      serviceAreas: areas.data ?? [],
      portfolio: portfolio.data ?? [],
    };
  }

  /**
   * Signed URL for a verification document. Restricted to admins holding the
   * documents:read capability, and every access is audited -- these are
   * government IDs, and looking at one should leave a trace.
   */
  async getDocumentUrl(actor: AuthUser, documentId: string) {
    const doc = await this.db.one<any>(
      'verification_documents', 'id, artisan_id, storage_path, document_type', { id: documentId },
      'Verification document',
    );

    await this.audit.record(actor, {
      action: 'VERIFICATION_DOCUMENT_VIEWED',
      entityType: 'VERIFICATION_DOCUMENT',
      entityId: documentId,
      summary: `Viewed ${doc.document_type} for artisan ${doc.artisan_id}`,
      metadata: { artisanId: doc.artisan_id },
    });

    return this.storage.createSignedDownloadUrl(StorageBucket.VERIFICATION_DOCUMENTS, doc.storage_path);
  }

  /**
   * The verification decision. Approving here is what turns a signed-up
   * artisan into a Deevi marketplace artisan, so it is the single most
   * consequential admin action in the product.
   */
  async reviewApplication(actor: AuthUser, applicationId: string, dto: ReviewApplicationDto) {
    const application = await this.db.one<any>(
      'artisan_applications', 'id, artisan_id, status', { id: applicationId }, 'Artisan application',
    );

    if (['APPROVED', 'REJECTED'].includes(application.status)) {
      throw new DomainException(
        'APPLICATION_ALREADY_DECIDED',
        `This application was already ${application.status.toLowerCase()}`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.decision === 'REJECTED' && !dto.rejectionReason) {
      throw new DomainException(
        'REJECTION_REASON_REQUIRED',
        'Tell the artisan why, so they can fix it and reapply',
      );
    }

    const artisan = await this.db.one<any>(
      'artisan_profiles', 'id, user_id, verification_status', { id: application.artisan_id }, 'Artisan profile',
    );

    const now = new Date().toISOString();

    const updatedApplication = await this.db.updateIf<any>(
      'artisan_applications',
      { id: applicationId, status: application.status },
      {
        status: dto.decision,
        reviewed_by: actor.id,
        reviewed_at: now,
        review_notes: dto.notes ?? null,
        rejection_reason: dto.rejectionReason ?? null,
      },
      '*',
    );
    if (!updatedApplication) {
      throw new DomainException(
        'CONCURRENT_REVIEW',
        'Another admin reviewed this application first. Reload it.',
        HttpStatus.CONFLICT,
      );
    }

    await this.db.from('artisan_profiles').update({
      verification_status: dto.decision,
      ...(dto.decision === 'APPROVED' ? { approved_at: now } : {}),
    }).eq('id', artisan.id);

    if (dto.decision !== 'UNDER_REVIEW') {
      await this.db.from('verification_documents')
        .update({ status: dto.decision === 'APPROVED' ? 'APPROVED' : 'REJECTED', reviewed_by: actor.id, reviewed_at: now })
        .eq('application_id', applicationId);
    }

    // The artisan's cached principal carries their verification status, and
    // the feed gate reads it, so it must be dropped immediately.
    await this.authContext.invalidate(artisan.user_id);
    await this.cache.del(CacheKeys.publicArtisan(artisan.id), CacheKeys.adminMetrics());

    await this.audit.record(actor, {
      action: `ARTISAN_APPLICATION_${dto.decision}`,
      entityType: 'ARTISAN_APPLICATION',
      entityId: applicationId,
      summary: `${dto.decision} artisan ${artisan.id}`,
      before: { status: application.status, verificationStatus: artisan.verification_status },
      after: { status: dto.decision },
      metadata: { notes: dto.notes ?? null, rejectionReason: dto.rejectionReason ?? null },
    });

    const notificationType = dto.decision === 'APPROVED'
      ? NotificationType.ARTISAN_APPROVED
      : dto.decision === 'REJECTED'
        ? NotificationType.ARTISAN_REJECTED
        : NotificationType.ARTISAN_APPLICATION_UNDER_REVIEW;

    await this.notifications.notify({
      userId: artisan.user_id,
      type: notificationType,
      entityType: 'ARTISAN_APPLICATION',
      entityId: applicationId,
      priority: 'HIGH',
      template: { reason: dto.rejectionReason },
      data: { applicationId, decision: dto.decision },
    });

    return {
      message: `Application ${dto.decision.toLowerCase()}`,
      application: updatedApplication,
    };
  }

  async suspendArtisan(actor: AuthUser, artisanId: string, reason: string) {
    const artisan = await this.db.one<any>(
      'artisan_profiles', 'id, user_id, verification_status', { id: artisanId }, 'Artisan profile',
    );

    await this.db.from('artisan_profiles').update({
      verification_status: 'SUSPENDED',
      suspended_at: new Date().toISOString(),
      availability_status: 'UNAVAILABLE',
    }).eq('id', artisanId);

    await this.authContext.invalidate(artisan.user_id);
    await this.cache.del(CacheKeys.publicArtisan(artisanId));

    await this.audit.record(actor, {
      action: 'ARTISAN_SUSPENDED',
      entityType: 'ARTISAN',
      entityId: artisanId,
      summary: `Suspended artisan ${artisanId}`,
      before: { verificationStatus: artisan.verification_status },
      after: { verificationStatus: 'SUSPENDED' },
      metadata: { reason },
    });

    await this.notifications.notify({
      userId: artisan.user_id,
      type: NotificationType.ARTISAN_SUSPENDED,
      entityType: 'ARTISAN',
      entityId: artisanId,
      template: { reason },
      priority: 'HIGH',
    });

    return { message: 'Artisan suspended' };
  }

  /* --------------------------- jobs and bids --------------------------- */

  async listJobs(query: { page: number; limit: number; status?: string; q?: string }) {
    let builder = this.db
      .select('job_posts',
        'id, customer_id, title, status, urgency, service_id, city, state, budget_min, budget_max, ' +
        'applications_count, selected_artisan_id, published_at, created_at')
      .is('deleted_at', null)
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    if (query.q) builder = builder.ilike('title', `%${query.q}%`);

    return this.db.paginate(builder, query.page, query.limit, 'admin:jobs');
  }

  async getJob(jobPostId: string) {
    const post = await this.db.one<any>('job_posts', '*', { id: jobPostId }, 'Job post');

    const [applications, engagement, history, media] = await Promise.all([
      this.db.from('job_applications')
        .select('id, artisan_id, status, proposed_price, created_at')
        .eq('job_post_id', jobPostId),
      this.db.maybeOne('jobs', '*', { job_post_id: jobPostId }),
      this.db.from('job_status_history')
        .select('from_status, to_status, actor_role, reason, created_at')
        .eq('job_post_id', jobPostId).order('created_at', { ascending: true }),
      this.db.from('job_media').select('id, media_type, public_url').eq('job_post_id', jobPostId),
    ]);

    return {
      ...post,
      applications: applications.data ?? [],
      engagement,
      history: history.data ?? [],
      media: media.data ?? [],
    };
  }

  async listApplicationsAdmin(query: { page: number; limit: number; status?: string; jobPostId?: string }) {
    let builder = this.db
      .select('job_applications',
        'id, job_post_id, artisan_id, status, proposed_price, currency, is_boosted, created_at')
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    if (query.jobPostId) builder = builder.eq('job_post_id', query.jobPostId);

    return this.db.paginate(builder, query.page, query.limit, 'admin:applications-list');
  }

  /* --------------------------- moderation ------------------------------ */

  async listReports(query: { page: number; limit: number; status?: string; priority?: string; category?: string }) {
    let builder = this.db
      .select('reports',
        'id, reference, reporter_id, reported_user_id, job_post_id, job_id, category, description, ' +
        'status, priority, assigned_admin_id, resolved_at, created_at')
      .order('priority', { ascending: false })
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    else builder = builder.in('status', ['OPEN', 'UNDER_REVIEW']);
    if (query.priority) builder = builder.eq('priority', query.priority);
    if (query.category) builder = builder.eq('category', query.category);

    return this.db.paginate(builder, query.page, query.limit, 'admin:reports');
  }

  async getReport(reportId: string) {
    const report = await this.db.one<any>('reports', '*', { id: reportId }, 'Report');

    const [reporter, reported, relatedReports] = await Promise.all([
      this.db.maybeOne('users', 'id, first_name, last_name, email', { id: report.reporter_id }),
      report.reported_user_id
        ? this.db.maybeOne('users', 'id, first_name, last_name, email, status', { id: report.reported_user_id })
        : Promise.resolve(null),
      report.reported_user_id
        ? this.db.count('reports', { reported_user_id: report.reported_user_id })
        : Promise.resolve(0),
    ]);

    return { ...report, reporter, reportedUser: reported, totalReportsAgainstUser: relatedReports };
  }

  async updateReport(actor: AuthUser, reportId: string, dto: UpdateReportDto) {
    const before = await this.db.one<any>('reports', '*', { id: reportId }, 'Report');

    const values: Record<string, unknown> = {};
    if (dto.status) values.status = dto.status;
    if (dto.priority) values.priority = dto.priority;
    if (dto.assignedAdminId) values.assigned_admin_id = dto.assignedAdminId;
    if (dto.resolution) values.resolution = dto.resolution;
    if (dto.resolutionNotes) values.resolution_notes = dto.resolutionNotes;

    if (dto.status && ['RESOLVED', 'DISMISSED'].includes(dto.status)) {
      values.resolved_by = actor.id;
      values.resolved_at = new Date().toISOString();
    }

    const after = await this.db.updateOne('reports', { id: reportId }, values, '*', 'Report');

    await this.audit.record(actor, {
      action: 'REPORT_UPDATED',
      entityType: 'REPORT',
      entityId: reportId,
      summary: `Report ${before.reference} -> ${dto.status ?? before.status}`,
      before, after,
    });

    if (dto.status && dto.status !== before.status) {
      await this.notifications.notify({
        userId: before.reporter_id,
        type: NotificationType.REPORT_UPDATED,
        entityType: 'REPORT',
        entityId: reportId,
        template: { reference: before.reference, status: dto.status },
        data: { reportId, status: dto.status, resolution: dto.resolution ?? null },
      });
    }

    return after;
  }

  async listDisputes(query: { page: number; limit: number; status?: string }) {
    let builder = this.db
      .select('disputes',
        'id, reference, job_id, job_post_id, raised_by, raised_by_role, against_user_id, reason, ' +
        'status, assigned_admin_id, resolved_at, created_at')
      .order('created_at', { ascending: false });

    builder = query.status ? builder.eq('status', query.status) : builder.in('status', ['OPEN', 'UNDER_REVIEW']);
    return this.db.paginate(builder, query.page, query.limit, 'admin:disputes');
  }

  /**
   * Closes a dispute and puts the job somewhere valid again. A DISPUTED job
   * is frozen for its participants, so only this path can release it -- which
   * is exactly why the resolution and the resulting job status are recorded
   * together in the audit trail.
   */
  async resolveDispute(actor: AuthUser, disputeId: string, dto: ResolveDisputeDto) {
    const dispute = await this.db.one<any>('disputes', '*', { id: disputeId }, 'Dispute');

    if (['RESOLVED', 'DISMISSED'].includes(dispute.status)) {
      throw new DomainException(
        'DISPUTE_ALREADY_CLOSED',
        `This dispute was already ${dispute.status.toLowerCase()}`,
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date().toISOString();

    const updated = await this.db.updateIf<any>(
      'disputes',
      { id: disputeId, status: dispute.status },
      {
        status: dto.status,
        resolution: dto.resolution,
        resolution_notes: dto.notes ?? null,
        resolved_by: actor.id,
        resolved_at: now,
      },
      '*',
    );
    if (!updated) {
      throw new DomainException('CONCURRENT_RESOLUTION', 'Another admin resolved this first', HttpStatus.CONFLICT);
    }

    if (dto.jobOutcome) {
      const job = await this.db.maybeOne<any>('jobs', 'id, job_post_id, status', { id: dispute.job_id });
      if (job) {
        await this.db.from('jobs').update({
          status: dto.jobOutcome,
          ...(dto.jobOutcome === 'COMPLETED' ? { completed_at: now } : {}),
          ...(dto.jobOutcome === 'CANCELLED' ? { cancelled_at: now, cancelled_by: actor.id } : {}),
        }).eq('id', job.id);

        await this.db.from('job_posts').update({ status: dto.jobOutcome }).eq('id', job.job_post_id);

        await this.db.from('job_status_history').insert({
          job_post_id: job.job_post_id,
          job_id: job.id,
          entity: 'JOB',
          from_status: 'DISPUTED',
          to_status: dto.jobOutcome,
          changed_by: actor.id,
          actor_role: 'ADMIN',
          reason: dto.resolution,
        });
      }
    }

    await this.audit.record(actor, {
      action: `DISPUTE_${dto.status}`,
      entityType: 'DISPUTE',
      entityId: disputeId,
      summary: `Dispute ${dispute.reference} ${dto.status.toLowerCase()}`,
      before: dispute,
      after: updated,
      metadata: { jobOutcome: dto.jobOutcome ?? null },
    });

    const recipients = [dispute.raised_by, dispute.against_user_id].filter(Boolean) as string[];
    await this.notifications.notifyMany(recipients.map((userId) => ({
      userId,
      type: NotificationType.DISPUTE_UPDATED,
      entityType: 'DISPUTE',
      entityId: disputeId,
      priority: 'HIGH' as const,
      template: { reference: dispute.reference, status: dto.status },
      data: { disputeId, status: dto.status, resolution: dto.resolution },
    })));

    return { message: `Dispute ${dto.status.toLowerCase()}`, dispute: updated };
  }

  /* ------------------------------ reviews ------------------------------ */

  async listReviews(query: { page: number; limit: number; visible?: boolean; artisanId?: string }) {
    let builder = this.db
      .select('reviews', 'id, job_id, reviewer_id, reviewee_id, artisan_id, rating, comment, is_visible, hidden_reason, created_at')
      .order('created_at', { ascending: false });

    if (query.visible !== undefined) builder = builder.eq('is_visible', query.visible);
    if (query.artisanId) builder = builder.eq('artisan_id', query.artisanId);

    return this.db.paginate(builder, query.page, query.limit, 'admin:reviews');
  }

  /**
   * Hides a review from public view. It is never deleted: the rating history
   * has to remain reconstructible, and a hidden review can be restored.
   */
  async hideReview(actor: AuthUser, reviewId: string, reason: string) {
    const before = await this.db.one<any>('reviews', '*', { id: reviewId }, 'Review');

    const after = await this.db.updateOne('reviews', { id: reviewId }, {
      is_visible: false, hidden_reason: reason, hidden_by: actor.id,
    }, '*', 'Review');

    if (before.artisan_id) await this.cache.del(CacheKeys.publicArtisan(before.artisan_id));

    await this.audit.record(actor, {
      action: 'REVIEW_HIDDEN',
      entityType: 'REVIEW',
      entityId: reviewId,
      summary: `Hid review on job ${before.job_id}`,
      before, after, metadata: { reason },
    });

    return { message: 'Review hidden', review: after };
  }

  async restoreReview(actor: AuthUser, reviewId: string) {
    const before = await this.db.one<any>('reviews', '*', { id: reviewId }, 'Review');
    const after = await this.db.updateOne('reviews', { id: reviewId }, {
      is_visible: true, hidden_reason: null, hidden_by: null,
    }, '*', 'Review');

    if (before.artisan_id) await this.cache.del(CacheKeys.publicArtisan(before.artisan_id));
    await this.audit.record(actor, {
      action: 'REVIEW_RESTORED', entityType: 'REVIEW', entityId: reviewId, before, after,
    });

    return { message: 'Review restored', review: after };
  }

  /* --------------------------- subscriptions --------------------------- */

  async listSubscriptions(query: { page: number; limit: number; status?: string }) {
    let builder = this.db
      .select('subscriptions',
        'id, user_id, artisan_id, plan_id, status, provider, current_period_start, current_period_end, ' +
        'cancel_at_period_end, created_at, subscription_plans(code, name, amount, currency, billing_interval)')
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    return this.db.paginate(builder, query.page, query.limit, 'admin:subscriptions');
  }

  /* ------------------------- admin team management --------------------- */

  async listAdmins(page: number, limit: number) {
    const builder = this.db
      .select('admin_profiles', 'id, user_id, admin_role, is_active, created_at, users(id, first_name, last_name, email)')
      .order('created_at', { ascending: false });
    return this.db.paginate(builder, page, limit, 'admin:admins');
  }

  /**
   * Promotes an existing user to admin. Restricted to SUPER_ADMIN at the
   * route layer -- the ability to mint admins is the ability to do everything.
   */
  async createAdmin(actor: AuthUser, dto: CreateAdminDto) {
    const user = await this.db.one<any>('users', 'id, email, auth_user_id', { id: dto.userId }, 'User');

    const existing = await this.db.maybeOne('admin_profiles', 'id', { user_id: dto.userId });
    if (existing) {
      throw new DomainException('ALREADY_ADMIN', 'This user already has an admin profile', HttpStatus.CONFLICT);
    }

    const profile = await this.db.insertOne('admin_profiles', {
      user_id: dto.userId,
      admin_role: dto.adminRole,
      created_by: actor.id,
    }, 'id, user_id, admin_role, is_active');

    await this.db.from('user_roles')
      .upsert({ user_id: dto.userId, role: 'ADMIN' }, { onConflict: 'user_id,role', ignoreDuplicates: true });

    await this.authContext.invalidate(user.auth_user_id);

    await this.audit.record(actor, {
      action: 'ADMIN_CREATED',
      entityType: 'ADMIN_PROFILE',
      entityId: profile.id,
      summary: `Granted ${dto.adminRole} to ${user.email ?? dto.userId}`,
      after: profile,
    });

    return { message: `${user.email ?? dto.userId} is now a ${dto.adminRole}`, admin: profile };
  }

  async revokeAdmin(actor: AuthUser, userId: string) {
    if (userId === actor.id) {
      throw new DomainException('CANNOT_REVOKE_SELF', 'You cannot revoke your own admin access');
    }

    const user = await this.db.one<any>('users', 'id, email, auth_user_id', { id: userId }, 'User');
    const before = await this.db.one<any>('admin_profiles', '*', { user_id: userId }, 'Admin profile');

    await this.db.from('admin_profiles').update({ is_active: false }).eq('user_id', userId);
    await this.db.from('user_roles').delete().eq('user_id', userId).eq('role', 'ADMIN');
    await this.authContext.invalidate(user.auth_user_id);

    await this.audit.record(actor, {
      action: 'ADMIN_REVOKED',
      entityType: 'ADMIN_PROFILE',
      entityId: before.id,
      summary: `Revoked admin access for ${user.email ?? userId}`,
      before,
    });

    return { message: 'Admin access revoked' };
  }
}
