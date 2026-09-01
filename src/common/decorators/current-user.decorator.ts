import { createParamDecorator, ExecutionContext, UnauthorizedException } from '@nestjs/common';
import type { AuthUser } from '../types/auth-user.js';

/**
 * Injects the authenticated principal. Never read the user id from the body
 * or a query param -- it always comes from the verified token.
 */
export const CurrentUser = createParamDecorator(
  (data: keyof AuthUser | undefined, ctx: ExecutionContext) => {
    const request = ctx.switchToHttp().getRequest();
    const user: AuthUser | undefined = request.user;
    if (!user) throw new UnauthorizedException('Authentication required');
    return data ? user[data] : user;
  },
);

/** Same as CurrentUser but tolerates anonymous access (see @OptionalAuth). */
export const OptionalUser = createParamDecorator((_data: unknown, ctx: ExecutionContext) => {
  return ctx.switchToHttp().getRequest().user as AuthUser | undefined;
});
