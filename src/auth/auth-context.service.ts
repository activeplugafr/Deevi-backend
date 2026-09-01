import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { CacheKeys, CacheTtl } from '../cache/cache-keys.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { AdminRole, Role } from '../common/constants/roles.js';

interface UserRow {
  id: string;
  auth_user_id: string;
  email: string | null;
  first_name: string | null;
  last_name: string | null;
  avatar_url: string | null;
  status: string;
  deleted_at: string | null;
}

/**
 * Resolves a verified token into the full Deevi principal (roles, profile
 * ids, artisan verification state).
 *
 * This runs on every authenticated request, so the assembled context is
 * cached briefly. Anything that changes a user's authority -- role grants,
 * artisan approval, suspension -- must call `invalidate()`.
 */
@Injectable()
export class AuthContextService {
  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
  ) {}

  async resolve(authUserId: string, email: string | null, token: string): Promise<AuthUser | null> {
    const cacheKey = CacheKeys.authContext(authUserId);
    const cached = await this.cache.get<Omit<AuthUser, 'token'>>(cacheKey);
    if (cached) return { ...cached, token };

    const user = await this.db.maybeOne<UserRow>(
      'users',
      'id, auth_user_id, email, first_name, last_name, avatar_url, status, deleted_at',
      { auth_user_id: authUserId },
    );
    if (!user || user.deleted_at) return null;

    const [roleRows, adminRow, customerRow, artisanRow] = await Promise.all([
      this.db.from('user_roles').select('role').eq('user_id', user.id),
      this.db.maybeOne<{ admin_role: string; is_active: boolean }>(
        'admin_profiles', 'admin_role, is_active', { user_id: user.id },
      ),
      this.db.maybeOne<{ id: string }>('customer_profiles', 'id', { user_id: user.id }),
      this.db.maybeOne<{ id: string; verification_status: string }>(
        'artisan_profiles', 'id, verification_status', { user_id: user.id },
      ),
    ]);

    const context: Omit<AuthUser, 'token'> = {
      id: user.id,
      authUserId: user.auth_user_id,
      email: user.email ?? email,
      firstName: user.first_name,
      lastName: user.last_name,
      avatarUrl: user.avatar_url,
      status: user.status,
      roles: ((roleRows.data ?? []) as { role: string }[]).map((r) => r.role as Role),
      adminRole: adminRow?.is_active ? (adminRow.admin_role as AdminRole) : null,
      customerProfileId: customerRow?.id ?? null,
      artisanProfileId: artisanRow?.id ?? null,
      artisanVerificationStatus: artisanRow?.verification_status ?? null,
    };

    await this.cache.set(cacheKey, context, CacheTtl.authContext);
    return { ...context, token };
  }

  /** Call after any change to roles, artisan status, or account status. */
  async invalidate(authUserId: string): Promise<void> {
    await this.cache.del(CacheKeys.authContext(authUserId));
  }

  /** Invalidate by Deevi user id when the auth id is not to hand. */
  async invalidateByUserId(userId: string): Promise<void> {
    const user = await this.db.maybeOne<{ auth_user_id: string }>('users', 'auth_user_id', { id: userId });
    if (user?.auth_user_id) await this.invalidate(user.auth_user_id);
  }
}
