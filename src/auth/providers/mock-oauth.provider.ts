import { HttpStatus, Logger } from '@nestjs/common';
import { createHash } from 'node:crypto';
import { DomainException } from '../../common/errors/domain.exception.js';
import { loadConfiguration } from '../../config/configuration.js';
import type {
  OAuthAuthorizationRequest, OAuthAuthorizationUrl, OAuthIdentity, OAuthProvider,
} from './oauth-provider.interface.js';

/**
 * Development stand-in used when GOOGLE_CLIENT_ID/SECRET are absent, so the
 * social sign-in path can be built and tested end to end before anyone
 * provisions a Google Cloud project.
 *
 * The `code` is simply an email address: POST /auth/google/callback with
 * `{ "code": "ada@example.com" }` yields a deterministic identity. It refuses
 * to load in production so it can never become a real authentication bypass.
 */
export class MockOAuthProvider implements OAuthProvider {
  readonly name = 'google';
  readonly isMock = true;
  private readonly logger = new Logger('MockOAuth');

  constructor() {
    if (loadConfiguration().isProduction) {
      throw new Error(
        'Mock OAuth provider cannot run in production. Set GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET.',
      );
    }
    this.logger.warn(
      'Google OAuth is MOCKED. POST /auth/google/callback with {"code": "<email>"} to simulate sign-in.',
    );
  }

  async getAuthorizationUrl(request: OAuthAuthorizationRequest): Promise<OAuthAuthorizationUrl> {
    const params = new URLSearchParams({
      mock: 'true',
      ...(request.state ? { state: request.state } : {}),
      ...(request.redirectTo ? { redirect_to: request.redirectTo } : {}),
    });
    return {
      url: `/api/v1/auth/google/mock-consent?${params.toString()}`,
      provider: this.name,
      mocked: true,
    };
  }

  async exchangeCode(code: string): Promise<OAuthIdentity> {
    return this.identityFor(code);
  }

  async verifyIdToken(idToken: string): Promise<OAuthIdentity> {
    return this.identityFor(idToken);
  }

  private identityFor(seed: string): OAuthIdentity {
    const email = seed.includes('@') ? seed.trim().toLowerCase() : `${seed}@mock-google.test`;
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      throw new DomainException(
        'OAUTH_INVALID_TOKEN',
        'Mock Google sign-in expects an email address as the code',
        HttpStatus.BAD_REQUEST,
      );
    }

    const [local] = email.split('@');
    const parts = local.split(/[._-]/).filter(Boolean);

    return {
      providerUserId: `mock-google-${createHash('sha256').update(email).digest('hex').slice(0, 24)}`,
      email,
      emailVerified: true,
      firstName: capitalise(parts[0] ?? 'Test'),
      lastName: capitalise(parts[1] ?? 'User'),
      avatarUrl: null,
    };
  }
}

const capitalise = (value: string) => value.charAt(0).toUpperCase() + value.slice(1);
