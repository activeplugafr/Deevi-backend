import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { ArtisansService } from '../artisans/artisans.service.js';
import { buildPaginationMeta, type Paginated } from '../common/dto/pagination.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { FeedQueryDto } from './dto/feed.dto.js';

/**
 * The artisan job feed.
 *
 * Ranking runs inside Postgres (deevi_feed_jobs_for_artisan) rather than in
 * Node, for three reasons: the candidate set never leaves the database, the
 * window-function count gives exact pagination in the same round trip, and
 * scoring stays deterministic and inspectable in SQL.
 *
 * Scoring factors, in the order the brief lists them: service match,
 * sub-service match, service area versus job location, artisan availability,
 * approval (a hard filter, not a score), reputation, and job recency. Boosts
 * apply a bounded multiplier at the very end, so paid visibility can reorder
 * relevant results but never inject irrelevant ones.
 */
@Injectable()
export class FeedService {
  constructor(
    private readonly db: DatabaseService,
    private readonly artisans: ArtisansService,
  ) {}

  async getFeed(user: AuthUser, query: FeedQueryDto): Promise<Paginated<any>> {
    const artisanId = this.artisans.assertApproved(user);

    const rows = await this.db.rpc<any[]>('deevi_feed_jobs_for_artisan', {
      p_artisan_id: artisanId,
      p_limit: query.limit,
      p_offset: (query.page - 1) * query.limit,
      p_city: query.city ?? null,
      p_service_ids: query.serviceIds ?? null,
      p_urgency: query.urgency ?? null,
      p_min_budget: query.minBudget ?? null,
      p_max_distance_km: query.maxDistanceKm ?? null,
      p_search: query.q ?? null,
    });

    const total = rows?.[0]?.total_count ? Number(rows[0].total_count) : 0;

    // Keep the artisan's activity signal fresh; it feeds their own ranking
    // in the customer-facing recommendation flow.
    void this.db.from('artisan_profiles')
      .update({ last_active_at: new Date().toISOString() })
      .eq('id', artisanId);

    return {
      items: (rows ?? []).map(({ total_count: _count, ...job }) => ({
        ...job,
        media_count: Number(job.media_count ?? 0),
        relevance_score: Number(job.relevance_score ?? 0),
      })),
      meta: buildPaginationMeta(query.page, query.limit, total),
    };
  }

  /**
   * Why this feed looks the way it does. Surfacing the inputs makes an empty
   * or narrow feed self-diagnosing for the artisan instead of a mystery.
   */
  async explainFeed(user: AuthUser) {
    const artisanId = this.artisans.requireArtisanId(user);

    const [profile, services, areas, candidateCount] = await Promise.all([
      this.db.one<any>(
        'artisan_profiles',
        'verification_status, availability_status, max_travel_km, base_city, rating_average, rating_count',
        { id: artisanId }, 'Artisan profile',
      ),
      this.db.from('artisan_services').select('service_id, services(name)').eq('artisan_id', artisanId),
      this.db.from('artisan_service_areas').select('city, radius_km').eq('artisan_id', artisanId),
      this.db.from('job_posts').select('id', { count: 'exact', head: true })
        .in('status', ['PUBLISHED', 'RECEIVING_APPLICATIONS']).is('deleted_at', null),
    ]);

    const blockers: string[] = [];
    if (profile.verification_status !== 'APPROVED') {
      blockers.push(`Your account is ${profile.verification_status}; only APPROVED artisans see the feed.`);
    }
    if (!(services.data ?? []).length) blockers.push('You have not selected any services.');
    if (!(areas.data ?? []).length) blockers.push('You have not set any service areas.');
    if (profile.availability_status === 'UNAVAILABLE') {
      blockers.push('You are marked UNAVAILABLE, which pushes you to the bottom of every ranking.');
    }

    return {
      verificationStatus: profile.verification_status,
      availabilityStatus: profile.availability_status,
      services: (services.data ?? []).map((s: any) => s.services?.name).filter(Boolean),
      serviceAreas: (areas.data ?? []).map((a: any) => `${a.city} (${a.radius_km}km)`),
      maxTravelKm: profile.max_travel_km,
      reputation: { average: profile.rating_average, count: profile.rating_count },
      openJobsOnDeevi: candidateCount.count ?? 0,
      blockers,
      rankingFactors: [
        'Service match (required)',
        'Sub-service match',
        'Distance from your service areas versus their radius (hard filter beyond 125% of radius)',
        'Your availability status',
        'Your rating, once you have at least 3 reviews',
        'Jobs you have completed',
        'How recently the job was posted',
        'Job urgency',
        'How few artisans have already applied',
      ],
    };
  }
}
