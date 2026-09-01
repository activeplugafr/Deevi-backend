import { HttpStatus, Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CatalogueService } from '../catalogue/catalogue.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys, CacheTtl } from '../cache/cache-keys.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBucket } from '../storage/storage.constants.js';
import { NotificationsService } from '../notifications/notifications.service.js';
import { NotificationType } from '../notifications/notification-types.js';
import { DomainException, NotFoundError } from '../common/errors/domain.exception.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type {
  ArtisanServiceInputDto, UpdateArtisanProfileDto,
} from './dto/artisan-profile.dto.js';
import type {
  AddPortfolioItemDto, AvailabilitySlotDto, ServiceAreaInputDto,
} from './dto/artisan-onboarding.dto.js';

export const ARTISAN_PROFILE_COLUMNS = [
  'id', 'user_id', 'headline', 'bio', 'business_name', 'years_of_experience',
  'verification_status', 'availability_status', 'base_city', 'base_state',
  'base_latitude', 'base_longitude', 'max_travel_km', 'rating_average', 'rating_count',
  'jobs_completed_count', 'applications_count', 'acceptance_count', 'response_rate',
  'profile_completion', 'is_premium', 'premium_until', 'approved_at', 'last_active_at', 'created_at',
].join(', ');

/** Fields safe to show to anyone browsing the marketplace. */
export const ARTISAN_PUBLIC_COLUMNS = [
  'id', 'user_id', 'headline', 'bio', 'business_name', 'years_of_experience',
  'verification_status', 'availability_status', 'base_city', 'base_state',
  'rating_average', 'rating_count', 'jobs_completed_count', 'is_premium', 'created_at',
].join(', ');

@Injectable()
export class ArtisansService {
  constructor(
    private readonly db: DatabaseService,
    private readonly catalogue: CatalogueService,
    private readonly cache: CacheService,
    private readonly storage: StorageService,
    private readonly notifications: NotificationsService,
  ) {}

  /** Resolves the caller's artisan profile id, or explains how to get one. */
  requireArtisanId(user: AuthUser): string {
    if (!user.artisanProfileId) {
      throw new DomainException(
        'NOT_AN_ARTISAN',
        'This action requires an artisan profile. Register with role=ARTISAN.',
        HttpStatus.FORBIDDEN,
      );
    }
    return user.artisanProfileId;
  }

  /**
   * Approved status is what separates a signed-up artisan from a Deevi
   * marketplace artisan. Everything that touches live jobs goes through here.
   */
  assertApproved(user: AuthUser): string {
    const artisanId = this.requireArtisanId(user);
    if (user.artisanVerificationStatus !== 'APPROVED') {
      throw new DomainException(
        'ARTISAN_NOT_APPROVED',
        `Your artisan account is ${(user.artisanVerificationStatus ?? 'PENDING').toLowerCase()}. ` +
        'Complete verification before applying to jobs.',
        HttpStatus.FORBIDDEN,
      );
    }
    return artisanId;
  }

  async getMyProfile(user: AuthUser) {
    const artisanId = this.requireArtisanId(user);
    const [profile, services, areas, availability, portfolio, application] = await Promise.all([
      this.db.one('artisan_profiles', ARTISAN_PROFILE_COLUMNS, { id: artisanId }, 'Artisan profile'),
      this.listServices(artisanId),
      this.listServiceAreas(artisanId),
      this.listAvailability(artisanId),
      this.listPortfolio(artisanId),
      this.getLatestApplication(artisanId),
    ]);

    return {
      ...profile,
      services,
      serviceAreas: areas,
      availability,
      portfolio,
      application,
      profileCompletion: this.scoreCompletion(profile, services, areas, portfolio),
    };
  }

  async updateMyProfile(user: AuthUser, dto: UpdateArtisanProfileDto) {
    const artisanId = this.requireArtisanId(user);

    const updated = await this.db.updateOne('artisan_profiles', { id: artisanId }, compact({
      headline: dto.headline,
      bio: dto.bio,
      business_name: dto.businessName,
      years_of_experience: dto.yearsOfExperience,
      base_city: dto.baseCity,
      base_state: dto.baseState,
      base_latitude: dto.baseLatitude,
      base_longitude: dto.baseLongitude,
      max_travel_km: dto.maxTravelKm,
      availability_status: dto.availabilityStatus,
      last_active_at: new Date().toISOString(),
    }), ARTISAN_PROFILE_COLUMNS, 'Artisan profile');

    await this.cache.del(CacheKeys.publicArtisan(artisanId));
    await this.refreshCompletion(artisanId);
    return updated;
  }

