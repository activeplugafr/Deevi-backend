import { Injectable, Logger, OnModuleDestroy, OnModuleInit } from '@nestjs/common';
import { loadConfiguration, type DeeviConfig } from '../config/configuration.js';

interface CacheEntry {
  value: string;
  expiresAt: number;
}

/**
 * Cache abstraction with two adapters: Redis when REDIS_URL is set, and a
 * bounded in-process map otherwise. The database is always the source of
 * truth; nothing here is load-bearing for correctness, so a cold or missing
 * cache only costs latency.
 *
 * Note the in-memory adapter is per-process: with several API instances,
 * rate limiting becomes per-instance. That is an accepted MVP trade-off and
 * the reason Redis is recommended before the first real traffic spike.
 */
@Injectable()
export class CacheService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly config: DeeviConfig = loadConfiguration();
  private redis: any = null;
  private readonly memory = new Map<string, CacheEntry>();
  private readonly maxMemoryEntries = 10_000;
  private sweeper?: NodeJS.Timeout;

  async onModuleInit() {
    if (this.config.redis.configured) {
      try {
        const redisModule: any = await import('ioredis');
        const Redis = redisModule.default ?? redisModule;
        this.redis = new Redis(this.config.redis.url, {
          maxRetriesPerRequest: 2,
          lazyConnect: true,
          enableOfflineQueue: false,
        });
        this.redis.on('error', (err: Error) => {
          this.logger.warn(`Redis error, falling back to in-memory cache: ${err.message}`);
        });
        await this.redis.connect();
        this.logger.log('Cache adapter: redis');
      } catch (err) {
        this.redis = null;
        this.logger.warn(
          `Redis unavailable (${(err as Error).message}). Cache adapter: in-memory fallback.`,
        );
      }
    } else {
      this.logger.log('Cache adapter: in-memory (set REDIS_URL to enable Redis)');
    }

    this.sweeper = setInterval(() => this.sweep(), 60_000);
    this.sweeper.unref?.();
  }

  async onModuleDestroy() {
    if (this.sweeper) clearInterval(this.sweeper);
    if (this.redis) {
      try { await this.redis.quit(); } catch { /* already closed */ }
    }
  }

  get driver(): 'redis' | 'memory' {
    return this.redis ? 'redis' : 'memory';
  }

  async get<T>(key: string): Promise<T | null> {
    try {
      if (this.redis) {
        const raw = await this.redis.get(key);
        return raw ? (JSON.parse(raw) as T) : null;
      }
    } catch (err) {
      this.logger.warn(`Cache read failed for ${key}: ${(err as Error).message}`);
    }

    const entry = this.memory.get(key);
    if (!entry) return null;
    if (entry.expiresAt < Date.now()) {
      this.memory.delete(key);
      return null;
    }
    return JSON.parse(entry.value) as T;
  }

  async set(key: string, value: unknown, ttlSeconds = 60): Promise<void> {
    const serialised = JSON.stringify(value);
    try {
      if (this.redis) {
        await this.redis.set(key, serialised, 'EX', ttlSeconds);
        return;
      }
    } catch (err) {
      this.logger.warn(`Cache write failed for ${key}: ${(err as Error).message}`);
    }

    if (this.memory.size >= this.maxMemoryEntries) {
      const oldest = this.memory.keys().next().value;
      if (oldest) this.memory.delete(oldest);
    }
    this.memory.set(key, { value: serialised, expiresAt: Date.now() + ttlSeconds * 1000 });
  }

  async del(...keys: string[]): Promise<void> {
    if (!keys.length) return;
    try {
      if (this.redis) await this.redis.del(...keys);
    } catch (err) {
      this.logger.warn(`Cache delete failed: ${(err as Error).message}`);
    }
    for (const key of keys) this.memory.delete(key);
  }

  /**
   * Invalidates a whole family of keys. Call this from every mutation that
   * changes cached data -- catalogue writes, profile updates, and so on.
   */
  async delByPrefix(prefix: string): Promise<void> {
    try {
      if (this.redis) {
        let cursor = '0';
        do {
          const [next, found] = await this.redis.scan(cursor, 'MATCH', `${prefix}*`, 'COUNT', 200);
          cursor = next;
          if (found.length) await this.redis.del(...found);
        } while (cursor !== '0');
      }
    } catch (err) {
      this.logger.warn(`Cache prefix delete failed for ${prefix}: ${(err as Error).message}`);
    }
    for (const key of this.memory.keys()) {
      if (key.startsWith(prefix)) this.memory.delete(key);
    }
  }

  /** Read-through helper. */
  async wrap<T>(key: string, ttlSeconds: number, producer: () => Promise<T>): Promise<T> {
    const hit = await this.get<T>(key);
    if (hit !== null) return hit;
    const value = await producer();
    await this.set(key, value, ttlSeconds);
    return value;
  }

  /**
   * Atomic counter used by the rate limiter. Returns the count after the
   * increment plus the seconds remaining in the window.
   */
  async increment(key: string, windowSeconds: number): Promise<{ count: number; ttl: number }> {
    try {
      if (this.redis) {
        const count = await this.redis.incr(key);
        if (count === 1) await this.redis.expire(key, windowSeconds);
        const ttl = await this.redis.ttl(key);
        return { count, ttl: ttl > 0 ? ttl : windowSeconds };
      }
    } catch (err) {
      this.logger.warn(`Rate limit counter failed: ${(err as Error).message}`);
    }

    const now = Date.now();
    const entry = this.memory.get(key);
    if (!entry || entry.expiresAt < now) {
      this.memory.set(key, { value: '1', expiresAt: now + windowSeconds * 1000 });
      return { count: 1, ttl: windowSeconds };
    }
    const count = Number.parseInt(entry.value, 10) + 1;
    entry.value = String(count);
    return { count, ttl: Math.ceil((entry.expiresAt - now) / 1000) };
  }

  private sweep() {
    const now = Date.now();
    for (const [key, entry] of this.memory) {
      if (entry.expiresAt < now) this.memory.delete(key);
    }
  }
}
