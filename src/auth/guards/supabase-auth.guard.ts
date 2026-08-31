import {
  CanActivate, ExecutionContext, ForbiddenException, Injectable, UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { IS_PUBLIC_KEY, OPTIONAL_AUTH_KEY } from '../../common/decorators/public.decorator.js';
import { TokenVerifierService } from '../token-verifier.service.js';
import { AuthContextService } from '../auth-context.service.js';

/**
 * Global authentication guard: every route is protected unless explicitly
 * marked @Public(). Registering it globally means a new controller cannot be
 * left unauthenticated by omission.
 */
@Injectable()
export class SupabaseAuthGuard implements CanActivate {
  constructor(
    private readonly reflector: Reflector,
    private readonly tokens: TokenVerifierService,
    private readonly context: AuthContextService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    const targets = [ctx.getHandler(), ctx.getClass()];
    const isPublic = this.reflector.getAllAndOverride<boolean>(IS_PUBLIC_KEY, targets);
    const isOptional = this.reflector.getAllAndOverride<boolean>(OPTIONAL_AUTH_KEY, targets);

    const request = ctx.switchToHttp().getRequest();
    const token = extractBearerToken(request.headers?.authorization);

    if (!token) {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException('Authentication required');
    }

    const verified = await this.tokens.verify(token);
    if (!verified) {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException('Invalid or expired session');
    }

    const user = await this.context.resolve(verified.authUserId, verified.email, token);
    if (!user) {
      if (isPublic || isOptional) return true;
      throw new UnauthorizedException('No Deevi account is linked to this session');
    }

    if (user.status === 'SUSPENDED') {
      throw new ForbiddenException('This account is suspended. Contact Deevi support.');
    }
    if (user.status === 'DELETED' || user.status === 'DEACTIVATED') {
      throw new UnauthorizedException('This account is no longer active');
    }

    request.user = user;
    return true;
  }
}

export const extractBearerToken = (header?: string): string | null => {
  if (!header) return null;
  const [scheme, value] = header.split(' ');
  if (!value || scheme.toLowerCase() !== 'bearer') return null;
  return value.trim() || null;
};
