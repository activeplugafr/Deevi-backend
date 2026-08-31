import { Controller, Get, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOperation, ApiTags } from '@nestjs/swagger';
import { FeedService } from './feed.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { ApiPaginatedResponse } from '../common/decorators/api-paginated.decorator.js';
import { FeedJobDto, FeedQueryDto } from './dto/feed.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Job Feed')
@ApiBearerAuth()
@Roles('ARTISAN')
@Controller('feed')
export class FeedController {
  constructor(private readonly feed: FeedService) {}

  @Get('jobs')
  @ApiOperation({
    summary: 'My relevant job feed',
    description:
      'Deterministic, rule-based ranking: service match, sub-service match, distance from my service ' +
      'areas, availability, reputation and recency. Requires an APPROVED artisan account. Jobs beyond my ' +
      'travel radius are filtered out entirely, not merely ranked lower. Always paginated, max 100 per page.',
  })
  @ApiPaginatedResponse(FeedJobDto, 'Ranked, privacy-safe job posts')
  getFeed(@CurrentUser() user: AuthUser, @Query() query: FeedQueryDto) {
    return this.feed.getFeed(user, query);
  }

  @Get('explain')
  @ApiOperation({
    summary: 'Why my feed looks like this',
    description: 'Lists the inputs behind my ranking and anything blocking jobs from reaching me.',
  })
  explain(@CurrentUser() user: AuthUser) {
    return this.feed.explainFeed(user);
  }
}
