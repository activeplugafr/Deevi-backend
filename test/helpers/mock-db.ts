import { vi } from 'vitest';
import type { AuthUser } from '../../src/common/types/auth-user.js';

/**
 * A stand-in for DatabaseService.
 *
 * Every method is a vi.fn() with a sensible default, so a test only has to
 * describe the rows it cares about. `from()` returns a chainable stub whose
 * terminal value the test controls, which is what the PostgREST builder looks
 * like from the caller's side.
 */
export const createMockDb = () => {
  const queryResult = { data: [] as any[], error: null, count: 0 };

  const chain: any = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') return undefined;
      if (prop === 'maybeSingle' || prop === 'single') {
        return vi.fn().mockResolvedValue({ data: queryResult.data[0] ?? null, error: null });
      }
      return vi.fn(() => chain);
    },
  });

  // A thenable chain, so `await db.from(...).select(...)` resolves.
  const thenableChain = new Proxy({}, {
    get(_target, prop) {
      if (prop === 'then') {
        return (resolve: any) => resolve(queryResult);
      }
      if (prop === 'maybeSingle' || prop === 'single') {
        return vi.fn().mockResolvedValue({ data: queryResult.data[0] ?? null, error: null });
      }
      return vi.fn(() => thenableChain);
    },
  });

  return {
    maybeOne: vi.fn().mockResolvedValue(null),
    one: vi.fn().mockResolvedValue({}),
    insertOne: vi.fn().mockImplementation(async (_t: string, values: any) => ({ id: 'generated-id', ...values })),
    insertMany: vi.fn().mockResolvedValue([]),
    updateOne: vi.fn().mockImplementation(async (_t: string, _f: any, values: any) => ({ id: 'generated-id', ...values })),
    updateIf: vi.fn().mockImplementation(async (_t: string, _f: any, values: any) => ({ id: 'generated-id', ...values })),
    count: vi.fn().mockResolvedValue(0),
    rpc: vi.fn().mockResolvedValue(null),
    from: vi.fn((_table?: string) => thenableChain),
    select: vi.fn((_table?: string, _columns?: string) => thenableChain),
    paginate: vi.fn().mockResolvedValue({
      items: [],
      meta: { page: 1, limit: 20, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false },
    }),
    /** Test-side control over what a chained query resolves to. */
    __setQueryResult(data: any[], count = data.length) {
      queryResult.data = data;
      queryResult.count = count;
    },
  };
};

export type MockDb = ReturnType<typeof createMockDb>;

export const createMockNotifications = () => ({
  notify: vi.fn().mockResolvedValue(undefined),
  notifyMany: vi.fn().mockResolvedValue(undefined),
});

export const createMockCache = () => ({
  get: vi.fn().mockResolvedValue(null),
  set: vi.fn().mockResolvedValue(undefined),
  del: vi.fn().mockResolvedValue(undefined),
  delByPrefix: vi.fn().mockResolvedValue(undefined),
  wrap: vi.fn().mockImplementation((_k: string, _t: number, producer: () => any) => producer()),
  increment: vi.fn().mockResolvedValue({ count: 1, ttl: 60 }),
  driver: 'memory' as const,
});

export const createMockStorage = () => ({
  assertOwnership: vi.fn(),
  getPublicUrl: vi.fn().mockReturnValue('https://cdn.example.test/file.jpg'),
  createSignedDownloadUrl: vi.fn().mockResolvedValue({ url: 'https://signed.example.test/f', expiresIn: 300 }),
  createUploadTicket: vi.fn(),
  remove: vi.fn().mockResolvedValue(undefined),
  validate: vi.fn(),
});

export const createMockQueue = () => ({
  enqueue: vi.fn().mockResolvedValue('job-id'),
  register: vi.fn(),
  claim: vi.fn().mockResolvedValue([]),
  complete: vi.fn(),
  fail: vi.fn(),
});

export const createMockAudit = () => ({
  record: vi.fn().mockResolvedValue(undefined),
  list: vi.fn(),
});

let counter = 0;
const uuid = (label: string) => {
  counter += 1;
  return `${label.padEnd(8, '0').slice(0, 8)}-0000-4000-8000-${String(counter).padStart(12, '0')}`;
};

/** Builds an AuthUser without every test restating the whole shape. */
export const makeUser = (overrides: Partial<AuthUser> = {}): AuthUser => ({
  id: overrides.id ?? uuid('user'),
  authUserId: overrides.authUserId ?? uuid('auth'),
  email: 'test@deevi.test',
  firstName: 'Ada',
  lastName: 'Obi',
  avatarUrl: null,
  status: 'ACTIVE',
  roles: ['CUSTOMER'],
  adminRole: null,
  customerProfileId: uuid('cust'),
  artisanProfileId: null,
  artisanVerificationStatus: null,
  token: 'test-token',
  ...overrides,
});

export const makeArtisan = (overrides: Partial<AuthUser> = {}): AuthUser =>
  makeUser({
    roles: ['ARTISAN'],
    customerProfileId: null,
    artisanProfileId: uuid('artisan'),
    artisanVerificationStatus: 'APPROVED',
    ...overrides,
  });

export const makeAdmin = (adminRole: AuthUser['adminRole'] = 'SUPER_ADMIN'): AuthUser =>
  makeUser({ roles: ['ADMIN'], adminRole, customerProfileId: null });
