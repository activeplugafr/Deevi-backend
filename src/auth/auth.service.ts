import { HttpStatus, Inject, Injectable, Logger } from '@nestjs/common';
import type { Session } from '@supabase/supabase-js';
import { SupabaseService } from '../supabase/supabase.service.js';
import { DatabaseService } from '../supabase/database.service.js';
import { AuthContextService } from './auth-context.service.js';
import { DomainException } from '../common/errors/domain.exception.js';
import { loadConfiguration } from '../config/configuration.js';
import { OAUTH_PROVIDERS, type OAuthIdentity, type OAuthProvider } from './providers/oauth-provider.interface.js';
import type { SignupDto } from './dto/signup.dto.js';
import type { LoginDto } from './dto/login.dto.js';
import type { AuthResponseDto, SessionDto } from './dto/auth-response.dto.js';
import type { GoogleCallbackDto, OAuthStartQueryDto } from './dto/oauth.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

interface UserRow {
  id: string;
  auth_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  phone: string | null;
  avatar_url: string | null;
  status: string;
}

const USER_COLUMNS = 'id, auth_user_id, email, first_name, last_name, phone, avatar_url, status';

/**
 * Supabase Auth owns credentials; Deevi owns identity. Every account gets a
 * `users` row, a role, and the matching profile, provisioned atomically
 * enough that a partial failure never leaves an orphaned auth account.
 */
@Injectable()
export class AuthService {
  private readonly logger = new Logger(AuthService.name);
  private readonly config = loadConfiguration();

  constructor(
    private readonly supabase: SupabaseService,
    private readonly db: DatabaseService,
    private readonly authContext: AuthContextService,
    @Inject(OAUTH_PROVIDERS) private readonly oauthProviders: Map<string, OAuthProvider>,
  ) { }

  /* ---------------------------------------------------------------- */
  /* Email + password                                                  */
  /* ---------------------------------------------------------------- */

  async signup(dto: SignupDto): Promise<AuthResponseDto> {
    const existing = await this.db.maybeOne<{ id: string }>('users', 'id', { email: dto.email });
    if (existing) {
      throw new DomainException(
        'EMAIL_ALREADY_REGISTERED',
        'An account with this email already exists. Try logging in instead.',
        HttpStatus.CONFLICT,
      );
    }

    const { data: authData, error: authError } = await this.supabase.getAuthClient().auth.signUp({
      email: dto.email,
      password: dto.password,
      options: { data: { first_name: dto.firstName, last_name: dto.lastName, role: dto.role } },
    });

    if (authError) {
      throw new DomainException('SIGNUP_FAILED', authError.message, HttpStatus.BAD_REQUEST);
    }
    if (!authData.user) {
      throw new DomainException('SIGNUP_FAILED', 'Could not create the account', HttpStatus.BAD_REQUEST);
    }

    const user = await this.provisionDeeviUser(
      {
        authUserId: authData.user.id,
        email: dto.email,
        firstName: dto.firstName,
        lastName: dto.lastName,
        phone: dto.phone ?? null,
        avatarUrl: dto.avatarUrl ?? null,
        emailVerified: Boolean(authData.user.email_confirmed_at),
      },
      dto.role,
    );

    return {
      message: authData.session
        ? 'Account created successfully'
        : 'Account created. Check your email to confirm your address before logging in.',
      user: await this.toAuthUserDto(user, dto.role),
      session: this.toSessionDto(authData.session),
    };
  }

