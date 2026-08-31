import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ReviewsService } from './reviews.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import {
  ArtisanReviewsQueryDto, CreateReviewDto, ReviewDto, ReviewEligibilityDto,
} from './dto/review.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Reviews')
@Controller('reviews')
export class ReviewsController {
  constructor(private readonly reviews: ReviewsService) {}

  @Post()
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Review a completed job',
    description:
      'Only the customer who hired the artisan, only after the job is COMPLETED, and only once per job. ' +
      'The artisan rating average is recalculated by a database trigger.',
  })
  @ApiOkResponse({ type: ReviewDto })
  create(@CurrentUser() user: AuthUser, @Body() dto: CreateReviewDto) {
    return this.reviews.create(user, dto);
  }

  @Get('eligibility/:jobId')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Can I review this job?',
    description: 'Use this to decide whether to show the review prompt, and what to say when you cannot.',
  })
  @ApiOkResponse({ type: ReviewEligibilityDto })
  eligibility(@CurrentUser() user: AuthUser, @Param('jobId', ParseUUIDPipe) jobId: string) {
    return this.reviews.checkEligibility(user, jobId);
  }

  @Get('mine')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Reviews I have written' })
  @ApiPaginatedResponse(ReviewDto)
  listMine(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.reviews.listMine(user, query.page, query.limit);
  }

  @Public()
  @Get('artisans/:artisanId')
  @ApiOperation({ summary: 'Reviews for an artisan' })
  @ApiPaginatedResponse(ReviewDto)
  listForArtisan(
    @Param('artisanId', ParseUUIDPipe) artisanId: string,
    @Query() query: ArtisanReviewsQueryDto,
  ) {
    return this.reviews.listForArtisan(artisanId, query);
  }

  @Public()
  @Get('artisans/:artisanId/summary')
  @ApiOperation({ summary: 'Rating summary and distribution for an artisan' })
  summary(@Param('artisanId', ParseUUIDPipe) artisanId: string) {
    return this.reviews.getSummary(artisanId);
  }
}
