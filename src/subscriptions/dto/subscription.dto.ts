import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsOptional, IsString, IsUrl, MaxLength } from 'class-validator';

export class SubscriptionPlanDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'PREMIUM_MONTHLY' }) code: string;
  @ApiProperty({ example: 'Premium Monthly' }) name: string;
  @ApiPropertyOptional({ nullable: true }) description: string | null;
  @ApiProperty({ example: 3500, type: Number }) amount: number;
  @ApiProperty({ example: 'NGN' }) currency: string;
  @ApiProperty({ example: 'MONTHLY' }) billing_interval: string;
  @ApiProperty({ example: 7 }) trial_days: number;
  @ApiPropertyOptional({
    nullable: true, example: 15,
    description: 'Applications allowed per month. Null means unlimited.',
  })
  monthly_application_limit: number | null;
  @ApiProperty({ type: 'object', additionalProperties: true }) features: Record<string, unknown>;
}

export class SubscriptionDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ format: 'uuid' }) plan_id: string;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiProperty({ example: 'MOCK', description: 'MOCK until a real PSP is configured' }) provider: string;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) current_period_start: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) current_period_end: string | null;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) trial_ends_at: string | null;
  @ApiProperty() cancel_at_period_end: boolean;
}

export class StartSubscriptionDto {
  @ApiProperty({ example: 'PREMIUM_MONTHLY', description: 'Plan code from GET /subscriptions/plans' })
  @IsString() @MaxLength(60)
  planCode: string;

  @ApiPropertyOptional({ description: 'Where to send the artisan after payment' })
  @IsOptional() @IsUrl({ require_tld: false })
  callbackUrl?: string;
}

export class CheckoutSessionDto {
  @ApiProperty({ example: 'MOCK' }) provider: string;
  @ApiProperty() reference: string;
  @ApiProperty({ description: 'Send the artisan here to pay' }) authorizationUrl: string;
  @ApiProperty({ description: 'True when no real charge will occur' }) mocked: boolean;
  @ApiProperty({ format: 'uuid' }) subscriptionId: string;
}

export class EntitlementsDto {
  @ApiProperty({ example: false }) isPremium: boolean;
  @ApiProperty({ example: 'FREE' }) planCode: string;
  @ApiPropertyOptional({ nullable: true, example: 15 }) monthlyApplicationLimit: number | null;
  @ApiProperty({ example: 4 }) applicationsThisMonth: number;
  @ApiPropertyOptional({ nullable: true, example: 11 }) applicationsRemaining: number | null;
  @ApiProperty({ example: false }) featuredProfile: boolean;
  @ApiProperty({ example: 0 }) boostCredits: number;
}
