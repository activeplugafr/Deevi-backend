import { ForbiddenException, UnauthorizedException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { SupabaseAuthGuard, extractBearerToken } from './supabase-auth.guard.js';
import { makeUser } from '../../../test/helpers/mock-db.js';

const contextFor = (authorization?: string) => {
  const request: any = { headers: authorization ? { authorization } : {} };
  return {
    context: {
      getHandler: () => ({}),
      getClass: () => ({}),
      switchToHttp: () => ({ getRequest: () => request }),
    } as any,
    request,
  };
};

describe('extractBearerToken', () => {
  it('pulls the token out of a bearer header', () => {
    expect(extractBearerToken('Bearer abc.def.ghi')).toBe('abc.def.ghi');
    expect(extractBearerToken('bearer abc')).toBe('abc');
  });

  it('rejects anything that is not a bearer token', () => {
    expect(extractBearerToken(undefined)).toBeNull();
    expect(extractBearerToken('Basic dXNlcjpwYXNz')).toBeNull();
    expect(extractBearerToken('Bearer')).toBeNull();
    expect(extractBearerToken('Bearer   ')).toBeNull();
  });
});

describe('SupabaseAuthGuard', () => {
  let tokens: any;
  let authContext: any;
  let reflector: Reflector;
  let metadata: Record<string, unknown>;

  beforeEach(() => {
    metadata = {};
    reflector = new Reflector();
    vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => metadata[key] as any);
    tokens = { verify: vi.fn() };
    authContext = { resolve: vi.fn() };
  });

  const guard = () => new SupabaseAuthGuard(reflector, tokens, authContext);

  it('rejects a request with no token', async () => {
    const { context } = contextFor();
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  it('rejects a token the verifier will not accept', async () => {
    tokens.verify.mockResolvedValue(null);
    const { context } = contextFor('Bearer bad-token');
    await expect(guard().canActivate(context)).rejects.toThrow(/Invalid or expired session/);
  });

  it('rejects a valid token with no Deevi account behind it', async () => {
    tokens.verify.mockResolvedValue({ authUserId: 'auth-1', email: 'a@b.test', expiresAt: null });
    authContext.resolve.mockResolvedValue(null);
    const { context } = contextFor('Bearer good-token');
    await expect(guard().canActivate(context)).rejects.toThrow(/No Deevi account/);
  });

  it('attaches the resolved principal to the request', async () => {
    const user = makeUser();
    tokens.verify.mockResolvedValue({ authUserId: user.authUserId, email: user.email, expiresAt: null });
    authContext.resolve.mockResolvedValue(user);

    const { context, request } = contextFor('Bearer good-token');
    await expect(guard().canActivate(context)).resolves.toBe(true);
    expect(request.user).toBe(user);
  });

  it('blocks a suspended account even with a valid token', async () => {
    const suspended = makeUser({ status: 'SUSPENDED' });
    tokens.verify.mockResolvedValue({ authUserId: suspended.authUserId, email: null, expiresAt: null });
    authContext.resolve.mockResolvedValue(suspended);

    const { context } = contextFor('Bearer good-token');
    await expect(guard().canActivate(context)).rejects.toThrow(ForbiddenException);
  });

  it('blocks a deactivated account', async () => {
    const gone = makeUser({ status: 'DEACTIVATED' });
    tokens.verify.mockResolvedValue({ authUserId: gone.authUserId, email: null, expiresAt: null });
    authContext.resolve.mockResolvedValue(gone);

    const { context } = contextFor('Bearer good-token');
    await expect(guard().canActivate(context)).rejects.toThrow(UnauthorizedException);
  });

  describe('@Public routes', () => {
    it('lets an anonymous request through', async () => {
      metadata['deevi:isPublic'] = true;
      const { context } = contextFor();
      await expect(guard().canActivate(context)).resolves.toBe(true);
    });

    it('still attaches the user when a valid token is present', async () => {
      metadata['deevi:isPublic'] = true;
      const user = makeUser();
      tokens.verify.mockResolvedValue({ authUserId: user.authUserId, email: null, expiresAt: null });
      authContext.resolve.mockResolvedValue(user);

      const { context, request } = contextFor('Bearer good-token');
      await expect(guard().canActivate(context)).resolves.toBe(true);
      expect(request.user).toBe(user);
    });

    it('does not fail on a bad token', async () => {
      metadata['deevi:isPublic'] = true;
      tokens.verify.mockResolvedValue(null);
      const { context, request } = contextFor('Bearer rubbish');
      await expect(guard().canActivate(context)).resolves.toBe(true);
      expect(request.user).toBeUndefined();
    });

    it('still refuses a suspended account, public or not', async () => {
      metadata['deevi:isPublic'] = true;
      const suspended = makeUser({ status: 'SUSPENDED' });
      tokens.verify.mockResolvedValue({ authUserId: suspended.authUserId, email: null, expiresAt: null });
      authContext.resolve.mockResolvedValue(suspended);

      const { context } = contextFor('Bearer good-token');
      await expect(guard().canActivate(context)).rejects.toThrow(ForbiddenException);
    });
  });
});
