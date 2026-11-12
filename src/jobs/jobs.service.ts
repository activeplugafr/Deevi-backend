import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { CustomersService } from '../customers/customers.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBucket } from '../storage/storage.constants.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { QueueService } from '../queue/queue.service.js';
import { JobName } from '../queue/queue.types.js';
import { loadConfiguration } from '../config/configuration.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import {
  DomainException, ForbiddenError, NotFoundError,
} from '../common/errors/domain.exception.js';
import {
  assertJobPostTransition, assertJobTransition, OPEN_JOB_POST_STATUSES,
  type Actor, type JobPostStatus, type JobStatus,
} from './job-lifecycle.js';
import type { ServiceLocationDto } from '../common/dto/location.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { CreateJobPostDto } from './dto/create-job.dto.js';
import type { MyJobsQueryDto, UpdateJobPostDto } from './dto/job-query.dto.js';
import { UploadedMediaFile } from './jobs.controller.js';
import { CloudinaryService } from '../../cloudinary.service.js';

/** Fields the owning customer sees, including the private location. */
const OWNER_JOB_COLUMNS = [
  'id', 'customer_id', 'category_id', 'service_id', 'sub_service_id', 'title', 'description',
  'status', 'urgency', 'budget_min', 'budget_max', 'budget_type', 'transport_fare', 'currency',
  'preferred_start_at', 'preferred_end_at', 'preferred_time_notes', 'is_flexible_timing',
  'saved_location_id', 'address_line', 'neighbourhood', 'city', 'state', 'country',
  'latitude', 'longitude', 'location_notes', 'location_source', 'additional_notes',
  'selected_application_id', 'selected_artisan_id', 'applications_count', 'shortlisted_count',
  'views_count', 'published_at', 'expires_at', 'completed_at', 'cancelled_at',
  'cancellation_reason', 'created_at', 'updated_at'
].join(', ');

/**
 * Fields any authenticated marketplace participant may see.
 * The exact street address and access notes are omitted on purpose: a job
 * board that leaks where someone lives is a safety problem, not a UX one.
 */
const PUBLIC_JOB_COLUMNS = [
  'id', 'customer_id', 'category_id', 'service_id', 'sub_service_id', 'title', 'description',
  'status', 'urgency', 'budget_min', 'budget_max', 'budget_type', 'currency', 'transport_fare',
  'preferred_start_at', 'preferred_time_notes', 'is_flexible_timing',
  'neighbourhood', 'city', 'state', 'applications_count',
  'published_at', 'expires_at', 'created_at',
].join(', ');

const LIST_JOB_COLUMNS = [
  'id', 'title', 'description', 'status', 'urgency', 'service_id', 'sub_service_id',
  'budget_min', 'budget_max', 'budget_type', 'currency', 'neighbourhood', 'city', 'state',
  'applications_count', 'shortlisted_count', 'selected_artisan_id',
  'published_at', 'expires_at', 'created_at',
].join(', ');

@Injectable()
export class JobsService {
  private readonly config = loadConfiguration();
  private readonly cloudinary: CloudinaryService;

  constructor(
    private readonly db: DatabaseService,
    private readonly catalogue: CatalogueService,
    private readonly customers: CustomersService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
    private readonly queue: QueueService,
  ) { }