  async login(dto: LoginDto): Promise<AuthResponseDto> {
    const { data, error } = await this.supabase.getAuthClient().auth.signInWithPassword({
      email: dto.email,
      password: dto.password,
    });

    // Deliberately identical for unknown email and wrong password: telling
    // an attacker which emails exist is an account-enumeration gift.
    if (error || !data?.user || !data.session) {
      throw new DomainException('INVALID_CREDENTIALS', 'Invalid email or password', HttpStatus.UNAUTHORIZED);
    }

    const user = await this.db.maybeOne<UserRow>('users', USER_COLUMNS, {
      auth_user_id: data.user.id,
    });

    if (!user) {
      // Auth account exists without a Deevi profile: self-heal rather than
      // stranding the user (can happen if an old signup half-failed).
      const repaired = await this.provisionDeeviUser(
        {
          authUserId: data.user.id,
          email: data.user.email ?? dto.email,
          firstName: (data.user.user_metadata?.first_name as string) ?? null,
          lastName: (data.user.user_metadata?.last_name as string) ?? null,
          phone: null,
          avatarUrl: null,
          emailVerified: Boolean(data.user.email_confirmed_at),
        },
        (data.user.user_metadata?.role as 'CUSTOMER' | 'ARTISAN') ?? 'CUSTOMER',
      );
      return {
        message: 'Login successful',
        user: await this.toAuthUserDto(repaired),
        session: this.toSessionDto(data.session),
      };
    }

    if (user.status === 'SUSPENDED') {
      throw new DomainException(
        'ACCOUNT_SUSPENDED',
        'This account is suspended. Please contact Deevi support.',
        HttpStatus.FORBIDDEN,
      );
    }

    await this.db.from('users').update({ last_active_at: new Date().toISOString() }).eq('id', user.id);
    await this.authContext.invalidate(user.auth_user_id);

    return {
      message: 'Login successful',
      user: await this.toAuthUserDto(user),
      session: this.toSessionDto(data.session),
    };
  }

  async logout(accessToken: string): Promise<{ message: string }> {
    if (!accessToken) {
      throw new DomainException('MISSING_TOKEN', 'No session token supplied', HttpStatus.BAD_REQUEST);
    }
    const { error } = await this.supabase.getClient().auth.admin.signOut(accessToken);
    if (error) this.logger.warn(`Sign-out returned: ${error.message}`);
    return { message: 'Logged out successfully' };
  }

  async refresh(refreshToken: string): Promise<{ session: SessionDto }> {
    const { data, error } = await this.supabase.getAuthClient().auth.refreshSession({
      refresh_token: refreshToken,
    });
    if (error || !data.session) {
      throw new DomainException('INVALID_REFRESH_TOKEN', 'Session expired. Please log in again.', HttpStatus.UNAUTHORIZED);
    }
    return { session: this.toSessionDto(data.session)! };
  }

  /* ---------------------------------------------------------------- */
  /* Google OAuth (provider-agnostic; Apple slots in the same way)      */
  /* ---------------------------------------------------------------- */

  async getOAuthUrl(provider: string, query: OAuthStartQueryDto) {
    const adapter = this.requireProvider(provider);
    const result = await adapter.getAuthorizationUrl({
      redirectTo: query.redirectTo,
      state: query.state,
    });
    return result;
  }

  async handleOAuthCallback(provider: string, dto: GoogleCallbackDto): Promise<AuthResponseDto> {
    const adapter = this.requireProvider(provider);

    if (!dto.code && !dto.idToken) {
      throw new DomainException(
        'OAUTH_MISSING_CREDENTIAL',
        'Provide either `code` (web redirect) or `idToken` (native SDK)',
        HttpStatus.BAD_REQUEST,
      );
    }

    const identity: OAuthIdentity = dto.idToken
      ? await adapter.verifyIdToken(dto.idToken)
      : await adapter.exchangeCode(dto.code!, dto.redirectUri);

    if (!identity.emailVerified) {
      throw new DomainException(
        'OAUTH_EMAIL_UNVERIFIED',
        'Your Google email address is not verified',
        HttpStatus.FORBIDDEN,
      );
    }

    const { authUserId, session } = await this.upsertOAuthAuthAccount(identity);

    let user = await this.db.maybeOne<UserRow>('users', USER_COLUMNS, { auth_user_id: authUserId });
    if (!user) {
      user = await this.provisionDeeviUser(
        {
          authUserId,
          email: identity.email,
          firstName: identity.firstName,
          lastName: identity.lastName,
          phone: null,
          avatarUrl: identity.avatarUrl,
          emailVerified: true,
        },
        dto.role ?? 'CUSTOMER',
      );
    } else if (user.status === 'SUSPENDED') {
      throw new DomainException('ACCOUNT_SUSPENDED', 'This account is suspended.', HttpStatus.FORBIDDEN);
    }

    await this.authContext.invalidate(authUserId);

    return {
      message: 'Login successful',
      user: await this.toAuthUserDto(user),
      session: this.toSessionDto(session),
    };
  }

