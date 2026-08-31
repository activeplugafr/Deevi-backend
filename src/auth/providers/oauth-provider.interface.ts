export interface OAuthAuthorizationRequest {
  redirectTo?: string;
  state?: string;
}

export interface OAuthAuthorizationUrl {
  url: string;
  provider: string;
  /** True when the URL points at Deevi's own dev stub, not the real vendor. */
  mocked: boolean;
}

export interface OAuthIdentity {
  providerUserId: string;
  email: string;
  emailVerified: boolean;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
}

export interface OAuthProvider {
  readonly name: string;
  readonly isMock: boolean;
  getAuthorizationUrl(request: OAuthAuthorizationRequest): Promise<OAuthAuthorizationUrl>;
  /** Exchanges the callback code for a verified identity. */
  exchangeCode(code: string, redirectUri?: string): Promise<OAuthIdentity>;
  /** Verifies an ID token obtained by a native mobile SDK. */
  verifyIdToken(idToken: string): Promise<OAuthIdentity>;
}

export const OAUTH_PROVIDERS = Symbol('OAUTH_PROVIDERS');