  /**
   * Resolves the job's service location.
   *
   * A saved location is a starting point that explicit fields override, never
   * an implicit default. The result must be geocodable enough to rank against
   * artisan service areas: either a city, or coordinates.
   */
  private async resolveLocation(userId: string, input: ServiceLocationDto) {
    let base: Record<string, any> = {};

    if (input.savedLocationId) {
      const saved = await this.db.maybeOne<any>(
        'locations',
        'id, address_line, neighbourhood, city, state, country, latitude, longitude, notes',
        { id: input.savedLocationId, user_id: userId, deleted_at: null },
      );
      if (!saved) throw new NotFoundError('Saved location');

      base = {
        saved_location_id: saved.id,
        address_line: saved.address_line,
        neighbourhood: saved.neighbourhood,
        city: saved.city,
        state: saved.state,
        country: saved.country,
        latitude: saved.latitude,
        longitude: saved.longitude,
        location_notes: saved.notes,
        location_source: 'SAVED',
      };
    }

    const resolved = {
      saved_location_id: base.saved_location_id ?? null,
      address_line: input.addressLine ?? base.address_line ?? null,
      neighbourhood: input.neighbourhood ?? base.neighbourhood ?? null,
      city: input.city ?? base.city ?? null,
      state: input.state ?? base.state ?? null,
      country: input.country ?? base.country ?? 'NG',
      latitude: input.latitude ?? base.latitude ?? null,
      longitude: input.longitude ?? base.longitude ?? null,
      location_notes: input.locationNotes ?? base.location_notes ?? null,
      location_source: input.source ?? base.location_source ?? 'MANUAL',
    };

    if (!resolved.city && (resolved.latitude === null || resolved.longitude === null)) {
      throw new DomainException(
        'LOCATION_REQUIRED',
        'Tell us where the work is: pick a saved location, choose a point on the map, use your current ' +
        'location, or type at least a city.',
      );
    }

    return resolved;
  }

  // private async attachMedia(jobPostId: string, ownerId: string, media: JobMediaInputDto[]) {
  //   if (!media.length) return;

  //   if (media.length > this.config.jobs.maxMediaPerJob) {
  //     throw new DomainException(
  //       'TOO_MANY_MEDIA',
  //       `A job post can carry at most ${this.config.jobs.maxMediaPerJob} images or videos`,
  //     );
  //   }

  //   for (const item of media) this.storage.assertOwnership(item.storagePath, ownerId);

  //   await this.db.insertMany('job_media', media.map((item, index) => ({
  //     job_post_id: jobPostId,
  //     media_type: item.mediaType ?? 'IMAGE',
  //     storage_path: item.storagePath,
  //     public_url: this.storage.getPublicUrl(StorageBucket.JOB_MEDIA, item.storagePath),
  //     mime_type: item.mimeType ?? null,
  //     sort_order: item.sortOrder ?? index,
  //   })), 'id');
  // }



  private async attachMedia(jobPostId: string, ownerId: string, files: UploadedMediaFile[]) {
    for (const [index, file] of files.entries()) {
      const uploaded = await this.cloudinary.uploadImage(
        file,
        `deevi/job-posts/${jobPostId}`,
      );



      await this.db.insertOne('job_media', {
        job_post_id: jobPostId,
        media_type: 'IMAGE',
        storage_path: uploaded.storagePath,
        public_url: uploaded.secure_url,
        mime_type: file.mimetype ?? null,
        sort_order: index,
      }, 'id');
    }
  }


  private async recordStatusChange(
    jobPostId: string,
    from: string | null,
    to: string,
    actor: AuthUser | null,
    actorRole: Actor,
    reason?: string,
    jobId?: string,
  ) {
    await this.db.from('job_status_history').insert({
      job_post_id: jobPostId,
      job_id: jobId ?? null,
      entity: jobId ? 'JOB' : 'JOB_POST',
      from_status: from,
      to_status: to,
      changed_by: actor?.id ?? null,
      actor_role: actorRole,
      reason: reason ?? null,
    });
  }

  /* ------------------------------ create ------------------------------ */