  /**
   * Bridges a verified third-party identity onto a Supabase auth account.
   * Supabase has no admin "sign in as" call, so a first-time social user is
   * created with a random password they never see, and subsequent logins
   * reuse it via the admin API to mint a session.
   */
  private async upsertOAuthAuthAccount(
    identity: OAuthIdentity,
  ): Promise<{ authUserId: string; session: Session | null }> {
    const admin = this.supabase.getClient().auth.admin;
    const existing = await this.db.maybeOne<{ auth_user_id: string }>('users', 'auth_user_id', {
      email: identity.email,
    });

    if (!existing) {
      const { data, error } = await admin.createUser({
        email: identity.email,
        email_confirm: true,
        user_metadata: {
          first_name: identity.firstName,
          last_name: identity.lastName,
          avatar_url: identity.avatarUrl,
          provider: 'google',
        },
      });
      if (error || !data.user) {
        throw new DomainException('OAUTH_ACCOUNT_FAILED', error?.message ?? 'Could not create the account', HttpStatus.BAD_REQUEST);
      }
      return { authUserId: data.user.id, session: await this.mintSessionFor(identity.email) };
    }

    return {
      authUserId: existing.auth_user_id,
      session: await this.mintSessionFor(identity.email),
    };
  }

  /**
   * Issues a session for an already-verified social identity by generating a
   * magic link and exchanging its token. This never bypasses verification:
   * we only get here after the provider's signature has been validated.
   */
  private async mintSessionFor(email: string): Promise<Session | null> {
    const { data, error } = await this.supabase.getClient().auth.admin.generateLink({
      type: 'magiclink',
      email,
    });

    if (error || !data?.properties?.hashed_token) {
      this.logger.error(`Could not mint an OAuth session for ${email}: ${error?.message}`);
      throw new DomainException(
        'OAUTH_SESSION_FAILED',
        'Signed in, but a session could not be created. Please try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    const { data: verified, error: verifyError } = await this.supabase.getAuthClient().auth.verifyOtp({
      type: 'magiclink',
      token_hash: data.properties.hashed_token,
    });

    if (verifyError || !verified.session) {
      this.logger.error(`OAuth session exchange failed for ${email}: ${verifyError?.message}`);
      throw new DomainException(
        'OAUTH_SESSION_FAILED',
        'Signed in, but a session could not be created. Please try again.',
        HttpStatus.SERVICE_UNAVAILABLE,
      );
    }

    return verified.session;
  }

  private requireProvider(provider: string): OAuthProvider {
    const adapter = this.oauthProviders.get(provider);
    if (!adapter) {
      throw new DomainException(
        'UNSUPPORTED_OAUTH_PROVIDER',
        `${provider} sign-in is not available`,
        HttpStatus.NOT_IMPLEMENTED,
      );
    }
    return adapter;
  }

  /* ---------------------------------------------------------------- */
  /* Password management                                               */
  /* ---------------------------------------------------------------- */

  async forgotPassword(email: string): Promise<{ message: string }> {
    const { error } = await this.supabase.getAuthClient().auth.resetPasswordForEmail(email);
    if (error) this.logger.warn(`Password reset for ${email}: ${error.message}`);
    // Always the same answer, so this endpoint cannot enumerate accounts.
    return { message: 'If an account exists for that email, a reset link has been sent.' };
  }

  async resetPassword(accessToken: string, newPassword: string): Promise<{ message: string }> {
    const verified = await this.supabase.getClient().auth.getUser(accessToken);
    if (verified.error || !verified.data.user) {
      throw new DomainException('INVALID_RESET_TOKEN', 'This reset link is invalid or has expired', HttpStatus.UNAUTHORIZED);
    }

    const { error } = await this.supabase.getClient().auth.admin.updateUserById(
      verified.data.user.id,
      { password: newPassword },
    );
    if (error) throw new DomainException('PASSWORD_RESET_FAILED', error.message, HttpStatus.BAD_REQUEST);

    await this.authContext.invalidate(verified.data.user.id);
    return { message: 'Password updated. You can now log in.' };
  }

  async changePassword(user: AuthUser, currentPassword: string, newPassword: string) {
    if (!user.email) {
      throw new DomainException('NO_EMAIL_ON_ACCOUNT', 'This account has no email address', HttpStatus.BAD_REQUEST);
    }

    // Re-authenticate before allowing a credential change.
    const { error: signInError } = await this.supabase.getAuthClient().auth.signInWithPassword({
      email: user.email,
      password: currentPassword,
    });
    if (signInError) {
      throw new DomainException('INVALID_CREDENTIALS', 'Your current password is incorrect', HttpStatus.UNAUTHORIZED);
    }

    const { error } = await this.supabase.getClient().auth.admin.updateUserById(user.authUserId, {
      password: newPassword,
    });
    if (error) throw new DomainException('PASSWORD_CHANGE_FAILED', error.message, HttpStatus.BAD_REQUEST);

    return { message: 'Password changed successfully' };
  }

