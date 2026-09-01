import { Controller, Get } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { DatabaseService } from '../supabase/database.service.js';
import { CacheService } from '../cache/cache.service.js';
import { QueueService } from '../queue/queue.service.js';
import { loadConfiguration } from '../config/configuration.js';

@ApiTags('Health')
@Controller('health')
export class HealthController {
  private readonly config = loadConfiguration();
  private readonly startedAt = Date.now();

  constructor(
    private readonly db: DatabaseService,
    private readonly cache: CacheService,
    private readonly queue: QueueService,
  ) {}

  @Public()
  @Get('live')
  @ApiOperation({ summary: 'Liveness probe' })
  live() {
    return { status: 'ok', uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000) };
  }

  @Public()
  @Get('ready')
  @ApiOperation({
    summary: 'Readiness probe',
    description: 'Confirms the database is reachable. Returns 503 semantics via `status` when it is not.',
  })
  async ready() {
    let database = 'ok';
    try {
      await this.db.count('service_categories');
    } catch (err) {
      database = `unavailable: ${(err as Error).message}`;
    }
    return { status: database === 'ok' ? 'ok' : 'degraded', database };
  }

  @Public()
  @Get()
  @ApiOperation({
    summary: 'Integration status',
    description:
      'Reports which external integrations are live and which are running as mocks. Useful during ' +
      'onboarding to see exactly what still needs credentials.',
  })
  @ApiOkResponse({
    schema: {
      example: {
        status: 'ok',
        environment: 'development',
        integrations: {
          supabase: { configured: true, mocked: false },
          googleOAuth: { configured: false, mocked: true },
        },
      },
    },
  })
  async status() {
    return {
      status: 'ok',
      environment: this.config.env,
      version: '1.0.0',
      uptimeSeconds: Math.floor((Date.now() - this.startedAt) / 1000),
      integrations: {
        supabase: { configured: this.config.supabase.configured, mocked: false },
        googleOAuth: { configured: this.config.google.configured, mocked: !this.config.google.configured },
        email: { configured: this.config.email.configured, mocked: !this.config.email.configured, provider: this.config.email.provider },
        push: { configured: this.config.push.configured, mocked: true, provider: this.config.push.provider },
        maps: { configured: this.config.maps.configured, mocked: !this.config.maps.configured },
        payments: { configured: this.config.payments.configured, mocked: !this.config.payments.configured, provider: this.config.payments.provider },
        cache: { driver: this.cache.driver, configured: this.config.redis.configured },
        queue: { driver: 'database', workerEnabled: this.queue.workerEnabled, handlers: this.queue.registeredJobNames.length },
      },
      queue: await this.queue.stats().catch(() => ({})),
    };
  }
}
