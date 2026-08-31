export const Role = {
  CUSTOMER: 'CUSTOMER',
  ARTISAN: 'ARTISAN',
  ADMIN: 'ADMIN',
} as const;
export type Role = (typeof Role)[keyof typeof Role];

export const AdminRole = {
  SUPER_ADMIN: 'SUPER_ADMIN',
  OPERATIONS: 'OPERATIONS',
  SUPPORT: 'SUPPORT',
  VERIFICATION: 'VERIFICATION',
  FINANCE: 'FINANCE',
} as const;
export type AdminRole = (typeof AdminRole)[keyof typeof AdminRole];

/**
 * What each admin role is allowed to touch. Checked server-side on every
 * admin route; the frontend's opinion is never trusted.
 */
export const ADMIN_ROLE_CAPABILITIES: Record<AdminRole, string[]> = {
  SUPER_ADMIN: ['*'],
  OPERATIONS: [
    'metrics:read', 'users:read', 'users:suspend', 'artisans:read', 'artisans:verify',
    'jobs:read', 'jobs:moderate', 'applications:read', 'reports:read', 'reports:manage',
    'disputes:read', 'disputes:manage', 'reviews:read', 'reviews:moderate',
    'catalogue:read', 'catalogue:write', 'subscriptions:read',
  ],
  SUPPORT: [
    'metrics:read', 'users:read', 'artisans:read', 'jobs:read', 'applications:read',
    'reports:read', 'reports:manage', 'disputes:read', 'reviews:read', 'catalogue:read',
    'subscriptions:read',
  ],
  VERIFICATION: [
    'metrics:read', 'users:read', 'artisans:read', 'artisans:verify',
    'documents:read', 'catalogue:read',
  ],
  FINANCE: ['metrics:read', 'users:read', 'subscriptions:read', 'subscriptions:manage', 'catalogue:read'],
};

export const adminCan = (adminRole: AdminRole | null | undefined, capability: string): boolean => {
  if (!adminRole) return false;
  const caps = ADMIN_ROLE_CAPABILITIES[adminRole];
  if (!caps) return false;
  return caps.includes('*') || caps.includes(capability);
};
