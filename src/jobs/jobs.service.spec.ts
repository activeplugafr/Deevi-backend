import { beforeEach, describe, expect, it, vi } from 'vitest';
import { JobsService } from './jobs.service.js';
import {
  createMockDb, createMockNotifications, createMockQueue, createMockStorage,
  makeAdmin, makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

const SERVICE = { id: 'service-1', category_id: 'category-1', name: 'Leak Repair', is_active: true };

const validDto = () => ({
  title: 'Kitchen sink leaking badly',
  description: 'The pipe under my kitchen sink drips constantly and the cabinet floor is soaked.',
  serviceId: 'service-1',
  location: { city: 'Obalende', state: 'Lagos', latitude: 6.4474, longitude: 3.4064 },
});

describe('JobsService', () => {
  let db: MockDb;
  let catalogue: any;
  let customers: any;
  let storage: ReturnType<typeof createMockStorage>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let queue: ReturnType<typeof createMockQueue>;
  let service: JobsService;

  beforeEach(() => {
    db = createMockDb();
    catalogue = { resolveServiceReference: vi.fn().mockResolvedValue(SERVICE) };
    customers = { ensureProfile: vi.fn().mockResolvedValue({ id: 'customer-profile-1' }) };
    storage = createMockStorage();
    notifications = createMockNotifications();
    queue = createMockQueue();
    service = new JobsService(
      db as any, catalogue, customers, storage as any, notifications as any, queue as any,
    );
  });

  describe('creating a job post', () => {
    it('publishes by default and records the location on the job itself', async () => {
      const customer = makeUser();
      const result: any = await service.create(customer, validDto() as any);

      expect(result.status).toBe('PUBLISHED');
      expect(db.insertOne).toHaveBeenCalledWith('job_posts', expect.objectContaining({
        customer_id: customer.id,
        city: 'Obalende',
        latitude: 6.4474,
        category_id: 'category-1',
        status: 'PUBLISHED',
      }), expect.any(String));
    });

    it('saves a draft when asked', async () => {
      const result: any = await service.create(makeUser(), { ...validDto(), publish: false } as any);
      expect(result.status).toBe('DRAFT');
      expect(notifications.notify).not.toHaveBeenCalled();
    });

    it('keeps the customer own description verbatim', async () => {
      const dto = validDto();
      await service.create(makeUser(), dto as any);
      expect(db.insertOne).toHaveBeenCalledWith('job_posts',
        expect.objectContaining({ description: dto.description }), expect.any(String));
    });

    it('refuses a location that cannot be resolved to a place', async () => {
      const dto = { ...validDto(), location: { locationNotes: 'behind the big tree' } };
      await expect(service.create(makeUser(), dto as any)).rejects.toThrow(/Tell us where the work is/);
    });

    it('accepts a city with no coordinates', async () => {
      const dto = { ...validDto(), location: { city: 'Igando' } };
      await expect(service.create(makeUser(), dto as any)).resolves.toBeTruthy();
    });

    it('accepts coordinates with no city, as from a map pin or device GPS', async () => {
      const dto = { ...validDto(), location: { latitude: 6.5, longitude: 3.3, source: 'DEVICE' } };
      await expect(service.create(makeUser(), dto as any)).resolves.toBeTruthy();
    });

    it('rejects an inverted budget range', async () => {
      const dto = { ...validDto(), budgetMin: 50000, budgetMax: 10000 };
      await expect(service.create(makeUser(), dto as any)).rejects.toThrow(/budgetMax cannot be lower/);
    });

    it('rejects a service that does not exist', async () => {
      catalogue.resolveServiceReference.mockRejectedValueOnce(new Error('SERVICE_NOT_FOUND'));
      await expect(service.create(makeUser(), validDto() as any)).rejects.toThrow(/SERVICE_NOT_FOUND/);
    });

    it('caps how many open jobs one customer can hold', async () => {
      db.from.mockReturnValueOnce({
        select: () => ({ eq: () => ({ is: () => ({ in: () => Promise.resolve({ count: 20, error: null }) }) }) }),
      } as any);
      await expect(service.create(makeUser(), validDto() as any)).rejects.toThrow(/open job posts/i);
    });

    it('does not let a saved location belonging to someone else be used', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      const dto = { ...validDto(), location: { savedLocationId: 'someone-elses-location' } };
      await expect(service.create(makeUser(), dto as any)).rejects.toThrow(/not found/i);
    });
  });

  describe('visibility and privacy', () => {
    const OWNER_ROW = {
      id: 'post-1',
      customer_id: 'customer-1',
      status: 'RECEIVING_APPLICATIONS',
      title: 'Leak',
      description: 'Details',
      city: 'Obalende',
      neighbourhood: 'Obalende',
      state: 'Lagos',
      address_line: '14 Adeola Odeku Street, flat 3',
      location_notes: 'Blue gate, ring twice',
      latitude: 6.4474,
      longitude: 3.4064,
      selected_artisan_id: null,
      service_id: 'service-1',
      applications_count: 2,
    };

    it('gives the owner the full record including the street address', async () => {
      db.maybeOne.mockResolvedValueOnce(OWNER_ROW);
      const result = await service.getOne(makeUser({ id: 'customer-1' }), 'post-1');

      expect(result.viewerRole).toBe('OWNER');
      expect(result.address_line).toBe('14 Adeola Odeku Street, flat 3');
      expect(result.location_notes).toBe('Blue gate, ring twice');
    });

    it('withholds the street address from a browsing artisan', async () => {
      db.maybeOne.mockResolvedValueOnce(OWNER_ROW);
      db.count.mockResolvedValueOnce(0);

      const result: any = await service.getOne(
        makeArtisan({ artisanProfileId: 'artisan-9' }), 'post-1',
      );

      expect(result.viewerRole).toBe('MARKETPLACE');
      expect(result.address_line).toBeUndefined();
      expect(result.location_notes).toBeUndefined();
      expect(result.latitude).toBeUndefined();
      expect(result.neighbourhood).toBe('Obalende');
      expect(result.description).toBe('Details');
    });

    it('releases the address to the artisan once they are engaged', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OWNER_ROW, selected_artisan_id: 'artisan-9' });

      const result: any = await service.getOne(
        makeArtisan({ artisanProfileId: 'artisan-9' }), 'post-1',
      );

      expect(result.viewerRole).toBe('ENGAGED_ARTISAN');
      expect(result.address_line).toBe('14 Adeola Odeku Street, flat 3');
    });

    it('hides a draft from everyone but its owner', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OWNER_ROW, status: 'DRAFT' });
      db.count.mockResolvedValueOnce(0);
      await expect(service.getOne(makeArtisan(), 'post-1')).rejects.toThrow(/not found/i);
    });

    it('lets an admin see a draft in full', async () => {
      db.maybeOne.mockResolvedValueOnce({ ...OWNER_ROW, status: 'DRAFT' });
      const result = await service.getOne(makeAdmin(), 'post-1');
      expect(result.viewerRole).toBe('ADMIN');
    });

    it('tells a browsing artisan whether they already applied', async () => {
      db.maybeOne.mockResolvedValueOnce(OWNER_ROW);
      db.count.mockResolvedValueOnce(1);

      const result: any = await service.getOne(makeArtisan({ artisanProfileId: 'artisan-9' }), 'post-1');
      expect(result.hasApplied).toBe(true);
    });
  });

  describe('editing', () => {
    it('refuses edits once an artisan has been selected', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'post-1', customer_id: 'customer-1', status: 'ARTISAN_SELECTED' });
      await expect(
        service.update(makeUser({ id: 'customer-1' }), 'post-1', { title: 'New title' } as any),
      ).rejects.toThrow(/can no longer be edited/);
    });

    it('refuses edits from a non-owner', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'post-1', customer_id: 'customer-1', status: 'PUBLISHED' });
      await expect(
        service.update(makeUser({ id: 'intruder' }), 'post-1', { title: 'Hijacked' } as any),
      ).rejects.toThrow(/do not own this job post/i);
    });

    it('refuses to move the service location after selection', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'post-1', customer_id: 'customer-1', status: 'ACCEPTED' });
      await expect(
        service.updateLocation(makeUser({ id: 'customer-1' }), 'post-1', { city: 'Ikeja' } as any),
      ).rejects.toThrow(/cannot change once an artisan has been selected/);
    });

    it('allows edits while the post is still open', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'post-1', customer_id: 'customer-1', status: 'RECEIVING_APPLICATIONS' });
      await expect(
        service.update(makeUser({ id: 'customer-1' }), 'post-1', { title: 'Clearer title' } as any),
      ).resolves.toBeTruthy();
    });
  });

  describe('completion', () => {
    const liveJob = {
      id: 'job-1', job_post_id: 'post-1', customer_id: 'customer-1',
      artisan_id: 'artisan-1', status: 'IN_PROGRESS',
    };

    it('does not let the artisan mark the job complete', async () => {
      db.one.mockResolvedValueOnce(liveJob);
      const artisan = makeArtisan({ id: 'artisan-user', artisanProfileId: 'artisan-1' });
      await expect(service.complete(artisan, 'job-1')).rejects.toThrow(/Only the customer/);
    });

    it('lets the customer complete and schedules a review nudge', async () => {
      db.one.mockResolvedValueOnce(liveJob);
      const result = await service.complete(makeUser({ id: 'customer-1' }), 'job-1');

      expect(result.status).toBe('COMPLETED');
      expect(queue.enqueue).toHaveBeenCalledWith(
        'reminder.review', { jobId: 'job-1' }, expect.objectContaining({ delaySeconds: 86_400 }),
      );
    });

    it('refuses to complete a job that has not started', async () => {
      db.one.mockResolvedValueOnce({ ...liveJob, status: 'PENDING_ACCEPTANCE' });
      await expect(service.complete(makeUser({ id: 'customer-1' }), 'job-1'))
        .rejects.toThrow(/cannot move to COMPLETED/);
    });

    it('detects a concurrent completion and refuses', async () => {
      db.one.mockResolvedValueOnce(liveJob);
      db.updateIf.mockResolvedValueOnce(null);
      await expect(service.complete(makeUser({ id: 'customer-1' }), 'job-1')).rejects.toThrow(/just changed/i);
    });
  });

  describe('the artisan declining', () => {
    const pending = {
      id: 'job-1', job_post_id: 'post-1', customer_id: 'customer-1',
      artisan_id: 'artisan-1', application_id: 'app-1', status: 'PENDING_ACCEPTANCE',
    };

    it('returns the post to the market rather than killing it', async () => {
      db.one.mockResolvedValueOnce(pending);
      const result = await service.declineEngagement(
        makeArtisan({ artisanProfileId: 'artisan-1' }), 'job-1', 'No longer free',
      );
      expect(result.message).toMatch(/open to applications again/);
    });

    it('refuses to decline after accepting', async () => {
      db.one.mockResolvedValueOnce({ ...pending, status: 'ACCEPTED' });
      await expect(
        service.declineEngagement(makeArtisan({ artisanProfileId: 'artisan-1' }), 'job-1'),
      ).rejects.toThrow(/Cancel the job instead/);
    });

    it('refuses a decline from an artisan who is not on the job', async () => {
      db.one.mockResolvedValueOnce(pending);
      await expect(
        service.declineEngagement(makeArtisan({ artisanProfileId: 'other-artisan' }), 'job-1'),
      ).rejects.toThrow(/not the artisan on this job/);
    });
  });
});