  /* ------------------------------ services ----------------------------- */

  async listServices(artisanId: string) {
    const { data } = await this.db
      .from('artisan_services')
      .select(
        'id, service_id, sub_service_id, price_min, price_max, price_unit, years_experience, ' +
        'services(id, name, slug, category_id), sub_services(id, name, slug)',
      )
      .eq('artisan_id', artisanId);
    return data ?? [];
  }

  /**
   * Replaces the artisan services set. Done as delete-then-insert because the
   * list is small and a wholesale replace is far easier for clients to reason
   * about than a diff protocol.
   */
  async setServices(user: AuthUser, services: ArtisanServiceInputDto[]) {
    const artisanId = this.requireArtisanId(user);

    if (!services.length) {
      throw new DomainException('NO_SERVICES', 'Select at least one service you offer');
    }
    if (services.length > 20) {
      throw new DomainException('TOO_MANY_SERVICES', 'You can offer at most 20 services');
    }

    // Validate every reference before touching anything.
    for (const entry of services) {
      await this.catalogue.resolveServiceReference(entry.serviceId, entry.subServiceId);
      if (entry.priceMin !== undefined && entry.priceMax !== undefined && entry.priceMax < entry.priceMin) {
        throw new DomainException('INVALID_PRICE_RANGE', 'priceMax cannot be lower than priceMin');
      }
    }

    const deduped = new Map<string, ArtisanServiceInputDto>();
    for (const entry of services) {
      deduped.set(`${entry.serviceId}:${entry.subServiceId ?? ''}`, entry);
    }

    await this.db.from('artisan_services').delete().eq('artisan_id', artisanId);

    await this.db.insertMany('artisan_services', [...deduped.values()].map((entry, index) => ({
      artisan_id: artisanId,
      service_id: entry.serviceId,
      sub_service_id: entry.subServiceId ?? null,
      price_min: entry.priceMin ?? null,
      price_max: entry.priceMax ?? null,
      price_unit: entry.priceUnit ?? 'PER_JOB',
      years_experience: entry.yearsExperience ?? 0,
      is_primary: index === 0,
    })), 'id');

    await this.cache.del(CacheKeys.publicArtisan(artisanId));
    await this.refreshCompletion(artisanId);
    return this.listServices(artisanId);
  }

  /* ---------------------------- service areas -------------------------- */

  async listServiceAreas(artisanId: string) {
    const { data } = await this.db
      .from('artisan_service_areas')
      .select('id, label, neighbourhood, city, state, country, latitude, longitude, radius_km, is_primary')
      .eq('artisan_id', artisanId)
      .order('is_primary', { ascending: false });
    return data ?? [];
  }

  async setServiceAreas(user: AuthUser, areas: ServiceAreaInputDto[]) {
    const artisanId = this.requireArtisanId(user);

    if (!areas.length) {
      throw new DomainException('NO_SERVICE_AREAS', 'Add at least one area where you can work');
    }
    if (areas.length > 10) {
      throw new DomainException('TOO_MANY_SERVICE_AREAS', 'You can cover at most 10 service areas');
    }

    await this.db.from('artisan_service_areas').delete().eq('artisan_id', artisanId);

    await this.db.insertMany('artisan_service_areas', areas.map((area, index) => ({
      artisan_id: artisanId,
      label: area.label ?? null,
      neighbourhood: area.neighbourhood ?? null,
      city: area.city,
      state: area.state ?? null,
      latitude: area.latitude ?? null,
      longitude: area.longitude ?? null,
      radius_km: area.radiusKm ?? 10,
      is_primary: index === 0,
    })), 'id');

    await this.refreshCompletion(artisanId);
    return this.listServiceAreas(artisanId);
  }

  /* ---------------------------- availability --------------------------- */

  async listAvailability(artisanId: string) {
    const { data } = await this.db
      .from('artisan_availability')
      .select('id, day_of_week, start_time, end_time')
      .eq('artisan_id', artisanId)
      .order('day_of_week', { ascending: true });
    return data ?? [];
  }

