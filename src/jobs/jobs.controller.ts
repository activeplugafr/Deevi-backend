import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { JobsService } from './jobs.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { ServiceLocationDto } from '../common/dto/location.dto.js';
import { CreateJobPostDto } from './dto/create-job.dto.js';
import {
  CancelJobDto, JobPostSummaryDto, MyJobsQueryDto, UpdateJobPostDto,
} from './dto/job-query.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Jobs')
@ApiBearerAuth()
@Controller('jobs')
export class JobsController {
  constructor(private readonly jobs: JobsService) {}

  @Post()
  @RateLimit({ limit: 20, windowSeconds: 3600, bucket: 'job-create' })
  @ApiOperation({
    summary: 'Post a job',
    description:
      'Creates and (by default) publishes a job post. The job carries its own service location, which is ' +
      'independent of the customer profile address. Set `publish: false` to save a draft.',
  })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateJobPostDto) {
    return this.jobs.create(user, dto);
  }

  @Get('mine')
  @ApiOperation({ summary: 'List the jobs I posted' })
  @ApiPaginatedResponse(JobPostSummaryDto)
  listMine(@CurrentUser() user: AuthUser, @Query() query: MyJobsQueryDto) {
    return this.jobs.listMine(user, query);
  }

  @Get('engagements')
  @ApiOperation({
    summary: 'List the jobs I am working on',
    description: 'The artisan side: engagements created once a customer selected me.',
  })
  listEngagements(@CurrentUser() user: AuthUser, @Query() query: MyJobsQueryDto) {
    const artisanId = user.artisanProfileId;
    if (!artisanId) return { items: [], meta: { page: 1, limit: query.limit, total: 0, totalPages: 0, hasNextPage: false, hasPreviousPage: false } };
    return this.jobs.listForArtisan(artisanId, query.page, query.limit, query.status);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one job post',
    description:
      'The response is scoped to the caller. The owner and admins see everything; other artisans see the ' +
      'marketplace view without the street address or access notes. The selected artisan gets the full ' +
      'address once they are engaged.',
  })
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getOne(user, id);
  }

  @Get(':id/history')
  @ApiOperation({ summary: 'Get the lifecycle history of a job' })
  history(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.getStatusHistory(user, id);
  }

  @Patch(':id')
  @ApiOperation({
    summary: 'Edit a job post',
    description: 'Only while the post is a DRAFT or still open to applications.',
  })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateJobPostDto,
  ) {
    return this.jobs.update(user, id, dto);
  }

  @Patch(':id/location')
  @ApiOperation({ summary: 'Change where the work happens' })
  updateLocation(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ServiceLocationDto,
  ) {
    return this.jobs.updateLocation(user, id, dto);
  }

  @Post(':id/publish')
  @ApiOperation({ summary: 'Publish a draft job post' })
  publish(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.jobs.publish(user, id);
  }

  @Post(':id/cancel')
  @ApiOperation({
    summary: 'Cancel a job',
    description: 'Closes every outstanding application and notifies everyone involved.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: CancelJobDto,
  ) {
    return this.jobs.cancel(user, id, dto.reason);
  }

  @Delete(':id/media/:mediaId')
  @ApiOperation({ summary: 'Remove a photo or video from a job post' })
  @ApiOkResponse({ type: MessageResponseDto })
  removeMedia(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Param('mediaId', ParseUUIDPipe) mediaId: string,
  ) {
    return this.jobs.removeMedia(user, id, mediaId);
  }
}
