import { Body, Controller, Get, Param, ParseUUIDPipe, Patch, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { AdminService } from './admin.service.js';
import { AuditService } from '../audit/audit.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { AdminRoles, RequireCapability, Roles } from '../common/decorators/roles.decorator.js';
import { AdminApplicationsQueryDto, PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { SignedUrlDto } from '../storage/dto/storage.dto.js';
import {
  AdminArtisansQueryDto, AdminUsersQueryDto, CreateAdminDto, HideReviewDto,
  ResolveDisputeDto, ReviewApplicationDto, SuspendUserDto, UpdateReportDto,
} from './dto/admin.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

/**
 * Every route here is gated twice: @Roles('ADMIN') establishes that the caller
 * is staff, and @RequireCapability narrows it to what their specific admin
 * role may do. A SUPPORT admin can read the verification queue but cannot
 * approve; a VERIFICATION admin cannot touch subscriptions.
 */
@ApiTags('Admin')
@ApiBearerAuth()
@Roles('ADMIN')
@Controller('admin')
export class AdminController {
  constructor(
    private readonly admin: AdminService,
    private readonly audit: AuditService,
  ) { }

  @Get('metrics')
  @RequireCapability('metrics:read')
  @ApiOperation({
    summary: 'Dashboard metrics',
    description: 'Users, artisans, jobs, applications, moderation queue, reviews and subscriptions in one call.',
  })
  metrics() {
    return this.admin.getMetrics();
  }

  @Get('metrics/growth')
  @RequireCapability('metrics:read')
  @ApiOperation({ summary: 'Daily signups, job posts and applications' })
  growth(@Query('days') days?: string) {
    return this.admin.getGrowth(Math.min(Number(days) || 30, 180));
  }

  /* ------------------------------- users ------------------------------- */

  @Get('users')
  @RequireCapability('users:read')
  @ApiOperation({ summary: 'List and search users' })
  listUsers(@Query() query: AdminUsersQueryDto) {
    return this.admin.listUsers(query);
  }

  @Get('users/:id')
  @RequireCapability('users:read')
  @ApiOperation({ summary: 'Get a user with their profiles and activity' })
  getUser(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getUser(id);
  }

  @Post('users/:id/suspend')
  @RequireCapability('users:suspend')
  @ApiOperation({
    summary: 'Suspend a user',
    description: 'Takes effect on their next request: the cached principal is invalidated immediately.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  suspendUser(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.admin.suspendUser(actor, id, dto.reason);
  }

  @Post('users/:id/reinstate')
  @RequireCapability('users:suspend')
  @ApiOperation({ summary: 'Reinstate a suspended user' })
  @ApiOkResponse({ type: MessageResponseDto })
  reinstateUser(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.reinstateUser(actor, id);
  }

  /* ----------------------------- artisans ------------------------------ */

  @Get('artisans')
  @RequireCapability('artisans:read')
  @ApiOperation({ summary: 'List artisans' })
  listArtisans(@Query() query: AdminArtisansQueryDto) {
    return this.admin.listArtisans(query);
  }

  @Get('artisan-applications')
  @RequireCapability('artisans:read')
  @ApiOperation({
    summary: 'The verification queue',
    description: 'Oldest submission first. Defaults to PENDING and UNDER_REVIEW.',
  })
  listApplications(@Query() query: AdminApplicationsQueryDto) {
    return this.admin.listApplications(query.status, query.page, query.limit);
  }

  @Get('artisan-applications/:id')
  @RequireCapability('artisans:read')
  @ApiOperation({
    summary: 'Full verification packet',
    description: 'Profile, services, service areas, portfolio and document metadata in one call.',
  })
  getApplication(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getApplication(id);
  }

  @Get('verification-documents/:id/url')
  @RequireCapability('documents:read')
  @ApiOperation({
    summary: 'Open a verification document',
    description:
      'Returns a 5-minute signed URL. These are government IDs, so every access is written to the audit log.',
  })
  @ApiOkResponse({ type: SignedUrlDto })
  documentUrl(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getDocumentUrl(actor, id);
  }

  @Post('artisan-applications/:id/review')
  @RequireCapability('artisans:verify')
  @ApiOperation({
    summary: 'Approve, reject or hold an artisan application',
    description:
      'Approving is what makes someone a Deevi marketplace artisan. Rejection requires a reason the ' +
      'artisan can act on. Concurrent reviews are rejected rather than silently overwriting each other.',
  })
  reviewApplication(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ReviewApplicationDto,
  ) {
    return this.admin.reviewApplication(actor, id, dto);
  }

  @Post('artisans/:id/suspend')
  @RequireCapability('artisans:verify')
  @ApiOperation({ summary: 'Suspend an artisan from the marketplace' })
  @ApiOkResponse({ type: MessageResponseDto })
  suspendArtisan(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: SuspendUserDto,
  ) {
    return this.admin.suspendArtisan(actor, id, dto.reason);
  }

  /* -------------------------- jobs and bids ---------------------------- */

  @Get('jobs')
  @RequireCapability('jobs:read')
  @ApiOperation({ summary: 'List job posts across the marketplace' })
  listJobs(@Query() query: PaginationQueryDto, @Query('status') status?: string, @Query('q') q?: string) {
    return this.admin.listJobs({ page: query.page, limit: query.limit, status, q });
  }

  @Get('jobs/:id')
  @RequireCapability('jobs:read')
  @ApiOperation({ summary: 'Full job record with applications, engagement and history' })
  getJob(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getJob(id);
  }

  @Get('applications')
  @RequireCapability('applications:read')
  @ApiOperation({ summary: 'List applications across the marketplace' })
  listApplicationsAdmin(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
    @Query('jobPostId') jobPostId?: string,
  ) {
    return this.admin.listApplicationsAdmin({ page: query.page, limit: query.limit, status, jobPostId });
  }

  /* ---------------------------- moderation ----------------------------- */

  @Get('reports')
  @RequireCapability('reports:read')
  @ApiOperation({
    summary: 'The report queue',
    description: 'Highest priority first. Defaults to OPEN and UNDER_REVIEW.',
  })
  listReports(
    @Query() query: PaginationQueryDto,
    @Query('status') status?: string,
    @Query('priority') priority?: string,
    @Query('category') category?: string,
  ) {
    return this.admin.listReports({ page: query.page, limit: query.limit, status, priority, category });
  }

  @Get('reports/:id')
  @RequireCapability('reports:read')
  @ApiOperation({
    summary: 'Investigate a report',
    description: 'Includes the reporter, the reported user and how many reports that user has attracted.',
  })
  getReport(@Param('id', ParseUUIDPipe) id: string) {
    return this.admin.getReport(id);
  }

  @Patch('reports/:id')
  @RequireCapability('reports:manage')
  @ApiOperation({ summary: 'Update, assign or resolve a report' })
  updateReport(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: UpdateReportDto,
  ) {
    return this.admin.updateReport(actor, id, dto);
  }

  @Get('disputes')
  @RequireCapability('disputes:read')
  @ApiOperation({ summary: 'The dispute queue' })
  listDisputes(@Query() query: PaginationQueryDto, @Query('status') status?: string) {
    return this.admin.listDisputes({ page: query.page, limit: query.limit, status });
  }

  @Post('disputes/:id/resolve')
  @RequireCapability('disputes:manage')
  @ApiOperation({
    summary: 'Resolve a dispute',
    description:
      'A DISPUTED job is frozen for its participants, so this is the only way it moves again. ' +
      'Pass `jobOutcome` to say where the job should land.',
  })
  resolveDispute(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: ResolveDisputeDto,
  ) {
    return this.admin.resolveDispute(actor, id, dto);
  }

  @Get('reviews')
  @RequireCapability('reviews:read')
  @ApiOperation({ summary: 'List reviews' })
  listReviews(
    @Query() query: PaginationQueryDto,
    @Query('visible') visible?: string,
    @Query('artisanId') artisanId?: string,
  ) {
    return this.admin.listReviews({
      page: query.page,
      limit: query.limit,
      visible: visible === undefined ? undefined : visible === 'true',
      artisanId,
    });
  }

  @Post('reviews/:id/hide')
  @RequireCapability('reviews:moderate')
  @ApiOperation({
    summary: 'Hide a review',
    description: 'Never deleted, so rating history stays reconstructible and the review can be restored.',
  })
  hideReview(
    @CurrentUser() actor: AuthUser,
    @Param('id', ParseUUIDPipe) id: string,
    @Body() dto: HideReviewDto,
  ) {
    return this.admin.hideReview(actor, id, dto.reason);
  }

  @Post('reviews/:id/restore')
  @RequireCapability('reviews:moderate')
  @ApiOperation({ summary: 'Restore a hidden review' })
  restoreReview(@CurrentUser() actor: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.admin.restoreReview(actor, id);
  }

  /*
   * Subscriptions are dormant in the MVP (see src/config/mvp-scope.ts), so the
   * admin listing is not registered either -- it could only ever return an
   * empty page. AdminService.listSubscriptions remains for reactivation.
   */

  /* ------------------------------ the team ----------------------------- */

  @Get('admins')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'List admin accounts' })
  listAdmins(@Query() query: PaginationQueryDto) {
    return this.admin.listAdmins(query.page, query.limit);
  }

  @Post('admins')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({
    summary: 'Promote a user to admin',
    description: 'SUPER_ADMIN only: the ability to mint admins is the ability to do everything.',
  })
  createAdmin(@CurrentUser() actor: AuthUser, @Body() dto: CreateAdminDto) {
    return this.admin.createAdmin(actor, dto);
  }

  @Post('admins/:userId/revoke')
  @AdminRoles('SUPER_ADMIN')
  @ApiOperation({ summary: 'Revoke admin access' })
  @ApiOkResponse({ type: MessageResponseDto })
  revokeAdmin(@CurrentUser() actor: AuthUser, @Param('userId', ParseUUIDPipe) userId: string) {
    return this.admin.revokeAdmin(actor, userId);
  }

  /* ----------------------------- audit log ----------------------------- */

  @Get('audit-logs')
  @AdminRoles('SUPER_ADMIN', 'OPERATIONS')
  @ApiOperation({
    summary: 'Read the audit trail',
    description: 'Append-only record of every sensitive admin action, including document views.',
  })
  auditLogs(
    @Query() query: PaginationQueryDto,
    @Query('actorId') actorId?: string,
    @Query('entityType') entityType?: string,
    @Query('entityId') entityId?: string,
    @Query('action') action?: string,
  ) {
    return this.audit.list({ page: query.page, limit: query.limit, actorId, entityType, entityId, action });
  }
}