  async setAvailability(user: AuthUser, slots: AvailabilitySlotDto[]) {
    const artisanId = this.requireArtisanId(user);

    for (const slot of slots) {
      if (slot.endTime <= slot.startTime) {
        throw new DomainException(
          'INVALID_AVAILABILITY_WINDOW',
          `Availability on day ${slot.dayOfWeek} ends at or before it starts`,
        );
      }
    }

    await this.db.from('artisan_availability').delete().eq('artisan_id', artisanId);
    await this.db.insertMany('artisan_availability', slots.map((slot) => ({
      artisan_id: artisanId,
      day_of_week: slot.dayOfWeek,
      start_time: slot.startTime,
      end_time: slot.endTime,
    })), 'id');

    return this.listAvailability(artisanId);
  }

  /* ------------------------------ portfolio ---------------------------- */

  async listPortfolio(artisanId: string) {
    const { data } = await this.db
      .from('artisan_portfolio_items')
      .select('id, title, description, storage_path, public_url, media_type, sort_order, created_at')
      .eq('artisan_id', artisanId)
      .is('deleted_at', null)
      .order('sort_order', { ascending: true });
    return data ?? [];
  }

  async addPortfolioItem(user: AuthUser, dto: AddPortfolioItemDto) {
    const artisanId = this.requireArtisanId(user);

    // The upload ticket namespaces objects by user id; re-check it here so a
    // client cannot attach somebody else's file to their own profile.
    this.storage.assertOwnership(dto.storagePath, user.id);

    const existing = await this.db.count('artisan_portfolio_items', {
      artisan_id: artisanId, deleted_at: null,
    });
    if (existing >= 20) {
      throw new DomainException('PORTFOLIO_FULL', 'You can showcase at most 20 portfolio items');
    }

    const item = await this.db.insertOne('artisan_portfolio_items', {
      artisan_id: artisanId,
      title: dto.title ?? null,
      description: dto.description ?? null,
      storage_path: dto.storagePath,
      public_url: this.storage.getPublicUrl(StorageBucket.PORTFOLIO, dto.storagePath),
      media_type: dto.mediaType ?? 'IMAGE',
      sort_order: dto.sortOrder ?? existing,
    });

    await this.cache.del(CacheKeys.publicArtisan(artisanId));
    await this.refreshCompletion(artisanId);
    return item;
  }

  async removePortfolioItem(user: AuthUser, itemId: string) {
    const artisanId = this.requireArtisanId(user);
    const item = await this.db.maybeOne<any>('artisan_portfolio_items', 'id, storage_path', {
      id: itemId, artisan_id: artisanId,
    });
    if (!item) throw new NotFoundError('Portfolio item');

    await this.db.updateOne('artisan_portfolio_items', { id: itemId },
      { deleted_at: new Date().toISOString() }, 'id', 'Portfolio item');
    await this.storage.remove(StorageBucket.PORTFOLIO, [item.storage_path]);
    await this.cache.del(CacheKeys.publicArtisan(artisanId));

    return { message: 'Portfolio item removed' };
  }

  /* ------------------------- public marketplace ------------------------ */

  /**
   * The public artisan profile. Only approved artisans are browsable, and the
   * payload deliberately excludes contact details, exact coordinates and
   * anything from the verification file.
   */
  async getPublicProfile(artisanId: string) {
    return this.cache.wrap(CacheKeys.publicArtisan(artisanId), CacheTtl.publicProfile, async () => {
      const profile = await this.db.maybeOne<any>(
        'artisan_profiles', ARTISAN_PUBLIC_COLUMNS, { id: artisanId, deleted_at: null },
      );
      if (!profile || profile.verification_status !== 'APPROVED') {
        throw new NotFoundError('Artisan');
      }

      const [user, services, areas, portfolio, reviews] = await Promise.all([
        this.db.one('users', 'id, first_name, last_name, avatar_url, created_at', { id: profile.user_id }, 'User'),
        this.listServices(artisanId),
        this.db.from('artisan_service_areas')
          .select('city, state, neighbourhood, radius_km').eq('artisan_id', artisanId),
        this.listPortfolio(artisanId),
        this.db.from('reviews')
          .select('id, rating, comment, created_at, reviewer_id')
          .eq('artisan_id', artisanId).eq('is_visible', true)
          .order('created_at', { ascending: false }).limit(5),
      ]);

      return {
        ...profile,
        user: {
          id: user.id,
          firstName: user.first_name,
          lastName: user.last_name,
          avatarUrl: user.avatar_url,
          memberSince: user.created_at,
        },
        services,
        serviceAreas: areas.data ?? [],
        portfolio,
        recentReviews: reviews.data ?? [],
      };
    });
  }

