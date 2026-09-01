import { Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { WebhooksService } from '../webhooks/webhooks.service.js';
import { QueueService } from '../queue/queue.service.js';
import { AdminRoles, Roles } from '../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';

/** Operational visibility: the queue and the inbound webhook log. */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@AdminRoles('SUPER_ADMIN', 'OPERATIONS')
@Controller('admin/ops')
export class AdminOpsController {
  constructor(
    private readonly webhooks: WebhooksService,
    private readonly queue: QueueService,
  ) {}

  @Get('webhooks')
  @ApiOperation({
    summary: 'Inbound webhook log',
    description: 'Includes events rejected for a bad signature, which is a security signal worth watching.',
  })
  listWebhooks(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
    @Query('provider') provider?: string,
  ) {
    return this.webhooks.listEvents(query.page, query.limit, status, provider);
  }

  @Post('webhooks/:id/replay')
  @ApiOperation({
    summary: 'Replay a webhook',
    description: 'For an event that failed for a reason since fixed. Processing is idempotent.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  replay(@Param('id', ParseUUIDPipe) id: string) {
    return this.webhooks.replay(id);
  }

  @Get('queue')
  @ApiOperation({ summary: 'Background queue depth by status' })
  queueStats() {
    return this.queue.stats();
  }

  @Post('queue/requeue-stuck')
  @ApiOperation({
    summary: 'Requeue jobs abandoned by a dead worker',
    description: 'Also runs automatically every five minutes.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  async requeue() {
    const count = await this.queue.requeueStuckJobs();
    return { message: `${count} stuck job(s) requeued` };
  }
}
