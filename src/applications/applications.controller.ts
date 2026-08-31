import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApplicationsService } from './applications.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  ApplicationsQueryDto, CreateApplicationDto, RejectApplicationDto,
  SelectArtisanDto, UpdateApplicationDto,
} from './dto/application.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Applications')
@ApiBearerAuth()
@Controller('applications')
export class ApplicationsController {
  constructor(private readonly applications: ApplicationsService) {}

  @Post()
  @Roles('ARTISAN')
  @RateLimit({ limit: 30, windowSeconds: 3600, bucket: 'apply' })
  @ApiOperation({
    summary: 'Apply to a job',
    description:
      'Requires an APPROVED artisan account that already offers the job service, and available quota on ' +
      'the current plan. One application per artisan per job.',
  })
  apply(@CurrentUser() user: AuthUser, @Body() dto: CreateApplicationDto) {
    return this.applications.apply(user, dto);
  }

  @Get('mine')
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'List the jobs I applied to' })
  listMine(@CurrentUser() user: AuthUser, @Query() query: ApplicationsQueryDto) {
    return this.applications.listMine(user, query);
  }

  @Get(':id')
  @ApiOperation({
    summary: 'Get one application',
    description: 'Visible to the artisan who submitted it and to the customer who owns the job.',
  })
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.getOne(user, id);
  }

  @Patch(':id')
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Revise my application', description: 'Allowed while it is SUBMITTED or SHORTLISTED.' })
  update(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateApplicationDto,
  ) {
    return this.applications.update(user, id, dto);
  }

  @Post(':id/withdraw')
  @Roles('ARTISAN')
  @ApiOperation({ summary: 'Withdraw my application' })
  @ApiOkResponse({ type: MessageResponseDto })
  withdraw(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.withdraw(user, id);
  }

  @Post(':id/shortlist')
  @ApiOperation({ summary: 'Shortlist an application', description: 'Customer only.' })
  shortlist(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.applications.shortlist(user, id);
  }

  @Post(':id/reject')
  @ApiOperation({ summary: 'Reject an application', description: 'Customer only.' })
  reject(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: RejectApplicationDto,
  ) {
    return this.applications.reject(user, id, dto.reason);
  }

  @Post(':id/select')
  @ApiOperation({
    summary: 'Select this artisan for the job',
    description:
      'Customer only. Atomically accepts this application, rejects every other one, creates the ' +
      'engagement and opens the conversation. Concurrent selections are serialised by a row lock and ' +
      'backed by a partial unique index, so two artisans can never both be accepted.',
  })
  select(
    @CurrentUser() user: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SelectArtisanDto,
  ) {
    return this.applications.selectArtisan(user, id, dto.agreedPrice);
  }
}
