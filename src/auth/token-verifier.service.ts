import { Injectable, Logger } from '@nestjs/common';
import { createRemoteJWKSet, decodeJwt, jwtVerify } from 'jose';
import { SupabaseService } from '../supabase/supabase.service.js';
import { loadConfiguration, type DeeviConfig } from '../config/configuration.js';

export interface VerifiedToken {
  authUserId: string;
  email: string | null;
  expiresAt: number | null;
}

/**
 * Verifies Supabase access tokens.
 *
 * Preference order matters for scale: asymmetric JWTs are verified locally
 * against the project's JWKS, which keeps request auth CPU-bound instead of
 * costing a network round trip to GoTrue on every single call. Projects
 * still on legacy HS256 keys fall back to a remote `getUser()` check.
 */
@Injectable()
export class TokenVerifierService {
  private readonly logger = new Logger(TokenVerifierService.name);
  private readonly config: DeeviConfig = loadConfiguration();
  private jwks: ReturnType<typeof createRemoteJWKSet> | null = null;
  private localVerificationUsable = true;

  constructor(private readonly supabase: SupabaseService) {}

  private getJwks() {
    if (!this.jwks) {
      this.jwks = createRemoteJWKSet(new URL(this.config.supabase.jwksUrl), {
        cacheMaxAge: 10 * 60 * 1000,
        cooldownDuration: 30 * 1000,
      });
    }
    return this.jwks;
  }

  async verify(token: string): Promise<VerifiedToken | null> {
    if (!token) return null;

    if (this.localVerificationUsable) {
      const local = await this.verifyLocally(token);
      if (local) return local;
    }

    return this.verifyRemotely(token);
  }

  private async verifyLocally(token: string): Promise<VerifiedToken | null> {
    try {
      // Symmetric (legacy) tokens cannot be checked against JWKS.
      const header = JSON.parse(
        Buffer.from(token.split('.')[0] ?? '', 'base64url').toString('utf8'),
      );
      if (typeof header.alg === 'string' && header.alg.startsWith('HS')) {
        this.localVerificationUsable = false;
        this.logger.log('Project uses symmetric JWTs; verifying tokens via GoTrue instead.');
        return null;
      }

      const { payload } = await jwtVerify(token, this.getJwks(), {
        issuer: `${this.config.supabase.url}/auth/v1`,
      });

      if (!payload.sub) return null;
      return {
        authUserId: payload.sub,
        email: (payload.email as string) ?? null,
        expiresAt: payload.exp ?? null,
      };
    } catch (err) {
      const message = (err as Error).message ?? '';
      // A malformed/expired token is a client problem; a JWKS fetch failure
      // is ours, and must not lock everyone out -- fall through to GoTrue.
      if (/JWKS|jwks|fetch|ENOTFOUND|ECONNREFUSED/i.test(message)) {
        this.logger.warn(`JWKS verification unavailable: ${message}`);
        return null;
      }
      return null;
    }
  }

  private async verifyRemotely(token: string): Promise<VerifiedToken | null> {
    const { data, error } = await this.supabase.getClient().auth.getUser(token);
    if (error || !data?.user) return null;

    let expiresAt: number | null = null;
    try {
      expiresAt = decodeJwt(token).exp ?? null;
    } catch { /* opaque token */ }

    return { authUserId: data.user.id, email: data.user.email ?? null, expiresAt };
  }
}
