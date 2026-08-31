import { beforeEach, describe, expect, it, vi } from 'vitest';
import { AdminService } from './admin.service.js';
import {
  createMockAudit, createMockCache, createMockDb, createMockNotifications,
  createMockStorage, makeAdmin, type MockDb,
} from '../../test/helpers/mock-db.js';

const PENDING_APPLICATION = { id: 'app-1', artisan_id: 'artisan-1', status: 'PENDING' };
const ARTISAN = { id: 'artisan-1', user_id: 'artisan-user-1', verification_status: 'PENDING' };

describe('AdminService', () => {
  let db: MockDb;
  let cache: ReturnType<typeof createMockCache>;
  let audit: ReturnType<typeof createMockAudit>;
  let authContext: any;
  let notifications: ReturnType<typeof createMockNotifications>;
  let storage: ReturnType<typeof createMockStorage>;
  let service: AdminService;

  beforeEach(() => {
    db = createMockDb();
    cache = createMockCache();
    audit = createMockAudit();
    authContext = { invalidate: vi.fn(), invalidateByUserId: vi.fn() };
    notifications = createMockNotifications();
    storage = createMockStorage();
    service = new AdminService(
      db as any, cache as any, audit as any, authContext, notifications as any, storage as any,
    );
  });

  describe('deciding an artisan application', () => {
    it('approves, stamps the profile and tells the artisan', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION).mockResolvedValueOnce(ARTISAN);
      const actor = makeAdmin('VERIFICATION');

      const result = await service.reviewApplication(actor, 'app-1', { decision: 'APPROVED' });

      expect(result.message).toMatch(/approved/i);
      expect(db.updateIf).toHaveBeenCalledWith(
        'artisan_applications',
        { id: 'app-1', status: 'PENDING' },
        expect.objectContaining({ status: 'APPROVED', reviewed_by: actor.id }),
        expect.any(String),
      );
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'artisan-user-1', type: 'ARTISAN_APPROVED',
      }));
    });

    it('drops the cached principal so the approval bites immediately', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION).mockResolvedValueOnce(ARTISAN);
      await service.reviewApplication(makeAdmin('VERIFICATION'), 'app-1', { decision: 'APPROVED' });
      expect(authContext.invalidate).toHaveBeenCalledWith('artisan-user-1');
    });

    it('demands a reason when rejecting', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION);
      await expect(
        service.reviewApplication(makeAdmin('VERIFICATION'), 'app-1', { decision: 'REJECTED' }),
      ).rejects.toThrow(/Tell the artisan why/);
    });

    it('accepts a rejection that carries a reason', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION).mockResolvedValueOnce(ARTISAN);
      const result = await service.reviewApplication(makeAdmin('VERIFICATION'), 'app-1', {
        decision: 'REJECTED', rejectionReason: 'The ID document was unreadable.',
      });

      expect(result.message).toMatch(/rejected/i);
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ARTISAN_REJECTED',
      }));
    });

    it('refuses to re-decide an application already settled', async () => {
      db.one.mockResolvedValueOnce({ ...PENDING_APPLICATION, status: 'APPROVED' });
      await expect(
        service.reviewApplication(makeAdmin('VERIFICATION'), 'app-1', {
          decision: 'REJECTED', rejectionReason: 'x',
        }),
      ).rejects.toThrow(/already approved/i);
    });

    it('loses gracefully when another admin reviewed first', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION).mockResolvedValueOnce(ARTISAN);
      db.updateIf.mockResolvedValueOnce(null);

      await expect(
        service.reviewApplication(makeAdmin('VERIFICATION'), 'app-1', { decision: 'APPROVED' }),
      ).rejects.toThrow(/Another admin reviewed this application first/);
    });

    it('writes an audit entry for the decision', async () => {
      db.one.mockResolvedValueOnce(PENDING_APPLICATION).mockResolvedValueOnce(ARTISAN);
      const actor = makeAdmin('VERIFICATION');
      await service.reviewApplication(actor, 'app-1', { decision: 'APPROVED', notes: 'ID checks out' });

      expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({
        action: 'ARTISAN_APPLICATION_APPROVED',
        entityType: 'ARTISAN_APPLICATION',
        entityId: 'app-1',
      }));
    });
  });

  describe('suspending a user', () => {
    it('suspends, invalidates the session context and notifies', async () => {
      db.one.mockResolvedValueOnce({
        id: 'user-9', status: 'ACTIVE', auth_user_id: 'auth-9', email: 'bad@actor.test',
      });
      const actor = makeAdmin('OPERATIONS');

      const result = await service.suspendUser(actor, 'user-9', 'Confirmed no-shows across three jobs');

      expect(result.message).toMatch(/suspended/i);
      expect(authContext.invalidate).toHaveBeenCalledWith('auth-9');
      expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'USER_SUSPENDED' }));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        type: 'ACCOUNT_SUSPENDED',
      }));
    });

    it('refuses to let an admin suspend themselves', async () => {
      const actor = makeAdmin('SUPER_ADMIN');
      db.one.mockResolvedValueOnce({
        id: actor.id, status: 'ACTIVE', auth_user_id: actor.authUserId, email: 'me@deevi.test',
      });

      await expect(service.suspendUser(actor, actor.id, 'Testing something'))
        .rejects.toThrow(/cannot suspend your own/i);
    });
  });

  describe('resolving a dispute', () => {
    const OPEN_DISPUTE = {
      id: 'dispute-1', reference: 'DSP-1', job_id: 'job-1', status: 'OPEN',
      raised_by: 'customer-1', against_user_id: 'artisan-user-1',
    };

    it('closes the dispute and moves the job where the admin says', async () => {
      db.one.mockResolvedValueOnce(OPEN_DISPUTE);
      db.maybeOne.mockResolvedValueOnce({ id: 'job-1', job_post_id: 'post-1', status: 'DISPUTED' });

      const actor = makeAdmin('OPERATIONS');
      const result = await service.resolveDispute(actor, 'dispute-1', {
        status: 'RESOLVED',
        resolution: 'Artisan agreed to return and finish the tiling.',
        jobOutcome: 'IN_PROGRESS',
      });

      expect(result.message).toMatch(/resolved/i);
      expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({ action: 'DISPUTE_RESOLVED' }));
      expect(notifications.notifyMany).toHaveBeenCalled();
    });

    it('refuses to reopen a closed dispute', async () => {
      db.one.mockResolvedValueOnce({ ...OPEN_DISPUTE, status: 'RESOLVED' });
      await expect(
        service.resolveDispute(makeAdmin('OPERATIONS'), 'dispute-1', {
          status: 'DISMISSED', resolution: 'Changed my mind about this one.',
        }),
      ).rejects.toThrow(/already resolved/i);
    });

    it('loses gracefully to a concurrent resolution', async () => {
      db.one.mockResolvedValueOnce(OPEN_DISPUTE);
      db.updateIf.mockResolvedValueOnce(null);
      await expect(
        service.resolveDispute(makeAdmin('OPERATIONS'), 'dispute-1', {
          status: 'RESOLVED', resolution: 'Both sides settled it directly.',
        }),
      ).rejects.toThrow(/Another admin resolved this first/);
    });
  });

  describe('verification documents', () => {
    it('audits every document view before handing out a signed URL', async () => {
      db.one.mockResolvedValueOnce({
        id: 'doc-1', artisan_id: 'artisan-1',
        storage_path: 'artisan-user-1/nin.jpg', document_type: 'NIN',
      });
      const actor = makeAdmin('VERIFICATION');

      const result = await service.getDocumentUrl(actor, 'doc-1');

      expect(audit.record).toHaveBeenCalledWith(actor, expect.objectContaining({
        action: 'VERIFICATION_DOCUMENT_VIEWED',
      }));
      expect(result.url).toContain('signed');
    });
  });

  describe('admin team management', () => {
    it('refuses to let an admin revoke their own access', async () => {
      const actor = makeAdmin('SUPER_ADMIN');
      await expect(service.revokeAdmin(actor, actor.id)).rejects.toThrow(/cannot revoke your own/i);
    });

    it('refuses to promote someone who is already an admin', async () => {
      db.one.mockResolvedValueOnce({ id: 'user-2', email: 'a@b.test', auth_user_id: 'auth-2' });
      db.maybeOne.mockResolvedValueOnce({ id: 'existing-admin-profile' });

      await expect(
        service.createAdmin(makeAdmin('SUPER_ADMIN'), { userId: 'user-2', adminRole: 'SUPPORT' }),
      ).rejects.toThrow(/already has an admin profile/i);
    });

    it('promotes a user and invalidates their cached principal', async () => {
      db.one.mockResolvedValueOnce({ id: 'user-2', email: 'a@b.test', auth_user_id: 'auth-2' });
      db.maybeOne.mockResolvedValueOnce(null);

      const result = await service.createAdmin(makeAdmin('SUPER_ADMIN'), {
        userId: 'user-2', adminRole: 'SUPPORT',
      });

      expect(result.message).toMatch(/SUPPORT/);
      expect(authContext.invalidate).toHaveBeenCalledWith('auth-2');
    });
  });
});
