import { beforeEach, describe, expect, it, vi } from 'vitest';
import { StorageService } from './storage.service.js';
import { StorageBucket } from './storage.constants.js';

describe('StorageService', () => {
  let service: StorageService;

  beforeEach(() => {
    const supabase = {
      getClient: () => ({
        storage: {
          from: () => ({
            createSignedUploadUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: 'https://upload.test/x', token: 'tok' }, error: null,
            }),
            createSignedUrl: vi.fn().mockResolvedValue({
              data: { signedUrl: 'https://signed.test/x' }, error: null,
            }),
            getPublicUrl: () => ({ data: { publicUrl: 'https://cdn.test/x' } }),
            remove: vi.fn().mockResolvedValue({ error: null }),
          }),
        },
      }),
    };
    service = new StorageService(supabase as any);
  });

  describe('file type validation', () => {
    it('accepts an image into an image bucket', () => {
      expect(() => service.validate(StorageBucket.AVATARS, 'image/jpeg')).not.toThrow();
    });

    it('rejects a PDF as an avatar', () => {
      expect(() => service.validate(StorageBucket.AVATARS, 'application/pdf'))
        .toThrow(/not allowed here/);
    });

    it('rejects an executable everywhere', () => {
      for (const bucket of Object.values(StorageBucket)) {
        expect(() => service.validate(bucket, 'application/x-msdownload')).toThrow();
      }
    });

    it('accepts video only in the job media bucket', () => {
      expect(() => service.validate(StorageBucket.JOB_MEDIA, 'video/mp4')).not.toThrow();
      expect(() => service.validate(StorageBucket.PORTFOLIO, 'video/mp4')).toThrow();
    });

    it('accepts a PDF as a verification document', () => {
      expect(() => service.validate(StorageBucket.VERIFICATION_DOCUMENTS, 'application/pdf')).not.toThrow();
    });
  });

  describe('size limits', () => {
    it('rejects an oversized avatar', () => {
      expect(() => service.validate(StorageBucket.AVATARS, 'image/jpeg', 10 * 1024 * 1024))
        .toThrow(/exceeds the 5MB limit/);
    });

    it('accepts a file inside the limit', () => {
      expect(() => service.validate(StorageBucket.AVATARS, 'image/jpeg', 1024)).not.toThrow();
    });

    it('allows a larger video in the job media bucket', () => {
      expect(() => service.validate(StorageBucket.JOB_MEDIA, 'video/mp4', 20 * 1024 * 1024)).not.toThrow();
      expect(() => service.validate(StorageBucket.JOB_MEDIA, 'video/mp4', 30 * 1024 * 1024)).toThrow();
    });
  });

  describe('object key ownership', () => {
    it('namespaces every key under the owner id', () => {
      const path = service.buildPath(StorageBucket.JOB_MEDIA, 'user-123', 'photo.jpg');
      expect(path.startsWith('user-123/')).toBe(true);
      expect(path.endsWith('.jpg')).toBe(true);
    });

    it('does not let a crafted filename escape the namespace', () => {
      const path = service.buildPath(StorageBucket.JOB_MEDIA, 'user-123', '../../etc/passwd');
      expect(path.startsWith('user-123/')).toBe(true);
      expect(path).not.toContain('..');
    });

    it('drops an unrecognised extension rather than trusting it', () => {
      const path = service.buildPath(StorageBucket.AVATARS, 'user-123', 'payload.php%00.jpg');
      expect(path).not.toContain('%00');
    });

    it('accepts a path the user owns', () => {
      expect(() => service.assertOwnership('user-123/file.jpg', 'user-123')).not.toThrow();
    });

    it('rejects a path belonging to somebody else', () => {
      expect(() => service.assertOwnership('user-999/file.jpg', 'user-123'))
        .toThrow(/do not have access/);
    });

    it('rejects a prefix-collision attempt', () => {
      // "user-1234" must not pass as "user-123".
      expect(() => service.assertOwnership('user-1234/file.jpg', 'user-123')).toThrow();
    });
  });

  describe('upload tickets', () => {
    it('returns a public URL for a public bucket', async () => {
      const ticket = await service.createUploadTicket(
        StorageBucket.JOB_MEDIA, 'user-1', 'photo.jpg', 'image/jpeg', 1024,
      );
      expect(ticket.publicUrl).toBe('https://cdn.test/x');
      expect(ticket.uploadUrl).toBe('https://upload.test/x');
    });

    it('withholds a public URL for a private bucket', async () => {
      const ticket = await service.createUploadTicket(
        StorageBucket.VERIFICATION_DOCUMENTS, 'user-1', 'nin.pdf', 'application/pdf', 1024,
      );
      expect(ticket.publicUrl).toBeNull();
    });

    it('validates before minting a URL at all', async () => {
      await expect(
        service.createUploadTicket(StorageBucket.AVATARS, 'user-1', 'huge.jpg', 'image/jpeg', 50 * 1024 * 1024),
      ).rejects.toThrow(/exceeds/);
    });
  });
});
