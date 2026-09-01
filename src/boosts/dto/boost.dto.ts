import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsInt, IsOptional, Max, Min } from 'class-validator';

export class BoostApplicationDto {
  @ApiPropertyOptional({ default: 7, minimum: 1, maximum: 30, description: 'How long the promotion lasts, in days' })
  @IsOptional() @Type(() => Number) @IsInt() @Min(1) @Max(30)
  days?: number;
}

export class BoostBalanceDto {
  @ApiProperty({ example: 10, description: 'Credits included by my current plan' }) planCredits: number;
  @ApiProperty({ example: 0 }) granted: number;
  @ApiProperty({ example: 3 }) spent: number;
  @ApiProperty({ example: 7 }) available: number;
}

export class BoostDto {
  @ApiProperty({ format: 'uuid' }) id: string;
  @ApiProperty({ example: 'APPLICATION_PROMOTION' }) boost_type: string;
  @ApiPropertyOptional({ nullable: true, format: 'uuid' }) target_id: string | null;
  @ApiProperty({ example: 'ACTIVE' }) status: string;
  @ApiProperty({ example: 1 }) credits_spent: number;
  @ApiProperty({
    example: 1.5, type: Number,
    description: 'Ranking multiplier, hard-capped at 1.5 so relevance always dominates',
  })
  weight: number;
  @ApiPropertyOptional({ nullable: true, format: 'date-time' }) ends_at: string | null;
}
