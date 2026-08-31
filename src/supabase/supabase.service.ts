import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { createClient, SupabaseClient } from '@supabase/supabase-js';
import { loadConfiguration, type DeeviConfig } from '../config/configuration.js';

/**
 * Owns the Supabase clients.
 *
 * - `getClient()` is the service-role client. It bypasses RLS, which is
 *   deliberate: Deevi enforces authorization in the application layer where
 *   it can express marketplace rules RLS cannot. Never hand this to a client.
 * - `getAuthClient()` is the anon client, used only for auth flows that must
 *   run as the end user (sign-in, OAuth code exchange, refresh).
 */
@Injectable()
export class SupabaseService implements OnModuleInit {
  private readonly logger = new Logger(SupabaseService.name);
  private readonly config: DeeviConfig = loadConfiguration();
  private client: SupabaseClient;
  private authClient: SupabaseClient;

  constructor() {
    const { url, secretKey, publishableKey } = this.config.supabase;

    this.client = createClient(url, secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-deevi-client': 'api-service-role' } },
    });

    this.authClient = createClient(url, publishableKey || secretKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { 'x-deevi-client': 'api-auth' } },
    });
  }

  onModuleInit() {
    if (!this.config.supabase.configured) {
      this.logger.error(
        'Supabase is not configured. Set SUPABASE_URL and SUPABASE_SECRET_KEY in .env.',
      );
    }
  }

  getClient(): SupabaseClient {
    return this.client;
  }

  getAuthClient(): SupabaseClient {
    return this.authClient;
  }

  /** A client that acts as the given end user, for the rare RLS-scoped call. */
  getUserClient(accessToken: string): SupabaseClient {
    return createClient(this.config.supabase.url, this.config.supabase.publishableKey, {
      auth: { autoRefreshToken: false, persistSession: false },
      global: { headers: { Authorization: `Bearer ${accessToken}` } },
    });
  }

  get storage() {
    return this.client.storage;
  }

  get config$(): DeeviConfig {
    return this.config;
  }
}
