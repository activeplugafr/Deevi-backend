import { SetMetadata } from '@nestjs/common';

export const IS_PUBLIC_KEY = 'deevi:isPublic';

/** Opts a route out of authentication. Authorization is deny-by-default. */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);

export const OPTIONAL_AUTH_KEY = 'deevi:optionalAuth';

/**
 * Authenticates when a token is present but does not reject anonymous
 * callers. Used by browse-style endpoints that personalise when they can.
 */
export const OptionalAuth = () => SetMetadata(OPTIONAL_AUTH_KEY, true);
