/**
 * Central, typed runtime configuration.
 *
 * Every external integration degrades to a documented mock when its
 * credentials are absent, so a fresh clone boots and the whole marketplace
 * loop works without a single third-party account.
 */
export interface DeeviConfig {
  env: string;
  port: number;
  isProduction: boolean;
  apiPrefix: string;
  corsOrigins: string[];
  supabase: {
    url: string;
    publishableKey: string;
    secretKey: string;
    jwksUrl: string;
    configured: boolean;
  };
  google: { clientId: string; clientSecret: string; redirectUri: string; configured: boolean };
  email: { provider: string; from: string; apiKey: string; configured: boolean };
  push: { provider: string; apiKey: string; configured: boolean };
  maps: { provider: string; apiKey: string; configured: boolean };
  payments: { provider: string; secretKey: string; publicKey: string; webhookSecret: string; configured: boolean };
  redis: { url: string; configured: boolean };
  queue: { driver: 'database' | 'memory'; workerEnabled: boolean; pollIntervalMs: number; concurrency: number };
  rateLimit: { windowSeconds: number; max: number; authMax: number };
  jobs: { defaultExpiryDays: number; maxMediaPerJob: number; maxOpenJobsPerCustomer: number };
  uploads: { maxImageBytes: number; maxVideoBytes: number; maxDocumentBytes: number };
}

const bool = (v: string | undefined, fallback = false) =>
  v === undefined ? fallback : ['1', 'true', 'yes', 'on'].includes(v.toLowerCase());

const int = (v: string | undefined, fallback: number) => {
  const parsed = Number.parseInt(v ?? '', 10);
  return Number.isFinite(parsed) ? parsed : fallback;
};

export const loadConfiguration = (): DeeviConfig => {
  const env = process.env.NODE_ENV ?? 'development';
  const supabaseUrl = process.env.SUPABASE_URL ?? '';

  return {
    env,
    port: int(process.env.PORT, 3001),
    isProduction: env === 'production',
    apiPrefix: process.env.API_PREFIX ?? 'api/v1',
    corsOrigins: (process.env.CORS_ORIGINS ?? '*').split(',').map((o) => o.trim()).filter(Boolean),

    supabase: {
      url: supabaseUrl,
      publishableKey: process.env.SUPABASE_PUBLISHABLE_KEY ?? '',
      secretKey: process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY ?? '',
      jwksUrl: `${supabaseUrl}/auth/v1/.well-known/jwks.json`,
      configured: Boolean(supabaseUrl && (process.env.SUPABASE_SECRET_KEY ?? process.env.SUPABASE_SERVICE_ROLE_KEY)),
    },

    google: {
      clientId: process.env.GOOGLE_CLIENT_ID ?? '',
      clientSecret: process.env.GOOGLE_CLIENT_SECRET ?? '',
      redirectUri: process.env.GOOGLE_REDIRECT_URI ?? 'http://localhost:3001/api/v1/auth/google/callback',
      configured: Boolean(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET),
    },

    email: {
      provider: process.env.EMAIL_PROVIDER ?? 'mock',
      from: process.env.EMAIL_FROM ?? 'Deevi <no-reply@deevi.ng>',
      apiKey: process.env.EMAIL_API_KEY ?? '',
      configured: Boolean(process.env.EMAIL_API_KEY),
    },

    push: {
      provider: process.env.PUSH_PROVIDER ?? 'mock',
      apiKey: process.env.PUSH_API_KEY ?? '',
      configured: Boolean(process.env.PUSH_API_KEY),
    },

    maps: {
      provider: process.env.MAPS_PROVIDER ?? 'mock',
      apiKey: process.env.MAPS_API_KEY ?? '',
      configured: Boolean(process.env.MAPS_API_KEY),
    },

    payments: {
      provider: process.env.PAYMENT_PROVIDER ?? 'mock',
      secretKey: process.env.PAYMENT_SECRET_KEY ?? '',
      publicKey: process.env.PAYMENT_PUBLIC_KEY ?? '',
      webhookSecret: process.env.PAYMENT_WEBHOOK_SECRET ?? '',
      configured: Boolean(process.env.PAYMENT_SECRET_KEY),
    },

    redis: {
      url: process.env.REDIS_URL ?? '',
      configured: Boolean(process.env.REDIS_URL),
    },

    queue: {
      driver: (process.env.QUEUE_DRIVER as 'database' | 'memory') ?? 'database',
      workerEnabled: bool(process.env.QUEUE_WORKER_ENABLED, true),
      pollIntervalMs: int(process.env.QUEUE_POLL_INTERVAL_MS, 5000),
      concurrency: int(process.env.QUEUE_CONCURRENCY, 5),
    },

    rateLimit: {
      windowSeconds: int(process.env.RATE_LIMIT_WINDOW_SECONDS, 60),
      max: int(process.env.RATE_LIMIT_MAX, 120),
      authMax: int(process.env.RATE_LIMIT_AUTH_MAX, 10),
    },

    jobs: {
      defaultExpiryDays: int(process.env.JOB_DEFAULT_EXPIRY_DAYS, 30),
      maxMediaPerJob: int(process.env.JOB_MAX_MEDIA, 8),
      maxOpenJobsPerCustomer: int(process.env.JOB_MAX_OPEN_PER_CUSTOMER, 20),
    },

    uploads: {
      maxImageBytes: int(process.env.UPLOAD_MAX_IMAGE_BYTES, 5 * 1024 * 1024),
      maxVideoBytes: int(process.env.UPLOAD_MAX_VIDEO_BYTES, 25 * 1024 * 1024),
      maxDocumentBytes: int(process.env.UPLOAD_MAX_DOCUMENT_BYTES, 10 * 1024 * 1024),
    },
  };
};

export const CONFIG_TOKEN = 'DEEVI_CONFIG';