  /* ------------------- verification / application ---------------------- */

  async getLatestApplication(artisanId: string) {
    const { data } = await this.db
      .from('artisan_applications')
      .select('id, status, submitted_at, reviewed_at, review_notes, rejection_reason, attempt, created_at')
      .eq('artisan_id', artisanId)
      .order('created_at', { ascending: false })
      .limit(1);
    return data?.[0] ?? null;
  }

  async listVerificationDocuments(user: AuthUser) {
    const artisanId = this.requireArtisanId(user);
    const { data } = await this.db
      .from('verification_documents')
      .select('id, document_type, original_filename, mime_type, size_bytes, status, review_notes, created_at')
      .eq('artisan_id', artisanId)
      .is('deleted_at', null)
      .order('created_at', { ascending: false });
    return data ?? [];
  }

  async addVerificationDocument(user: AuthUser, dto: {
    documentType: string; storagePath: string;
    originalFilename?: string; mimeType?: string; sizeBytes?: number;
  }) {
    const artisanId = this.requireArtisanId(user);
    this.storage.assertOwnership(dto.storagePath, user.id);

    const latest = await this.getLatestApplication(artisanId);
    if (latest && ['PENDING', 'UNDER_REVIEW'].includes(latest.status)) {
      throw new DomainException(
        'APPLICATION_LOCKED',
        'Your application is being reviewed. Wait for the outcome before changing documents.',
        HttpStatus.CONFLICT,
      );
    }

    return this.db.insertOne('verification_documents', {
      artisan_id: artisanId,
      application_id: latest && latest.status === 'DRAFT' ? latest.id : null,
      document_type: dto.documentType,
      storage_path: dto.storagePath,
      original_filename: dto.originalFilename ?? null,
      mime_type: dto.mimeType ?? null,
      size_bytes: dto.sizeBytes ?? null,
    }, 'id, document_type, status, created_at');
  }

  /**
   * Issues a short-lived signed URL for the artisan's own document. The
   * verification bucket is private, so this is the only read path, and the
   * ownership check happens before the URL exists.
   */
  async getVerificationDocumentUrl(user: AuthUser, documentId: string) {
    const artisanId = this.requireArtisanId(user);
    const doc = await this.db.maybeOne<any>('verification_documents', 'id, storage_path, artisan_id', {
      id: documentId, artisan_id: artisanId,
    });
    if (!doc) throw new NotFoundError('Verification document');

    return this.storage.createSignedDownloadUrl(StorageBucket.VERIFICATION_DOCUMENTS, doc.storage_path);
  }

  async removeVerificationDocument(user: AuthUser, documentId: string) {
    const artisanId = this.requireArtisanId(user);
    const doc = await this.db.maybeOne<any>('verification_documents', 'id, storage_path', {
      id: documentId, artisan_id: artisanId,
    });
    if (!doc) throw new NotFoundError('Verification document');

    const latest = await this.getLatestApplication(artisanId);
    if (latest && ['PENDING', 'UNDER_REVIEW'].includes(latest.status)) {
      throw new DomainException(
        'APPLICATION_LOCKED', 'Documents cannot be removed while your application is under review',
        HttpStatus.CONFLICT,
      );
    }

    await this.db.updateOne('verification_documents', { id: documentId },
      { deleted_at: new Date().toISOString() }, 'id', 'Verification document');
    await this.storage.remove(StorageBucket.VERIFICATION_DOCUMENTS, [doc.storage_path]);
    return { message: 'Document removed' };
  }

