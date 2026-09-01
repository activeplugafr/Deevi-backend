import { Controller, Get, Param, ParseUUIDPipe, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { ApplicationsQueryDto } from './dto/application.dto.js';
import { JobPostSummaryDto } from '../jobs/dto/job-query.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

/** Applications viewed from the job they belong to -- the customer's screen. */
@ApiTags('Applications')
@ApiBearerAuth()
@Controller('jobs/:jobPostId/applications')
export class JobApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Get()
  @ApiOperation({
    summary: 'List the applications on my job',
    description:
      'Customer only. Each row carries an artisan preview (rating, jobs completed, experience) so the ' +
      'customer can compare bids without a second request per artisan.',
  })
  @ApiPaginatedResponse(JobPostSummaryDto, 'Applications with an artisan preview')
  list(
    @CurrentUser() user: AuthUser,
    @Param('jobPostId', ParseUUIDPipe) jobPostId: string,
    @Query() query: ApplicationsQueryDto,
  ) {
    return this.applications.listForJob(user, jobPostId, query);
  }
}
