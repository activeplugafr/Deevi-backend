import { beforeEach, describe, expect, it } from 'vitest';
import { MessagingService } from './messaging.service.js';
import {
  createMockDb, createMockNotifications, createMockStorage,
  makeAdmin, makeArtisan, makeUser, type MockDb,
} from '../../test/helpers/mock-db.js';

const CONVERSATION = {
  id: 'conv-1',
  job_post_id: 'post-1',
  job_application_id: 'app-1',
  customer_id: 'customer-1',
  artisan_id: 'artisan-1',
  artisan_user_id: 'artisan-user-1',
  status: 'ACTIVE',
  customer_unread_count: 0,
  artisan_unread_count: 2,
  message_count: 5,
};

describe('MessagingService', () => {
  let db: MockDb;
  let storage: ReturnType<typeof createMockStorage>;
  let notifications: ReturnType<typeof createMockNotifications>;
  let service: MessagingService;

  beforeEach(() => {
    db = createMockDb();
    storage = createMockStorage();
    notifications = createMockNotifications();
    service = new MessagingService(db as any, storage as any, notifications as any);
  });

  describe('who may read a conversation', () => {
    it('lets the customer in', async () => {
      db.maybeOne.mockResolvedValue(CONVERSATION);
      await expect(
        service.listMessages(makeUser({ id: 'customer-1' }), 'conv-1', { limit: 30 } as any),
      ).resolves.toBeTruthy();
    });

    it('lets the artisan in', async () => {
      db.maybeOne.mockResolvedValue(CONVERSATION);
      await expect(
        service.listMessages(
          makeArtisan({ id: 'artisan-user-1', artisanProfileId: 'artisan-1' }), 'conv-1', { limit: 30 } as any,
        ),
      ).resolves.toBeTruthy();
    });

    it('keeps an unrelated customer out', async () => {
      db.maybeOne.mockResolvedValue(CONVERSATION);
      await expect(
        service.listMessages(makeUser({ id: 'nosy-customer' }), 'conv-1', { limit: 30 } as any),
      ).rejects.toThrow(/not part of this conversation/i);
    });

    it('keeps an unrelated artisan out', async () => {
      db.maybeOne.mockResolvedValue(CONVERSATION);
      await expect(
        service.listMessages(
          makeArtisan({ id: 'other-artisan-user', artisanProfileId: 'artisan-2' }), 'conv-1', { limit: 30 } as any,
        ),
      ).rejects.toThrow(/not part of this conversation/i);
    });

    it('keeps admins out too', async () => {
      // Reading private negotiations is a moderation action that must go
      // through a report, not a browse.
      db.maybeOne.mockResolvedValue(CONVERSATION);
      await expect(
        service.listMessages(makeAdmin('SUPER_ADMIN'), 'conv-1', { limit: 30 } as any),
      ).rejects.toThrow(/not part of this conversation/i);
    });

    it('refuses a blocked conversation', async () => {
      db.maybeOne.mockResolvedValue({ ...CONVERSATION, status: 'BLOCKED' });
      await expect(
        service.listMessages(makeUser({ id: 'customer-1' }), 'conv-1', { limit: 30 } as any),
      ).rejects.toThrow(/blocked/i);
    });

    it('404s on a conversation that does not exist', async () => {
      db.maybeOne.mockResolvedValue(null);
      await expect(
        service.listMessages(makeUser(), 'missing', { limit: 30 } as any),
      ).rejects.toThrow(/not found/i);
    });
  });

  describe('sending', () => {
    it('addresses the message to the other participant', async () => {
      db.maybeOne.mockResolvedValueOnce(CONVERSATION).mockResolvedValueOnce({ title: 'Leak' });

      await service.sendMessage(makeUser({ id: 'customer-1' }), 'conv-1', { body: 'Can you come Saturday?' });

      expect(db.insertOne).toHaveBeenCalledWith('messages', expect.objectContaining({
        sender_id: 'customer-1',
        recipient_id: 'artisan-user-1',
        message_type: 'TEXT',
      }), expect.any(String));
      expect(notifications.notify).toHaveBeenCalledWith(expect.objectContaining({
        userId: 'artisan-user-1', type: 'NEW_MESSAGE',
      }));
    });

    it('refuses an empty message', async () => {
      db.maybeOne.mockResolvedValueOnce(CONVERSATION);
      await expect(
        service.sendMessage(makeUser({ id: 'customer-1' }), 'conv-1', {}),
      ).rejects.toThrow(/text or an attachment/i);
    });

    it('refuses an attachment the sender does not own', async () => {
      db.maybeOne.mockResolvedValueOnce(CONVERSATION);
      storage.assertOwnership.mockImplementationOnce(() => { throw new Error('FILE_ACCESS_DENIED'); });

      await expect(
        service.sendMessage(makeUser({ id: 'customer-1' }), 'conv-1', {
          attachmentPath: 'someone-else/photo.jpg',
        }),
      ).rejects.toThrow(/FILE_ACCESS_DENIED/);
    });

    it('refuses a non-participant sending into the thread', async () => {
      db.maybeOne.mockResolvedValueOnce(CONVERSATION);
      await expect(
        service.sendMessage(makeUser({ id: 'intruder' }), 'conv-1', { body: 'Hello there friend' }),
      ).rejects.toThrow(/not part of this conversation/i);
    });
  });

  describe('opening a conversation', () => {
    const POST = {
      id: 'post-1', customer_id: 'customer-1', title: 'Leak',
      status: 'RECEIVING_APPLICATIONS', selected_artisan_id: null, deleted_at: null,
    };

    it('refuses cold outreach where no application exists', async () => {
      db.maybeOne.mockResolvedValueOnce(POST);
      db.count.mockResolvedValueOnce(0);

      await expect(
        service.startConversation(makeUser({ id: 'customer-1' }), {
          jobPostId: 'post-1', artisanId: 'artisan-1',
        } as any),
      ).rejects.toThrow(/once an application exists/i);
    });

    it('opens the thread once the artisan has applied', async () => {
      db.maybeOne.mockResolvedValueOnce(POST).mockResolvedValueOnce(null);
      db.count.mockResolvedValueOnce(1);
      db.one.mockResolvedValueOnce({ id: 'artisan-1', user_id: 'artisan-user-1' });

      const result = await service.startConversation(makeUser({ id: 'customer-1' }), {
        jobPostId: 'post-1', artisanId: 'artisan-1',
      } as any);

      expect(result).toBeTruthy();
      expect(db.insertOne).toHaveBeenCalledWith('conversations', expect.objectContaining({
        job_post_id: 'post-1', artisan_id: 'artisan-1',
      }), expect.any(String));
    });

    it('does not let an artisan open a thread as somebody else', async () => {
      db.maybeOne.mockResolvedValueOnce(POST);
      await expect(
        service.startConversation(
          makeArtisan({ artisanProfileId: 'artisan-1' }),
          { jobPostId: 'post-1', artisanId: 'artisan-2' } as any,
        ),
      ).rejects.toThrow(/only open conversations as yourself/i);
    });

    it('returns the existing thread instead of creating a duplicate', async () => {
      db.maybeOne.mockResolvedValueOnce(POST).mockResolvedValueOnce(CONVERSATION);
      db.count.mockResolvedValueOnce(1);
      db.one.mockResolvedValueOnce({ id: 'artisan-1', user_id: 'artisan-user-1' });

      const result = await service.startConversation(makeUser({ id: 'customer-1' }), {
        jobPostId: 'post-1', artisanId: 'artisan-1',
      } as any);

      expect(result.id).toBe('conv-1');
      expect(db.insertOne).not.toHaveBeenCalled();
    });
  });

  describe('deleting a message', () => {
    it('only lets the sender delete their own', async () => {
      db.maybeOne
        .mockResolvedValueOnce(CONVERSATION)
        .mockResolvedValueOnce({ id: 'msg-1', sender_id: 'artisan-user-1' });

      await expect(
        service.deleteMessage(makeUser({ id: 'customer-1' }), 'conv-1', 'msg-1'),
      ).rejects.toThrow(/only delete your own/i);
    });
  });
});
