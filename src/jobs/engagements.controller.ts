import { Body, Controller, Param, ParseUUIDPipe, Post } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { DeclineJobDto } from './dto/job-query.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

/**
 * A `Job` is the engagement that exists once a customer has chosen an artisan.
 * It is a separate resource from the `JobPost` because its participants,
 * permissions and lifecycle are different.
 */
@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('engagements')
export class EngagementsController {
  constructor(private readonly jobs: JobsService) {}

  @Post(':id/accept')
  @ApiOperation({
    summary: 'Accept the job I was selected for',
    description: 'Artisan only. Moves the engagement from PENDING_ACCEPTANCE to ACCEPTED.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  accept(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.acceptEngagement(user, id);
  }

  @Post(':id/decline')
  @ApiOperation({
    summary: 'Decline the job I was selected for',
    description:
      'Artisan only, and only before accepting. The job post returns to RECEIVING_APPLICATIONS so the ' +
      'customer can pick someone else without re-posting.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  decline(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: DeclineJobDto,
  ) {
    return this.jobs.declineEngagement(user, id, dto.reason);
  }

  @Post(':id/start')
  @ApiOperation({ summary: 'Mark work as started', description: 'Either participant can start an ACCEPTED job.' })
  @ApiOkResponse({ type: MessageResponseDto })
  start(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.startWork(user, id);
  }

  @Post(':id/artisan-complete')
  @ApiOperation({
    summary: 'Flag the work as finished',
    description: 'Artisan only. The job stays IN_PROGRESS until the customer confirms.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  artisanComplete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.markArtisanComplete(user, id);
  }

  @Post(':id/complete')
  @ApiOperation({
    summary: 'Confirm the job is complete',
    description:
      'Customer only. Completion is the customer call, which is what makes the review that follows ' +
      'meaningful. Schedules a review reminder.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  complete(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.complete(user, id);
  }
}
