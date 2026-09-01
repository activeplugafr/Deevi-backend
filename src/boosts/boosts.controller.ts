import { Body, Controller, Delete, Get, Param, ParseUUIDPipe, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { BoostsService } from './boosts.service.js';
import { ArtisansService } from '../artisans/artisans.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import { BoostApplicationDto, BoostBalanceDto, BoostDto } from './dto/boost.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Boosts')
@ApiBearerAuth()
@Roles('ARTISAN')
@Controller('boosts')
export class BoostsController {
  constructor(
    private readonly boosts: BoostsService,
    private readonly artisans: ArtisansService,
  ) {}

  @Get('balance')
  @ApiOperation({
    summary: 'My boost credit balance',
    description: 'Credits come from the subscription plan. Buying credits directly is post-MVP.',
  })
  @ApiOkResponse({ type: BoostBalanceDto })
  balance(@CurrentUser() user: AuthUser) {
    return this.boosts.getBalance(this.artisans.requireArtisanId(user));
  }

  @Get()
  @ApiOperation({ summary: 'List my boosts' })
  @ApiOkResponse({ type: [BoostDto] })
  list(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.boosts.listMine(this.artisans.requireArtisanId(user), query.page, query.limit);
  }

  @Post('applications/:applicationId')
  @ApiOperation({
    summary: 'Promote one of my applications',
    description:
      'Spends one credit to raise this application in the customer list. The multiplier is capped at ' +
      '1.5x by a database constraint, so a boost reorders relevant results and never manufactures them.',
  })
  @ApiOkResponse({ type: BoostDto })
  boostApplication(
    @CurrentUser() user: AuthUser,
    @Param('applicationId', ParseUUIDPipe) applicationId: string,
    @Body() dto: BoostApplicationDto,
  ) {
    return this.boosts.boostApplication(
      user, this.artisans.requireArtisanId(user), applicationId, dto.days ?? 7,
    );
  }

  @Delete(':id')
  @ApiOperation({ summary: 'Cancel an active boost' })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(@CurrentUser() user: AuthUser, @Param('id', ParseUUIDPipe) id: string) {
    return this.boosts.cancelBoost(this.artisans.requireArtisanId(user), id);
  }
}
