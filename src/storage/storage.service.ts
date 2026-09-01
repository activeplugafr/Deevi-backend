import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { extname } from 'node:path';
import { SupabaseService } from '../supabase/supabase.service.js';
import { DomainException, ForbiddenError } from '../common/errors/domain.exception.js';
import {
  BUCKET_POLICIES, SIGNED_URL_TTL_SECONDS, StorageBucket,
} from './storage.constants.js';

export interface UploadTicket {
  bucket: string;
  path: string;
  /** Signed URL the client PUTs the bytes to. */
  uploadUrl: string;
  token: string;
  /** Permanent URL for public buckets; null for private ones. */
  publicUrl: string | null;
  expiresIn: number;
  maxBytes: number;
  allowedMimeTypes: string[];
}

/**
 * All file traffic is brokered here.
 *
 * Clients never hold Supabase credentials: they ask the API for a short-lived
 * signed upload URL, and the API decides -- from the caller's identity and the
 * bucket policy -- whether that upload is allowed and where it may land.
 * Private buckets (verification documents, message attachments) are only ever
 * readable through a signed URL minted after an ownership check.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);

  constructor(private readonly supabase: SupabaseService) {}

  private get storage() {
    return this.supabase.getClient().storage;
  }

  validate(bucket: StorageBucket, mimeType: string, sizeBytes?: number): void {
    const policy = BUCKET_POLICIES[bucket];
    if (!policy) throw new DomainException('UNKNOWN_BUCKET', 'Unknown storage bucket');

    if (!policy.allowedMimeTypes.includes(mimeType)) {
      throw new DomainException(
        'UNSUPPORTED_FILE_TYPE',
        `${mimeType} is not allowed here. Accepted: ${policy.allowedMimeTypes.join(', ')}`,
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }

    if (sizeBytes !== undefined && sizeBytes > policy.maxBytes) {
      throw new DomainException(
        'FILE_TOO_LARGE',
        `File exceeds the ${Math.round(policy.maxBytes / 1024 / 1024)}MB limit for this upload`,
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
  }

  /**
   * Object keys always start with the owning user's id. That single
   * convention makes ownership checkable from the path alone.
   */
  buildPath(bucket: StorageBucket, ownerId: string, filename: string, prefix?: string): string {
    const ext = (extname(filename) || '').toLowerCase().slice(0, 10);
    const safeExt = /^\.[a-z0-9]+$/.test(ext) ? ext : '';
    const segments = [ownerId, prefix, `${Date.now()}-${randomUUID().slice(0, 8)}${safeExt}`];
    return segments.filter(Boolean).join('/');
  }

  async createUploadTicket(
    bucket: StorageBucket,
    ownerId: string,
    filename: string,
    mimeType: string,
    sizeBytes?: number,
    prefix?: string,
  ): Promise<UploadTicket> {
    this.validate(bucket, mimeType, sizeBytes);

    const policy = BUCKET_POLICIES[bucket];
    const path = this.buildPath(bucket, ownerId, filename, prefix);

    const { data, error } = await this.storage.from(bucket).createSignedUploadUrl(path);
    if (error || !data) {
      this.logger.error(`Could not create upload URL for ${bucket}/${path}: ${error?.message}`);
      throw new DomainException(
        'UPLOAD_URL_FAILED',
        'Could not prepare the upload. Please try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return {
      bucket,
      path,
      uploadUrl: data.signedUrl,
      token: data.token,
      publicUrl: policy.isPublic ? this.getPublicUrl(bucket, path) : null,
      expiresIn: SIGNED_URL_TTL_SECONDS,
      maxBytes: policy.maxBytes,
      allowedMimeTypes: policy.allowedMimeTypes,
    };
  }

  getPublicUrl(bucket: StorageBucket, path: string): string {
    return this.storage.from(bucket).getPublicUrl(path).data.publicUrl;
  }

  /** Short-lived read URL for a private object. Caller must authorize first. */
  async createSignedDownloadUrl(
    bucket: StorageBucket,
    path: string,
    ttlSeconds = SIGNED_URL_TTL_SECONDS,
  ): Promise<{ url: string; expiresIn: number }> {
    const { data, error } = await this.storage.from(bucket).createSignedUrl(path, ttlSeconds);
    if (error || !data) {
      this.logger.error(`Could not sign ${bucket}/${path}: ${error?.message}`);
      throw new DomainException('SIGNED_URL_FAILED', 'Could not generate a download link');
    }
    return { url: data.signedUrl, expiresIn: ttlSeconds };
  }

  /** Path-prefix ownership check, used before serving private objects. */
  assertOwnership(path: string, ownerId: string): void {
    if (!path.startsWith(`${ownerId}/`)) {
      throw new ForbiddenError('You do not have access to this file', 'FILE_ACCESS_DENIED');
    }
  }

  async remove(bucket: StorageBucket, paths: string[]): Promise<void> {
    if (!paths.length) return;
    const { error } = await this.storage.from(bucket).remove(paths);
    if (error) this.logger.warn(`Could not delete from ${bucket}: ${error.message}`);
  }

  async exists(bucket: StorageBucket, path: string): Promise<boolean> {
    const folder = path.split('/').slice(0, -1).join('/');
    const filename = path.split('/').pop() ?? '';
    const { data, error } = await this.storage.from(bucket).list(folder, { search: filename, limit: 1 });
    if (error) return false;
    return (data ?? []).some((item) => item.name === filename);
  }
}
