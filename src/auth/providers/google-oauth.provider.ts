import { HttpStatus, Logger } from '@nestjs/common';
import { createRemoteJWKSet, jwtVerify } from 'jose';
import { DomainException } from '../../common/errors/domain.exception.js';
import type {
  OAuthAuthorizationRequest, OAuthAuthorizationUrl, OAuthIdentity, OAuthProvider,
} from './oauth-provider.interface.js';

const GOOGLE_JWKS = 'https://www.googleapis.com/oauth2/v3/certs';
const GOOGLE_TOKEN_ENDPOINT = 'https://oauth2.googleapis.com/token';
const GOOGLE_AUTH_ENDPOINT = 'https://accounts.google.com/o/oauth2/v2/auth';

/**
 * Google Sign-In. Supports both flows the Deevi clients need:
 * - web: redirect to Google, exchange the `code` on the callback
 * - mobile: the native SDK returns an id_token, verified here against JWKS
 *
 * Adding Apple later means implementing OAuthProvider once and registering it;
 * nothing in AuthService is Google-specific.
 */
export class GoogleOAuthProvider implements OAuthProvider {
  readonly name = 'google';
  readonly isMock = false;
  private readonly logger = new Logger('GoogleOAuth');
  private readonly jwks = createRemoteJWKSet(new URL(GOOGLE_JWKS));

  constructor(
    private readonly clientId: string,
    private readonly clientSecret: string,
    private readonly redirectUri: string,
  ) {}

  async getAuthorizationUrl(request: OAuthAuthorizationRequest): Promise<OAuthAuthorizationUrl> {
    const params = new URLSearchParams({
      client_id: this.clientId,
      redirect_uri: request.redirectTo ?? this.redirectUri,
      response_type: 'code',
      scope: 'openid email profile',
      access_type: 'offline',
      prompt: 'select_account',
      ...(request.state ? { state: request.state } : {}),
    });
    return { url: `${GOOGLE_AUTH_ENDPOINT}?${params.toString()}`, provider: this.name, mocked: false };
  }

  async exchangeCode(code: string, redirectUri?: string): Promise<OAuthIdentity> {
    const response = await fetch(GOOGLE_TOKEN_ENDPOINT, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams({
        code,
        client_id: this.clientId,
        client_secret: this.clientSecret,
        redirect_uri: redirectUri ?? this.redirectUri,
        grant_type: 'authorization_code',
      }),
    });

    if (!response.ok) {
      const detail = await response.text();
      this.logger.warn(`Google code exchange failed: ${response.status} ${detail}`);
      throw new DomainException('OAUTH_EXCHANGE_FAILED', 'Google sign-in failed', HttpStatus.UNAUTHORIZED);
    }

    const body = (await response.json()) as { id_token?: string };
    if (!body.id_token) {
      throw new DomainException('OAUTH_EXCHANGE_FAILED', 'Google did not return an identity token', HttpStatus.UNAUTHORIZED);
    }
    return this.verifyIdToken(body.id_token);
  }

  async verifyIdToken(idToken: string): Promise<OAuthIdentity> {
    try {
      const { payload } = await jwtVerify(idToken, this.jwks, {
        issuer: ['https://accounts.google.com', 'accounts.google.com'],
        audience: this.clientId,
      });

      if (!payload.email) {
        throw new DomainException('OAUTH_NO_EMAIL', 'Google did not share an email address', HttpStatus.BAD_REQUEST);
      }

      return {
        providerUserId: String(payload.sub),
        email: String(payload.email),
        emailVerified: payload.email_verified === true,
        firstName: (payload.given_name as string) ?? null,
        lastName: (payload.family_name as string) ?? null,
        avatarUrl: (payload.picture as string) ?? null,
      };
    } catch (err) {
      if (err instanceof DomainException) throw err;
      this.logger.warn(`Google id_token rejected: ${(err as Error).message}`);
      throw new DomainException('OAUTH_INVALID_TOKEN', 'Google sign-in token is invalid', HttpStatus.UNAUTHORIZED);
    }
  }
}
