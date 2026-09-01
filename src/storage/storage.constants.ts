export const StorageBucket = {
  AVATARS: 'avatars',
  PORTFOLIO: 'portfolio',
  JOB_MEDIA: 'job-media',
  MESSAGE_ATTACHMENTS: 'message-attachments',
  VERIFICATION_DOCUMENTS: 'verification-documents',
} as const;
export type StorageBucket = (typeof StorageBucket)[keyof typeof StorageBucket];

export const IMAGE_MIME_TYPES = ['image/jpeg', 'image/png', 'image/webp'];
export const VIDEO_MIME_TYPES = ['video/mp4', 'video/quicktime'];
export const DOCUMENT_MIME_TYPES = [...IMAGE_MIME_TYPES, 'application/pdf'];

export interface BucketPolicy {
  bucket: StorageBucket;
  /** Public buckets serve a permanent CDN URL; private ones require signing. */
  isPublic: boolean;
  allowedMimeTypes: string[];
  maxBytes: number;
}

/**
 * Upload rules enforced server-side. The same limits exist on the Supabase
 * bucket itself, so a client that somehow bypasses the API still cannot
 * store a 2GB file or an executable.
 */
export const BUCKET_POLICIES: Record<StorageBucket, BucketPolicy> = {
  avatars: {
    bucket: 'avatars', isPublic: true,
    allowedMimeTypes: IMAGE_MIME_TYPES, maxBytes: 5 * 1024 * 1024,
  },
  portfolio: {
    bucket: 'portfolio', isPublic: true,
    allowedMimeTypes: IMAGE_MIME_TYPES, maxBytes: 10 * 1024 * 1024,
  },
  'job-media': {
    bucket: 'job-media', isPublic: true,
    allowedMimeTypes: [...IMAGE_MIME_TYPES, ...VIDEO_MIME_TYPES], maxBytes: 25 * 1024 * 1024,
  },
  'message-attachments': {
    bucket: 'message-attachments', isPublic: false,
    allowedMimeTypes: DOCUMENT_MIME_TYPES, maxBytes: 10 * 1024 * 1024,
  },
  'verification-documents': {
    bucket: 'verification-documents', isPublic: false,
    allowedMimeTypes: DOCUMENT_MIME_TYPES, maxBytes: 10 * 1024 * 1024,
  },
};

export const SIGNED_URL_TTL_SECONDS = 300;
