import type { AdminRole, Role } from '../constants/roles.js';

/** The authenticated principal, resolved once per request by SupabaseAuthGuard. */
export interface AuthUser {
  id: string;
  authUserId: string;
  email: string | null;
  firstName: string | null;
  lastName: string | null;
  avatarUrl: string | null;
  status: string;
  roles: Role[];
  adminRole: AdminRole | null;
  customerProfileId: string | null;
  artisanProfileId: string | null;
  artisanVerificationStatus: string | null;
  token: string;
}

export interface RequestWithUser extends Request {
  user?: AuthUser;
}

export const hasRole = (user: AuthUser | undefined, role: Role): boolean =>
  Boolean(user?.roles?.includes(role));
