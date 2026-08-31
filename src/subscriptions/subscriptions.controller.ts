import { Body, Controller, Get, Post, Query } from '@nestjs/common';
import { ApiBearerAuth, ApiExcludeEndpoint, ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { SubscriptionsService } from './subscriptions.service.js';
import { ArtisansService } from '../artisans/artisans.service.js';
import { CurrentUser } from '../common/decorators/current-user.decorator.js';
import { Public } from '../common/decorators/public.decorator.js';
import { Roles } from '../common/decorators/roles.decorator.js';
import { PaginationQueryDto } from '../common/dto/pagination.dto.js';
import { MessageResponseDto } from '../common/dto/api-error.dto.js';
import {
  CheckoutSessionDto, EntitlementsDto, StartSubscriptionDto,
  SubscriptionDto, SubscriptionPlanDto,
} from './dto/subscription.dto.js';
import type { AuthUser } from '../common/types/auth-user.js';

@ApiTags('Subscriptions')
@Controller('subscriptions')
export class SubscriptionsController {
  constructor(
    private readonly subscriptions: SubscriptionsService,
    private readonly artisans: ArtisansService,
  ) {}

  @Public()
  @Get('plans')
  @ApiOperation({
    summary: 'List artisan subscription plans',
    description:
      'Deevi does not process payment for jobs in this MVP -- customers and artisans settle directly. ' +
      'These plans are the only money flow the platform handles.',
  })
  @ApiOkResponse({ type: [SubscriptionPlanDto] })
  listPlans() {
    return this.subscriptions.listPlans();
  }

  @Get('me')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'Get my subscription' })
  @ApiOkResponse({ type: SubscriptionDto })
  getMine(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getMySubscription(user);
  }

  @Get('me/entitlements')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'What my plan currently allows',
    description: 'Includes the monthly application quota and how much of it I have used.',
  })
  @ApiOkResponse({ type: EntitlementsDto })
  entitlements(@CurrentUser() user: AuthUser) {
    return this.subscriptions.getEntitlements(this.artisans.requireArtisanId(user));
  }

  @Post('checkout')
  @ApiBearerAuth()
  @Roles('ARTISAN')
  @ApiOperation({
    summary: 'Start a premium subscription',
    description:
      'Returns a provider checkout URL. The subscription stays INCOMPLETE until a verified provider ' +
      'webhook confirms payment -- a redirect back is never treated as proof. When no PSP is configured ' +
      'the mock provider is used and `mocked` is true.',
  })
  @ApiOkResponse({ type: CheckoutSessionDto })
  checkout(@CurrentUser() user: AuthUser, @Body() dto: StartSubscriptionDto) {
    return this.subscriptions.startCheckout(user, this.artisans.requireArtisanId(user), dto);
  }

  @Post('cancel')
  @ApiBearerAuth()
  @ApiOperation({
    summary: 'Cancel my subscription',
    description: 'Cancels at the end of the paid period; premium access continues until then.',
  })
  @ApiOkResponse({ type: MessageResponseDto })
  cancel(@CurrentUser() user: AuthUser) {
    return this.subscriptions.cancel(user, false);
  }

  @Get('me/invoices')
  @ApiBearerAuth()
  @ApiOperation({ summary: 'List my subscription invoices' })
  invoices(@CurrentUser() user: AuthUser, @Query() query: PaginationQueryDto) {
    return this.subscriptions.listInvoices(user, query.page, query.limit);
  }

  @Public()
  @Get('mock-checkout')
  @ApiExcludeEndpoint()
  async mockCheckout(@Query('reference') reference: string) {
    if (!this.subscriptions.providerIsMock) {
      return { message: 'Mock checkout is disabled because a real payment provider is configured.' };
    }
    const activated = await this.subscriptions.activateByReference(reference);
    return {
      message: activated
        ? 'Mock payment confirmed. Subscription activated. No money moved.'
        : 'Unknown checkout reference.',
      mocked: true,
    };
  }
}