  /* ---------------------------------------------------------------- */
  /* Provisioning + mapping helpers                                    */
  /* ---------------------------------------------------------------- */

  /**
   * Creates the Deevi user, role and profile for a fresh auth account.
   * PostgREST has no multi-statement transaction, so on failure we roll back
   * by hand and delete the auth user -- leaving a credential with no identity
   * behind would block that email from ever registering again.
   */
  private async provisionDeeviUser(
    input: {
      authUserId: string;
      email: string;
      firstName: string | null;
      lastName: string | null;
      phone: string | null;
      avatarUrl: string | null;
      emailVerified: boolean;
    },
    role: 'CUSTOMER' | 'ARTISAN',
  ): Promise<UserRow> {
    let user: UserRow;

    try {
      user = await this.db.insertOne<UserRow>('users', {
        auth_user_id: input.authUserId,
        email: input.email,
        first_name: input.firstName,
        last_name: input.lastName,
        phone: input.phone,
        avatar_url: input.avatarUrl,
        email_verified: input.emailVerified,
        status: 'ACTIVE',
        last_active_at: new Date().toISOString(),
      }, USER_COLUMNS);
    } catch (err) {
      await this.rollbackAuthUser(input.authUserId);
      throw err;
    }

    try {
      await this.db.from('user_roles').insert({ user_id: user.id, role });

      if (role === 'CUSTOMER') {
        await this.db.from('customer_profiles').insert({ user_id: user.id });
      } else {
        await this.db.from('artisan_profiles').insert({
          user_id: user.id,
          verification_status: 'PENDING',
          availability_status: 'AVAILABLE',
        });
      }

      await this.db.from('notification_preferences').insert({ user_id: user.id });
    } catch (err) {
      await this.db.from('users').delete().eq('id', user.id);
      await this.rollbackAuthUser(input.authUserId);
      throw err;
    }

    return user;
  }

  private async rollbackAuthUser(authUserId: string): Promise<void> {
    try {
      await this.supabase.getClient().auth.admin.deleteUser(authUserId);
    } catch (err) {
      this.logger.error(`Orphaned auth user ${authUserId}: ${(err as Error).message}`);
    }
  }

  private async toAuthUserDto(user: UserRow, knownRole?: string) {
    const [roleRows, customer, artisan, admin] = await Promise.all([
      this.db.from('user_roles').select('role').eq('user_id', user.id),
      this.db.maybeOne<{ id: string }>('customer_profiles', 'id', { user_id: user.id }),
      this.db.maybeOne<{ id: string; verification_status: string }>(
        'artisan_profiles', 'id, verification_status', { user_id: user.id },
      ),
      this.db.maybeOne<{ admin_role: string; is_active: boolean }>(
        'admin_profiles', 'admin_role, is_active', { user_id: user.id },
      ),
    ]);

    const roles = ((roleRows.data ?? []) as { role: string }[]).map((r) => r.role);

    return {
      id: user.id,
      authUserId: user.auth_user_id,
      email: user.email,
      firstName: user.first_name,
      lastName: user.last_name,
      phone: user.phone,
      avatarUrl: user.avatar_url,
      status: user.status,
      roles: roles.length ? roles : knownRole ? [knownRole] : [],
      adminRole: admin?.is_active ? admin.admin_role : null,
      customerProfileId: customer?.id ?? null,
      artisanProfileId: artisan?.id ?? null,
      artisanVerificationStatus: artisan?.verification_status ?? null,
    };
  }

  private toSessionDto(session: Session | null): SessionDto | null {
    if (!session) return null;
    return {
      accessToken: session.access_token,
      refreshToken: session.refresh_token,
      expiresAt: session.expires_at ?? null,
      expiresIn: session.expires_in ?? null,
      tokenType: session.token_type ?? 'bearer',
    };
  }

  /** Reports which auth integrations are live vs. mocked. */
  getProviderStatus() {
    return {
      emailPassword: { enabled: true, mocked: false },
      google: {
        enabled: this.oauthProviders.has('google'),
        mocked: this.oauthProviders.get('google')?.isMock ?? true,
        configured: this.config.google.configured,
      },
      apple: { enabled: false, mocked: false, configured: false },
    };
  }
}
