import { beforeEach, describe, expect, it } from 'vitest';
import { FeedService } from './feed.service.js';
import { ArtisansService } from '../artisans/artisans.service.js';
import {
  createMockCache, createMockDb, createMockNotifications, createMockStorage,
  makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

const FEED_ROW = {
  id: 'post-1', title: 'Leaking sink', description: 'Real customer words',
  status: 'RECEIVING_APPLICATIONS', urgency: 'HIGH', service_id: 'service-1',
  service_name: 'Leak Repair', sub_service_id: null, category_id: 'cat-1',
  category_name: 'Plumbing', budget_min: 10000, budget_max: 30000,
  budget_type: 'NEGOTIABLE', currency: 'NGN', preferred_start_at: null,
  preferred_time_notes: null, neighbourhood: 'Obalende', city: 'Lagos Island',
  state: 'Lagos', latitude_approx: 6.45, longitude_approx: 3.41, distance_km: 2.3,
  applications_count: 1, media_count: '2', published_at: '2026-01-01T00:00:00Z',
  expires_at: null, relevance_score: '68.4212', total_count: '37',
};

describe('FeedService', () => {
  let db: MockDb;
  let artisans: ArtisansService;
  let service: FeedService;

  beforeEach(() => {
    db = createMockDb();
    artisans = new ArtisansService(db as any, {} as any, createMockCache() as any, createMockStorage() as any, createMockNotifications() as any);
    service = new FeedService(db as any, artisans);
  });

  const query = { page: 1, limit: 20 } as any;

  describe('access', () => {
    it('refuses an artisan who is not approved', async () => {
      const pending = makeArtisan({ artisanVerificationStatus: 'PENDING' });
      await expect(service.getFeed(pending, query)).rejects.toThrow(/Complete verification/);
      expect(db.rpc).not.toHaveBeenCalled();
    });

    it('refuses a customer with no artisan profile', async () => {
      await expect(service.getFeed(makeUser(), query)).rejects.toThrow(/requires an artisan profile/i);
    });

    it('refuses a suspended artisan', async () => {
      await expect(
        service.getFeed(makeArtisan({ artisanVerificationStatus: 'SUSPENDED' }), query),
      ).rejects.toThrow(/suspended/i);
    });
  });

  describe('ranking and pagination', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    it('passes every filter to the ranking function', async () => {
      db.rpc.mockResolvedValueOnce([]);
      await service.getFeed(artisan, {
        page: 2, limit: 10, city: 'Ikeja', serviceIds: ['service-1'],
        urgency: 'HIGH', minBudget: 5000, maxDistanceKm: 12, q: 'leak',
      } as any);

      expect(db.rpc).toHaveBeenCalledWith('deevi_feed_jobs_for_artisan', {
        p_artisan_id: 'artisan-1',
        p_limit: 10,
        p_offset: 10,
        p_city: 'Ikeja',
        p_service_ids: ['service-1'],
        p_urgency: 'HIGH',
        p_min_budget: 5000,
        p_max_distance_km: 12,
        p_search: 'leak',
      });
    });

    it('derives exact pagination from the window count', async () => {
      db.rpc.mockResolvedValueOnce([FEED_ROW, { ...FEED_ROW, id: 'post-2' }]);

      const result = await service.getFeed(artisan, { page: 1, limit: 20 } as any);

      expect(result.meta.total).toBe(37);
      expect(result.meta.totalPages).toBe(2);
      expect(result.meta.hasNextPage).toBe(true);
      expect(result.items).toHaveLength(2);
    });

    it('strips the internal count column from every row', async () => {
      db.rpc.mockResolvedValueOnce([FEED_ROW]);
      const result = await service.getFeed(artisan, query);
      expect(result.items[0]).not.toHaveProperty('total_count');
    });

    it('coerces the numeric columns Postgres returns as strings', async () => {
      db.rpc.mockResolvedValueOnce([FEED_ROW]);
      const result = await service.getFeed(artisan, query);
      expect(result.items[0].relevance_score).toBe(68.4212);
      expect(result.items[0].media_count).toBe(2);
    });

    it('keeps the customer own description intact', async () => {
      db.rpc.mockResolvedValueOnce([FEED_ROW]);
      const result = await service.getFeed(artisan, query);
      expect(result.items[0].description).toBe('Real customer words');
    });

    it('never returns the private street address', async () => {
      db.rpc.mockResolvedValueOnce([FEED_ROW]);
      const result = await service.getFeed(artisan, query);
      expect(result.items[0]).not.toHaveProperty('address_line');
      expect(result.items[0]).not.toHaveProperty('location_notes');
      // Coordinates are coarsened to roughly a kilometre.
      expect(result.items[0].latitude_approx).toBe(6.45);
    });

    it('reports an empty feed cleanly rather than throwing', async () => {
      db.rpc.mockResolvedValueOnce([]);
      const result = await service.getFeed(artisan, query);
      expect(result.items).toEqual([]);
      expect(result.meta.total).toBe(0);
    });
  });

  describe('feed explanation', () => {
    it('names the blockers keeping jobs away from an unapproved artisan', async () => {
      db.one.mockResolvedValueOnce({
        verification_status: 'PENDING', availability_status: 'AVAILABLE',
        max_travel_km: 15, base_city: 'Yaba', rating_average: 0, rating_count: 0,
      });
      db.__setQueryResult([]);

      const result = await service.explainFeed(makeArtisan({ artisanVerificationStatus: 'PENDING' }));

      expect(result.blockers.join(' ')).toMatch(/PENDING/);
      expect(result.blockers.join(' ')).toMatch(/not selected any services/);
      expect(result.blockers.join(' ')).toMatch(/not set any service areas/);
    });

    it('lists the ranking factors so an empty feed is self-diagnosing', async () => {
      db.one.mockResolvedValueOnce({
        verification_status: 'APPROVED', availability_status: 'AVAILABLE',
        max_travel_km: 15, base_city: 'Yaba', rating_average: 4.5, rating_count: 10,
      });
      db.__setQueryResult([]);

      const result = await service.explainFeed(makeArtisan());
      expect(result.rankingFactors.length).toBeGreaterThan(5);
      expect(result.rankingFactors[0]).toMatch(/Service match/);
    });
  });
});
