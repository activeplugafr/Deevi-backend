/**
 * Every cache key in one place, so invalidation is auditable. When you add a
 * key here, add the matching invalidation to the mutation that changes it.
 */
export const CacheKeys = {
  catalogueTree: () => 'catalogue:tree',
  categories: (activeOnly: boolean) => `catalogue:categories:${activeOnly ? 'active' : 'all'}`,
  services: (categoryId?: string) => `catalogue:services:${categoryId ?? 'all'}`,
  catalogueNamespace: 'catalogue:',

  authContext: (authUserId: string) => `auth:ctx:${authUserId}`,
  authNamespace: 'auth:ctx:',

  publicArtisan: (artisanId: string) => `artisan:public:${artisanId}`,
  artisanNamespace: 'artisan:public:',

  adminMetrics: () => 'admin:metrics',

  rateLimit: (bucket: string, identity: string) => `rl:${bucket}:${identity}`,
} as const;

export const CacheTtl = {
  catalogue: 300,
  authContext: 60,
  publicProfile: 120,
  adminMetrics: 60,
} as const;
