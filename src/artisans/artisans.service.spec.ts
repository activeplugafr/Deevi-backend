import { beforeEach, describe, expect, it, vi } from 'vitest';
import { ArtisansService } from './artisans.service.js';
import {
  createMockCache, createMockDb, createMockNotifications, createMockStorage,
  makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

describe('ArtisansService', () => {
  let db: MockDb;
  let catalogue: any;
  let cache: ReturnType<typeof createMockCache>;
  let storage: ReturnType<typeof createMockStorage>;
  let service: ArtisansService;

  beforeEach(() => {
    db = createMockDb();
    catalogue = { resolveServiceReference: vi.fn().mockResolvedValue({ id: 'service-1', category_id: 'cat-1' }) };
    cache = createMockCache();
    storage = createMockStorage();
    service = new ArtisansService(db as any, catalogue, cache as any, storage as any, createMockNotifications() as any);
  });

  describe('the approval gate', () => {
    it('lets an approved artisan through', () => {
      const artisan = makeArtisan({ artisanProfileId: 'artisan-1', artisanVerificationStatus: 'APPROVED' });
      expect(service.assertApproved(artisan)).toBe('artisan-1');
    });

    it.each(['PENDING', 'UNDER_REVIEW', 'REJECTED', 'SUSPENDED'])(
      'blocks an artisan whose status is %s',
      (status) => {
        const artisan = makeArtisan({ artisanVerificationStatus: status });
        expect(() => service.assertApproved(artisan)).toThrow(/Complete verification/);
      },
    );

    it('blocks a customer with no artisan profile', () => {
      expect(() => service.assertApproved(makeUser())).toThrow(/requires an artisan profile/i);
    });
  });

  describe('choosing services', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    it('requires at least one service', async () => {
      await expect(service.setServices(artisan, [])).rejects.toThrow(/at least one service/i);
    });

    it('caps the list at twenty', async () => {
      const many = Array.from({ length: 21 }, () => ({ serviceId: 'service-1' }));
      await expect(service.setServices(artisan, many as any)).rejects.toThrow(/at most 20 services/i);
    });

    it('validates every service reference before writing anything', async () => {
      catalogue.resolveServiceReference.mockRejectedValueOnce(new Error('SERVICE_NOT_FOUND'));
      await expect(
        service.setServices(artisan, [{ serviceId: 'made-up' }] as any),
      ).rejects.toThrow(/SERVICE_NOT_FOUND/);
      expect(db.insertMany).not.toHaveBeenCalled();
    });

    it('rejects an inverted price range', async () => {
      await expect(
        service.setServices(artisan, [{ serviceId: 'service-1', priceMin: 5000, priceMax: 1000 }] as any),
      ).rejects.toThrow(/priceMax cannot be lower/);
    });

    it('de-duplicates repeated service and sub-service pairs', async () => {
      await service.setServices(artisan, [
        { serviceId: 'service-1', subServiceId: 'sub-1' },
        { serviceId: 'service-1', subServiceId: 'sub-1' },
        { serviceId: 'service-1' },
      ] as any);

      const written = (db.insertMany as any).mock.calls[0][1];
      expect(written).toHaveLength(2);
    });
  });

  describe('service areas', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    it('requires at least one area', async () => {
      await expect(service.setServiceAreas(artisan, [])).rejects.toThrow(/at least one area/i);
    });

    it('caps the list at ten', async () => {
      const many = Array.from({ length: 11 }, () => ({ city: 'Lagos' }));
      await expect(service.setServiceAreas(artisan, many as any)).rejects.toThrow(/at most 10/i);
    });

    it('marks the first area as primary', async () => {
      await service.setServiceAreas(artisan, [{ city: 'Yaba' }, { city: 'Ikeja' }] as any);
      const written = (db.insertMany as any).mock.calls[0][1];
      expect(written[0].is_primary).toBe(true);
      expect(written[1].is_primary).toBe(false);
    });
  });

  describe('availability', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1' });

    it('rejects a window that ends before it starts', async () => {
      await expect(
        service.setAvailability(artisan, [{ dayOfWeek: 1, startTime: '18:00', endTime: '08:00' }] as any),
      ).rejects.toThrow(/ends at or before it starts/);
    });

    it('accepts a sensible window', async () => {
      await expect(
        service.setAvailability(artisan, [{ dayOfWeek: 1, startTime: '08:00', endTime: '18:00' }] as any),
      ).resolves.toBeTruthy();
    });
  });

  describe('submitting for verification', () => {
    const artisan = makeArtisan({ artisanProfileId: 'artisan-1', artisanVerificationStatus: 'PENDING' });
    const readyProfile = {
      id: 'artisan-1', headline: 'Plumber', bio: 'Ten years experience',
      verification_status: 'PENDING', years_of_experience: 10,
    };

    it('lists exactly what is missing rather than a vague refusal', async () => {
      db.one.mockResolvedValueOnce({ ...readyProfile, headline: null, bio: null });
      db.__setQueryResult([]);

      await expect(service.submitApplication(artisan)).rejects.toThrow(/headline or bio/);
      await expect(service.submitApplication(artisan)).rejects.toThrow(/at least one service area/);
    });

    it('refuses when the artisan is already approved', async () => {
      db.one.mockResolvedValueOnce({ ...readyProfile, verification_status: 'APPROVED' });
      db.__setQueryResult([{ id: 'doc-1', document_type: 'NIN' }]);
      await expect(service.submitApplication(artisan)).rejects.toThrow(/already approved/i);
    });

    it('refuses a suspended artisan', async () => {
      db.one.mockResolvedValueOnce({ ...readyProfile, verification_status: 'SUSPENDED' });
      db.__setQueryResult([{ id: 'doc-1', document_type: 'NIN' }]);
      await expect(service.submitApplication(artisan)).rejects.toThrow(/suspended/i);
    });
  });

  describe('public profile', () => {
    it('hides an artisan who is not approved', async () => {
      db.maybeOne.mockResolvedValueOnce({ id: 'artisan-1', verification_status: 'PENDING' });
      await expect(service.getPublicProfile('artisan-1')).rejects.toThrow(/not found/i);
    });

    it('hides an artisan who does not exist', async () => {
      db.maybeOne.mockResolvedValueOnce(null);
      await expect(service.getPublicProfile('nope')).rejects.toThrow(/not found/i);
    });
  });

  describe('portfolio', () => {
    it('refuses a file the artisan does not own', async () => {
      storage.assertOwnership.mockImplementationOnce(() => { throw new Error('FILE_ACCESS_DENIED'); });
      await expect(
        service.addPortfolioItem(makeArtisan({ artisanProfileId: 'artisan-1' }), {
          storagePath: 'another-user/photo.jpg',
        } as any),
      ).rejects.toThrow(/FILE_ACCESS_DENIED/);
    });

    it('caps the portfolio at twenty items', async () => {
      db.count.mockResolvedValueOnce(20);
      await expect(
        service.addPortfolioItem(makeArtisan({ artisanProfileId: 'artisan-1' }), {
          storagePath: 'me/photo.jpg',
        } as any),
      ).rejects.toThrow(/at most 20 portfolio items/i);
    });
  });
});
