import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { RateLimitGuard } from './rate-limit.guard.js';
import { createMockCache, makeUser } from '../../../test/helpers/mock-db.js';

const contextFor = (request: any) => {
  const headers: Record<string, unknown> = {};
  return {
    context: {
      getType: () => 'http',
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({
        getRequest: () => request,
        getResponse: () => ({ setHeader: (k: string, v: unknown) => { headers[k] = v; } }),
      }),
    } as any,
    headers,
  };
};

describe('RateLimitGuard', () => {
  let cache: ReturnType<typeof createMockCache>;
  let reflector: Reflector;
  let metadata: Record<string, unknown>;

  beforeEach(() => {
    cache = createMockCache();
    metadata = {};
    reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => metadata[key] as any);
  });

  const guard = () => new RateLimitGuard(reflector, cache as any);

  it('allows a request inside the budget', async () => {
    cache.increment.mockResolvedValue({ count: 3, ttl: 40 });
    const { context } = contextFor({ ip: '1.2.3.4', headers: {} });
    await expect(guard().canActivate(context)).resolves.toBe(true);
  });

  it('rejects once the budget is exhausted', async () => {
    metadata['deevi:rateLimit'] = { limit: 5, windowSeconds: 60, bucket: 'login' };
    cache.increment.mockResolvedValue({ count: 6, ttl: 30 });
    const { context } = contextFor({ ip: '1.2.3.4', headers: {} });

    await expect(guard().canActivate(context)).rejects.toThrow(/Too many requests. Try again in 30/);
  });

  it('counts an authenticated caller per user, not per IP', async () => {
    const user = makeUser({ id: 'user-77' });
    cache.increment.mockResolvedValue({ count: 1, ttl: 60 });
    const { context } = contextFor({ user, ip: '1.2.3.4', headers: {} });

    await guard().canActivate(context);
    expect(cache.increment).toHaveBeenCalledWith('rl:global:user-77', 60);
  });

  it('falls back to the forwarded IP for anonymous callers', async () => {
    cache.increment.mockResolvedValue({ count: 1, ttl: 60 });
    const { context } = contextFor({ headers: { 'x-forwarded-for': '9.9.9.9, 10.0.0.1' } });

    await guard().canActivate(context);
    expect(cache.increment).toHaveBeenCalledWith('rl:global:9.9.9.9', 60);
  });

  it('keeps separate budgets per bucket', async () => {
    metadata['deevi:rateLimit'] = { limit: 10, windowSeconds: 300, bucket: 'signup' };
    cache.increment.mockResolvedValue({ count: 1, ttl: 300 });
    const { context } = contextFor({ ip: '1.2.3.4', headers: {} });

    await guard().canActivate(context);
    expect(cache.increment).toHaveBeenCalledWith('rl:signup:1.2.3.4', 300);
  });

  it('publishes the standard rate limit headers', async () => {
    metadata['deevi:rateLimit'] = { limit: 10, windowSeconds: 60 };
    cache.increment.mockResolvedValue({ count: 4, ttl: 45 });
    const { context, headers } = contextFor({ ip: '1.2.3.4', headers: {} });

    await guard().canActivate(context);
    expect(headers['X-RateLimit-Limit']).toBe(10);
    expect(headers['X-RateLimit-Remaining']).toBe(6);
    expect(headers['X-RateLimit-Reset']).toBe(45);
  });
});