  /**
   * Submits the artisan for verification.
   *
   * Readiness is enforced here rather than trusted from the client: an
   * incomplete profile reaching the review queue wastes a verification
   * officer's time and gives the artisan a slow no instead of a fast fix.
   */
  async submitApplication(user: AuthUser, note?: string) {
    const artisanId = this.requireArtisanId(user);

    const [profile, services, areas, documents] = await Promise.all([
      this.db.one('artisan_profiles', ARTISAN_PROFILE_COLUMNS, { id: artisanId }, 'Artisan profile'),
      this.listServices(artisanId),
      this.listServiceAreas(artisanId),
      this.db.from('verification_documents').select('id, document_type')
        .eq('artisan_id', artisanId).is('deleted_at', null),
    ]);

    if (profile.verification_status === 'APPROVED') {
      throw new DomainException('ALREADY_APPROVED', 'Your artisan account is already approved', HttpStatus.CONFLICT);
    }
    if (profile.verification_status === 'SUSPENDED') {
      throw new DomainException(
        'ARTISAN_SUSPENDED',
        'Your account is suspended. Contact Deevi support.',
        HttpStatus.FORBIDDEN,
      );
    }

    const missing: string[] = [];
    if (!profile.bio && !profile.headline) missing.push('a headline or bio');
    if (!services.length) missing.push('at least one service');
    if (!areas.length) missing.push('at least one service area');
    if (!(documents.data ?? []).length) missing.push('at least one verification document');

    if (missing.length) {
      throw new DomainException(
        'APPLICATION_INCOMPLETE',
        `Your profile still needs ${missing.join(', ')}.`,
        HttpStatus.UNPROCESSABLE_ENTITY,
        missing,
      );
    }

    const latest = await this.getLatestApplication(artisanId);
    if (latest && ['PENDING', 'UNDER_REVIEW'].includes(latest.status)) {
      throw new DomainException(
        'APPLICATION_IN_PROGRESS',
        'You already have an application awaiting review',
        HttpStatus.CONFLICT,
      );
    }

    const attempt = latest ? latest.attempt + 1 : 1;
    const now = new Date().toISOString();

    const application = await this.db.insertOne('artisan_applications', {
      artisan_id: artisanId,
      status: 'PENDING',
      submitted_at: now,
      attempt,
      snapshot: {
        note: note ?? null,
        headline: profile.headline,
        bio: profile.bio,
        yearsOfExperience: profile.years_of_experience,
        services: services.map((s: any) => s.service_id),
        serviceAreas: areas.map((a: any) => `${a.city}${a.state ? `, ${a.state}` : ''}`),
        documentTypes: (documents.data ?? []).map((d: any) => d.document_type),
      },
    }, 'id, status, submitted_at, attempt');

    // Bind loose documents to this submission so reviewers see one bundle.
    await this.db.from('verification_documents')
      .update({ application_id: application.id })
      .eq('artisan_id', artisanId)
      .is('application_id', null)
      .is('deleted_at', null);

    await this.db.updateOne('artisan_profiles', { id: artisanId },
      { verification_status: 'PENDING' }, 'id, verification_status', 'Artisan profile');

    await this.notifications.notify({
      userId: user.id,
      type: NotificationType.ARTISAN_APPLICATION_SUBMITTED,
      entityType: 'ARTISAN_APPLICATION',
      entityId: application.id,
      data: { applicationId: application.id, attempt },
    });

    return application;
  }

  /* ------------------------------ scoring ------------------------------ */

  private scoreCompletion(profile: any, services: any[], areas: any[], portfolio: any[]): number {
    let score = 0;
    if (profile.headline) score += 15;
    if (profile.bio) score += 15;
    if (profile.years_of_experience > 0) score += 10;
    if (profile.base_city) score += 10;
    if (profile.base_latitude && profile.base_longitude) score += 10;
    if (services.length) score += 20;
    if (areas.length) score += 10;
    if (portfolio.length) score += 10;
    return Math.min(score, 100);
  }

  private async refreshCompletion(artisanId: string): Promise<void> {
    const [profile, services, areas, portfolio] = await Promise.all([
      this.db.maybeOne<any>('artisan_profiles', ARTISAN_PROFILE_COLUMNS, { id: artisanId }),
      this.listServices(artisanId),
      this.listServiceAreas(artisanId),
      this.listPortfolio(artisanId),
    ]);
    if (!profile) return;

    await this.db.from('artisan_profiles')
      .update({ profile_completion: this.scoreCompletion(profile, services, areas, portfolio) })
      .eq('id', artisanId);
  }
}