  // async create(user: AuthUser, dto: CreateJobPostDto) 
  async create(
    user: AuthUser,
    dto: CreateJobPostDto,
    files: UploadedMediaFile[] = [],
  ) {
    await this.customers.ensureProfile(user);

    const service = await this.catalogue.resolveServiceReference(dto.serviceId, dto.subServiceId);
    const location = await this.resolveLocation(user.id, dto.location);

    if (dto.budgetMin !== undefined && dto.budgetMax !== undefined && dto.budgetMax < dto.budgetMin) {
      throw new DomainException('INVALID_BUDGET_RANGE', 'budgetMax cannot be lower than budgetMin');
    }

    const openCount = await this.db
      .from('job_posts')
      .select('id', { count: 'exact', head: true })
      .eq('customer_id', user.id)
      .is('deleted_at', null)
      .in('status', OPEN_JOB_POST_STATUSES);

    if ((openCount.count ?? 0) >= this.config.jobs.maxOpenJobsPerCustomer) {
      throw new DomainException(
        'TOO_MANY_OPEN_JOBS',
        `You already have ${openCount.count} open job posts. Close or cancel one before posting another.`,
        HttpStatus.CONFLICT,
      );
    }

    const publish = dto.publish ?? true;
    const now = new Date();
    const expiresAt = new Date(
      now.getTime() + (dto.expiresInDays ?? this.config.jobs.defaultExpiryDays) * 86_400_000,
    );

    const jobPost = await this.db.insertOne('job_posts', {
      customer_id: user.id,
      category_id: service.category_id,
      service_id: dto.serviceId,
      sub_service_id: dto.subServiceId ?? null,
      title: dto.title,
      description: dto.description,
      status: publish ? 'PUBLISHED' : 'DRAFT',
      urgency: dto.urgency ?? 'NORMAL',
      budget_min: dto.budgetMin ?? null,
      budget_max: dto.budgetMax ?? null,
      budget_type: dto.budgetType ?? 'NEGOTIABLE',
      transport_fare: dto.transport_fare ?? null,
      preferred_start_at: dto.preferredStartAt ?? null,
      preferred_end_at: dto.preferredEndAt ?? null,
      preferred_time_notes: dto.preferredTimeNotes ?? null,
      is_flexible_timing: dto.isFlexibleTiming ?? true,
      additional_notes: dto.additionalNotes ?? null,
      published_at: publish ? now.toISOString() : null,
      expires_at: publish ? expiresAt.toISOString() : null,
      ...location,
    }, OWNER_JOB_COLUMNS);

    // await this.attachMedia(jobPost.id, user.id, dto.media ?? []);
    await this.attachMedia(jobPost.id, user.id, files);
    await this.db.from('customer_profiles')
      .update({ jobs_posted_count: (await this.db.count('job_posts', { customer_id: user.id })) })
      .eq('user_id', user.id);

    await this.recordStatusChange(jobPost.id, null, jobPost.status, user, 'CUSTOMER', 'Job post created');

    if (publish) {
      await this.notifications.notify({
        userId: user.id,
        type: NotificationType.JOB_PUBLISHED,
        entityType: 'JOB_POST',
        entityId: jobPost.id,
        template: { jobTitle: jobPost.title },
        data: { jobPostId: jobPost.id },
      });
    }

    return { ...jobPost, media: await this.listMedia(jobPost.id) };
  }

  async listMedia(jobPostId: string) {
    const { data } = await this.db
      .from('job_media')
      .select('id, media_type, public_url, storage_path, sort_order')
      .eq('job_post_id', jobPostId)
      .order('sort_order', { ascending: true });
    return data ?? [];
  }

  /* ------------------------------- reads ------------------------------ */

  async listMine(user: AuthUser, query: MyJobsQueryDto) {
    let builder = this.db
      .select('job_posts', LIST_JOB_COLUMNS)
      .eq('customer_id', user.id)
      .is('deleted_at', null);

    if (query.status) builder = builder.eq('status', query.status);
    if (query.bucket === 'open') builder = builder.in('status', OPEN_JOB_POST_STATUSES);
    if (query.bucket === 'active') {
      builder = builder.in('status', ['ARTISAN_SELECTED', 'ACCEPTED', 'IN_PROGRESS']);
    }
    if (query.bucket === 'closed') {
      builder = builder.in('status', ['COMPLETED', 'CANCELLED', 'EXPIRED', 'DISPUTED']);
    }
    if (query.serviceId) builder = builder.eq('service_id', query.serviceId);
    if (query.q) builder = builder.ilike('title', `%${query.q}%`);

    builder = builder.order('created_at', { ascending: false });
    return this.db.paginate(builder, query.page, query.limit, 'jobs:mine');
  }

  /** Jobs an artisan is engaged on, from their side of the marketplace. */
  async listForArtisan(artisanId: string, page: number, limit: number, status?: string) {
    let builder = this.db
      .select(
        'jobs',
        'id, job_post_id, application_id, customer_id, status, agreed_price, currency, transport_fare,' +
        'started_at, completed_at, created_at, job_posts(id, title, city, neighbourhood, urgency, service_id)',
      )
      .eq('artisan_id', artisanId);

    if (status) builder = builder.eq('status', status);
    builder = builder.order('created_at', { ascending: false });

    return this.db.paginate(builder, page, limit, 'jobs:artisan');
  }

