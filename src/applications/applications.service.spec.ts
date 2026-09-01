import { beforeEach, describe, expect, it } from 'vitest';
import { ApplicationsService } from './applications.service.js';
import {
  createMockDb, createMockNotifications, makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';
import { ArtisansService } from '../artisans/artisans.service.js';

const OPEN_POST = {
  id: 'post-1',
  customer_id: 'customer-1',
  title: 'Leaking kitchen sink',
  status: 'RECEIVING_APPLICATIONS',
  service_id: 'service-1',
  sub_service_id: null,
  deleted_at: null,
  expires_at: null,
  selected_application_id: null,
};

describe('ApplicationsService', () => {
  let db: MockDb;
  let notifications: ReturnType<typeof createMockNotifications>;
  let artisans: ArtisansService;
  let service: ApplicationsService;

  beforeEach(() => {
    db = createMockDb();
    notifications = createMockNotifications();
    // The real ArtisansService is used for its approval gate, which is the
    // behaviour under test; its own dependencies are irrelevant here.
    artisans = new ArtisansService(db as any, {} as any, {} as any, {} as any, createMockNotifications() as any);
    service = new ApplicationsService(db as any, artisans, notifications as any);
  });

  describe('applying to a job', () => {
    const artisan = makeArtisan({ id: 'artisan-user-1', artisanProfileId: 'artisan-1' });
    const dto = { jobPostId: 'post-1', message: 'I can fix that leak this Thursday morning for you.' };

    it('refuses an artisan who is not approved', async () => {
      const pending = makeArtisan({ artisanVerificationStatus: 'PENDING' });
      await expect(service.apply(pending, dto as any)).rejects.toThrow(/ARTISAN_NOT_APPROVED|pending/i);
    });

    it('refuses a user with no artisan profile', async () => {
      await expect(service.apply(makeUser(), dto as any)).rejects.toThrow(/artisan profile/i);
    });

    it('refuses to let a customer apply to their own job', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OPEN_POST, customer_id: artisan.id });
      await expect(service.apply(artisan, dto as any)).rejects.toThrow(/own job post/i);
    });

    it('refuses a job that is no longer open', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OPEN_POST, status: 'ARTISAN_SELECTED' });
      await expect(service.apply(artisan, dto as any)).rejects.toThrow(/already been selected/i);
    });

    it('refuses an expired job', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OPEN_POST, expires_at: '2020-01-01T00:00:00.000Z' });
      await expect(service.apply(artisan, dto as any)).rejects.toThrow(/expired/i);
    });

    it('refuses a service the artisan does not offer', async () => {
      db.maybeOne.mockResolvedValueOnce(OPEN_POST);
      db.count.mockResolvedValueOnce(0);
      await expect(service.apply(artisan, dto as any)).rejects.toThrow(/do not offer this service/i);
    });

    it('refuses a second application to the same job', async () => {
      db.maybeOne
        .mockResolvedValueOnce(OPEN_POST)
        .mockResolvedValueOnce({ id: 'existing-application', status: 'SUBMITTED' });
      db.count.mockResolvedValueOnce(1);
      await expect(service.apply(artisan, dto as any)).rejects.toThrow(/already applied/i);
    });

    it('does not gate bidding behind a subscription plan', async () => {
      // Subscriptions are dormant in the MVP, so no plan quota may block the
      // core loop. Rate limiting handles abuse instead.
      db.maybeOne.mockResolvedValueOnce(OPEN_POST).mockResolvedValueOnce(null);
      db.count.mockResolvedValueOnce(1);
      await expect(service.apply(artisan, dto as any)).resolves.toBeTruthy();
    });

    it('creates the bid and tells the customer', async () => {
      db.maybeOne.mockResolvedValueOnce(OPEN_POST).mockResolvedValueOnce(null);
      db.count.mockResolvedValueOnce(1);

      const result = await service.apply(artisan, { ...dto, proposedPrice: 25000 } as any);

      expect(result.status).toBe('SUBMITTED');
      expect(db.insertOne).toHaveBeenCalledWith('job_applications', expect.objectContaining({
        job_post_id: 'post-1',
        artisan_id: 'artisan-1',
        proposed_price: 25000,
      }), expect.any(String));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'customer-1',
        type: 'APPLICATION_RECEIVED',
      }));
    });
  });

  describe('selecting an artisan (the race-sensitive path)', () => {
    const customer = makeUser({ id: 'customer-1' });

    const setupSelection = () => {
      db.one.mockResolvedValueOnce({
        id: 'app-1', job_post_id: 'post-1', artisan_id: 'artisan-1',
        status: 'SUBMITTED', proposed_price: 25000,
      });
      db.maybeOne.mockResolvedValueOnce(OPEN_POST);
    };

    it('delegates the whole decision to the locking database function', async () => {
      setupSelection();
      db.rpc.mockResolvedValueOnce({
        job: { id: 'job-1', status: 'PENDING_ACCEPTANCE', agreed_price: 25000 },
        artisan_user_id: 'artisan-user-1',
      });

      const result = await service.selectArtisan(customer, 'app-1');

      // A single atomic call, not a read-then-write the client could interleave.
      expect(db.rpc).toHaveBeenCalledWith('deevi_select_artisan_for_job', {
        p_job_post_id: 'post-1',
        p_application_id: 'app-1',
        p_customer_id: 'customer-1',
        p_agreed_price: null,
      });
      expect(result.job.status).toBe('PENDING_ACCEPTANCE');
    });

    it('passes a negotiated price through to the engagement', async () => {
      setupSelection();
      db.rpc.mockResolvedValueOnce({ job: { id: 'job-1', agreed_price: 20000 }, artisan_user_id: 'u' });

      await service.selectArtisan(customer, 'app-1', 20000);

      expect(db.rpc).toHaveBeenCalledWith('deevi_select_artisan_for_job',
        expect.objectContaining({ p_agreed_price: 20000 }));
    });

    it('surfaces the database refusal when someone else selected first', async () => {
      setupSelection();
      db.rpc.mockRejectedValueOnce(new Error('ARTISAN_ALREADY_SELECTED'));

      await expect(service.selectArtisan(customer, 'app-1')).rejects.toThrow(/ARTISAN_ALREADY_SELECTED/);
    });

    it('refuses a customer who does not own the job post', async () => {
      db.one.mockResolvedValueOnce({
        id: 'app-1', job_post_id: 'post-1', artisan_id: 'artisan-1', status: 'SUBMITTED', proposed_price: null,
      });
      db.maybeOne.mockResolvedValueOnce({ ...OPEN_POST, customer_id: 'someone-else' });

      await expect(service.selectArtisan(customer, 'app-1')).rejects.toThrow(/do not own this job post/i);
      expect(db.rpc).not.toHaveBeenCalled();
    });

    it('opens the conversation and notifies the winner', async () => {
      setupSelection();
      db.rpc.mockResolvedValueOnce({
        job: { id: 'job-1', status: 'PENDING_ACCEPTANCE' },
        artisan_user_id: 'artisan-user-1',
      });

      await service.selectArtisan(customer, 'app-1');

      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'artisan-user-1',
        type: 'ARTISAN_SELECTED',
        priority: 'HIGH',
      }));
    });
  });

  describe('withdrawing', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    it('refuses to withdraw an accepted application', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'app-1', artisan_id: 'artisan-1', status: 'ACCEPTED', job_post_id: 'post-1',
      });
      await expect(service.withdraw(artisan, 'app-1')).rejects.toThrow(/Decline the engagement instead/);
    });

    it('refuses to withdraw an already-rejected application', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'app-1', artisan_id: 'artisan-1', status: 'REJECTED', job_post_id: 'post-1',
      });
      await expect(service.withdraw(artisan, 'app-1')).rejects.toThrow(/cannot be withdrawn/);
    });

    it('detects a concurrent change and refuses rather than overwriting', async () => {
      db.maybeOne.mockResolvedValueOnce({
        id: 'app-1', artisan_id: 'artisan-1', status: 'SUBMITTED', job_post_id: 'post-1',
      });
      db.updateIf.mockResolvedValueOnce(null);

      await expect(service.withdraw(artisan, 'app-1')).rejects.toThrow(/just changed/i);
    });

    it('withdraws a live application', async () => {
      db.maybeOne
        .mockResolvedValueOnce({ id: 'app-1', artisan_id: 'artisan-1', status: 'SUBMITTED', job_post_id: 'post-1' })
        .mockResolvedValueOnce({ id: 'post-1', customer_id: 'customer-1', title: 'Leak', applications_count: 3 });
      db.updateIf.mockResolvedValueOnce({ id: 'app-1', job_post_id: 'post-1', status: 'WITHDRAWN' });

      const result = await service.withdraw(artisan, 'app-1');
      expect(result.message).toMatch(/withdrawn/i);
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'APPLICATION_WITHDRAWN',
      }));
    });
  });

  describe('shortlisting and rejecting', () => {
    const customer = makeUser({ id: 'customer-1' });

    it('only shortlists a submitted application', async () => {
      db.one.mockResolvedValueOnce({
        id: 'app-1', job_post_id: 'post-1', artisan_id: 'artisan-1', status: 'SHORTLISTED',
      });
      db.maybeOne.mockResolvedValueOnce(OPEN_POST);
      await expect(service.shortlist(customer, 'app-1')).rejects.toThrow(/Only submitted applications/);
    });

    it('refuses to reject an application already accepted', async () => {
      db.one.mockResolvedValueOnce({
        id: 'app-1', job_post_id: 'post-1', artisan_id: 'artisan-1', status: 'ACCEPTED',
      });
      db.maybeOne.mockResolvedValueOnce(OPEN_POST);
      await expect(service.reject(customer, 'app-1')).rejects.toThrow(/cannot be rejected/);
    });

    it('blocks a stranger from shortlisting on someone else job', async () => {
      db.one.mockResolvedValueOnce({
        id: 'app-1', job_post_id: 'post-1', artisan_id: 'artisan-1', status: 'SUBMITTED',
      });
      db.maybeOne.mockResolvedValueOnce({ ...OPEN_POST, customer_id: 'another-customer' });
      await expect(service.shortlist(makeUser({ id: 'intruder' }), 'app-1'))
        .rejects.toThrow(/do not own this job post/i);
    });
  });
});
