import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReportsService } from './reports.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { RateLimit } from '../common/decorators/rate-limit.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import {
  CreateDisputeDto, CreateReportDto, DisputeDto, MyReportsQueryDto, ReportDto,
} from './dto/report.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Reports')
@ApiBearerAuth()
@Controller()
export class ReportsController {
  constructor(private readonly reports: ReportsService) {}

  @Post('reports')
  @RateLimit({ limit: 10, windowSeconds: 3600, bucket: 'report' })
  @ApiOperation({
    summary: 'Report a problem',
    description:
      'Either side can report. SAFETY_CONCERN and FRAUD are escalated to URGENT automatically. ' +
      'The response carries a reference the reporter can quote to support.',
  })
  @ApiOkResponse({ type: ReportDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReportDto) {
    return this.reports.create(user, dto);
  }

  @Get('reports/mine')
  @ApiOperation({ summary: 'List the reports I have filed' })
  @ApiPaginatedResponse(ReportDto)
  listMine(@CurrentUser() user: AuthUser, @Query() query: MyReportsQueryDto) {
    return this.reports.listMine(user, query);
  }

  @Get('reports/:id')
  @ApiOperation({ summary: 'Get one of my reports' })
  @ApiOkResponse({ type: ReportDto })
  getOne(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getMine(user, id);
  }

  @Post('disputes')
  @RateLimit({ limit: 5, windowSeconds: 3600, bucket: 'dispute' })
  @ApiOperation({
    summary: 'Raise a dispute on a job',
    description:
      'Freezes the job lifecycle: the job and its post move to DISPUTED, and from there only an admin ' +
      'can resolve it. One open dispute per job.',
  })
  @ApiOkResponse({ type: DisputeDto })
  createDispute(@CurrentUser() user: AuthUser, @Body() dto: CreateDisputeDto) {
    return this.reports.createDispute(user, dto);
  }

  @Get('disputes/mine')
  @ApiOperation({ summary: 'List disputes I am party to' })
  @ApiPaginatedResponse(DisputeDto)
  listDisputes(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.reports.listMyDisputes(user, query.page, query.limit);
  }

  @Get('disputes/:id')
  @ApiOperation({ summary: 'Get one dispute I am party to' })
  @ApiOkResponse({ type: DisputeDto })
  getDispute(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.reports.getMyDispute(user, id);
  }
}