  /**
   * Returns a job post scoped to what the caller is allowed to see. The owner
   * gets the full record; an approved artisan gets the marketplace view with
   * the private address stripped.
   */
  async getOne(user: AuthUser, jobPostId: string) {
    const owner = await this.db.maybeOne<any>('job_posts', OWNER_JOB_COLUMNS, {
      id: jobPostId, deleted_at: null,
    });
    if (!owner) throw new NotFoundError('Job post');

    const isOwner = owner.customer_id === user.id;
    const isAdmin = user.roles.includes('ADMIN');
    const isSelectedArtisan = Boolean(
      user.artisanProfileId && owner.selected_artisan_id === user.artisanProfileId,
    );

    let hasApplied = false;
    if (user.artisanProfileId && !isSelectedArtisan) {
      hasApplied = (await this.db.count('job_applications', {
        job_post_id: jobPostId, artisan_id: user.artisanProfileId,
      })) > 0;
    }

    // Drafts are private to their owner until published.
    if (owner.status === 'DRAFT' && !isOwner && !isAdmin) throw new NotFoundError('Job post');

    const media = await this.listMedia(jobPostId);

    if (isOwner || isAdmin) {
      return { ...owner, media, viewerRole: isOwner ? 'OWNER' : 'ADMIN' };
    }

    // The exact address is released only once the artisan is engaged: before
    // selection they get the neighbourhood, which is enough to judge distance.
    const scoped = Object.fromEntries(
      Object.entries(owner).filter(([key]) =>
        PUBLIC_JOB_COLUMNS.includes(key) || (isSelectedArtisan && [
          'address_line', 'location_notes', 'latitude', 'longitude', 'selected_artisan_id',
        ].includes(key))),
    );

    return {
      ...scoped,
      media,
      hasApplied,
      viewerRole: isSelectedArtisan ? 'ENGAGED_ARTISAN' : 'MARKETPLACE',
    };
  }

  async getStatusHistory(user: AuthUser, jobPostId: string) {
    const post = await this.db.one<any>('job_posts', 'id, customer_id, selected_artisan_id', { id: jobPostId }, 'Job post');
    this.assertCanViewPrivate(user, post);

    const { data } = await this.db
      .from('job_status_history')
      .select('id, entity, from_status, to_status, actor_role, reason, created_at')
      .eq('job_post_id', jobPostId)
      .order('created_at', { ascending: true });
    return data ?? [];
  }

  private assertCanViewPrivate(user: AuthUser, post: { customer_id: string; selected_artisan_id?: string | null }) {
    const allowed =
      post.customer_id === user.id ||
      user.roles.includes('ADMIN') ||
      (user.artisanProfileId && post.selected_artisan_id === user.artisanProfileId);
    if (!allowed) throw new ForbiddenError('You do not have access to this job');
  }

  /* ---------------------------- mutations ----------------------------- */

  private async requireOwnedPost(user: AuthUser, jobPostId: string) {
    const post = await this.db.maybeOne<any>('job_posts', OWNER_JOB_COLUMNS, {
      id: jobPostId, deleted_at: null,
    });
    if (!post) throw new NotFoundError('Job post');
    if (post.customer_id !== user.id && !user.roles.includes('ADMIN')) {
      throw new ForbiddenError('You do not own this job post', 'NOT_JOB_OWNER');
    }
    return post;
  }

