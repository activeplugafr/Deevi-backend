import { CanActivate, ExecutionContext, ForbiddenException, Injectable } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import {
  ADMIN_ROLES_KEY, CAPABILITY_KEY, ROLES_KEY,
} from '../../common/decorators/roles.decorator.js';
import { adminCan, type AdminRole, type Role } from '../../common/constants/roles.js';
import type { AuthUser } from '../../common/types/auth-user.js';

/**
 * Role and capability enforcement. Runs after SupabaseAuthGuard, so the
 * principal is already verified server-side; nothing here trusts a claim
 * supplied by the client.
 */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(ctx: ExecutionContext): boolean {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const requiredRoles = this.reflector.getAllAndOverride<Role[]>(ROLES_KEY, targets);
    const requiredAdminRoles = this.reflector.getAllAndOverride<AdminRole[]>(ADMIN_ROLES_KEY, targets);
    const requiredCapability = this.reflector.getAllAndOverride<string>(CAPABILITY_KEY, targets);

    if (!requiredRoles?.length && !requiredAdminRoles?.length && !requiredCapability) return true;

    const user: AuthUser | undefined = ctx.switchToHttp().getRequest().user;
    if (!user) throw new ForbiddenException('Authentication required');

    if (requiredRoles?.length && !requiredRoles.some((role) => user.roles.includes(role))) {
      throw new ForbiddenException(
        `This action requires the ${requiredRoles.join(' or ')} role`,
      );
    }

    if (requiredAdminRoles?.length) {
      if (!user.roles.includes('ADMIN') || !user.adminRole
          || !requiredAdminRoles.includes(user.adminRole)) {
        throw new ForbiddenException('Insufficient admin privileges');
      }
    }

    if (requiredCapability) {
      if (!user.roles.includes('ADMIN') || !adminCan(user.adminRole, requiredCapability)) {
        throw new ForbiddenException(
          `Your admin role cannot perform "${requiredCapability}"`,
        );
      }
    }

    return true;
  }
}
