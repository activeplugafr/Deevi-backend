import { SetMetadata } from '@nestjs/common';

export const RATE_LIMIT_KEY = 'deevi:rateLimit';

export interface RateLimitOptions {
  /** Requests allowed inside the window. */
  limit: number;
  /** Window length in seconds. */
  windowSeconds: number;
  /** Bucket name, so unrelated routes do not share a budget. */
  bucket?: string;
}

/** Per-route override of the global rate limit. */
export const RateLimit = (options: RateLimitOptions) => SetMetadata(RATE_LIMIT_KEY, options);
