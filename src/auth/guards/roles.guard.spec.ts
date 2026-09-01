import { ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { describe, expect, it, vi } from 'vitest';
import { RolesGuard } from './roles.guard.js';
import { adminCan } from '../../common/constants/roles.js';
import { makeAdmin, makeArtisan, makeUser } from '../../../test/helpers/mock-db.js';
import type { AuthUser } from '../../common/types/auth-user.js';

const contextFor = (user: AuthUser | undefined) => ({
  getHandler: () => ({}),
  getClass: () => ({}),
  switchToHttp: () => ({ getRequest: () => ({ user }) }),
}) as any;

const guardWith = (metadata: Record<string, unknown>) => {
  const reflector = new Reflector();
  vi.spyOn(reflector, 'getAllAndOverride').mockImplementation((key: any) => metadata[key] as any);
  return new RolesGuard(reflector);
};

describe('RolesGuard', () => {
  it('allows a route with no role requirement', () => {
    const guard = guardWith({});
    expect(guard.canActivate(contextFor(makeUser()))).toBe(true);
  });

  it('rejects an unauthenticated request on a guarded route', () => {
    const guard = guardWith({ 'deevi:roles': ['CUSTOMER'] });
    expect(() => guard.canActivate(contextFor(undefined))).toThrow(ForbiddenException);
  });

  describe('top-level roles', () => {
    it('lets a matching role through', () => {
      const guard = guardWith({ 'deevi:roles': ['ARTISAN'] });
      expect(guard.canActivate(contextFor(makeArtisan()))).toBe(true);
    });

    it('blocks a customer from an artisan-only route', () => {
      const guard = guardWith({ 'deevi:roles': ['ARTISAN'] });
      expect(() => guard.canActivate(contextFor(makeUser()))).toThrow(/requires the ARTISAN role/);
    });

    it('accepts any one of several allowed roles', () => {
      const guard = guardWith({ 'deevi:roles': ['ADMIN', 'ARTISAN'] });
      expect(guard.canActivate(contextFor(makeArtisan()))).toBe(true);
    });
  });

  describe('admin roles', () => {
    it('lets the named admin role through', () => {
      const guard = guardWith({ 'deevi:adminRoles': ['SUPER_ADMIN'] });
      expect(guard.canActivate(contextFor(makeAdmin('SUPER_ADMIN')))).toBe(true);
    });

    it('blocks a different admin role', () => {
      const guard = guardWith({ 'deevi:adminRoles': ['SUPER_ADMIN'] });
      expect(() => guard.canActivate(contextFor(makeAdmin('SUPPORT')))).toThrow(/Insufficient admin privileges/);
    });

    it('blocks a non-admin claiming an admin role', () => {
      const guard = guardWith({ 'deevi:adminRoles': ['SUPPORT'] });
      // A user whose token says ADMIN but who has no admin profile.
      const impostor = makeUser({ roles: ['CUSTOMER'], adminRole: 'SUPER_ADMIN' });
      expect(() => guard.canActivate(contextFor(impostor))).toThrow(ForbiddenException);
    });
  });

  describe('capabilities', () => {
    it('allows an admin whose role holds the capability', () => {
      const guard = guardWith({ 'deevi:capability': 'artisans:verify' });
      expect(guard.canActivate(contextFor(makeAdmin('VERIFICATION')))).toBe(true);
    });

    it('blocks an admin whose role lacks it', () => {
      const guard = guardWith({ 'deevi:capability': 'artisans:verify' });
      expect(() => guard.canActivate(contextFor(makeAdmin('SUPPORT'))))
        .toThrow(/cannot perform "artisans:verify"/);
    });

    it('blocks a customer entirely', () => {
      const guard = guardWith({ 'deevi:capability': 'metrics:read' });
      expect(() => guard.canActivate(contextFor(makeUser()))).toThrow(ForbiddenException);
    });
  });
});

describe('admin capability matrix', () => {
  it('gives SUPER_ADMIN everything', () => {
    expect(adminCan('SUPER_ADMIN', 'anything:at:all')).toBe(true);
  });

  it('lets VERIFICATION verify but not moderate reviews or touch subscriptions', () => {
    expect(adminCan('VERIFICATION', 'artisans:verify')).toBe(true);
    expect(adminCan('VERIFICATION', 'reviews:moderate')).toBe(false);
    expect(adminCan('VERIFICATION', 'subscriptions:manage')).toBe(false);
  });

  it('lets SUPPORT read the verification queue but not decide it', () => {
    expect(adminCan('SUPPORT', 'artisans:read')).toBe(true);
    expect(adminCan('SUPPORT', 'artisans:verify')).toBe(false);
  });

  it('keeps FINANCE away from moderation', () => {
    expect(adminCan('FINANCE', 'subscriptions:manage')).toBe(true);
    expect(adminCan('FINANCE', 'reports:manage')).toBe(false);
    expect(adminCan('FINANCE', 'users:suspend')).toBe(false);
  });

  it('denies everything when there is no admin role', () => {
    expect(adminCan(null, 'metrics:read')).toBe(false);
    expect(adminCan(undefined, 'metrics:read')).toBe(false);
  });

  it('does not let VERIFICATION read documents it has no claim to via a typo capability', () => {
    expect(adminCan('VERIFICATION', 'documents:write')).toBe(false);
  });
});
