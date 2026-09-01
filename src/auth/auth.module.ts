import { Global, Logger, Module } from '@nestjs/common';
import { AuthController } from './auth.controller.js';
import { AuthService } from './auth.service.js';
import { AuthContextService } from './auth-context.service.js';
import { TokenVerifierService } from './token-verifier.service.js';
import { SupabaseAuthGuard } from './guards/supabase-auth.guard.js';
import { RolesGuard } from './guards/roles.guard.js';
import { OAUTH_PROVIDERS, type OAuthProvider } from './providers/oauth-provider.interface.js';
import { GoogleOAuthProvider } from './providers/google-oauth.provider.js';
import { MockOAuthProvider } from './providers/mock-oauth.provider.js';
import { loadConfiguration } from '../config/configuration.js';

/**
 * Provider registry. Google is real when credentials exist and mocked
 * otherwise; Apple would be added here as one more entry.
 */
const oauthProvidersFactory = (): Map<string, OAuthProvider> => {
  const config = loadConfiguration();
  const logger = new Logger('AuthModule');
  const providers = new Map<string, OAuthProvider>();

  if (config.google.configured) {
    providers.set('google', new GoogleOAuthProvider(
      config.google.clientId, config.google.clientSecret, config.google.redirectUri,
    ));
    logger.log('Google OAuth: configured');
  } else if (!config.isProduction) {
    providers.set('google', new MockOAuthProvider());
  } else {
    logger.error('Google OAuth is not configured and mocks are disabled in production.');
  }

  return providers;
};

@Global()
@Module({
  controllers: [AuthController],
  providers: [
    AuthService,
    AuthContextService,
    TokenVerifierService,
    SupabaseAuthGuard,
    RolesGuard,
    { provide: OAUTH_PROVIDERS, useFactory: oauthProvidersFactory },
  ],
  exports: [AuthService, AuthContextService, TokenVerifierService, SupabaseAuthGuard, RolesGuard],
})
export class AuthModule {}
