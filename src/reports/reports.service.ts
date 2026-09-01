import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { ConflictError, DomainException, ForbiddenError, NotFoundError } from '../common/errors/domain.exception.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { CreateDisputeDto, CreateReportDto, MyReportsQueryDto } from './dto/report.dto.js';

const REPORT_COLUMNS =
  'id, reference, reporter_id, reporter_role, reported_user_id, job_post_id, job_id, message_id, ' +
  'category, description, evidence_urls, status, priority, resolution, resolution_notes, resolved_at, created_at';

const DISPUTE_COLUMNS =
  'id, reference, job_id, job_post_id, report_id, raised_by, raised_by_role, against_user_id, ' +
  'reason, details, status, resolution, resolution_notes, resolved_at, created_at';

/** Reports that put someone at risk jump the queue rather than waiting their turn. */
const URGENT_CATEGORIES = ['SAFETY_CONCERN', 'FRAUD'];
const HIGH_CATEGORIES = ['NO_SHOW', 'INAPPROPRIATE_BEHAVIOUR', 'PAYMENT_ISSUE'];

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DatabaseService,
    private readonly notifications: NotificationsService,
  ) {}

  private priorityFor(category: string): string {
    if (URGENT_CATEGORIES.includes(category)) return 'URGENT';
    if (HIGH_CATEGORIES.includes(category)) return 'HIGH';
    return 'NORMAL';
  }

  async create(user: AuthUser, dto: CreateReportDto) {
    // A report must be about something the reporter was actually involved in,
    // otherwise the queue fills with noise from uninvolved accounts.
    if (dto.jobId) {
      const job = await this.db.maybeOne<any>('jobs', 'id, customer_id, artisan_id', { id: dto.jobId });
      if (!job) throw new NotFoundError('Job');
      const isParticipant = job.customer_id === user.id || job.artisan_id === user.artisanProfileId;
      if (!isParticipant) throw new ForbiddenError('You can only report a job you were part of');
    }

    if (dto.jobPostId) {
      const post = await this.db.maybeOne<any>('job_posts', 'id, customer_id', { id: dto.jobPostId });
      if (!post) throw new NotFoundError('Job post');
    }

    if (dto.reportedUserId === user.id) {
      throw new DomainException('CANNOT_REPORT_SELF', 'You cannot report yourself');
    }

    const report = await this.db.insertOne('reports', {
      reporter_id: user.id,
      reporter_role: user.roles[0] ?? null,
      reported_user_id: dto.reportedUserId ?? null,
      job_post_id: dto.jobPostId ?? null,
      job_id: dto.jobId ?? null,
      message_id: dto.messageId ?? null,
      category: dto.category,
      description: dto.description,
      evidence_urls: dto.evidenceUrls ?? [],
      status: 'OPEN',
      priority: this.priorityFor(dto.category),
    }, REPORT_COLUMNS);

    await this.notifications.notify({
      userId: user.id,
      type: NotificationType.REPORT_SUBMITTED,
      entityType: 'REPORT',
      entityId: report.id,
      template: { reference: report.reference },
      data: { reportId: report.id, reference: report.reference },
    });

    return report;
  }

  async listMine(user: AuthUser, query: MyReportsQueryDto) {
    let builder = this.db
      .select('reports', REPORT_COLUMNS)
      .eq('reporter_id', user.id)
      .order('created_at', { ascending: false });

    if (query.status) builder = builder.eq('status', query.status);
    return this.db.paginate(builder, query.page, query.limit, 'reports:mine');
  }

  async getMine(user: AuthUser, reportId: string) {
    const report = await this.db.maybeOne<any>('reports', REPORT_COLUMNS, {
      id: reportId, reporter_id: user.id,
    });
    if (!report) throw new NotFoundError('Report');
    return report;
  }

  /* ------------------------------ disputes ----------------------------- */

  /**
   * Escalates a live engagement into a dispute. Both the job and its post
   * move to DISPUTED, which freezes the normal lifecycle: from here only an
   * admin can resolve it in either direction.
   */
  async createDispute(user: AuthUser, dto: CreateDisputeDto) {
    const job = await this.db.maybeOne<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status', { id: dto.jobId },
    );
    if (!job) throw new NotFoundError('Job');

    const isCustomer = job.customer_id === user.id;
    const isArtisan = Boolean(user.artisanProfileId && job.artisan_id === user.artisanProfileId);
    if (!isCustomer && !isArtisan) {
      throw new ForbiddenError('You can only raise a dispute on a job you were part of');
    }

    if (['CANCELLED'].includes(job.status)) {
      throw new ConflictError('JOB_CANCELLED', 'This job was cancelled; raise a report instead');
    }

    const open = await this.db.maybeOne('disputes', 'id', { job_id: dto.jobId, status: 'OPEN' });
    if (open) throw new ConflictError('DISPUTE_ALREADY_OPEN', 'A dispute is already open on this job');

    const artisanUser = await this.db.maybeOne<any>('artisan_profiles', 'user_id', { id: job.artisan_id });
    const againstUserId = isCustomer ? artisanUser?.user_id ?? null : job.customer_id;

    const dispute = await this.db.insertOne('disputes', {
      job_id: dto.jobId,
      job_post_id: job.job_post_id,
      raised_by: user.id,
      raised_by_role: isCustomer ? 'CUSTOMER' : 'ARTISAN',
      against_user_id: againstUserId,
      reason: dto.reason,
      details: dto.details ?? null,
      status: 'OPEN',
    }, DISPUTE_COLUMNS);

    const now = new Date().toISOString();
    await this.db.from('jobs').update({ status: 'DISPUTED', disputed_at: now }).eq('id', dto.jobId);
    await this.db.from('job_posts').update({ status: 'DISPUTED' }).eq('id', job.job_post_id);

    await this.db.from('job_status_history').insert({
      job_post_id: job.job_post_id,
      job_id: job.id,
      entity: 'JOB',
      from_status: job.status,
      to_status: 'DISPUTED',
      changed_by: user.id,
      actor_role: isCustomer ? 'CUSTOMER' : 'ARTISAN',
      reason: dto.reason,
    });

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    const recipients = [user.id, againstUserId].filter(Boolean) as string[];

    await this.notifications.notifyMany(recipients.map((userId) => ({
      userId,
      type: NotificationType.DISPUTE_OPENED,
      entityType: 'DISPUTE',
      entityId: dispute.id,
      priority: 'HIGH' as const,
      template: { jobTitle: post?.title, reference: dispute.reference },
      data: { disputeId: dispute.id, jobId: job.id, reference: dispute.reference },
    })));

    return dispute;
  }

  async listMyDisputes(user: AuthUser, page: number, limit: number) {
    const builder = this.db
      .select('disputes', DISPUTE_COLUMNS)
      .or(`raised_by.eq.${user.id},against_user_id.eq.${user.id}`)
      .order('created_at', { ascending: false });
    return this.db.paginate(builder, page, limit, 'disputes:mine');
  }

  async getMyDispute(user: AuthUser, disputeId: string) {
    const dispute = await this.db.maybeOne<any>('disputes', DISPUTE_COLUMNS, { id: disputeId });
    if (!dispute) throw new NotFoundError('Dispute');

    if (dispute.raised_by !== user.id && dispute.against_user_id !== user.id && !user.roles.includes('ADMIN')) {
      throw new ForbiddenError('You are not party to this dispute');
    }
    return dispute;
  }
}