  /**
   * Content edits are only allowed while the post is still open. Once an
   * artisan has been selected, the terms they bid on must not move under them.
   */
  async update(user: AuthUser, jobPostId: string, dto: UpdateJobPostDto) {
    const post = await this.requireOwnedPost(user, jobPostId);

    if (!['DRAFT', ...OPEN_JOB_POST_STATUSES].includes(post.status)) {
      throw new DomainException(
        'JOB_NOT_EDITABLE',
        `A ${post.status} job post can no longer be edited. Cancel it and post again if the work changed.`,
        HttpStatus.CONFLICT,
      );
    }

    if (dto.budgetMin !== undefined && dto.budgetMax !== undefined && dto.budgetMax < dto.budgetMin) {
      throw new DomainException('INVALID_BUDGET_RANGE', 'budgetMax cannot be lower than budgetMin');
    }

    return this.db.updateOne('job_posts', { id: jobPostId }, compact({
      title: dto.title,
      description: dto.description,
      urgency: dto.urgency,
      budget_min: dto.budgetMin,
      budget_max: dto.budgetMax,
      budget_type: dto.budgetType,
      preferred_start_at: dto.preferredStartAt,
      preferred_time_notes: dto.preferredTimeNotes,
      transport_fare: dto.transportFare,
      additional_notes: dto.additionalNotes,
    }), OWNER_JOB_COLUMNS, 'Job post');
  }

  async updateLocation(user: AuthUser, jobPostId: string, input: ServiceLocationDto) {
    const post = await this.requireOwnedPost(user, jobPostId);
    if (!['DRAFT', ...OPEN_JOB_POST_STATUSES].includes(post.status)) {
      throw new DomainException(
        'JOB_NOT_EDITABLE',
        'The service location cannot change once an artisan has been selected',
        HttpStatus.CONFLICT,
      );
    }

    const location = await this.resolveLocation(user.id, input);
    return this.db.updateOne('job_posts', { id: jobPostId }, location, OWNER_JOB_COLUMNS, 'Job post');
  }

  async publish(user: AuthUser, jobPostId: string) {
    const post = await this.requireOwnedPost(user, jobPostId);
    assertJobPostTransition(post.status as JobPostStatus, 'PUBLISHED', 'CUSTOMER');

    const now = new Date();
    const updated = await this.db.updateIf<any>(
      'job_posts',
      { id: jobPostId, status: post.status },
      {
        status: 'PUBLISHED',
        published_at: now.toISOString(),
        expires_at: new Date(now.getTime() + this.config.jobs.defaultExpiryDays * 86_400_000).toISOString(),
      },
      OWNER_JOB_COLUMNS,
    );

    if (!updated) {
      throw new DomainException(
        'CONCURRENT_MODIFICATION', 'This job post changed while you were publishing it. Reload and try again.',
        HttpStatus.CONFLICT,
      );
    }

    await this.recordStatusChange(jobPostId, post.status, 'PUBLISHED', user, 'CUSTOMER', 'Published');
    await this.notifications.notify({
      userId: user.id,
      type: NotificationType.JOB_PUBLISHED,
      entityType: 'JOB_POST',
      entityId: jobPostId,
      template: { jobTitle: updated.title },
      data: { jobPostId },
    });

    return updated;
  }

  async addMedia(user: AuthUser, jobPostId: string, media: UploadedMediaFile[]) {
    const post = await this.requireOwnedPost(user, jobPostId);
    const existing = await this.db.count('job_media', { job_post_id: jobPostId });

    if (existing + media.length > this.config.jobs.maxMediaPerJob) {
      throw new DomainException(
        'TOO_MANY_MEDIA',
        `A job post can carry at most ${this.config.jobs.maxMediaPerJob} images or videos`,
      );
    }

    await this.attachMedia(post.id, user.id, media);
    return this.listMedia(jobPostId);
  }

  async removeMedia(user: AuthUser, jobPostId: string, mediaId: string) {
    await this.requireOwnedPost(user, jobPostId);
    const item = await this.db.maybeOne<any>('job_media', 'id, storage_path', {
      id: mediaId, job_post_id: jobPostId,
    });
    if (!item) throw new NotFoundError('Job media');

    await this.db.from('job_media').delete().eq('id', mediaId);
    await this.storage.remove(StorageBucket.JOB_MEDIA, [item.storage_path]);
    return { message: 'Media removed' };
  }

  /* ------------------------- lifecycle actions ------------------------ */

