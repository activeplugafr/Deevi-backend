import {
  CanActivate, ExecutionContext, HttpStatus, Injectable, Logger,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { CacheService } from '../../cache/cache.service.js';
import { RATE_LIMIT_KEY, type RateLimitOptions } from '../decorators/rate-limit.decorator.js';
import { loadConfiguration } from '../../config/configuration.js';
import { DomainException } from '../errors/domain.exception.js';
import type { AuthUser } from '../types/auth-user.js';

/**
 * Fixed-window rate limiting over the cache abstraction. Authenticated
 * callers are limited per user id, anonymous ones per IP, so one abusive
 * client cannot exhaust an entire NAT's budget.
 */
@Injectable()
export class RateLimitGuard implements CanActivate {
  private readonly logger = new Logger(RateLimitGuard.name);
  private readonly config = loadConfiguration();

  constructor(
    private readonly reflector: Reflector,
    private readonly cache: CacheService,
  ) {}

  async canActivate(ctx: ExecutionContext): Promise<boolean> {
    if (ctx.getType() !== 'http') return true;

    const override = this.reflector.getAllAndOverride<RateLimitOptions>(RATE_LIMIT_KEY, [
      ctx.getHandler(), ctx.getClass(),
    ]);

    const request = ctx.switchToHttp().getRequest();
    const response = ctx.switchToHttp().getResponse();

    const limit = override?.limit ?? this.config.rateLimit.max;
    const windowSeconds = override?.windowSeconds ?? this.config.rateLimit.windowSeconds;
    const bucket = override?.bucket ?? 'global';

    const user: AuthUser | undefined = request.user;
    const identity = user?.id ?? clientIp(request);
    const key = `rl:${bucket}:${identity}`;

    const { count, ttl } = await this.cache.increment(key, windowSeconds);

    response.setHeader?.('X-RateLimit-Limit', limit);
    response.setHeader?.('X-RateLimit-Remaining', Math.max(0, limit - count));
    response.setHeader?.('X-RateLimit-Reset', ttl);

    if (count > limit) {
      response.setHeader?.('Retry-After', ttl);
      this.logger.warn(`Rate limit hit: bucket=${bucket} identity=${identity} count=${count}`);
      throw new DomainException(
        'RATE_LIMITED',
        `Too many requests. Try again in ${ttl} second(s).`,
        HttpStatus.TOO_MANY_REQUESTS,
      );
    }

    return true;
  }
}

const clientIp = (request: any): string => {
  const forwarded = request.headers?.['x-forwarded-for'];
  if (typeof forwarded === 'string' && forwarded.length) return forwarded.split(',')[0].trim();
  return request.ip ?? request.socket?.remoteAddress ?? 'unknown';
};
