import { beforeEach, describe, expect, it } from 'vitest';
import { ReviewsService } from './reviews.service.js';
import {
  createMockCache, createMockDb, createMockNotifications,
  makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

const COMPLETED_JOB = {
  id: 'job-1',
  job_post_id: 'post-1',
  customer_id: 'customer-1',
  artisan_id: 'artisan-1',
  status: 'COMPLETED',
};

describe('ReviewsService', () => {
  let db: MockDb;
  let cache: ReturnType<typeof createMockCache>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: ReviewsService;

  beforeEach(() => {
    db = createMockDb();
    cache = createMockCache();
    notifications = createMockNotifications();
    service = new ReviewsService(db as any, cache as any, notifications as any);
  });

  describe('who may review', () => {
    it('lets the hiring customer review a completed job', async () => {
      db.maybeOne.mockResolvedValueOnce(COMPLETED_JOB).mockResolvedValueOnce(null);
      db.one.mockResolvedValueOnce({ id: 'artisan-1', user_id: 'artisan-user-1' });

      const review = await service.create(makeUser({ id: 'customer-1' }), {
        jobId: 'job-1', rating: 5, comment: 'Excellent work',
      });

      expect(db.insertOne).toHaveBeenCalledWith('reviews', expect.objectContaining({
        job_id: 'job-1',
        reviewer_id: 'customer-1',
        artisan_id: 'artisan-1',
        direction: 'CUSTOMER_TO_ARTISAN',
        rating: 5,
      }), expect.any(String));
      expect(review).toBeTruthy();
    });

    it('refuses a stranger who was not on the job', async () => {
      db.maybeOne.mockResolvedValueOnce(COMPLETED_JOB);
      await expect(
        service.create(makeUser({ id: 'random-user' }), { jobId: 'job-1', rating: 5 }),
      ).rejects.toThrow(/Only the customer who hired/);
    });

    it('refuses the artisan reviewing themselves through this path', async () => {
      db.maybeOne.mockResolvedValueOnce(COMPLETED_JOB);
      await expect(
        service.create(makeArtisan({ id: 'artisan-user-1', artisanProfileId: 'artisan-1' }),
          { jobId: 'job-1', rating: 5 }),
      ).rejects.toThrow(/Only the customer who hired/);
    });
  });

  describe('when a review is allowed', () => {
    it('refuses a job that is not complete', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...COMPLETED_JOB, status: 'IN_PROGRESS' });
      await expect(
        service.create(makeUser({ id: 'customer-1' }), { jobId: 'job-1', rating: 5 }),
      ).rejects.toThrow(/only review a job once it is complete/i);
    });

    it('refuses a cancelled job', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...COMPLETED_JOB, status: 'CANCELLED' });
      await expect(
        service.create(makeUser({ id: 'customer-1' }), { jobId: 'job-1', rating: 4 }),
      ).rejects.toThrow(/JOB_NOT_COMPLETED|complete/i);
    });

    it('refuses a duplicate review', async () => {
      db.maybeOne
        .mockResolvedValueOnce(COMPLETED_JOB)
        .mockResolvedValueOnce({ id: 'existing-review' });

      await expect(
        service.create(makeUser({ id: 'customer-1' }), { jobId: 'job-1', rating: 5 }),
      ).rejects.toThrow(/already reviewed/i);
    });

    it('404s on a job that does not exist', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      await expect(
        service.create(makeUser(), { jobId: 'nope', rating: 5 }),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('eligibility check', () => {
    it('says yes for the customer on a completed, unreviewed job', async () => {
      db.maybeOne.mockResolvedValueOnce(COMPLETED_JOB).mockResolvedValueOnce(null);
      const result = await service.checkEligibility(makeUser({ id: 'customer-1' }), 'job-1');
      expect(result).toEqual({ canReview: true, reason: null, existingReviewId: null });
    });

    it('explains why not when the job is unfinished', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...COMPLETED_JOB, status: 'ACCEPTED' });
      const result = await service.checkEligibility(makeUser({ id: 'customer-1' }), 'job-1');
      expect(result.canReview).toBe(false);
      expect(result.reason).toMatch(/marked complete/);
    });

    it('points at the existing review when there already is one', async () => {
      db.maybeOne.mockResolvedValueOnce(COMPLETED_JOB).mockResolvedValueOnce({ id: 'review-9' });
      const result = await service.checkEligibility(makeUser({ id: 'customer-1' }), 'job-1');
      expect(result.canReview).toBe(false);
      expect(result.existingReviewId).toBe('review-9');
    });

    it('does not throw for a missing job, it just says no', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      const result = await service.checkEligibility(makeUser(), 'missing');
      expect(result.canReview).toBe(false);
    });
  });

  describe('rating summary', () => {
    it('computes the average and distribution', async () => {
      db.__setQueryResult([{ rating: 5 }, { rating: 5 }, { rating: 4 }, { rating: 2 }]);
      const summary = await service.getSummary('artisan-1');

      expect(summary.total).toBe(4);
      expect(summary.average).toBe(4);
      expect(summary.distribution[5]).toBe(2);
      expect(summary.distribution[2]).toBe(1);
      expect(summary.distribution[1]).toBe(0);
    });

    it('reports zero rather than NaN when there are no reviews', async () => {
      db.__setQueryResult([]);
      const summary = await service.getSummary('artisan-1');
      expect(summary).toMatchObject({ total: 0, average: 0 });
    });
  });
});