  /** Cancels an open job post and closes every outstanding application. */
  async cancel(user: AuthUser, jobPostId: string, reason: string) {
    const post = await this.requireOwnedPost(user, jobPostId);
    const actor: Actor = user.roles.includes('ADMIN') && post.customer_id !== user.id ? 'ADMIN' : 'CUSTOMER';
    assertJobPostTransition(post.status as JobPostStatus, 'CANCELLED', actor);

    const updated = await this.db.updateIf<any>(
      'job_posts',
      { id: jobPostId, status: post.status },
      { status: 'CANCELLED', cancelled_at: new Date().toISOString(), cancellation_reason: reason },
      'id, title, status, selected_artisan_id',
    );
    if (!updated) {
      throw new DomainException(
        'CONCURRENT_MODIFICATION', 'This job changed while you were cancelling it. Reload and try again.',
        HttpStatus.CONFLICT,
      );
    }

    const { data: openApplications } = await this.db
      .from('job_applications')
      .update({ status: 'REJECTED', responded_at: new Date().toISOString(), rejection_reason: 'Job cancelled by customer' })
      .eq('job_post_id', jobPostId)
      .in('status', ['SUBMITTED', 'SHORTLISTED'])
      .select('artisan_id');

    const engagement = await this.db.maybeOne<any>('jobs', 'id, artisan_id, status', { job_post_id: jobPostId });
    if (engagement && !['COMPLETED', 'CANCELLED'].includes(engagement.status)) {
      await this.db.from('jobs').update({
        status: 'CANCELLED',
        cancelled_at: new Date().toISOString(),
        cancelled_by: user.id,
        cancellation_reason: reason,
      }).eq('id', engagement.id);
    }

    await this.recordStatusChange(jobPostId, post.status, 'CANCELLED', user, actor, reason);
    await this.notifyArtisans(
      [...(openApplications ?? []).map((a: any) => a.artisan_id), engagement?.artisan_id].filter(Boolean),
      NotificationType.JOB_CANCELLED,
      { jobTitle: updated.title, reason },
      jobPostId,
    );

    return { message: 'Job post cancelled', status: 'CANCELLED' };
  }

  /** The selected artisan accepts the engagement. */
  async acceptEngagement(user: AuthUser, jobId: string) {
    const job = await this.db.one<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status', { id: jobId }, 'Job',
    );
    if (job.artisan_id !== user.artisanProfileId) {
      throw new ForbiddenError('You are not the artisan on this job');
    }
    assertJobTransition(job.status as JobStatus, 'ACCEPTED', 'ARTISAN');

    const now = new Date().toISOString();
    const updated = await this.db.updateIf<any>(
      'jobs', { id: jobId, status: job.status },
      { status: 'ACCEPTED', artisan_accepted_at: now }, 'id, status',
    );
    if (!updated) {
      throw new DomainException('CONCURRENT_MODIFICATION', 'This job just changed. Reload and try again.', HttpStatus.CONFLICT);
    }

    await this.db.from('job_posts').update({ status: 'ACCEPTED' }).eq('id', job.job_post_id);
    await this.recordStatusChange(job.job_post_id, 'ARTISAN_SELECTED', 'ACCEPTED', user, 'ARTISAN', 'Artisan accepted', jobId);

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    await this.notifications.notify({
      userId: job.customer_id,
      type: NotificationType.JOB_ACCEPTED_BY_ARTISAN,
      entityType: 'JOB',
      entityId: jobId,
      template: { jobTitle: post?.title, actorName: `${user.firstName ?? 'Your artisan'}` },
      data: { jobId, jobPostId: job.job_post_id },
    });

