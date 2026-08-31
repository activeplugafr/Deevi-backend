import { beforeEach, describe, expect, it } from 'vitest';
import { ReportsService } from './reports.service.js';
import {
  createMockDb, createMockNotifications, makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

const JOB = {
  id: 'job-1', job_post_id: 'post-1', customer_id: 'customer-1',
  artisan_id: 'artisan-1', status: 'IN_PROGRESS',
};

describe('ReportsService', () => {
  let db: MockDb;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: ReportsService;

  beforeEach(() => {
    db = createMockDb();
    notifications = createMockNotifications();
    service = new ReportsService(db as any, notifications as any);
  });

  describe('filing a report', () => {
    it('lets a participant report the job they were on', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB);
      const report = await service.create(makeUser({ id: 'customer-1' }), {
        category: 'NO_SHOW', description: 'The artisan never turned up on the agreed day.', jobId: 'job-1',
      } as any);

      expect(report).toBeTruthy();
      expect(db.insertOne).toHaveBeenCalledWith('reports', expect.objectContaining({
        reporter_id: 'customer-1', category: 'NO_SHOW',
      }), expect.any(String));
    });

    it('blocks someone reporting a job they had nothing to do with', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB);
      await expect(
        service.create(makeUser({ id: 'bystander' }), {
          category: 'POOR_WORKMANSHIP', description: 'Heard it went badly from a friend.', jobId: 'job-1',
        } as any),
      ).rejects.toThrow(/only report a job you were part of/i);
    });

    it('lets the artisan on the job report too', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB);
      await expect(
        service.create(makeArtisan({ id: 'artisan-user', artisanProfileId: 'artisan-1' }), {
          category: 'PAYMENT_ISSUE', description: 'Customer refused to pay after the work was done.', jobId: 'job-1',
        } as any),
      ).resolves.toBeTruthy();
    });

    it('refuses a self-report', async () => {
      await expect(
        service.create(makeUser({ id: 'customer-1' }), {
          category: 'OTHER', description: 'Reporting my own account for testing.', reportedUserId: 'customer-1',
        } as any),
      ).rejects.toThrow(/cannot report yourself/i);
    });

    it('escalates safety concerns to URGENT automatically', async () => {
      await service.create(makeUser(), {
        category: 'SAFETY_CONCERN', description: 'The artisan threatened me at my home.',
      } as any);

      expect(db.insertOne).toHaveBeenCalledWith('reports',
        expect.objectContaining({ priority: 'URGENT' }), expect.any(String));
    });

    it('escalates fraud to URGENT', async () => {
      await service.create(makeUser(), {
        category: 'FRAUD', description: 'They took a deposit and disappeared entirely.',
      } as any);
      expect(db.insertOne).toHaveBeenCalledWith('reports',
        expect.objectContaining({ priority: 'URGENT' }), expect.any(String));
    });

    it('marks a no-show HIGH but not urgent', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB);
      await service.create(makeUser({ id: 'customer-1' }), {
        category: 'NO_SHOW', description: 'Did not show up on the agreed date.', jobId: 'job-1',
      } as any);
      expect(db.insertOne).toHaveBeenCalledWith('reports',
        expect.objectContaining({ priority: 'HIGH' }), expect.any(String));
    });

    it('leaves an ordinary category at NORMAL', async () => {
      await service.create(makeUser(), {
        category: 'MISLEADING_PROFILE', description: 'Their profile claims certifications they do not hold.',
      } as any);
      expect(db.insertOne).toHaveBeenCalledWith('reports',
        expect.objectContaining({ priority: 'NORMAL' }), expect.any(String));
    });
  });

  describe('raising a dispute', () => {
    it('lets the customer escalate their own job', async () => {
      db.maybeOne
        .mockResolvedValueOnce(JOB)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({ user_id: 'artisan-user-1' })
        .mockResolvedValueOnce({ title: 'Leak' });

      const dispute = await service.createDispute(makeUser({ id: 'customer-1' }), {
        jobId: 'job-1', reason: 'Work was left unfinished and they stopped replying.',
      } as any);

      expect(dispute).toBeTruthy();
      expect(db.insertOne).toHaveBeenCalledWith('disputes', expect.objectContaining({
        job_id: 'job-1', raised_by: 'customer-1', raised_by_role: 'CUSTOMER',
      }), expect.any(String));
    });

    it('blocks a non-participant', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB);
      await expect(
        service.createDispute(makeUser({ id: 'bystander' }), {
          jobId: 'job-1', reason: 'I think this job went badly for them.',
        } as any),
      ).rejects.toThrow(/only raise a dispute on a job you were part of/i);
    });

    it('refuses a second open dispute on the same job', async () => {
      db.maybeOne.mockResolvedValueOnce(JOB).mockResolvedValueOnce({ id: 'existing-dispute' });
      await expect(
        service.createDispute(makeUser({ id: 'customer-1' }), {
          jobId: 'job-1', reason: 'Raising this a second time for good measure.',
        } as any),
      ).rejects.toThrow(/already open/i);
    });

    it('refuses a dispute on a cancelled job', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...JOB, status: 'CANCELLED' });
      await expect(
        service.createDispute(makeUser({ id: 'customer-1' }), {
          jobId: 'job-1', reason: 'This job was cancelled but I am unhappy.',
        } as any),
      ).rejects.toThrow(/raise a report instead/i);
    });
  });

  describe('reading a dispute', () => {
    it('lets either party read it', async () => {
      db.maybeOne.mockResolvedValue({
        id: 'dispute-1', raised_by: 'customer-1', against_user_id: 'artisan-user-1',
      });
      await expect(service.getMyDispute(makeUser({ id: 'customer-1' }), 'dispute-1')).resolves.toBeTruthy();
      await expect(service.getMyDispute(makeUser({ id: 'artisan-user-1' }), 'dispute-1')).resolves.toBeTruthy();
    });

    it('keeps everyone else out', async () => {
      db.maybeOne.mockResolvedValue({
        id: 'dispute-1', raised_by: 'customer-1', against_user_id: 'artisan-user-1',
      });
      await expect(service.getMyDispute(makeUser({ id: 'nosy' }), 'dispute-1'))
        .rejects.toThrow(/not party to this dispute/i);
    });
  });
});
