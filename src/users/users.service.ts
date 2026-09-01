import { Injectable } from '@nestjs/common';
import { DatabaseService } from '../supabase/database.service.js';
import { StorageService } from '../storage/storage.service.js';
import { StorageBucket } from '../storage/storage.constants.js';
import { AuthContextService } from '../auth/auth-context.service.js';
import { compact } from '../catalogue/catalogue-admin.service.js';
import type { AuthUser } from '../common/types/auth-user.js';
import type { UpdateUserDto } from './dto/user.dto.js';

const USER_COLUMNS =
  'id, email, first_name, last_name, phone, avatar_url, status, email_verified, phone_verified, locale, created_at';

@Injectable()
export class UsersService {
  constructor(
    private readonly db: DatabaseService,
    private readonly storage: StorageService,
    private readonly authContext: AuthContextService,
  ) {}

  async getMe(user: AuthUser) {
    const [row, roles] = await Promise.all([
      this.db.one('users', USER_COLUMNS, { id: user.id }, 'User'),
      this.db.from('user_roles').select('role').eq('user_id', user.id),
    ]);

    return {
      ...row,
      roles: ((roles.data ?? []) as { role: string }[]).map((r) => r.role),
      customerProfileId: user.customerProfileId,
      artisanProfileId: user.artisanProfileId,
      artisanVerificationStatus: user.artisanVerificationStatus,
      adminRole: user.adminRole,
    };
  }

  async updateMe(user: AuthUser, dto: UpdateUserDto) {
    const values = compact({
      first_name: dto.firstName,
      last_name: dto.lastName,
      phone: dto.phone,
      locale: dto.locale,
    });

    // An avatar is referenced by storage path; the public URL is derived here
    // so a client can never point the profile at somebody else's object.
    if (dto.avatarPath) {
      this.storage.assertOwnership(dto.avatarPath, user.id);
      values.avatar_url = this.storage.getPublicUrl(StorageBucket.AVATARS, dto.avatarPath);
    }

    const updated = await this.db.updateOne('users', { id: user.id }, values, USER_COLUMNS, 'User');
    await this.authContext.invalidate(user.authUserId);
    return updated;
  }

  /**
   * Soft deactivation. Rows are retained because job history, reviews and
   * disputes involving this user must stay intact for the other party.
   */
  async deactivate(user: AuthUser, reason?: string) {
    await this.db.updateOne('users', { id: user.id }, {
      status: 'DEACTIVATED',
      suspension_reason: reason ?? null,
      deleted_at: new Date().toISOString(),
    }, 'id', 'User');

    await this.authContext.invalidate(user.authUserId);
    return { message: 'Account deactivated. Contact support to restore it.' };
  }

  /** Minimal public identity used when rendering counterparties. */
  async getPublicUser(userId: string) {
    return this.db.one('users', 'id, first_name, last_name, avatar_url, created_at', { id: userId }, 'User');
  }
}