    return { message: 'Job accepted', status: 'ACCEPTED' };
  }

  /**
   * The selected artisan declines. The post goes back to the market rather
   * than dying, so the customer is not forced to re-post from scratch.
   */
  async declineEngagement(user: AuthUser, jobId: string, reason?: string) {
    const job = await this.db.one<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, application_id, status', { id: jobId }, 'Job',
    );
    if (job.artisan_id !== user.artisanProfileId) {
      throw new ForbiddenError('You are not the artisan on this job');
    }
    if (job.status !== 'PENDING_ACCEPTANCE') {
      throw new DomainException(
        'CANNOT_DECLINE',
        'You can only decline before accepting. Cancel the job instead.',
        HttpStatus.CONFLICT,
      );
    }

    const now = new Date().toISOString();
    await this.db.from('jobs').update({
      status: 'CANCELLED', artisan_declined_at: now, decline_reason: reason ?? null,
      cancelled_at: now, cancelled_by: user.id,
    }).eq('id', jobId);

    await this.db.from('job_applications')
      .update({ status: 'WITHDRAWN', withdrawn_at: now })
      .eq('id', job.application_id);

    await this.db.from('job_posts').update({
      status: 'RECEIVING_APPLICATIONS',
      selected_application_id: null,
      selected_artisan_id: null,
    }).eq('id', job.job_post_id);

    await this.recordStatusChange(
      job.job_post_id, 'ARTISAN_SELECTED', 'RECEIVING_APPLICATIONS', user, 'ARTISAN',
      reason ?? 'Artisan declined', jobId,
    );

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    await this.notifications.notify({
      userId: job.customer_id,
      type: NotificationType.JOB_DECLINED_BY_ARTISAN,
      entityType: 'JOB_POST',
      entityId: job.job_post_id,
      template: { jobTitle: post?.title, actorName: user.firstName ?? 'The artisan', reason },
      data: { jobPostId: job.job_post_id },
    });

    return { message: 'Job declined. The post is open to applications again.' };
  }

  async startWork(user: AuthUser, jobId: string) {
    const job = await this.db.one<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status', { id: jobId }, 'Job',
    );
    const actor = this.actorFor(user, job);
    assertJobTransition(job.status as JobStatus, 'IN_PROGRESS', actor);

    const updated = await this.db.updateIf<any>(
      'jobs', { id: jobId, status: job.status },
      { status: 'IN_PROGRESS', started_at: new Date().toISOString() }, 'id, status',
    );
    if (!updated) {
      throw new DomainException('CONCURRENT_MODIFICATION', 'This job just changed. Reload and try again.', HttpStatus.CONFLICT);
    }

    await this.db.from('job_posts').update({ status: 'IN_PROGRESS' }).eq('id', job.job_post_id);
    await this.recordStatusChange(job.job_post_id, 'ACCEPTED', 'IN_PROGRESS', user, actor, 'Work started', jobId);
    await this.notifyCounterparty(user, job, NotificationType.JOB_STATUS_CHANGED, { status: 'IN_PROGRESS' });

    return { message: 'Work marked as started', status: 'IN_PROGRESS' };
  }

  /** The artisan flags the work done; the customer still has to confirm. */
  async markArtisanComplete(user: AuthUser, jobId: string) {
    const job = await this.db.one<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status, artisan_completed_at', { id: jobId }, 'Job',
    );
    if (job.artisan_id !== user.artisanProfileId) {
      throw new ForbiddenError('You are not the artisan on this job');
    }
    if (job.status !== 'IN_PROGRESS') {
      throw new DomainException(
        'JOB_NOT_IN_PROGRESS', 'Start the job before marking it finished', HttpStatus.CONFLICT,
      );
    }

    await this.db.from('jobs').update({ artisan_completed_at: new Date().toISOString() }).eq('id', jobId);

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    await this.notifications.notify({
      userId: job.customer_id,
      type: NotificationType.JOB_STATUS_CHANGED,
      entityType: 'JOB',
      entityId: jobId,
      template: { jobTitle: post?.title, status: 'awaiting your confirmation' },
      data: { jobId, awaitingCustomerConfirmation: true },
    });

    return {
      message: 'Marked as finished. Waiting for the customer to confirm completion.',
      status: 'IN_PROGRESS',
      awaitingCustomerConfirmation: true,
    };
  }

  /**
   * Completion is the customer's call. Only they can close the loop, which is
   * what makes the resulting review meaningful.
   */
  async complete(user: AuthUser, jobId: string) {
    const job = await this.db.one<any>(
      'jobs', 'id, job_post_id, customer_id, artisan_id, status', { id: jobId }, 'Job',
    );
    const actor: Actor = user.roles.includes('ADMIN') && job.customer_id !== user.id ? 'ADMIN' : 'CUSTOMER';
    if (actor === 'CUSTOMER' && job.customer_id !== user.id) {
      throw new ForbiddenError('Only the customer can confirm completion');
    }
    assertJobTransition(job.status as JobStatus, 'COMPLETED', actor);

    const now = new Date().toISOString();
    const updated = await this.db.updateIf<any>(
      'jobs', { id: jobId, status: job.status },
      { status: 'COMPLETED', completed_at: now, customer_confirmed_at: now }, 'id, status',
    );
    if (!updated) {
      throw new DomainException('CONCURRENT_MODIFICATION', 'This job just changed. Reload and try again.', HttpStatus.CONFLICT);
    }

    await this.db.from('job_posts')
      .update({ status: 'COMPLETED', completed_at: now })
      .eq('id', job.job_post_id);

    // Derived counters, kept in the profile so feed ranking stays a single query.
    const completed = await this.db.count('jobs', { artisan_id: job.artisan_id, status: 'COMPLETED' });
    await this.db.from('artisan_profiles')
      .update({ jobs_completed_count: completed })
      .eq('id', job.artisan_id);

    const customerCompleted = await this.db.count('jobs', { customer_id: job.customer_id, status: 'COMPLETED' });
    await this.db.from('customer_profiles')
      .update({ jobs_completed_count: customerCompleted })
      .eq('user_id', job.customer_id);

    await this.recordStatusChange(job.job_post_id, 'IN_PROGRESS', 'COMPLETED', user, actor, 'Completed', jobId);

    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    const artisan = await this.db.maybeOne<any>('artisan_profiles', 'user_id', { id: job.artisan_id });

    await this.notifications.notifyMany([
      {
        userId: job.customer_id, type: NotificationType.JOB_COMPLETED, entityType: 'JOB', entityId: jobId,
        template: { jobTitle: post?.title }, data: { jobId },
      },
      ...(artisan ? [{
        userId: artisan.user_id, type: NotificationType.JOB_COMPLETED, entityType: 'JOB', entityId: jobId,
        template: { jobTitle: post?.title }, data: { jobId },
      }] : []),
    ]);

    // Nudge the customer to review a day later, if they have not already.
    await this.queue.enqueue(JobName.REVIEW_REMINDER, { jobId }, {
      delaySeconds: 86_400, dedupeKey: `review-reminder:${jobId}`,
    });

    return { message: 'Job completed', status: 'COMPLETED' };
  }

  private actorFor(user: AuthUser, job: { customer_id: string; artisan_id: string }): Actor {
    if (job.customer_id === user.id) return 'CUSTOMER';
    if (user.artisanProfileId && job.artisan_id === user.artisanProfileId) return 'ARTISAN';
    if (user.roles.includes('ADMIN')) return 'ADMIN';
    throw new ForbiddenError('You are not a participant on this job');
  }

  private async notifyCounterparty(
    user: AuthUser,
    job: { id: string; job_post_id: string; customer_id: string; artisan_id: string },
    type: string,
    template: Record<string, unknown>,
  ) {
    const post = await this.db.maybeOne<any>('job_posts', 'title', { id: job.job_post_id });
    const artisan = await this.db.maybeOne<any>('artisan_profiles', 'user_id', { id: job.artisan_id });
    const recipientId = job.customer_id === user.id ? artisan?.user_id : job.customer_id;
    if (!recipientId) return;

    await this.notifications.notify({
      userId: recipientId,
      type,
      entityType: 'JOB',
      entityId: job.id,
      template: { jobTitle: post?.title, ...template },
      data: { jobId: job.id, jobPostId: job.job_post_id },
    });
  }

  private async notifyArtisans(
    artisanIds: string[],
    type: string,
    template: Record<string, unknown>,
    jobPostId: string,
  ) {
    const unique = [...new Set(artisanIds)];
    if (!unique.length) return;

    const { data } = await this.db.from('artisan_profiles').select('user_id').in('id', unique);
    await this.notifications.notifyMany((data ?? []).map((row: any) => ({
      userId: row.user_id,
      type,
      entityType: 'JOB_POST',
      entityId: jobPostId,
      template,
      data: { jobPostId },
    })));
  }
}
