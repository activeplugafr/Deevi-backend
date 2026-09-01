import { Body, Controller, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { MatchingService } from './matching.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  InviteArtisanDto, RecommendArtisansQueryDto, RecommendedArtisanDto, RecommendForJobQueryDto,
} from './dto/matching.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Matching')
@ApiBearerAuth()
@Controller('matching')
export class MatchingController {
  constructor(private readonly matching: MatchingService) {}

  @Get('artisans')
  @ApiOperation({
    summary: 'Ask Deevi to recommend artisans',
    description:
      'The secondary flow, for a customer who would rather be matched than wait for applications. ' +
      'Only APPROVED artisans who offer the service and can reach the location are returned, ranked ' +
      'deterministically on proximity, availability, rating, completed jobs and recent activity.',
  })
  @ApiPaginatedResponse(RecommendedArtisanDto)
  recommend(@Query() query: RecommendArtisansQueryDto) {
    return this.matching.recommend(query);
  }

  @Get('jobs/:jobPostId/artisans')
  @ApiOperation({
    summary: 'Recommend artisans for one of my jobs',
    description:
      'Uses the job own service and location. Each result is flagged with whether that artisan has ' +
      'already applied.',
  })
  @ApiPaginatedResponse(RecommendedArtisanDto)
  recommendForJob(
    @CurrentUser() user: AuthUser,
    @Param('jobPostId', ParseUUIDPipe) jobPostId: string,
    @Query() query: RecommendForJobQueryDto,
  ) {
    return this.matching.recommendForJob(user, jobPostId, query);
  }

  @Post('artisans/:artisanId/invite')
  @ApiOperation({
    summary: 'Invite a recommended artisan to apply',
    description:
      'Sends a notification. It is an invitation, not an assignment: the artisan still applies and the ' +
      'customer still selects, so the marketplace loop is never bypassed.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  invite(
    @CurrentUser() user: AuthUser,
    @Param('artisanId', ParseUUIDPipe) artisanId: string,
    @Body() dto: InviteArtisanDto,
  ) {
    return this.matching.inviteArtisan(user, artisanId, dto.jobPostId, dto.message);
  }
}
