import { SetMetadata } from '@nestjs/common';
import type { AdminRole, Role } from '../constants/roles.js';

export const ROLES_KEY = 'deevi:roles';
export const ADMIN_ROLES_KEY = 'deevi:adminRoles';
export const CAPABILITY_KEY = 'deevi:capability';

/** Restrict a route to one or more top-level roles. */
export const Roles = (...roles: Role[]) => SetMetadata(ROLES_KEY, roles);

/** Restrict an admin route to specific admin roles. */
export const AdminRoles = (...roles: AdminRole[]) => SetMetadata(ADMIN_ROLES_KEY, roles);

/** Restrict an admin route by capability (preferred over naming roles). */
export const RequireCapability = (capability: string) => SetMetadata(CAPABILITY_KEY, capability);
